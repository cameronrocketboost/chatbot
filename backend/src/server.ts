import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { once } from 'node:events';

import {
  addMessageToConversation,
  getMessageHistory,
  supabase,
} from './supabaseRepo.js';

import { graph as retrievalGraph } from './retrieval_graph/graph.js';
import { ensureAgentConfiguration } from './retrieval_graph/configuration.js';

dotenv.config({ path: '../.env' });

const REQUIRED_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
] as const;

for (const k of REQUIRED_ENV_VARS) {
  if (!process.env[k]) throw new Error(`Missing env var ${k}`);
}

if (!supabase) throw new Error('Supabase client not initialised');

const app = express();
const PORT = process.env.PORT ?? 2024;

// ---------- middleware ----------
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '*').split(',');
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// ---------- helper: SSE headers ----------
function openSSE(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx buffering off
  });
  res.flushHeaders();
}

// ---------- routes ----------
app.get('/', (_req: Request, res: Response): void => {
  res.send('LangGraph backend running');
});

app.post('/chat/threads', (_req: Request, res: Response): void => {
  const threadId = uuidv4();
  res.json({ threadId });
});

app.post('/conversations/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const { title = 'New conversation' } = req.body as { title?: string };
    const threadId = uuidv4();

    const { data, error } = await supabase
      .from('conversations')
      .insert({ thread_id: threadId, title })
      .select()
      .single();

    if (error) throw error;
    res.json({ ...data, threadId });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
});

/**
 * Core streaming endpoint
 */
app.post('/chat/stream', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    messages?: { role: string; content: string }[];
    threadId?: string;
  };

  const userMsg = body.messages?.at(-1)?.content?.trim() ?? '';

  if (!userMsg) {
    openSSE(res);
    res.write(
      `data:${JSON.stringify({ error: 'Message content cannot be empty' })}\n\ndata:[DONE]\n\n`,
    );
    res.end();
    return;
  }

  if (userMsg.length < 3) {
    openSSE(res);
    res.write(
      `data:${JSON.stringify({ role: 'assistant', content: 'Could you finish your question first? 😊' })}\n\ndata:[DONE]\n\n`,
    );
    res.end();
    return;
  }

  const threadId = body.threadId ?? uuidv4();
  res.setHeader('X-Chat-Thread-Id', threadId);

  await addMessageToConversation(threadId, { role: 'user', content: userMsg });

  openSSE(res);

  // heartbeat
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      const ok = res.write(`:heartbeat ${Date.now()}\n\n`);
      if (!ok) void res.once('drain', () => {});
    }
  }, 15_000);

  // AbortController to cancel upstream when client disconnects
  const ac = new AbortController();
  const { signal } = ac;

  const cleanup = (): void => {
    ac.abort();
    clearInterval(heartbeat);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);

  try {
    const history = await getMessageHistory(threadId);
    const graphInput = { query: userMsg, contextMessages: history };

    const graphCfg = {
      configurable: { thread_id: threadId, ...ensureAgentConfiguration({}) },
      streamMode: ['messages' as const],
      signal,
    };

    const stream = await retrievalGraph.stream(graphInput, graphCfg as any);

    for await (const patch of stream) {
      if (!('messages' in patch)) continue;
      const last = patch.messages.at(-1);
      if (!last || !(last.type as string)?.startsWith('AIMessage')) continue;

      const payload = `data:${JSON.stringify({ role: 'assistant', content: last.content })}\n\n`;
      const ok = res.write(payload);
      if (!ok) await once(res, 'drain');
    }

    res.write('data:[DONE]\n\n');
  } catch (err) {
    const error = err as Error;
    res.write(`data:${JSON.stringify({ error: error.message })}\n\ndata:[DONE]\n\n`);
  } finally {
    cleanup();
    res.end();
  }
});

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`LangGraph server listening on ${PORT}`);
});
