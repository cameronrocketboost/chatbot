'use client';

import type React from 'react';

import { useToast } from '@/hooks/use-toast';
import { useRef, useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Paperclip, ArrowUp, Loader2, UploadCloud, Info, Search, FileText, Filter } from 'lucide-react';
import { ExamplePrompts } from '@/components/example-prompts';
import { ChatMessage } from '@/components/chat-message';
import { FilePreview } from '@/components/file-preview';
import { client } from '@/lib/langgraph-client';
import {
  AgentState,
  documentType,
  PDFDocument,
  RetrieveDocumentsNodeUpdates,
} from '@/types/graphTypes';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useSearchParams, useRouter } from 'next/navigation';
import { type Message as AIMessage } from 'ai';
import { v4 as uuidv4 } from 'uuid';
import { UploadProgress } from '@/components/upload-progress';

// Define custom Message type that extends AIMessage
interface Message extends AIMessage {
  thinking?: string;
  sources?: PDFDocument[];
  stage?: string;
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

export default function Home() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastRetrievedDocsRef = useRef<PDFDocument[]>([]);
  const [showFeatures, setShowFeatures] = useState(true);
  const searchParams = useSearchParams();
  const router = useRouter();
  
  // State for tracking polling
  const [pollingRunId, setPollingRunId] = useState<string | null>(null);
  const [pollingThreadId, setPollingThreadId] = useState<string | null>(null);
  const [pollingProgress, setPollingProgress] = useState<IngestStatusResponse['progress']>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Add state for error tracking
  const [processingError, setProcessingError] = useState<string | null>(null);

  // Add a state to track if upload progress is minimized
  const [progressMinimized, setProgressMinimized] = useState(false);

  // Add callback for upload progress minimize event
  const handleProgressMinimize = (minimized: boolean) => {
    setProgressMinimized(minimized);
  };

