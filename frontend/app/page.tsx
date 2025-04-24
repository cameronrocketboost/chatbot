'use client';

import type React from 'react';
import { useRouter } from 'next/navigation';

import { useToast } from '@/hooks/use-toast';
import { useRef, useState, useEffect, useCallback, Suspense, useLayoutEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowUp, Loader2, UploadCloud, Info, Search, FileText, Filter } from 'lucide-react';
import { ExamplePrompts } from '@/components/example-prompts';
import { ChatMessage } from '@/components/chat-message';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { type Message as AIMessage, useChat } from 'ai/react';
import type { JSONValue } from 'ai';
import { UploadProgress } from '@/components/upload-progress';
import { useThreadId } from '@/hooks/useThreadId';
import { ErrorBanner } from '@/components/error-banner';
import { isChatMessage } from '@/utils/chatUtils';

// Define a specific type for thinking annotations
type ThinkingAnnotation = { type: 'thinking'; [k: string]: JSONValue };

// Define custom Message type that extends AIMessage
interface Message extends AIMessage {
  thinking?: string;
  sources?: any[];
  stage?: string;
  annotations?: (JSONValue | ThinkingAnnotation)[];
}

// Define expected polling response structure
interface IngestStatusResponse {
  status: 'running' | 'success' | 'failed' | 'canceled' | string;
  isComplete: boolean;
  finalStatus: string | null;
  processedFiles?: {
    success: number;
    skipped: number;
    skippedFiles: string[];
    total: number;
  };
  progress?: {
    percentComplete: number;
    currentStage: string;
    processingFile: string | null;
    estimatedTimeRemaining: string | null;
  } | null;
  error?: string | null;
  timing?: {
    startTime: string;
    endTime: string | null;
    durationMs: number | null;
  };
}

interface PollingResponse {
  status: 'pending' | 'success' | 'failure';
  error?: string;
}

