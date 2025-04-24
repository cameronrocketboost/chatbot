import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AIMessage, HumanMessage, BaseMessage } from '@langchain/core/messages';

// --- Initialize Supabase Client ---
// Environment variables are assumed to be validated by the main server entrypoint
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let supabaseInstance: SupabaseClient | null = null;

try {
  supabaseInstance = createClient(
    supabaseUrl,
    supabaseServiceRoleKey,
    { auth: { persistSession: false } } 
  );
  console.log("Supabase client initialized successfully in supabaseRepo.");
} catch (error) {
  console.error("Failed to initialize Supabase client in supabaseRepo:", error);
  // Throw error to prevent repo usage without a client
  throw new Error("Supabase client could not be initialized.");
}

// Export the initialized client instance
export const supabase = supabaseInstance;

// --- Constants ---
// Get history limit from env or default, ensure it's available here
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT ?? 10);

// --- Helper Function to get or create conversation ID --- 
export async function getOrCreateConversationId(threadId: string): Promise<string | null> {
  if (!supabase) {
      console.error('Supabase client not available in getOrCreateConversationId');
      return null;
  }
  try {
    // Check if conversation exists
    let { data: conversation, error: fetchError } = await supabase
      .from('conversations')
      .select('id')
      .eq('thread_id', threadId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116: Row not found
      console.error(`[supabaseRepo] Error fetching conversation for thread ${threadId}:`, fetchError);
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
      console.error(`[supabaseRepo] Error creating conversation for thread ${threadId}:`, createError);
      return null;
    }

    console.log(`[supabaseRepo] Created new conversation record for thread ${threadId} with ID: ${newConversation?.id}`);
    return newConversation?.id ?? null;

  } catch (error) {
    console.error(`[supabaseRepo] Unexpected error getting/creating conversation ID for thread ${threadId}:`, error);
    return null;
  }
}

// --- Helper Function to add a message to Supabase --- 
export async function addMessageToConversation(
  threadId: string,
  message: { role: 'user' | 'assistant'; content: string; thinking_state?: string | null, metadata?: Record<string, any> | null },
): Promise<boolean> {
  if (!supabase) {
      console.error('Supabase client not available in addMessageToConversation');
      return false;
  }

  try {
    const conversationId = await getOrCreateConversationId(threadId);
    if (!conversationId) {
      console.error(`[supabaseRepo] Could not get or create conversation ID for thread ${threadId}, cannot save message.`);
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
      console.error(`[supabaseRepo] Error fetching last message order for conv ${conversationId}:`, orderError);
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
      console.error(`[supabaseRepo] Error inserting message for conv ${conversationId}:`, insertError);
      return false;
    }

    console.log(`[supabaseRepo] Message [${message.role}, order ${nextOrder}] saved for thread ${threadId} (conv ${conversationId})`);
    return true;
  } catch (error) {
    console.error(`[supabaseRepo] Unexpected error saving message for thread ${threadId}:`, error);
    return false;
  }
}

// --- Helper Function to fetch message history from Supabase --- 
export async function getMessageHistory(threadId: string): Promise<BaseMessage[]> {
  if (!supabase) {
      console.error('Supabase client not available in getMessageHistory');
      return [];
  } 

  try {
    const conversationId = await getOrCreateConversationId(threadId);
    if (!conversationId) {
      console.error(`[supabaseRepo] Could not get conversation ID for thread ${threadId}, cannot fetch history.`);
      return [];
    }

    const { data: messages, error } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('display_order', { ascending: false }) 
      .limit(HISTORY_LIMIT); // Use the constant defined above

    if (error) {
      console.error(`[supabaseRepo] Error fetching message history for conv ${conversationId}:`, error);
      return [];
    }

    // Convert to LangChain message format and reverse 
    const formattedMessages: BaseMessage[] = messages
      .map(msg => {
        if (msg.role === 'user') {
          return new HumanMessage(msg.content);
        } else if (msg.role === 'assistant') {
          return new AIMessage(msg.content);
        } else {
          return null;
        }
      })
      .filter((msg): msg is BaseMessage => msg !== null)
      .reverse();

    console.log(`[supabaseRepo] Fetched ${formattedMessages.length} messages for history (limit ${HISTORY_LIMIT}) (thread ${threadId}, conv ${conversationId})`);
    return formattedMessages;

  } catch (error) {
    console.error(`[supabaseRepo] Unexpected error fetching history for thread ${threadId}:`, error);
    return [];
  }
} 