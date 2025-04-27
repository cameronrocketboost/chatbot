import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

// Imports for DI
import { createClient } from '@supabase/supabase-js';
import { OpenAIEmbeddings } from '@langchain/openai';
import { loadChatModel } from './shared/utils.js';

import {
  addMessageToConversation,
  getMessageHistory,
  supabase as supabaseRepoClient,
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

// ---------------------------------------------------------------------------
//  Initialize Dependencies for Injection
// ---------------------------------------------------------------------------
const supabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
   auth: { persistSession: false } // Recommended for backend
});
const embeddings = new OpenAIEmbeddings();
const chatModel = loadChatModel(process.env.DEFAULT_QUERY_MODEL || "openai/gpt-4o"); // Load default model

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

// Updated CORS: Use explicit origin array from environment variable
const defaultAllowedOrigins = 'https://chatbot-1-sujm.onrender.com,http://localhost:3000';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || defaultAllowedOrigins).split(',').map(origin => origin.trim());

console.log('[CORS] Allowed Origins:', allowedOrigins); // Log allowed origins for debugging

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests) - needed for some deployment health checks too
    if (!origin) return callback(null, true);
    
    // Check if the origin is in the allowed list
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
      console.error('[CORS] Blocked Origin:', origin); // Log blocked origins
      return callback(new Error(msg), false);
    }
    
    // Origin is allowed
    return callback(null, true);
  },
  credentials: true,
  optionsSuccessStatus: 204 // Use 204 for OPTIONS preflight success
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

    const { data, error } = await supabaseRepoClient
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

// UNCOMMENT: This endpoint is now NON-STREAMING
app.post('/custom_chat/invoke', async (req: Request, res: Response): Promise<void> => {
  console.log(`[${new Date().toISOString()}] >>> ENTERED /chat/invoke handler`);
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

    // Use supabaseRepoClient for direct repo operations
    await addMessageToConversation(threadId, { role: 'user', content: userMsg });
    const history = await getMessageHistory(threadId);
    
    const graphInput = { query: userMsg, contextMessages: history };

    // Ensure chatModel promise is resolved before passing to config
    const resolvedChatModel = await chatModel;

    // Construct graph config with injected dependencies
    const graphCfg = {
      configurable: { 
        thread_id: threadId, 
        ...ensureAgentConfiguration({}),
        // Injected dependencies:
        supabaseClient: supabaseClient,
        embeddings: embeddings,
        chatModel: resolvedChatModel, 
      },
    } as const;

    // console.log(`[${threadId}] Invoking graph with config:`, JSON.stringify(graphCfg, null, 2)); // Log the config - REMOVED JSON.stringify due to circular refs
    console.log(`[${threadId}] Invoking graph with thread_id: ${graphCfg.configurable.thread_id}`); // Log thread_id only
    const finalState = await (retrievalGraph as any).invoke(graphInput, graphCfg);
    console.log(`[${threadId}] Graph invocation complete.`);
    // console.log('Final State:', JSON.stringify(finalState, null, 2)); // Optional: Log final state

    // Extract final message from the final state
    // --- SIMPLIFIED EXTRACTION LOGIC ---
    let finalContent = 'Sorry, I could not generate a response.'; // Default error
    const finalMessages = finalState?.messages;

    if (Array.isArray(finalMessages) && finalMessages.length > 0) {
      const lastMessage = finalMessages[finalMessages.length - 1];
      // Directly access kwargs.content, assuming the last message is the AI response
      if (lastMessage && (lastMessage as any).kwargs?.content) {
        finalContent = (lastMessage as any).kwargs.content;
      } else if (lastMessage?.content) {
        // Add a fallback for potential messages that might just have a .content property
        finalContent = lastMessage.content;
      }
    }
    // --- END SIMPLIFIED EXTRACTION LOGIC ---

    // --- EXTRACT SOURCES --- 
    let sourceList: string[] = [];
    if (Array.isArray(finalState?.documents) && finalState.documents.length > 0) {
      // Map documents to their source metadata and filter out duplicates/nulls
      const sources: (string | undefined)[] = finalState.documents.map(
        (doc: { metadata?: { source?: unknown } }) => 
          typeof doc.metadata?.source === 'string' ? doc.metadata.source : undefined
      );
      const validSources: string[] = sources.filter((source): source is string => typeof source === 'string');
      sourceList = [...new Set(validSources)];
    }
    // --- END EXTRACT SOURCES ---

    // Send standard JSON response including sources
    console.log(`[${threadId}] Sending response:`, finalContent);
    console.log(`[${threadId}] Sources:`, sourceList);
    res.json({ role: 'assistant', content: finalContent, sources: sourceList });

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
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});