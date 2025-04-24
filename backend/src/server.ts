// import { graph as ingestion_graph } from './ingestion_graph/graph.js'; // REMOVED - Unused
// import { graph as retrieval_graph } from './retrieval_graph/graph.js'; // REMOVED - Unused
// import { addRoutes } from '@langchain/langgraph'; // REMOVED - Incorrect import
import express from 'express';
// import { RunnableConfig } from '@langchain/core/runnables'; // REMOVED - Unused
// import { BaseCheckpointSaver } from '@langchain/langgraph'; // REMOVED - Unused import
import cors from 'cors';
import dotenv from 'dotenv';
// import { Client as LangGraphClient } from '@langchain/langgraph-sdk'; // REMOVE Client SDK import
import { v4 as uuidv4 } from 'uuid'; // Import for data-stream v1 final message ID
// import { createClient, SupabaseClient } from '@supabase/supabase-js'; // REMOVED - Supabase imports are now in supabaseRepo
// import { HumanMessage, BaseMessage } from '@langchain/core/messages';
// import { addRoutes } from '@langchain/core/utils/langgraph'; // REMOVED - Cannot find module
// import { graph as ingestionGraph } from './ingestion_graph/graph.js'; // REMOVED - No longer mounting graph routes here
// import { graph as retrievalGraph } from './retrieval_graph/graph.js'; // REMOVED - No longer mounting graph routes here

// Import Supabase helpers from the repo module (Should #6)
import {
  addMessageToConversation,
  getMessageHistory,
  supabase 
} from './supabaseRepo.js'; // Add .js extension

// --- REMOVE LangServe addRoutes import --- 
// import { addRoutes } from '@langchain/langserve'; 
import { graph as retrievalGraph }  from './retrieval_graph/graph.js'; // Keep graph definitions
// REMOVE unused ingestionGraph import
// import { graph as ingestionGraph }  from './ingestion_graph/graph.js'; 

// Import config helper to get defaults
// REMOVE AgentConfigurationAnnotation import
import { ensureAgentConfiguration } from './retrieval_graph/configuration.js';
import { RunnableConfig } from '@langchain/core/runnables'; // Import RunnableConfig if not already present

dotenv.config({ path: '../.env' }); // Load root .env file first

// --- REMOVE Unused Type Definitions --- 
/*
interface LLMStreamChunkData {
  chunk: string;
}

interface LLMStreamChunk {
  event: 'on_llm_stream';
  data: LLMStreamChunkData;
  // Add other potential event/data structures if known
}

interface GraphFinalStateValues {
  documents?: any[]; // Define more strictly if document structure is known
  response?: string; // Or whatever the final response field is named
  // Add other expected values from the graph state
}

interface GraphFinalState {
  values: GraphFinalStateValues;
  // Add other top-level state properties if known (e.g., config, version)
}
*/

// --- Environment Variable Validation (Must #1) ---
const REQUIRED_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY', 
  // 'GRAPH_API_URL', // REMOVE check for GRAPH_API_URL
  // 'LANGCHAIN_API_KEY' // REMOVE check for LANGCHAIN_API_KEY (unless used elsewhere)
];

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    // Throw an error to prevent the server from starting with missing critical config
    throw new Error(`Missing critical environment variable: ${key}`);
  }
}
console.log("All critical environment variables are set.");

// --- REMOVE LangGraph Client Initialization Block ---
// const langGraphClient = new LangGraphClient({ ... });
// console.log("LangGraph client initialized successfully.");

// --- Initialize Supabase Client (from Repo) ---
// We still need supabase for the /conversations/create endpoint
if (!supabase) {
  throw new Error("Supabase client failed to initialize in repository.");
}

// --- Constants ---
// const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT ?? 10);
// console.log(`Using history limit: ${HISTORY_LIMIT}`);

const app = express();
const port = process.env.PORT || 2024;

// --- CORS Configuration ---
// Load allowed origins from environment variable
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*']; // Default to allow all if not set
console.log('Allowed CORS origins:', allowedOrigins);

// Replace callback with static options object (Should #7)
app.use(cors({
  origin: allowedOrigins, // Use the parsed list or wildcard
  credentials: true 
}));

// Middleware to parse JSON bodies
app.use(express.json());

// --- REMOVE Mounting LangGraph Routes --- 
// addRoutes(app, retrievalGraph, { path: '/retrieval' });
// addRoutes(app, ingestionGraph,  { path: '/ingestion' });
// console.log('[Boot] LangGraph routes mounted via LangServe: /retrieval /ingestion');

// --- API Endpoints (/ , /chat/threads , /conversations/create) ---
// NOTE: The custom /chat/threads might conflict or be redundant now?
// The addRoutes for retrievalGraph already adds POST /retrieval/threads
// Review if the custom /chat/threads endpoint is still needed or should be removed/adapted.
app.get('/', (_req: express.Request, res: express.Response) => { // Add types
  res.send('LangGraph Backend is running!');
});

