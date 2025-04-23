// import { graph as ingestion_graph } from './ingestion_graph/graph.js'; // REMOVED - Unused
// import { graph as retrieval_graph } from './retrieval_graph/graph.js'; // REMOVED - Unused
// import { addRoutes } from '@langchain/langgraph'; // REMOVED - Incorrect import
import express from 'express';
// import { RunnableConfig } from '@langchain/core/runnables'; // REMOVED - Unused
// import { BaseCheckpointSaver } from '@langchain/langgraph'; // REMOVED - Unused import
import cors from 'cors';
import dotenv from 'dotenv';
import { Client as LangGraphClient } from '@langchain/langgraph-sdk'; // Renamed to avoid conflict
// import { v4 as uuidv4 } from 'uuid'; // REMOVED - Unused import
import { createClient, SupabaseClient } from '@supabase/supabase-js'; // Import Supabase
import { AIMessage, HumanMessage, BaseMessage } from '@langchain/core/messages'; // Import message types

dotenv.config({ path: '../.env' }); // Load root .env file if needed, adjust path as necessary

// --- Initialize Supabase Client --- 
let supabase: SupabaseClient | null = null;
try {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase URL or Service Role Key not set in environment variables.');
  }
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } } // Use service key, no session needed
  );
  console.log("Supabase client initialized successfully.");
} catch (error) {
  console.error("Failed to initialize Supabase client:", error);
  // Decide if the app should exit or continue with limited functionality
  // process.exit(1); 
}

// --- Initialize LangGraph Client --- 
// Ensure necessary backend env vars are set (OpenAI API key, etc.)
if (!process.env.OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY not set. Backend graph calls might fail.");
  // Consider throwing an error if it's strictly required for all graphs
  // throw new Error("Missing critical environment variable: OPENAI_API_KEY");
}

// Initialize the client once for the server instance
// The SDK client doesn't need the LangGraph API URL; it interacts directly if configured
// It *does* need credentials for underlying services (like OpenAI API key)
const langGraphClient = new LangGraphClient(); // Base client

// --- Helper Function to get or create conversation ID --- 
async function getOrCreateConversationId(threadId: string): Promise<string | null> {
  if (!supabase) return null;
  try {
    // Check if conversation exists
    let { data: conversation, error: fetchError } = await supabase
      .from('conversations')
      .select('id')
      .eq('thread_id', threadId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116: Row not found
      console.error(`Error fetching conversation for thread ${threadId}:`, fetchError);
      return null;
    }

    if (conversation) {
      return conversation.id;
    }

    // Conversation doesn't exist, create it
    const { data: newConversation, error: createError } = await supabase
      .from('conversations')
      .insert({ thread_id: threadId })
      .select('id')
      .single();

    if (createError) {
      console.error(`Error creating conversation for thread ${threadId}:`, createError);
      return null;
    }

    console.log(`Created new conversation record for thread ${threadId} with ID: ${newConversation?.id}`);
    return newConversation?.id ?? null;

  } catch (error) {
    console.error(`Unexpected error getting/creating conversation ID for thread ${threadId}:`, error);
    return null;
  }
}

// --- Helper Function to add a message to Supabase --- 
async function addMessageToConversation(
  threadId: string,
  message: { role: 'user' | 'assistant'; content: string; thinking_state?: string | null, metadata?: Record<string, any> | null },
): Promise<boolean> {
  if (!supabase) return false;

  try {
    const conversationId = await getOrCreateConversationId(threadId);
    if (!conversationId) {
      console.error(`Could not get or create conversation ID for thread ${threadId}, cannot save message.`);
      return false;
    }

    // Get the current max display_order for this conversation
    const { data: lastMessage, error: orderError } = await supabase
      .from('messages')
      .select('display_order')
      .eq('conversation_id', conversationId)
      .order('display_order', { ascending: false })
      .limit(1)
      .single();

    if (orderError && orderError.code !== 'PGRST116') { // Ignore 'Row not found'
      console.error(`Error fetching last message order for conv ${conversationId}:`, orderError);
      return false;
    }

    const nextOrder = (lastMessage?.display_order ?? -1) + 1;

    // Insert the new message
    const { error: insertError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role: message.role,
        content: message.content,
        display_order: nextOrder,
        thinking_state: message.thinking_state ?? null,
        metadata: message.metadata ?? {},
      });

    if (insertError) {
      console.error(`Error inserting message for conv ${conversationId}:`, insertError);
      return false;
    }

    console.log(`Message [${message.role}, order ${nextOrder}] saved for thread ${threadId} (conv ${conversationId})`);
    return true;
  } catch (error) {
    console.error(`Unexpected error saving message for thread ${threadId}:`, error);
    return false;
  }
}

