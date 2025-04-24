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
    // Send an error back via SSE if possible, otherwise standard HTTP error
    if (res.headersSent && !res.writableEnded) {
        sendSSE(res, { error: 'Message content cannot be empty' }, 'error');
        res.end();
    } else if (!res.headersSent) {
        res.status(400).json({ error: 'Message content cannot be empty' });
    }
    return;
  }
  
  // --- Backend safety net for short messages --- 
  if (trimmedContent.length < 2) {
    console.log(`[POST /chat/stream] Query too short (${trimmedContent.length} chars), sending clarification.`);
    // Set headers first if not already sent (needed for SSE)
    if (!res.headersSent) {
      res.setHeader('Content-Type','text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
    }
    sendSSE(res, {
      role: "assistant",
      content: "I'll answer once you finish your question 🙂",
    }, 'message');
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

    // --- Set headers for data-stream v1 protocol (SSE) ---
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Send headers immediately

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
      // Set stream mode to get messages patches and final values
      streamMode: ["messages", "values"] as ("messages" | "values")[], 
    };
    console.log('[POST /chat/stream] Using graph config:', JSON.stringify(graphConfig));

    // --- Direct Graph Execution & Streaming Loop --- 
    let finalState: any = null; // Variable to store the final state

    try {
      console.log(`[POST /chat/stream] Invoking retrievalGraph.stream for thread ${currentThreadId}`);
      const stream = await retrievalGraph.stream(graphInputState, graphConfig);
      
      // Iterate over the stream of patches and values
      for await (const patch of stream) {
        // CONCISE LOGGING
        const meta = (patch as any).__meta__ || {}; // Extract metadata if present
        const kind = Object.keys(patch)[0]; // Get the type of patch (e.g., "messages", "values")
        console.log(
          `[Stream Patch] node=${meta.langgraph_node || 'unknown'} type=${kind} ` +
          (kind === "messages" && Array.isArray((patch as any).messages) ? `Δ=${(patch as any).messages.length}` : "")
        );
        // END CONCISE LOGGING
        
        // Check if the patch contains messages updates
        if (patch && typeof patch === 'object' && 'messages' in patch && Array.isArray(patch.messages)) {
          const lastMessage = patch.messages[patch.messages.length - 1];
          
          // --- CORRECTED FILTER --- 
          // Check if it's an AI message OR chunk using startsWith
          if (lastMessage && (lastMessage.type?.startsWith("AIMessage") || lastMessage.role === "assistant") && lastMessage.content) { 
            console.log('[POST /chat/stream] Sending assistant message/chunk patch via SSE');
            sendSSE(res, lastMessage, 'message'); 
            // assistantMessageSent = true; // No longer needed
          }
          // --- END CORRECTED FILTER --- 
        }
        
        // Keep track of the latest patch (which might be the final state)
        finalState = patch; 
      }
      console.log(`[POST /chat/stream] Graph stream finished for thread ${currentThreadId}.`);
      console.log('[POST /chat/stream] Final Data Received:', JSON.stringify(finalState, null, 2)); // Keep logging final state for now

    } catch (streamError: any) {
      console.error(`[POST /chat/stream] Error *during* graph stream execution for thread ${currentThreadId}:`, streamError);
      // Send an error event via SSE if stream is still open
      sendSSE(res, { error: streamError.message || 'Error during stream execution' }, 'error'); 
      // No need to re-throw if we handle it here, just end the response
    } finally {
      clearInterval(heartbeatInterval);
      console.log(`[POST /chat/stream] Heartbeat cleared for thread ${currentThreadId}.`);
    }

    // End the SSE stream cleanly
    if (!res.writableEnded) {
      console.log('[POST /chat/stream] Ending SSE stream.');
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
      sendSSE(res, { error: error.message || 'An unexpected server error occurred.' }, 'error');
      res.end();
    }
  }
});

// --- Start Server --- 
app.listen(port, () => {
  console.log(`LangGraph server listening on port ${port}`);
}); 