// Endpoint to create a new *logical* chat thread ID for the client
app.post('/chat/threads', async (_req: express.Request, res: express.Response) => {
  try {
    // Generate a new UUID for the client to use as the thread ID
    const newThreadId = uuidv4(); 
    console.log('[POST /chat/threads] Generated new thread ID:', newThreadId);
    // Respond with the generated ID
    res.json({ threadId: newThreadId }); 
  } catch (error: any) {
    // Error handling remains the same
    console.error('[POST /chat/threads] Error generating new thread ID:', error);
    res.status(500).json({ error: error.message || 'Failed to generate thread ID' });
  }
});

// Create new conversation (Generates ID + Saves Supabase record)
app.post('/conversations/create', async (req: express.Request, res: express.Response) => {
  try {
    if (!supabase) {
      res.status(500).json({ error: 'Supabase client not available' });
      return;
    }
    const title = (req.body as any).title || 'New Conversation';
    // Generate a UUID for the threadId
    const threadId = uuidv4(); 
    console.log(`[POST /conversations/create] Generated Graph thread ID: ${threadId}`);
    // Save conversation record in Supabase
    const { data: conversationData, error } = await supabase
      .from('conversations')
      .insert({ thread_id: threadId, title })
      .select('id, thread_id, title, created_at, updated_at')
      .single();
    if (error) throw error;
    // Respond with conversation info including the generated threadId
    res.json({ ...conversationData, threadId });
  } catch (error: any) {
    console.error('[POST /conversations/create] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Helper function to send SSE data frames ---
function sendSSE(res: express.Response, data: any, _eventType: string = 'message') {
  // Ensure response is writable before attempting to write
  if (!res.writableEnded) {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`); // Standard SSE data field + double newline
    } catch (error) {
      console.error("[SSE Helper] Error writing to stream:", error);
      // Optionally close the response here if writing fails critically
      // if (!res.writableEnded) res.end(); 
    }
  }
}

// --- New SSE Chat Streaming Endpoint --- 
app.post('/chat/stream', async (req: express.Request, res: express.Response): Promise<void> => {
  console.log("[POST /chat/stream] Request received.");

  const requestBody = req.body as { messages?: { role: string; content: string }[], threadId?: string };
  const messages = requestBody?.messages ?? [];
  const currentThreadIdFromRequest = requestBody?.threadId;
  const userMessageContent = messages.length > 0 ? messages[messages.length - 1].content : null;

  // --- Validate User Message --- 
  const trimmedContent = userMessageContent?.trim() ?? '';
  if (trimmedContent === '') { // Check for empty/whitespace-only
    console.warn("[POST /chat/stream] Missing or empty message content.", req.body);
    // Always respond with SSE-framed error instead of raw JSON
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    res.flushHeaders?.(); // Ensure headers reach the client immediately
    const sendError = (obj: unknown) => res.write(`data:${JSON.stringify(obj)}\n\n`);
    sendError({ error: 'Message content cannot be empty' });
    sendError("[DONE]");
    res.end();
    return;
  }
  
  // --- Backend safety net for short messages (Revised) --- 
  if (trimmedContent.length < 2) {
    console.log(`[POST /chat/stream] Query too short (${trimmedContent.length} chars), sending clarification.`);
    // Set headers using writeHead for SSE
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
    });
    res.flushHeaders?.(); // Ensure headers sent
    // Helper to send SSE frames (defined later, but usable here)
    const sendHelper = (obj: unknown) => res.write(`data:${JSON.stringify(obj)}\n\n`);
    sendHelper({ role: "assistant", content: "Could you finish your question first? 😊" });
    sendHelper("[DONE]");
    res.end();
    return;
  }
  
  let currentThreadId = currentThreadIdFromRequest;

  try {
    // --- Thread ID Handling & Initial Message Save --- 
    if (!currentThreadId) {
      console.log("[POST /chat/stream] No threadId provided, generating new thread ID...");
      currentThreadId = uuidv4();
      console.log("[POST /chat/stream] New thread ID generated:", currentThreadId);
      res.setHeader('X-Chat-Thread-Id', currentThreadId); 
      await addMessageToConversation(currentThreadId, { role: 'user', content: userMessageContent! });
      console.log("[POST /chat/stream] Saved initial user message to new thread.");
    } else {
      await addMessageToConversation(currentThreadId, { role: 'user', content: userMessageContent! });
    }

    // --- Set headers for data-stream v1 protocol (SSE) using writeHead ---
    // Combined header setting and status code
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    // Ensure headers reach the client immediately
    res.flushHeaders?.(); 

    // --- SSE Heartbeat ---
    const heartbeatInterval = setInterval(() => {
      if (!res.writableEnded) {
          sendSSE(res, { type: 'heartbeat', timestamp: Date.now() }, 'heartbeat');
      } else {
          clearInterval(heartbeatInterval); // Stop if connection closes
      }
    }, 15000); // Send every 15 seconds

    // --- Prepare Graph Input State (Using correct fields) --- 
    const history = await getMessageHistory(currentThreadId!); 
    const graphInputState = {
      // Use the specific field names expected by the graph state
      query: trimmedContent,                 // Pass the non-empty user message
      contextMessages: history,            // Pass the fetched history 
    }; 
    
    // --- Prepare Graph Config --- 
    const baseConfig: RunnableConfig = {}; 
    const agentDefaults = ensureAgentConfiguration(baseConfig);
    const graphConfig = {
      configurable: {
        thread_id: currentThreadId!,
        ...agentDefaults 
      },
      // Set stream mode to only get messages patches
      streamMode: ["messages"] as ("messages")[], 
    };
    console.log('[POST /chat/stream] Using graph config:', JSON.stringify(graphConfig));

    // --- Direct Graph Execution & Streaming Loop (REVISED AGAIN) --- 

    // helper – send one SSE frame
    const send = (obj: unknown) => res.write(`data:${JSON.stringify(obj)}\n\n`);

    try {
      console.log(`[POST /chat/stream] Invoking retrievalGraph.stream for thread ${currentThreadId}`);
      // Use graphInputState and graphConfig as defined above
      const stream = await retrievalGraph.stream(graphInputState, graphConfig); 
      
      // Iterate over the stream of message patches
      for await (const patch of stream) {
        // Check if it's a messages patch
        if (!("messages" in patch)) continue;

        const lastMessage = patch.messages.at(-1);
        
        // CONCISE LOGGING (Revised)
        // console.log( // Optional: Keep or remove concise logging
        //   `[Patch] ${meta?.langgraph_node ?? "?"} ` +
        //   (patch.messages ? `Δ=${patch.messages.length}` : Object.keys(patch)[0] ?? 'unknown')
        // );
        // END CONCISE LOGGING
        
        // --- STREAM EVERY AI CHUNK / MESSAGE (Using send helper) ---
        if (
          lastMessage &&
          lastMessage.type?.startsWith("AIMessage") // Catches AIMessageChunk and AIMessage
          // No need to check role explicitly if type check is sufficient
        ) {
          send(lastMessage); // ← Emits each chunk/message in proper SSE format
        }
      }
      console.log(`[POST /chat/stream] Graph stream finished for thread ${currentThreadId}.`);
      // Removed logging of finalState

    } catch (streamError: any) {
      console.error(`[POST /chat/stream] Error *during* graph stream execution for thread ${currentThreadId}:`, streamError);
      // Try to send an error event via SSE if stream is still open and writeable
      if (!res.writableEnded) {
          try {
              // Standard SSE error format (can adjust if needed)
              const errorData = JSON.stringify({ error: streamError.message || 'Error during stream execution' });
              res.write(`event: error
data: ${errorData}

`); 
          } catch (writeError) {
              console.error("[SSE Error] Failed to write error to stream:", writeError);
          }
      }
      // No need to re-throw if we handle it here, error will be logged, heartbeat cleared in finally
    } finally {
      clearInterval(heartbeatInterval);
      console.log(`[POST /chat/stream] Heartbeat cleared for thread ${currentThreadId}.`);
    }

    // End the SSE stream cleanly and signal completion
    if (!res.writableEnded) {
      console.log('[POST /chat/stream] Ending SSE stream with [DONE].');
      send("[DONE]"); // Use send helper to signal end of stream
      res.end(); 
    }

  } catch (error: any) {
    // Overall error handling (e.g., initial DB save fails)
    console.error(`[POST /chat/stream] Overall error for thread ${currentThreadId || 'N/A'}:`, error);
    // Ensure heartbeat is cleared if it exists
    // if (typeof heartbeatInterval !== 'undefined' && heartbeatInterval) clearInterval(heartbeatInterval);
    
    // Send error response if headers haven't been sent
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'An unexpected server error occurred.' });
    } else if (!res.writableEnded) {
      // If headers were sent, try to send an SSE error event and end
      if (!res.writableEnded) { // Check if writable before attempting to write
          try {
              const errorData = JSON.stringify({ error: error.message || 'An unexpected server error occurred.' });
              res.write(`event: error
data: ${errorData}

`);
          } catch (writeError) {
              console.error("[SSE Error] Failed to write overall error to stream:", writeError);
          }
          res.end(); // End the stream even if writing the error fails
      }
    }
  }
});

// --- Start Server --- 
app.listen(port, () => {
  console.log(`LangGraph server listening on port ${port}`);
}); 