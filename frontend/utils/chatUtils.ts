import type { Message as AIMessage } from 'ai/react';
import type { JSONValue } from 'ai';

// Re-define or import the Message type if needed
// Assuming Message is defined elsewhere or can be partially defined here
interface MinimalMessage extends AIMessage {
    // Add properties used by the type guard if necessary
}

// Define custom Message type that extends AIMessage (copied from page.tsx initially)
// You might want a shared types file eventually.
interface Message extends AIMessage {
  thinking?: string;
  sources?: any[]; 
  stage?: string;
  annotations?: (JSONValue | { type: 'thinking'; [k: string]: JSONValue })[];
}

/**
 * Type guard to check if a message is from the user or assistant.
 */
export function isChatMessage(
  msg: Message | AIMessage | undefined | null
): msg is Message & { role: 'user' | 'assistant' } {
  return !!msg && (msg.role === 'user' || msg.role === 'assistant');
} 