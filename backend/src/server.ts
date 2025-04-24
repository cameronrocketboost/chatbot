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
import { HumanMessage } from '@langchain/core/messages';
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

// --- New SSE Chat Streaming Endpoint --- 
app.post('/chat/stream', async (req: express.Request, res: express.Response): Promise<void> => {
  console.log("[POST /chat/stream] Request received.");

  const requestBody = req.body as { messages?: { role: string; content: string }[], threadId?: string };
  const messages = requestBody?.messages ?? [];
  const currentThreadIdFromRequest = requestBody?.threadId;
  const userMessageContent = messages.length > 0 ? messages[messages.length - 1].content : null;

  if (!userMessageContent) {
    console.warn("[POST /chat/stream] Missing message content.", req.body);
    res.status(400).json({ error: 'Message content is required' });
    return;
  }
  
  let currentThreadId = currentThreadIdFromRequest;

  try {
    // If threadId is missing, generate a new one
    if (!currentThreadId) {
      console.log("[POST /chat/stream] No threadId provided, generating new thread ID...");
      currentThreadId = uuidv4();
      console.log("[POST /chat/stream] New thread ID generated:", currentThreadId);
      // Set header so client knows the ID (important now!)
      res.setHeader('X-Chat-Thread-Id', currentThreadId); 
      // Save the user message to the *new* thread before proceeding
      await addMessageToConversation(currentThreadId, { role: 'user', content: userMessageContent! });
      console.log("[POST /chat/stream] Saved initial user message to new thread.");
    } else {
      // If threadId *was* provided, save the message as before
      await addMessageToConversation(currentThreadId, { role: 'user', content: userMessageContent! });
    }

    // --- Set headers for data-stream v1 protocol ---
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // --- SSE Heartbeat --- 
    const heartbeatInterval = setInterval(() => { /* ... heartbeat logic ... */ }, 15000);

    // --- Prepare Graph Input State --- 
    const history = await getMessageHistory(currentThreadId!);
    const graphInputMessages = [...history, new HumanMessage(userMessageContent!)];
    const initialState = { messages: graphInputMessages };
    
    // --- Prepare Graph Config (Fix #1) --- 
    // Start with an empty RunnableConfig for type safety
    const baseConfig: RunnableConfig = {}; 
    // Get default configuration values 
    // Pass baseConfig to ensureAgentConfiguration, it expects RunnableConfig
    const agentDefaults = ensureAgentConfiguration(baseConfig);
    const graphConfig = {
      configurable: {
        thread_id: currentThreadId!,
        // Spread the default config values required by the graph's schema
        ...agentDefaults 
      } 
    };
    console.log('[POST /chat/stream] Using graph config:', JSON.stringify(graphConfig));

    // --- Direct Graph Execution & Simplified Streaming --- 
    let finalAiMessageContent = "";
    let finalSources: any[] = [];
    let finalStateSnapshot: any = null;

    try {
      console.log(`[POST /chat/stream] Invoking retrievalGraph.stream for thread ${currentThreadId}`);
      
      // --- Await the stream object first (Fix #2) ---
      const stream = await retrievalGraph.stream(initialState, graphConfig);
      
      // Now iterate over the resolved stream object
      for await (const stateUpdate of stream) {
        // stateUpdate contains the full graph state at each step
        // We just need the *final* state to get the complete AI message
        // console.log("[Stream Update]:", JSON.stringify(stateUpdate, null, 2)); // DEBUG
        finalStateSnapshot = stateUpdate; // Keep track of the latest state
      }
      console.log(`[POST /chat/stream] Graph stream finished for thread ${currentThreadId}.`);

      // Extract final message and sources from the last state snapshot
      if (finalStateSnapshot && Array.isArray(finalStateSnapshot.messages)) {
         const lastMessage = finalStateSnapshot.messages[finalStateSnapshot.messages.length - 1];
         if (lastMessage && (lastMessage.type === 'ai' || lastMessage.role === 'assistant')) {
             finalAiMessageContent = lastMessage.content;
             // Check for sources in the final state (adjust path if needed based on graph state)
             finalSources = finalStateSnapshot.documents ?? []; // Assuming sources are in state.documents
             console.log(`[POST /chat/stream] Extracted final AI message and ${finalSources.length} sources.`);
         } else {
            console.warn('[POST /chat/stream] Last message in final state was not AI:', lastMessage);
            finalAiMessageContent = "Error: Could not extract final AI response.";
         }
      } else {
         console.error('[POST /chat/stream] Could not get final state or messages from graph stream.');
         finalAiMessageContent = "Error: Failed to get final state from graph.";
      }

    } catch (streamError: any) {
      console.error(`[POST /chat/stream] Error *during* graph stream execution for thread ${currentThreadId}:`, streamError);
      if (!res.writableEnded) {
        res.write(`2:${JSON.stringify({ error: streamError.message || 'Error during stream execution' })}\n`);
      }
      throw streamError; // Re-throw to be caught by outer catch
    } finally {
      clearInterval(heartbeatInterval);
      console.log(`[POST /chat/stream] Heartbeat cleared for thread ${currentThreadId}.`);
    }

    // --- Send final structured assistant message (Data Stream v1 Frame 1) ---
    if (!res.writableEnded) {
      const finalMessagePayload = {
        id: uuidv4(),
        role: 'assistant',
        content: finalAiMessageContent,
        parts: [{ type: 'text', text: finalAiMessageContent }],
        metadata: { sources: finalSources }
      };
      res.write(`1:${JSON.stringify(finalMessagePayload)}\n`);
      console.log('[POST /chat/stream] Sent final message frame.');
    } else {
      console.warn('[POST /chat/stream] Response ended before final message could be sent.');
    }

    res.end(); // End the SSE stream

  } catch (error: any) {
    // ... (outer error handling remains mostly the same) ...
    console.error(`[POST /chat/stream] Overall error for thread ${currentThreadId || 'N/A'}:`, error);
    // Clear interval just in case it wasn't cleared in finally (e.g., error before try block)
    // if (typeof heartbeatInterval !== 'undefined') clearInterval(heartbeatInterval);
    if (res.headersSent && !res.writableEnded) { /* ... send error event ... */ }
    if (!res.writableEnded) { res.end(); }
  }
});

// --- Start Server --- 
app.listen(port, () => {
  console.log(`LangGraph server listening on port ${port}`);
}); 