// Initial View Component
const InitialChatView: React.FC<{ onExampleClick: (prompt: string) => void }> = ({ onExampleClick }) => {
  const router = useRouter();
  const navigateToDocuments = () => router.push('/documents');

  // Define hand-drawn box style component locally or import if shared
  const HandDrawnBox: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
    <div className={`relative border-2 border-sladen-navy/20 rounded-lg overflow-hidden ${className}`}>
      {/* Removed complex SVG border for brevity, replace with simpler border or keep original */}
      <div className="relative z-10 p-6">
        {children}
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <div className="w-full max-w-3xl mx-auto text-center mb-10 px-4">
        {/* Title */}
        <h1 className="text-4xl md:text-5xl font-bold mb-6 relative inline-flex text-sladen-navy dark:text-white">
          <span className="relative mr-2">
            SLADEN
            <span className="absolute top-0 -right-4 text-sladen-red font-bold">/</span>
          </span>{" "}
          <span className="text-sladen-gray dark:text-gray-400">CHAT</span>
        </h1>
        <p className="text-lg text-sladen-navy/80 dark:text-gray-300 max-w-2xl mx-auto">
          Upload your documents and chat with them using our advanced AI system.
          Get answers, summaries, and insights from your content.
        </p>
      </div>

      {/* Document Management Box */}
      <HandDrawnBox className="bg-white dark:bg-gray-800 shadow-md max-w-3xl mx-auto mb-10 w-full">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-sladen-navy dark:text-gray-100 mb-4 uppercase tracking-wide flex items-center justify-center">
            <UploadCloud className="h-5 w-5 mr-2 text-sladen-red" />
            Document Management
          </h2>
          <p className="text-sladen-navy/70 dark:text-gray-400 mb-6">
            Upload, view, and manage your documents in the documents section.
          </p>
          <Button
            onClick={navigateToDocuments}
            className="bg-sladen-teal hover:bg-sladen-navy text-white"
          >
            <UploadCloud className="mr-2 h-4 w-4" />
            Go to Documents
          </Button>
        </div>
      </HandDrawnBox>

      {/* Features Section */}
      <div className="mt-10 text-center w-full max-w-4xl mx-auto px-4">
        <h3 className="text-xl font-semibold mb-6 text-sladen-navy dark:text-gray-100 uppercase tracking-wide inline-block relative">
          Enhanced Capabilities
          <div className="absolute bottom-0 left-0 w-full h-1 bg-sladen-red/40"></div>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Feature Cards */}
          <div className="bg-white dark:bg-gray-800 p-5 rounded-lg shadow-md border border-sladen-navy/10 dark:border-gray-700">
             <Search className="text-sladen-red h-12 w-12 mx-auto mb-2" />
             <h4 className="font-bold text-sladen-navy dark:text-gray-100 mb-2">Smart Retrieval</h4>
             <p className="text-sm text-sladen-navy/70 dark:text-gray-400">Precisely find information across all your documents.</p>
          </div>
          <div className="bg-white dark:bg-gray-800 p-5 rounded-lg shadow-md border border-sladen-navy/10 dark:border-gray-700">
             <Filter className="text-sladen-teal h-12 w-12 mx-auto mb-2" />
             <h4 className="font-bold text-sladen-navy dark:text-gray-100 mb-2">Multi-format Support</h4>
             <p className="text-sm text-sladen-navy/70 dark:text-gray-400">Handle PDF, Word and PowerPoint formats.</p>
          </div>
           <div className="bg-white dark:bg-gray-800 p-5 rounded-lg shadow-md border border-sladen-navy/10 dark:border-gray-700">
             <Info className="text-sladen-navy dark:text-sladen-teal h-12 w-12 mx-auto mb-2" />
             <h4 className="font-bold text-sladen-navy dark:text-gray-100 mb-2">Transparent AI</h4>
             <p className="text-sm text-sladen-navy/70 dark:text-gray-400">Follow the AI's thinking process and see sources.</p>
           </div>
        </div>
      </div>

      {/* Prompts and Alert Box */}
      <div className="w-full max-w-3xl mx-auto mt-10 px-4">
        <Alert className="mb-4 bg-sladen-navy/5 dark:bg-sladen-teal/10 border-sladen-teal dark:border-sladen-teal/50">
          <AlertTitle className="text-sladen-navy dark:text-gray-100 flex items-center">
            <Info className="h-4 w-4 mr-2 text-sladen-red" />
            Enhanced Retrieval Features
          </AlertTitle>
          <AlertDescription className="text-sm text-sladen-navy/70 dark:text-gray-400">
            Ask about specific documents by name (e.g., "What does test.pdf say?") or file type (e.g., "summarize the PowerPoint presentations").
          </AlertDescription>
        </Alert>
        <ExamplePrompts onSelect={onExampleClick} />
      </div>
    </div>
  );
};

// Input Form Component
interface ChatInputFormProps {
  input: string;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  handleNewChat: () => void;
  threadIdExists: boolean;
}

const ChatInputForm: React.FC<ChatInputFormProps> = ({ input, handleInputChange, handleSubmit, isLoading, handleNewChat, threadIdExists }) => (
  <div className="p-4 border-t bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700">
    <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-3xl mx-auto">
      <Button variant="outline" size="icon" onClick={handleNewChat} type="button" className="border-sladen-navy/20 dark:border-gray-600" title="Start New Chat">
        <FileText className="h-4 w-4 text-sladen-teal" />
      </Button>
      <label htmlFor="chat-input" className="sr-only">Chat message</label>
      <Input
        id="chat-input"
        placeholder="Ask a question about your documents..."
        value={input}
        onChange={handleInputChange}
        disabled={isLoading}
        className="flex-1 border-sladen-navy/20 dark:border-gray-600 focus-visible:ring-sladen-teal dark:bg-gray-800 dark:text-white"
      />
      <Button
        type="submit"
        disabled={isLoading || !input.trim() || !threadIdExists}
        className="bg-sladen-navy hover:bg-sladen-teal text-white dark:bg-sladen-teal dark:hover:bg-sladen-navy"
        title={!threadIdExists ? "Please start a new chat first" : "Send message"}
      >
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <ArrowUp className="h-5 w-5" />
        )}
      </Button>
    </form>
  </div>
);

