import express, { Application, Request, Response } from 'express';
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

// ---------------------------------------------------------------------------
//  Environment checks
// ---------------------------------------------------------------------------
const REQUIRED_ENV_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'] as const;
REQUIRED_ENV_VARS.forEach((k) => {
  if (!process.env[k]) throw new Error(`Missing env var ${k}`);
});

if (!supabase) throw new Error('Supabase client not initialised');

// ---------------------------------------------------------------------------
//  App setup
// ---------------------------------------------------------------------------
const app: Application = express();
const PORT: number = Number(process.env.PORT ?? 2024);

// ---------------------------------------------------------------------------
//  Middleware
// ---------------------------------------------------------------------------
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '*').split(',');
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// ---------------------------------------------------------------------------
//  Helper: open SSE connection
// ---------------------------------------------------------------------------
function openSSE(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
}

// ---------------------------------------------------------------------------
//  Routes
// ---------------------------------------------------------------------------
app.get('/', (_req: Request, res: Response): void => {
  res.send('LangGraph backend running');
});

app.post('/chat/threads', (_req: Request, res: Response): void => {
  res.json({ threadId: uuidv4() });
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

app.post('/chat/stream', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { messages?: { role: string; content: string }[]; threadId?: string };
  const userMsg: string = body.messages?.at(-1)?.content?.trim() ?? '';

  // Guard clauses -----------------------------------------------------------
  if (!userMsg) {
    openSSE(res);
    res.write(`data:${JSON.stringify({ error: 'Message content cannot be empty' })}\n\ndata:[DONE]\n\n`);
    res.end();
    return;
  }
  if (userMsg.length < 3) {
    openSSE(res);
    res.write(`data:${JSON.stringify({ role: 'assistant', content: 'Could you finish your question first? 😊' })}\n\ndata:[DONE]\n\n`);
    res.end();
    return;
  }

  const threadId: string = body.threadId ?? uuidv4();
  res.setHeader('X-Chat-Thread-Id', threadId);

  await addMessageToConversation(threadId, { role: 'user', content: userMsg });

  openSSE(res);

  // Heart‑beat keep‑alive ----------------------------------------------------
  const heartbeat = setInterval((): void => {
    if (!res.writableEnded) {
      const ok = res.write(`:heartbeat ${Date.now()}\n\n`);
      if (!ok) void res.once('drain', () => {});
    }
  }, 15_000);

  // Abort upstream on disconnect -------------------------------------------
  const ac = new AbortController();
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
      streamMode: ['messages'],
      signal: ac.signal,
    } as const;

    const stream = await (retrievalGraph as any).stream(graphInput, graphCfg);

    for await (const patch of stream as any) {
      if (!('messages' in patch)) continue;
      const last = patch.messages.at(-1);
      if (!last || typeof last.type !== 'string' || !last.type.startsWith('AIMessage')) continue;

      const ok = res.write(`data:${JSON.stringify({ role: 'assistant', content: last.content })}\n\n`);
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

// ---------------------------------------------------------------------------
//  Bootstrap
// ---------------------------------------------------------------------------
app.listen(PORT, (): void => {
  console.log(`LangGraph server listening on ${PORT}`);
});
