/**
 * Message type representing chat messages between user and assistant
 */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;  // For displaying thinking states
  stage?: string;     // For tracking thinking stages
  sources?: Array<{   // For tracking sources in responses
    document: string;
    text: string;
    score?: number;
  }>;
  metadata?: Record<string, any>;
}

/**
 * ChatRequestBody type for chat API requests
 */
export interface ChatRequestBody {
  messages: Message[];
  data?: {
    threadId?: string;
    [key: string]: any;
  };
}

/**
 * ChatResponseBody type for chat API responses
 */
export interface ChatResponseBody {
  message: Message;
  threadId: string;
  runId?: string;
  sources?: Array<{
    document: string;
    text: string;
    score?: number;
  }>;
  error?: string;
} 