import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";

import {
  addMessageToConversation,
  getMessageHistory,
  supabase,
} from "./supabaseRepo.js";

import { graph as retrievalGraph } from "./retrieval_graph/graph.js";
import { ensureAgentConfiguration } from "./retrieval_graph/configuration.js";
import { RunnableConfig } from "@langchain/core/runnables";

/* ---------------------------------------------------------------------------
 * ENVIRONMENT
 * ------------------------------------------------------------------------ */
dotenv.config({ path: "../.env" });

const REQUIRED_ENV_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
];
REQUIRED_ENV_VARS.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`Missing critical environment variable: ${key}`);
  }
});
console.log("All critical environment variables are set.");

if (!supabase) {
  throw new Error("Supabase client failed to initialise in repository.");
}

/* ---------------------------------------------------------------------------
 * EXPRESS APP BASICS
 * ------------------------------------------------------------------------ */
const app = express();
const port = process.env.PORT || 2024;

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") ?? ["*"];
console.log("Allowed CORS origins:", allowedOrigins);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json());

/* ---------------------------------------------------------------------------
 * SIMPLE HEALTH‑CHECK ENDPOINTS
 * ------------------------------------------------------------------------ */
app.get("/", (_req, res) => {
  res.send("LangGraph Backend is running!");
});

app.post("/chat/threads", async (_req, res) => {
  try {
    const threadId = uuidv4();
    console.log("[POST /chat/threads] Generated new thread ID:", threadId);
    res.json({ threadId });
  } catch (err) {
    const error = err as Error;
    console.error("[POST /chat/threads] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/conversations/create", async (req, res) => {
  try {
    const title = req.body?.title ?? "New Conversation";
    const threadId = uuidv4();

    const { data, error } = await supabase
      .from("conversations")
      .insert({ thread_id: threadId, title })
      .select("id, thread_id, title, created_at, updated_at")
      .single();

    if (error) throw error;
    res.json({ ...data, threadId });
  } catch (err) {
    const error = err as Error;
    console.error("[POST /conversations/create] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

/* ---------------------------------------------------------------------------
 * CHAT STREAM ENDPOINT (SSE – data‑stream v1)
 * ------------------------------------------------------------------------ */
app.post("/chat/stream", async (req, res) => {
  console.log("[POST /chat/stream] Request received.");

  const { messages = [], threadId: incomingThreadId } = req.body as {
    messages?: { role: string; content: string }[];
    threadId?: string;
  };

  const userMessageContent = messages.at(-1)?.content ?? "";
  const trimmedContent = userMessageContent.trim();

  /* --- basic validation -------------------------------------------------- */
  if (!trimmedContent) {
    return sseError(res, "Message content cannot be empty");
  }
  if (trimmedContent.length < 3) {
    return sseError(res, "Could you finish your question first? 😊");
  }

  /* --- thread set‑up ------------------------------------------------------ */
  let threadId = incomingThreadId ?? uuidv4();
  if (!incomingThreadId) {
    res.setHeader("X-Chat-Thread-Id", threadId);
  }

  await addMessageToConversation(threadId, {
    role: "user",
    content: userMessageContent,
  });

  /* --- prepare SSE headers ----------------------------------------------- */
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  /* --- heartbeat ---------------------------------------------------------- */
  let heartbeat: NodeJS.Timeout | null = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: "heartbeat", t: Date.now() })}\n\n`);
    }
  }, 15_000);

  /* --- call LangGraph ----------------------------------------------------- */
  try {
    const history = await getMessageHistory(threadId);

    const graphInput = {
      query: trimmedContent,
      contextMessages: history,
    };

    const baseConfig: RunnableConfig = {} as RunnableConfig;
    const graphConfig = {
      configurable: {
        thread_id: threadId,
        ...ensureAgentConfiguration(baseConfig),
      },
      streamMode: ["messages"] as ("messages" | "values")[],
    };

    const stream = await retrievalGraph.stream(graphInput, graphConfig);

    for await (const patch of stream) {
      if (!("messages" in patch)) continue;
      const last = patch.messages.at(-1);
      if (last && last.type?.startsWith("AIMessage")) {
        res.write(`data: ${JSON.stringify(last)}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
  } catch (err) {
    const error = err as Error;
    console.error("[POST /chat/stream] Stream error:", error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.write("data: [DONE]\n\n");
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    res.end();
  }
});

/* ---------------------------------------------------------------------------
 * HELPERS
 * ------------------------------------------------------------------------ */
function sseError(res: express.Response, message: string) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

/* ---------------------------------------------------------------------------
 * BOOT
 * ------------------------------------------------------------------------ */
app.listen(port, () => {
  console.log(`LangGraph server listening on port ${port}`);
});