  useEffect(() => {
    // Create a thread when the component mounts
    const initThread = async () => {
      // Skip if we already have a thread
      if (threadId) return;

      try {
        // Check URL parameters first
        const urlThreadId = searchParams.get('threadId');
        
        // Then check localStorage
        const storedThreadId = typeof window !== 'undefined' ? localStorage.getItem('lastThreadId') : null;
        
        if (urlThreadId) {
          console.log('[initThread] Using threadId from URL:', urlThreadId);
          setThreadId(urlThreadId);
          // Save to localStorage for persistence
          if (typeof window !== 'undefined') {
            localStorage.setItem('lastThreadId', urlThreadId);
          }
        } else if (storedThreadId) {
          console.log('[initThread] Using threadId from localStorage:', storedThreadId);
          setThreadId(storedThreadId);
          // Update URL without reload
          window.history.replaceState(null, '', `?threadId=${storedThreadId}`);
        } else {
          console.log('[initThread] No existing threadId, creating new conversation...');
          // Create new conversation (which creates a thread)
          const response = await fetch('/api/conversations/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'New Conversation' }),
          });
          
          if (!response.ok) {
            throw new Error(`Failed to create conversation: ${response.statusText}`);
          }
          
          const data = await response.json();
          const newThreadId = data.thread_id;
          
          console.log('[initThread] Created new threadId:', newThreadId);
          setThreadId(newThreadId);
          
          // Save to localStorage for persistence
          if (typeof window !== 'undefined') {
            localStorage.setItem('lastThreadId', newThreadId);
          }
          
          // Update URL without reload
          window.history.replaceState(null, '', `?threadId=${newThreadId}`);
        }
      } catch (error) {
        console.error('Error creating thread:', error);
        toast({
          title: 'Error',
          description:
            'Error creating conversation thread. Please make sure you have set all required environment variables. ' +
            error,
          variant: 'destructive',
        });
      }
    };
    initThread();
  }, [searchParams, toast, threadId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  // Reverted handleSubmit for non-streaming JSON response with sources
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    console.log("handleSubmit triggered (SSE version with thinking states).");
    const messageContent = input.trim();

    if (!messageContent) return;
    if (!threadId) {
      toast({ title: 'Error', description: 'Chat not initialized.', variant: 'destructive' });
      return;
    }
    // Ensure pollingRunId check is included from previous edits if needed
    if (isLoading || pollingRunId) return; 

    setIsLoading(true);
    const newUserMessage: Message = {
        id: self.crypto.randomUUID(), 
        role: 'user' as const,
        content: messageContent
    };
    // Add user message immediately
    setMessages((prev) => [...prev, newUserMessage]);
    setInput(''); 

    // Add a temporary thinking message that will be updated
    const thinkingMessageId = self.crypto.randomUUID();
    const thinkingMessage: Message = {
      id: thinkingMessageId,
      role: 'assistant' as const,
      content: '', // Must be empty to show thinking state
      thinking: 'Starting to process your query. This may take a moment...',
      stage: 'Starting'
    };
    console.log("Created initial thinking message:", thinkingMessage);
    setMessages((prev) => [...prev, thinkingMessage]);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
        console.log(`handleSubmit: Starting SSE connection for: "${messageContent}" with threadId: ${threadId}`);
        
        const payload = {
            messages: [...messages, newUserMessage], // Send history up to the new user message
            data: { threadId: threadId } 
        };

        // Using Server-Sent Events instead of regular fetch
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream' 
            },
            body: JSON.stringify(payload),
            signal: abortController.signal
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }

        if (!response.body) {
            throw new Error('Response body is null');
        }

        // Handle the SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const eventData = chunk.replace(/^data: /, '').trim();
            
            if (!eventData) continue;
            
            try {
                const data = JSON.parse(eventData);
                console.log("SSE update:", data);
                
                if (data.thinking) {
                    // Update the thinking message with more visible information
                    console.log("Updating thinking state:", data);
                    console.log("Current thinking message before update:", 
                      messages.find(m => m.id === thinkingMessageId));
                    
                    setMessages((prev) => {
                        const newMessages = [...prev];
                        const thinkingIndex = newMessages.findIndex(m => m.id === thinkingMessageId);
                        if (thinkingIndex !== -1) {
                            // Create updated message with thinking state
                            const updatedMessage = {
                                id: thinkingMessageId,
                                role: 'assistant' as const,
                                content: '', // Explicitly set to empty string to force thinking display
                                thinking: data.thinkingText || "Processing your query...",
                                stage: data.stage || 'Processing'
                            };
                            console.log("New thinking message:", updatedMessage);
                            newMessages[thinkingIndex] = updatedMessage;
                        } else {
                            console.error("Could not find thinking message with ID:", thinkingMessageId);
                        }
                        return newMessages;
                    });
                } else {
                    // Replace the thinking message with the final response
                    if (data.response) {
                        console.log("Received final response, replacing thinking message:", data.response.substring(0, 50) + "...");
                        setMessages((prev) => {
                            const newMessages = [...prev];
                            const thinkingIndex = newMessages.findIndex(m => m.id === thinkingMessageId);
                            if (thinkingIndex !== -1) {
                                // Create a completely new message object to avoid any state issues
                                const finalMessage = {
                                    id: thinkingMessageId,
                                    role: 'assistant' as const,
                                    content: data.response,
                                    sources: data.sources || [],
                                    // Remove thinking and stage properties entirely
                                    thinking: undefined,
                                    stage: undefined
                                };
                                console.log("Final response message:", finalMessage);
                                newMessages[thinkingIndex] = finalMessage;
                            }
                            return newMessages;
                        });
                        
                        // Update threadId if provided
                        if (data.newThreadId) {
                            console.log(`Updating threadId from ${threadId} to ${data.newThreadId}`);
                            setThreadId(data.newThreadId);
                            window.history.replaceState(null, '', `?threadId=${data.newThreadId}`);
                        }

                        // When we get a response and this is the first message in the conversation
                        if (messages.length === 1) {
                            // Find the conversation ID for this thread
                            try {
                                // Get conversation ID from thread ID
                                const conversationResponse = await fetch(`/api/conversations?thread_id=${threadId}`, {
                                    method: 'GET',
                                });
                                
                                if (conversationResponse.ok) {
                                    const conversationData = await conversationResponse.json();
                                    if (conversationData && conversationData.id) {
                                        // Generate a title based on the first message
                                        const titleResponse = await fetch('/api/conversations/generate-title', {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/json',
                                            },
                                            body: JSON.stringify({
                                                conversationId: conversationData.id,
                                                message: messageContent,
                                            }),
                                        });
                                        
                                        console.log('[handleSubmit] Auto-generated title for new conversation');
                                    }
                                }
                            } catch (titleError) {
                                console.error('[handleSubmit] Error generating conversation title:', titleError);
                                // Non-critical error, we don't need to show an error to the user
                            }
                        }
                    }
                    
                    // Handle errors
                    if (data.error) {
                        toast({
                            title: 'Error',
                            description: data.error,
                            variant: 'destructive'
                        });
                    }
                }
            } catch (error) {
                console.error('Error parsing SSE data:', error, eventData);
            }
        }

    } catch (error) {
        console.error("Error in chat submission:", error);
        
        // Update the thinking message to show the error
        setMessages((prev) => {
            const newMessages = [...prev];
            const thinkingIndex = newMessages.findIndex(m => m.id === thinkingMessageId);
            if (thinkingIndex !== -1) {
                newMessages[thinkingIndex] = {
                    id: thinkingMessageId,
                    role: 'assistant' as const,
                    content: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
                };
            }
            return newMessages;
        });
        
        toast({
            title: 'Error',
            description: error instanceof Error ? error.message : 'Unknown error occurred',
            variant: 'destructive'
        });
    } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
    }
  };

  const handlePromptSelect = (prompt: string) => {
    setInput(prompt);
  };

  const navigateToDocuments = () => {
    router.push('/documents');
  };
  
  // Function to stop polling when needed (used in cleanup)
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      console.log('[stopPolling] Stopping polling.');
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      setPollingRunId(null);
      setPollingThreadId(null);
    }
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  // Use this function to create a "hand-drawn" feel for borders
  const HandDrawnBox: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
    <div className={`relative border-2 border-sladen-navy/20 rounded-lg overflow-hidden ${className}`}>
      <div className="absolute top-0 left-0 w-full h-full">
        <div className="absolute top-[-1px] left-0 w-full h-[2px] bg-sladen-navy/20" style={{ clipPath: 'polygon(0 0, 100% 0, 97% 100%, 3% 100%)' }}></div>
        <div className="absolute bottom-[-1px] left-0 w-full h-[2px] bg-sladen-navy/20" style={{ clipPath: 'polygon(3% 0, 97% 0, 100% 100%, 0 100%)' }}></div>
        <div className="absolute top-0 left-[-1px] w-[2px] h-full bg-sladen-navy/20" style={{ clipPath: 'polygon(0 0, 100% 3%, 100% 97%, 0 100%)' }}></div>
        <div className="absolute top-0 right-[-1px] w-[2px] h-full bg-sladen-navy/20" style={{ clipPath: 'polygon(0 3%, 100% 0, 100% 100%, 0 97%)' }}></div>
      </div>
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );

  return (
    <main className="flex flex-col min-h-screen bg-white">
      {/* Show landing page when no messages */}
      {messages.length === 0 && (
        <div className="flex-1 flex flex-col">
          <div className="w-full bg-white text-sladen-navy py-20 px-4">
            <div className="max-w-3xl mx-auto text-center mb-10">
              <h1 className="text-4xl md:text-5xl font-bold mb-6 relative inline-flex">
                <span className="relative mr-2">
                  SLADEN
                  <span className="absolute top-0 -right-4 text-sladen-red font-bold">/</span>
                </span>{" "}
                <span className="text-sladen-gray">CHAT</span>
              </h1>
              <p className="text-lg text-sladen-navy/80 max-w-2xl mx-auto">
                Upload your documents and chat with them using our advanced AI system. 
                Get answers, summaries, and insights from your content.
              </p>
            </div>

            <HandDrawnBox className="bg-white shadow-md max-w-3xl mx-auto">
              <div className="p-6 text-center">
                <h2 className="text-xl font-semibold text-sladen-navy mb-4 uppercase tracking-wide flex items-center justify-center">
                  <UploadCloud className="h-5 w-5 mr-2 text-sladen-red" />
                  Document Management
                </h2>
                
                <p className="text-sladen-navy/70 mb-6">
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
            
            {/* Features section with hand-drawn style */}
            <div className="mt-16 text-center">
              <h3 className="text-xl font-semibold mb-6 text-sladen-navy uppercase tracking-wide inline-block relative">
                Enhanced Capabilities
                <div className="absolute bottom-0 left-0 w-full h-1 bg-sladen-red/40"></div>
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
                <div className="bg-white p-5 rounded-lg shadow-md border border-sladen-navy/10 transform rotate-[-0.5deg]">
                  <div className="text-sladen-red h-12 w-12 mx-auto mb-2">
                    <Search className="h-full w-full" />
                  </div>
                  <h4 className="font-bold text-sladen-navy mb-2">Smart Retrieval</h4>
                  <p className="text-sm text-sladen-navy/70">Precisely find information across all your documents with advanced fuzzy matching</p>
                </div>
                
                <div className="bg-white p-5 rounded-lg shadow-md border border-sladen-navy/10 transform rotate-[0.5deg]">
                  <div className="text-sladen-teal h-12 w-12 mx-auto mb-2">
                    <Filter className="h-full w-full" />
                  </div>
                  <h4 className="font-bold text-sladen-navy mb-2">Multi-format Support</h4>
                  <p className="text-sm text-sladen-navy/70">Handle PDF, Word and PowerPoint with specialized processing for each format</p>
                </div>
                
                <div className="bg-white p-5 rounded-lg shadow-md border border-sladen-navy/10 transform rotate-[-0.2deg]">
                  <div className="text-sladen-navy h-12 w-12 mx-auto mb-2">
                    <Info className="h-full w-full" />
                  </div>
                  <h4 className="font-bold text-sladen-navy mb-2">Transparent AI</h4>
                  <p className="text-sm text-sladen-navy/70">Follow the AI's thinking process and see exactly which sources inform each answer</p>
                </div>
              </div>
            </div>

            {/* Add chat input at the bottom of the hero section */}
            <div className="max-w-3xl mx-auto mt-12 px-4">
              {showFeatures && (
                <Alert className="mb-4 bg-sladen-navy/5 border-sladen-teal">
                  <AlertTitle className="text-sladen-navy flex items-center">
                    <Info className="h-4 w-4 mr-2 text-sladen-red" />
                    Enhanced Retrieval Features
                  </AlertTitle>
                  <AlertDescription className="text-sm text-sladen-navy/70">
                    Ask about specific documents by name (e.g., "What does the test.pdf say about X?") or file type (e.g., "summarize the PowerPoint presentations").
                  </AlertDescription>
                </Alert>
              )}
              
              <ExamplePrompts onSelect={handlePromptSelect} />
              
              <form onSubmit={handleSubmit} className="flex items-center gap-2 mt-4">
                <Input
                  placeholder="Ask a question about your documents..."
                  value={input}
                  onChange={handleInputChange}
                  disabled={isLoading || !threadId}
                  className="flex-1 border-sladen-navy/20 focus-visible:ring-sladen-teal"
                />
                <Button 
                  type="submit"
                  disabled={isLoading || !input.trim() || !threadId}
                  className="bg-sladen-navy hover:bg-sladen-teal text-white"
                >
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <ArrowUp className="h-5 w-5" />
                  )}
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Chat Interface - show when there are messages */}
      {messages.length > 0 && (
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto p-4 pt-8 space-y-6">
              {messages.map((message) => (
                <ChatMessage 
                  key={message.id} 
                  message={{
                    role: message.role === 'user' || message.role === 'assistant' ? message.role : 'assistant',
                    content: message.content,
                    sources: message.sources,
                    thinking: message.thinking,
                    stage: message.stage
                  }} 
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
          
          <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4">
            <div className="max-w-3xl mx-auto">
              {/* Remove the alert box from the chat interface */}
              
              <form onSubmit={handleSubmit} className="flex items-center gap-2 mt-4">
                <Input
                  placeholder="Ask a question about your documents..."
                  value={input}
                  onChange={handleInputChange}
                  disabled={isLoading || !threadId}
                  className="flex-1 border-sladen-navy/20 focus-visible:ring-sladen-teal"
                />
                <Button 
                  type="submit"
                  disabled={isLoading || !input.trim() || !threadId}
                  className="bg-sladen-navy hover:bg-sladen-teal text-white"
                >
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <ArrowUp className="h-5 w-5" />
                  )}
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}
      
      {/* Upload Progress component - Keep existing functionality */}
      {pollingRunId && pollingProgress && (
        <UploadProgress
          progress={pollingProgress}
          minimized={progressMinimized}
          onMinimize={handleProgressMinimize}
          error={processingError}
        />
      )}
    </main>
  );
}
