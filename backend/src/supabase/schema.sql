-- Conversations Table
-- Stores metadata about each conversation
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT 'New Conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID, -- Optional, for when authentication is implemented
  metadata JSONB DEFAULT '{}'::jsonb -- Flexible field for additional metadata
);

-- Create index on thread_id for faster lookups
CREATE INDEX idx_conversations_thread_id ON conversations(thread_id);

-- Index for user_id for when auth is implemented
CREATE INDEX idx_conversations_user_id ON conversations(user_id);

-- Messages Table
-- Stores all messages in conversations
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user', 'assistant', etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  display_order INT NOT NULL, -- Order of messages in conversation
  thinking_state TEXT, -- For storing thinking state messages
  metadata JSONB DEFAULT '{}'::jsonb -- For sources and other metadata
);

-- Create index on conversation_id for faster lookups
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);

-- Index on display_order for sorting messages in a conversation
CREATE INDEX idx_messages_order ON messages(conversation_id, display_order);

-- Function to update updated_at timestamp on conversations
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations SET updated_at = NOW() WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update conversation timestamp when new message is added
CREATE TRIGGER trigger_update_conversation_timestamp
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_timestamp();

-- Add cleanup for abort controllers
function setupAbortController() {
  const controller = new AbortController();
  // Track controllers to clean them up
  abortControllers.push(controller);
  
  // Limit to last 5 controllers to prevent leaks
  if (abortControllers.length > 5) {
    const oldController = abortControllers.shift();
    oldController.abort(); // Clean up old controller
  }
  
  return controller;
}

-- Fix state management for refinement and query evaluation
async function evaluateRetrievalQuality(state) {
  // Always use the current query for evaluation
  const currentQuery = state.query;
  
  // Ensure proper tracking of refinement attempts
  const refinementCount = state.refinementCount || 0;
  
  // Reset refinement count if this is a new query
  if (state.originalQuery !== currentQuery && !state.refinedQuery) {
    return { 
      refinementCount: 0,
      originalQuery: currentQuery
    };
  }
}

CREATE INDEX idx_documents_source ON documents USING gin ((metadata->'source'));

CREATE TABLE document_registry (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  title TEXT,
  upload_date TIMESTAMP DEFAULT NOW(),
  document_type TEXT,
  chunk_count INTEGER
); 