// Chat Interface Component
function ChatInterface() {
  const { threadId, isLoading: isThreadIdLoading, createAndSetNewThreadId } = useThreadId();
  const { toast } = useToast();

  // Define Backend URL from environment variable
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || '';
  if (!BACKEND_URL) {
    // Optionally throw an error or log a warning if the URL is missing
    console.warn('NEXT_PUBLIC_BACKEND_URL is not set. API calls may fail.');
  }

  // Handle stage updates via useChat callbacks
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading: isChatLoading,
    error,
    setMessages,
    setInput,
    reload,
  } = useChat({
    api: `${BACKEND_URL}/chat/stream`,
    id: threadId || undefined,
    body: { threadId: threadId },
    onError: (error) => {
      console.error('Chat error:', error);
    },
  });
  
  const typedMessages: Message[] = messages as Message[];

  // --- Suggestion #4: Memoize message filtering --- 
  const thinkingMessageIndex = useMemo(() => {
    // Add null/undefined check for annotations
    return typedMessages.findIndex(msg => 
      msg.annotations?.some((ann): ann is ThinkingAnnotation => 
        typeof ann === 'object' && ann !== null && !Array.isArray(ann) && 'type' in ann && ann.type === 'thinking'
      )
    );
  }, [typedMessages]);

  const messagesToRender = useMemo(() => {
    return typedMessages
      .filter(isChatMessage)
      .filter((_msg, index) => 
        (thinkingMessageIndex === -1 || index < thinkingMessageIndex)
      );
  }, [typedMessages, thinkingMessageIndex]);

  // --- Suggestion #5: Improve Scrolling --- 
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Use useLayoutEffect for scrolling to avoid flickering
  useLayoutEffect(() => {
    // Scroll to bottom only if the ref is attached
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' }); 
    // Using 'auto' might be smoother than 'smooth' during rapid updates
  }, [messagesToRender]); // Scroll when the rendered messages change

  const handleNewChat = useCallback(async () => {
    setMessages([]);
    setInput('');
    const newId = await createAndSetNewThreadId();
    if (newId) {
      // Maybe trigger a reload or other action if needed?
    }
  }, [createAndSetNewThreadId, setMessages, setInput]);

  // Combine loading states for the input form
  const isOverallLoading = isChatLoading || isThreadIdLoading;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950">
      {/* Chat History */}
      <div className="flex-grow overflow-y-auto p-6 space-y-4 " aria-live="polite">
        {isThreadIdLoading && (
          <div className="flex justify-center items-center h-full"><Loader2 className="h-8 w-8 animate-spin text-sladen-teal" /></div>
        )}
        {!isThreadIdLoading && messagesToRender.length === 0 && !isChatLoading && (
          <InitialChatView onExampleClick={setInput} />
        )}
        {!isThreadIdLoading && messagesToRender.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
        ))}
        {!isThreadIdLoading && isChatLoading && (
          <div className="flex justify-center items-center p-4 text-sladen-navy dark:text-gray-400">
            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            <span>Generating response...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error Display using ErrorBanner */}
      {error && (
        <ErrorBanner message={error.message} />
      )}

      {/* Input Area */}
      <ChatInputForm
        input={input}
        handleInputChange={handleInputChange}
        handleSubmit={handleSubmit}
        isLoading={isOverallLoading}
        handleNewChat={handleNewChat}
        threadIdExists={!!threadId}
      />
    </div>
  );
}

// Main Page component wraps the Suspense boundary
export default function HomePage() {
  return (
    // Only suspend the ChatInterface, show a smaller loader
    <Suspense fallback={
      <div className="flex h-full flex-grow items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-sladen-teal" />
      </div>
    }> 
      <ChatInterface />
    </Suspense>
    // If there were parts of the page outside ChatInterface that didn't need suspension,
    // they would go outside this Suspense boundary.
  );
}
