import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

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

// Disable ETag generation to prevent 304 responses which can interfere with streaming
app.disable('etag');

// Disable compression (ensure Content-Encoding is identity)
// This prevents potential buffering by proxies (like Render's) that might apply gzip
app.use((_req, res, next) => {
  res.setHeader('Content-Encoding', 'identity');
  next();
});

// Updated CORS: Use explicit origin array
app.use(cors({
  origin: ['https://chatbot-1-sujm.onrender.com'], // Explicitly list allowed origins
  credentials: true,
  optionsSuccessStatus: 204
}));

app.use(express.json());

// ---------------------------------------------------------------------------
//  Helper: open SSE connection - Removed: No longer used
// ---------------------------------------------------------------------------
// function openSSE(res: Response, origin: string): void {
//   res.setHeader('Content-Type', 'text/event-stream');
//   res.setHeader('Cache-Control', 'no-cache');
//   res.setHeader('Connection', 'keep-alive');
//   res.setHeader('X-Accel-Buffering', 'no'); // nginx-style buffering off
//   res.setHeader('Access-Control-Allow-Origin', origin); // 🔥 CORS for the stream
//   res.setHeader('Access-Control-Allow-Credentials', 'true');
//   res.flushHeaders();
// }

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

// This endpoint is now NON-STREAMING
app.post('/chat/stream', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { messages?: { role: string; content: string }[]; threadId?: string };
  const userMsg: string = body.messages?.at(-1)?.content?.trim() ?? '';

  // Guard clauses -----------------------------------------------------------
  if (!userMsg) {
    res.status(400).json({ error: 'Message content cannot be empty' });
    return;
  }
  if (userMsg.length < 3) {
    res.status(400).json({ role: 'assistant', content: 'Could you finish your question first? 😊' });
    return;
  }

  let threadId: string | undefined = body.threadId; // Allow threadId to be undefined initially

  try { // Wrap main logic in try/catch for error handling
    threadId = threadId ?? uuidv4(); // Assign only if needed and not yet defined
    // res.setHeader('X-Chat-Thread-Id', threadId); // Optional header

    await addMessageToConversation(threadId, { role: 'user', content: userMsg });

    // --- SSE and related logic removed --- 

    const history = await getMessageHistory(threadId);
    const graphInput = { query: userMsg, contextMessages: history };

    const graphCfg = {
      configurable: { thread_id: threadId, ...ensureAgentConfiguration({}) },
      // No streamMode, no signal needed
    } as const;

    console.log(`[${threadId}] Invoking graph...`);
    const finalState = await (retrievalGraph as any).invoke(graphInput, graphCfg);
    console.log(`[${threadId}] Graph invocation complete.`);
    // console.log('Final State:', JSON.stringify(finalState, null, 2)); // Optional: Log final state

    // Extract final message from the final state
    const finalMessages = finalState?.messages ?? [];
    // Find the last message that is an AIMessage based on its ID structure
    const lastAssistantMessage = finalMessages.filter((m: any) => 
        Array.isArray((m as any)?.id) && (m as any).id.at(-1) === 'AIMessage'
    ).pop();
    
    // Extract content from kwargs if available
    const finalContent = (lastAssistantMessage as any)?.kwargs?.content ?? 'Sorry, I could not generate a response.';

    // Send standard JSON response
    console.log(`[${threadId}] Sending response:`, finalContent);
    res.json({ role: 'assistant', content: finalContent });

  } catch (err) {
    const error = err as Error;
    // Use 'unknown' if threadId wasn't successfully assigned before error
    const tid = typeof threadId === 'string' ? threadId : 'unknown'; 
    console.error(`[${tid}] Error processing chat request:`, error);
    res.status(500).json({ error: error.message || 'An internal server error occurred', threadId: tid });
  }
});

// ---------------------------------------------------------------------------
//  Bootstrap
// ---------------------------------------------------------------------------
app.listen(PORT, (): void => {
  console.log(`LangGraph server listening on ${PORT}`);
});