// --- Helper Function to fetch message history from Supabase ---
async function getMessageHistory(threadId: string, limit: number = 10): Promise<BaseMessage[]> {
  if (!supabase) return [];

  try {
    const conversationId = await getOrCreateConversationId(threadId);
    if (!conversationId) {
      console.error(`Could not get conversation ID for thread ${threadId}, cannot fetch history.`);
      return [];
    }

    const { data: messages, error } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('display_order', { ascending: false }) // Fetch newest first
      .limit(limit);

    if (error) {
      console.error(`Error fetching message history for conv ${conversationId}:`, error);
      return [];
    }

    // Convert to LangChain message format and reverse to maintain chronological order (oldest first)
    const formattedMessages: BaseMessage[] = messages
      .map(msg => {
        if (msg.role === 'user') {
          return new HumanMessage(msg.content);
        } else if (msg.role === 'assistant') {
          return new AIMessage(msg.content);
        } else {
          // Handle other roles or return null/filter out if necessary
          return null;
        }
      })
      .filter((msg): msg is BaseMessage => msg !== null) // Filter out nulls
      .reverse(); // Reverse to get chronological order

    console.log(`Fetched ${formattedMessages.length} messages for history (thread ${threadId}, conv ${conversationId})`);
    return formattedMessages;

  } catch (error) {
    console.error(`Unexpected error fetching history for thread ${threadId}:`, error);
    return [];
  }
}

// --- REMOVED Unused Type Definition --- 
// interface LLMStreamChunk { ... }

const app = express();
const port = process.env.PORT || 2024;

// --- CORS Configuration ---
// Load allowed origins from environment variable, default to allow all for simplicity (adjust for production)
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    // Allow all origins if set to '*', otherwise check against the list
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // If you need to handle cookies or authorization headers
}));

// Middleware to parse JSON bodies
app.use(express.json());

// --- Add LangGraph routes --- 
// REMOVED addRoutes blocks as they are incorrect for LangGraph SDK usage
// The LangGraph SDK client (in the frontend or other services) interacts 
// directly with the deployed graphs without needing these explicit routes.

// Basic health check endpoint
app.get('/', (_req: express.Request, res: express.Response) => { // Add types
  res.send('LangGraph Backend is running!');
});

// --- New SSE Chat Streaming Endpoint --- 
app.post('/chat/stream', async (req: express.Request, res: express.Response): Promise<void> => {
  console.log("[POST /chat/stream] Request received.");
  let { message, threadId } = req.body as { message?: string; threadId?: string }; 

  if (!message) {
    res.status(400).json({ error: 'Message content is required' });
    return;
  }
  
  const assistantId = "retrieval_graph"; 

  let currentThreadId = threadId; // Use a local variable for the request scope

  try {
    // Create a new thread if one isn't provided & save user message
    if (!currentThreadId) {
      console.log("[POST /chat/stream] No threadId provided, creating new thread...");
      const newThread = await langGraphClient.threads.create();
      currentThreadId = newThread.thread_id;
      console.log(`[POST /chat/stream] Created new thread: ${currentThreadId}`);
      res.write(`event: thread_id\ndata: ${JSON.stringify({ threadId: currentThreadId })}\n\n`);
      await addMessageToConversation(currentThreadId, { role: 'user', content: message });
    } else {
        await addMessageToConversation(currentThreadId, { role: 'user', content: message });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    console.log(`[POST /chat/stream] Starting stream for thread ${currentThreadId}...`);

    const history = await getMessageHistory(currentThreadId); 
    const input = { query: message, contextMessages: history || [] }; 

    const streamResponse = langGraphClient.runs.stream(
      currentThreadId,
      assistantId,
      { input: input, streamMode: "updates" }
    );

    let accumulatedContent = "";

    for await (const chunk of streamResponse) {
       const streamChunk: any = chunk; 
       if (streamChunk.event === 'on_llm_stream' && streamChunk.data?.chunk) {
          const token = streamChunk.data.chunk;
          if (typeof token === 'string') {
              accumulatedContent += token;
              const escapedToken = JSON.stringify(token).slice(1, -1);
              const messageChunk = `0:"${escapedToken}"\n`; 
              res.write(messageChunk); 
          }
       }
    }
    
    console.log(`[POST /chat/stream] Stream finished for thread ${currentThreadId}.`);

    if (accumulatedContent) {
        console.log(`[POST /chat/stream] Fetching final state for thread ${currentThreadId}...`);
        const finalState: any = await langGraphClient.threads.getState(currentThreadId);
        const lastMessageContent = finalState?.values?.messages?.slice(-1)?.[0]?.content ?? accumulatedContent;
        const finalMetadata = { sources: finalState?.values?.documents ?? [] }; 
        
        console.log(`[POST /chat/stream] Saving final assistant message to DB (Length: ${lastMessageContent.length})`);
        if (lastMessageContent) { 
          await addMessageToConversation(currentThreadId, { 
              role: 'assistant', 
              content: lastMessageContent, 
              metadata: finalMetadata 
          });
        } else {
            console.warn(`[POST /chat/stream] No final assistant message content found...`);
        }
    }

    res.end(); 

  } catch (error: any) {
    const errorThreadId = currentThreadId || 'N/A'; 
    console.error(`[POST /chat/stream] Error during stream for thread ${errorThreadId}:`, error);
    try {
      if (!res.headersSent) {
         res.status(500).json({ error: "Failed to process chat stream", details: error.message });
         return;
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ message: error.message || 'Unknown stream error' })}\n\n`);
        res.end();
      }
    } catch (finalError) {
        console.error(`[POST /chat/stream] Error sending error response for thread ${errorThreadId}:`, finalError);
        res.end();
    }
  }
});

// --- Start Server --- 
app.listen(port, () => {
  console.log(`LangGraph server listening on port ${port}`);
}); 