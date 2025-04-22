import { createClient } from '@supabase/supabase-js';
import { Message } from '@/types/chat';

// Types
export interface Conversation {
  id: string;
  thread_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  user_id?: string;
  metadata?: Record<string, any>;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

// Create Supabase client using the same credentials as the vector store
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials for conversation management');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

/**
 * Creates a new conversation record linked to a LangGraph thread
 */
export async function createConversation(thread_id: string, title = 'New Conversation') {
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      thread_id,
      title
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating conversation:', error);
    throw new Error(`Failed to create conversation: ${error.message}`);
  }

  return data as Conversation;
}

/**
 * Gets a conversation by thread_id
 */
export async function getConversationByThreadId(thread_id: string) {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('thread_id', thread_id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    console.error('Error fetching conversation:', error);
    throw new Error(`Failed to fetch conversation: ${error.message}`);
  }

  return data as Conversation;
}

/**
 * Gets all conversations, optionally filtering by user_id
 */
export async function getConversations(user_id?: string) {
  let query = supabase
    .from('conversations')
    .select('*')
    .order('updated_at', { ascending: false });

  if (user_id) {
    query = query.eq('user_id', user_id);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching conversations:', error);
    throw new Error(`Failed to fetch conversations: ${error.message}`);
  }

  return data as Conversation[];
}

/**
 * Gets a conversation with its messages
 */
export async function getConversationWithMessages(conversation_id: string) {
  // First get the conversation
  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversation_id)
    .single();

  if (conversationError) {
    console.error('Error fetching conversation:', conversationError);
    throw new Error(`Failed to fetch conversation: ${conversationError.message}`);
  }

  // Then get the messages
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversation_id)
    .order('display_order', { ascending: true });

  if (messagesError) {
    console.error('Error fetching messages:', messagesError);
    throw new Error(`Failed to fetch messages: ${messagesError.message}`);
  }

  return {
    ...conversation,
    messages: messages
  } as ConversationWithMessages;
}

/**
 * Adds a message to a conversation
 */
export async function addMessageToConversation(
  conversation_id: string,
  message: {
    content: string;
    role: string;
    thinking_state?: string;
    metadata?: Record<string, any>;
  }
) {
  // Get the current max display_order
  const { data: maxOrderData, error: maxOrderError } = await supabase
    .from('messages')
    .select('display_order')
    .eq('conversation_id', conversation_id)
    .order('display_order', { ascending: false })
    .limit(1)
    .single();

  const nextOrder = maxOrderData ? maxOrderData.display_order + 1 : 0;

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id,
      content: message.content,
      role: message.role,
      thinking_state: message.thinking_state,
      metadata: message.metadata || {},
      display_order: nextOrder
    })
    .select()
    .single();

  if (error) {
    console.error('Error adding message:', error);
    throw new Error(`Failed to add message: ${error.message}`);
  }

  return data;
}

/**
 * Updates a conversation's title
 */
export async function updateConversationTitle(conversation_id: string, title: string) {
  const { data, error } = await supabase
    .from('conversations')
    .update({ title })
    .eq('id', conversation_id)
    .select()
    .single();

  if (error) {
    console.error('Error updating conversation title:', error);
    throw new Error(`Failed to update conversation title: ${error.message}`);
  }

  return data as Conversation;
}

/**
 * Deletes a conversation and all its messages (cascade)
 */
export async function deleteConversation(conversation_id: string) {
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversation_id);

  if (error) {
    console.error('Error deleting conversation:', error);
    throw new Error(`Failed to delete conversation: ${error.message}`);
  }

  return true;
} 