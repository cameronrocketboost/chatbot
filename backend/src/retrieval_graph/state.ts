import { Annotation } from '@langchain/langgraph';
// import { MessagesAnnotation } from '@langchain/langgraph'; // Removed
// import { reduceDocs } from '../shared/state.js'; // Removed
import { Document } from '@langchain/core/documents';
// import { BaseMessage } from '@langchain/core/messages'; // Removed

// Add refinement interfaces for query improvement
export interface RefinedQuery {
  refinedQuery: string;
  refinementCount: number;
  query: string;
}

/**
 * Represents the state of the retrieval graph / agent.
 * SIMPLIFIED VERSION
 */
export const AgentStateAnnotation = Annotation.Root({
  /**
   * A list of messages containing the chat history.
   */
  messages: Annotation<any[]>({
    value: (_, update) => update,
    default: () => [],
  }),
  /**
   * The user's query to the assistant.
   */
  query: Annotation<string>({
    value: (_, update) => update,
    default: () => '',
  }),
  /**
   * The route to take during execution.
   */
  route: Annotation<'retrieve' | 'direct' | null>({
    value: (_, update) => update,
    default: () => null,
  }),
  
  /**
   * Context messages from previous conversation
   */
  contextMessages: Annotation<any[]>({
    value: (_, update) => update,
    default: () => [],
  }),
  
  /**
   * List of retrieved documents
   */
  documents: Annotation<Document[]>({
    value: (_, update) => update,
    default: () => [],
  }),

  /**
   * Refinement count for query improvement cycles
   */
  refinementCount: Annotation<number>({
    value: (_, update) => update,
    default: () => 0,
  }),
  
  /**
   * Store the original query to compare with refined versions
   */
  originalQuery: Annotation<string>({
    value: (_, update) => update,
    default: () => '',
  }),
  
  /**
   * Refined query after improvement
   */
  refinedQuery: Annotation<string>({
    default: () => '',
    value: (_, update) => update,
  }),
  
  /**
   * Quality score for retrieval results
   */
  retrievalQuality: Annotation<number>({
    default: () => 0,
    value: (_, update) => update,
  }),
  
  /**
   * Track previous retrieval attempts for comparison
   */
  previousDocuments: Annotation<Document[]>({
    default: () => [],
    value: (_, update) => update,
  }),

  /**
   * A list of recent documents from this conversational context
   */
  recentDocuments: Annotation<Document[]>({
    value: (_, update) => update,
    default: () => [],
  }),
  
  /**
   * Error information for tracking issues
   */
  error: Annotation<{
    message: string;
    node: string;
    timestamp: number;
  } | null>({
    default: () => null,
    value: (_, update) => update,
  }),
  
  /**
   * Thread metadata for tracking conversation state
   */
  threadInfo: Annotation<{
    threadId: string;
    lastUpdated: number;
    messageCount: number;
    conversationContext?: string;
  } | null>({
    default: () => null,
    value: (prevValue, update) => {
      if (update === null) return prevValue;
      return { ...prevValue, ...update };
    },
  }),

  /**
   * Track the currently active document filter for context
   */
  active_document_filter: Annotation<{ 
    source: string; 
    filterApplied?: string; // Store the descriptive name too
  } | null>({
    default: () => null,
    value: (_, update) => update,
  }),

  new_explicit_filter_set: Annotation<boolean>({
    default: () => false,
    value: (_, update) => update,
  })
});

export {};
