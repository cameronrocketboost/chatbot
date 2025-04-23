import { type Message } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/langgraph-server';
import { retrievalAssistantStreamConfig } from '@/constants/graphConfigs';
import { PDFDocument } from '@/types/graphTypes'; // Import PDFDocument type
import { v4 as uuidv4 } from 'uuid'; // Add import for UUID generation
import { getConversationByThreadId, addMessageToConversation } from '@/lib/supabase-conversations';

// Remove Edge runtime - invoke might not be fully compatible or efficient
// export const runtime = 'edge';

export const dynamic = 'force-dynamic'; // Prevent pre-rendering at build time

interface ChatRequestBody {
  messages: Message[];
  data?: {
    threadId?: string;
  };
}

// Define the thinking stages
const THINKING_STAGES = {
  INITIAL: { 
    stage: "Analyzing query", 
    thinkingText: "I'm analyzing your question to understand your intent and determine the optimal approach. This helps me identify the types of documents and information that would be most relevant to your needs..."
  },
  RETRIEVING: { 
    stage: "Retrieving documents", 
    thinkingText: "Searching through the document database to find the most relevant information. I'm looking at document content, metadata, and contextual relevance to identify the most useful sources for your query..."
  },
  EVALUATING: { 
    stage: "Evaluating results", 
    thinkingText: "Examining the quality and relevance of the retrieved documents. I'm assessing how well each document matches your query, checking content accuracy, and determining which sources provide the most valuable information..."
  },
  REFINING: { 
    stage: "Refining search", 
    thinkingText: "I'm adjusting my search strategy to find more precisely relevant information. This might involve rephrasing the query, focusing on specific document sections, or applying different filtering criteria to improve the results..."
  },
  GENERATING: { 
    stage: "Generating response", 
    thinkingText: "Creating a comprehensive answer based on the information I've gathered. I'm synthesizing content from multiple sources, organizing key points, and formulating a clear and informative response to your question..."
  }
};

// Helper function for polling
async function pollRunStatus(client: ReturnType<typeof createServerClient>, threadId: string, runId: string): Promise<any> {
  const maxAttempts = 30; // Max ~30 seconds
  const intervalMs = 1000; // Poll every 1 second

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const runState = await client.client.runs.get(threadId, runId);
      console.log(`[Polling] Attempt ${attempt + 1}: Run status = ${runState.status}`);

      // Check for terminal success or error states based on inferred types
      if (runState.status === 'success' || runState.status === 'error') { 
        console.log(`[Polling] Run finished with status: ${runState.status}`);
        return runState; // Return the final state
      } 
      // Continue polling for pending/running/timeout/interrupted states
      else if (runState.status !== 'pending' && runState.status !== 'running' && runState.status !== 'timeout' && runState.status !== 'interrupted') {
         console.warn(`[Polling] Unknown/unexpected run status encountered: ${runState.status}`);
         // Treat unexpected status as potentially finished but maybe check state
         return runState;
      }

    } catch (pollError: any) {
        // Log polling error but continue polling unless it's maybe a 404 indicating run disappeared?
      console.error(`[Polling] Error getting run status (attempt ${attempt + 1}):`, pollError.message);
      // if (pollError.status === 404) { throw new Error("Run not found during polling."); }
    }
    
    // Wait before next attempt
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  // If loop finishes without success/failure
  throw new Error(`Run did not complete within the polling timeout (${maxAttempts * intervalMs / 1000}s).`);
}

export async function POST(req: NextRequest) {
  console.log('[POST /api/chat - Polling+GetState] Request received.');
  let threadId: string | undefined;
  let isNewThread = false; // Track if we created a new thread
  
  // Check if the request is for Server-Sent Events
  const isSSE = req.headers.get('accept') === 'text/event-stream';
  
  if (isSSE) {
    console.log('[POST /api/chat] SSE connection requested');
    
    const encoder = new TextEncoder();
    const sendThinkingUpdate = (data: any) => {
      return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    try {
      const body: ChatRequestBody = await req.json();
      const lastMessage = body.messages[body.messages.length - 1];
      const messageContent = lastMessage?.content;
      const originalThreadId = body.data?.threadId;
      
      // Validate inputs
      if (!messageContent) {
        throw new Error('Message content is required');
      }
      
      // Use existing thread if provided
      if (originalThreadId) {
        threadId = originalThreadId;
        isNewThread = false;
        console.log(`[POST /api/chat] Using existing thread: ${threadId}`);
      } else {
        isNewThread = true;
        console.log(`[POST /api/chat] No thread ID provided, will create a new one.`);
      }
      
      // Create a ReadableStream for SSE
      const stream = new ReadableStream({
        async start(controller) {
          try {
            // Send initial thinking state
            const initialData = { 
              thinking: true, 
              ...THINKING_STAGES.INITIAL
            };
            console.log('[SSE] Sending Initial Data:', JSON.stringify(initialData)); // Log data
            controller.enqueue(sendThinkingUpdate(initialData));
            await new Promise(resolve => setTimeout(resolve, 1)); // Add delay
            
            const assistantId = process.env.LANGGRAPH_RETRIEVAL_ASSISTANT_ID;
            if (!assistantId) {
              throw new Error('LANGGRAPH_RETRIEVAL_ASSISTANT_ID is not set');
            }
            
            const serverClient = createServerClient();
            
            // Create a new thread if needed
            if (isNewThread) {
              const threadCreateData = { 
                thinking: true, 
                stage: "Creating conversation thread",
                thinkingText: "Setting up a new conversation thread..." 
              };
              console.log('[SSE] Sending Thread Create Data:', JSON.stringify(threadCreateData)); // Log data
              controller.enqueue(sendThinkingUpdate(threadCreateData));
              await new Promise(resolve => setTimeout(resolve, 1)); // Add delay
              
              const threadResponse = await serverClient.client.threads.create();
              threadId = threadResponse.thread_id;
              console.log(`[POST /api/chat] Created new thread: ${threadId}`);
            } else if (!threadId) {
              // This case should theoretically not happen if logic above is correct, 
              // but adding as a safeguard.
              throw new Error('Error: Attempting to use existing thread but threadId is missing.');
            }
            
            // Add context from previous messages if this is an existing conversation
            let contextSetup = {};
            if (!isNewThread && body.messages.length > 1) {
              // Get previous messages to provide context (up to 5 most recent)
              const recentMessages = body.messages.slice(-6, -1);
              if (recentMessages.length > 0) {
                // Format previous messages for context
                const formattedContext = recentMessages.map(msg => {
                  return {
                    type: msg.role === 'user' ? 'human' : 'ai',
                    content: msg.content
                  };
                });
                
                // Add context to setup
                contextSetup = {
                  contextMessages: formattedContext
                };
                
                console.log(`[POST /api/chat] Added ${formattedContext.length} messages as context`);
              }
            }
            
            // Start document retrieval
            const retrievalStartData = { 
              thinking: true, 
              ...THINKING_STAGES.RETRIEVING
            };
            console.log('[SSE] Sending Retrieval Start Data:', JSON.stringify(retrievalStartData)); // Log data
            controller.enqueue(sendThinkingUpdate(retrievalStartData));
            await new Promise(resolve => setTimeout(resolve, 1)); // Add delay
            
            // Create run with additional context if needed
            console.log(`[POST /api/chat] Creating run with input:`, { query: messageContent, ...contextSetup });
            const run = await serverClient.client.runs.create(
              threadId!,
              assistantId,
              {
                input: { 
                  query: messageContent,
                  ...contextSetup
                },
                config: {
                  configurable: {
                    ...retrievalAssistantStreamConfig,
                    thread_id: threadId,
                    multitask_strategy: "parallel"
                  }
                },
              }
            );
            
            // Start polling and send updates based on state
            let prevNode = '';
            let errorRetries = 0;
            const maxErrorRetries = 3;
            
            for (let attempt = 0; attempt < 45; attempt++) { // Increase timeout to 45 seconds
              try {
                const runState = await serverClient.client.runs.get(threadId!, run.run_id);
                
                // Reset error counter on successful API call
                errorRetries = 0;
                
                // Use a more generic approach for getting the current node
                // Detect which node is currently executing based on run state
                const runStateAny = runState as any;
                const currentNode = runStateAny.state_value || runStateAny.state?.value || '';
                if (currentNode !== prevNode) {
                  prevNode = currentNode;
                  
                  // Update thinking stage based on current node
                  if (currentNode.includes('retrieveDocuments')) {
                    const retrieveData = { 
                      thinking: true, 
                      ...THINKING_STAGES.RETRIEVING,
                      stage: "Retrieving documents",
                      thinkingText: THINKING_STAGES.RETRIEVING.thinkingText
                    };
                    console.log('[SSE] Sending Retrieve Node Data:', JSON.stringify(retrieveData)); // Log data
                    controller.enqueue(sendThinkingUpdate(retrieveData));
                    await new Promise(resolve => setTimeout(resolve, 1)); // Add delay
                  } else if (currentNode.includes('evaluateRetrievalQuality')) {
                    const evaluateData = { 
                      thinking: true, 
                      ...THINKING_STAGES.EVALUATING,
                      stage: "Evaluating results",
                      thinkingText: THINKING_STAGES.EVALUATING.thinkingText
                    };
                    console.log('[SSE] Sending Evaluate Node Data:', JSON.stringify(evaluateData)); // Log data
                    controller.enqueue(sendThinkingUpdate(evaluateData));
                    await new Promise(resolve => setTimeout(resolve, 1)); // Add delay
                  } else if (currentNode.includes('refineQuery')) {
                    const refineData = { 
                      thinking: true, 
                      ...THINKING_STAGES.REFINING,
                      stage: "Refining search",
                      thinkingText: THINKING_STAGES.REFINING.thinkingText
                    };
                    console.log('[SSE] Sending Refine Node Data:', JSON.stringify(refineData)); // Log data
                    controller.enqueue(sendThinkingUpdate(refineData));
                    await new Promise(resolve => setTimeout(resolve, 1)); // Add delay
                  } else if (currentNode.includes('generateResponse')) {
                    const generateData = { 
                      thinking: true, 
                      ...THINKING_STAGES.GENERATING,
                      stage: "Generating response",
                      thinkingText: THINKING_STAGES.GENERATING.thinkingText
                    };
                    console.log('[SSE] Sending Generate Node Data:', JSON.stringify(generateData)); // Log data
                    controller.enqueue(sendThinkingUpdate(generateData));
                    await new Promise(resolve => setTimeout(resolve, 1)); // Add delay
                  } else if (currentNode.includes('directAnswer')) {
                    const directData = { 
                      thinking: true, 
                      stage: "Generating direct response",
                      thinkingText: THINKING_STAGES.GENERATING.thinkingText // Assuming direct answer uses same text?
                    };
                    console.log('[SSE] Sending Direct Answer Node Data:', JSON.stringify(directData)); // Log data
                    controller.enqueue(sendThinkingUpdate(directData));
                    await new Promise(resolve => setTimeout(resolve, 1)); // Add delay
                  }
                }
                
                if (runState.status === 'success' || runState.status === 'error') {
                  break;
                }
              } catch (pollError) {
                // Handle transient API errors with retries
                errorRetries++;
                console.warn(`[POST /api/chat] Poll error #${errorRetries}:`, pollError);
                
                if (errorRetries >= maxErrorRetries) {
                  throw new Error(`Multiple polling errors: ${pollError}`);
                }
                
                // Longer delay after errors
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
              }
              
              // Regular polling delay
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Get final state
            const finalThreadState = await serverClient.client.threads.getState(threadId!);
            
            // Extract response and sources
            let finalResponseContent = 'Error: Could not extract response content from thread state.';
            let finalSources: PDFDocument[] = [];
            
            const stateValues = finalThreadState?.values || {};
            const stateValuesAsAny = stateValues as any;
            
            if (stateValuesAsAny.messages && Array.isArray(stateValuesAsAny.messages)) {
              const assistantMessages = stateValuesAsAny.messages.filter((m: any) => m.type === 'ai' || m.role === 'assistant');
              if (assistantMessages.length > 0) {
                finalResponseContent = assistantMessages[assistantMessages.length - 1].content;
              }
            }
            
            if (stateValuesAsAny.documents && Array.isArray(stateValuesAsAny.documents)) {
              finalSources = stateValuesAsAny.documents;
            }
            
            // Send final response
            const finalResponseData = { 
              thinking: false,
              response: finalResponseContent,
              sources: finalSources,
              threadId: threadId
            };
            console.log('[SSE] Sending Final Response Data:', JSON.stringify(finalResponseData).substring(0, 500) + '...'); // Log truncated data
            controller.enqueue(sendThinkingUpdate(finalResponseData));
            
            // Save messages to Supabase for persistence
            const conversation = await getConversationByThreadId(threadId!);
            if (conversation) {
              // First save the user message
              await addMessageToConversation(conversation.id, {
                content: messageContent,
                role: 'user'
              });
              
              // Then save the assistant's response
              await addMessageToConversation(conversation.id, {
                content: finalResponseContent,
                role: 'assistant',
                metadata: { sources: finalSources || [] }
              });
              
              console.log(`[SSE] Saved conversation messages to Supabase for thread ${threadId}`);
            } else {
              console.warn(`[SSE] Could not find conversation record for thread ${threadId}`);
            }
            
            controller.close();
          } catch (error) {
            console.error('[SSE Stream] Error:', error);
            const errorData = { 
              thinking: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              errorDetails: {
                threadId,
                isNewThread,
                errorType: error instanceof Error ? error.name : 'Unknown'
              }
            };
            console.log('[SSE] Sending Error Data:', JSON.stringify(errorData)); // Log data
            controller.enqueue(sendThinkingUpdate(errorData));
            controller.close();
          }
        }
      });
      
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    } catch (error) {
      console.error('[SSE] Overall error:', error);
      return new Response(null, { status: 500 });
    }
  }
  
  // Handle standard JSON request if not SSE
  try {
    const body: ChatRequestBody = await req.json();
    const lastMessage = body.messages[body.messages.length - 1];
    const messageContent = lastMessage?.content;
    const originalThreadId = body.data?.threadId; // Store original threadId
    
    // Always generate a new threadId for each query to avoid concurrency issues
    threadId = uuidv4();
    isNewThread = true;
    
    console.log('[POST /api/chat - Polling+GetState] Extracted:', { messageContent, originalThreadId });
    console.log('[POST /api/chat - Polling+GetState] Created new threadId:', threadId);

    if (!messageContent) {
        const error = 'Message content is required';
        console.error(`[POST /api/chat - Polling+GetState] Error: ${error}.`);
        return new NextResponse(JSON.stringify({ error }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const assistantId = process.env.LANGGRAPH_RETRIEVAL_ASSISTANT_ID;
    if (!assistantId) {
        console.error('[POST /api/chat - Polling+GetState] Error: LANGGRAPH_RETRIEVAL_ASSISTANT_ID is not set.');
        return new NextResponse(JSON.stringify({ error: 'Server configuration error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    console.log(`[POST /api/chat - Polling+GetState] Using Assistant ID: ${assistantId}`);

    // --- Create Run & Poll --- 
    let runId: string | undefined;
    try {
      const serverClient = createServerClient();
      
      // Create a new thread on the server
      if (isNewThread) {
        console.log(`[POST /api/chat - Polling+GetState] Creating new thread on server...`);
        const threadResponse = await serverClient.client.threads.create();
        threadId = threadResponse.thread_id;
        console.log(`[POST /api/chat - Polling+GetState] Created new server thread: ${threadId}`);
      }
      
      console.log(`[POST /api/chat - Polling+GetState] Calling serverClient.client.runs.create...`);
      const run = await serverClient.client.runs.create(
          threadId, 
          assistantId,
          {
              input: { query: messageContent }, 
              config: { 
                  configurable: { 
                      ...retrievalAssistantStreamConfig,
                      thread_id: threadId,
                      multitask_strategy: "parallel" // Add multitask strategy for extra safety
                  }
              },
          }
      );
      runId = run.run_id; // Store runId for potential error logging
      console.log(`[POST /api/chat - Polling+GetState] Run created: ${runId}. Starting polling...`);

      const pollResult = await pollRunStatus(serverClient, threadId, runId);
      console.log('[POST /api/chat - Polling+GetState] Polling finished.');

      if (pollResult.status !== 'success') {
        console.error(`[POST /api/chat - Polling+GetState] Backend run failed with status: ${pollResult.status}`);
        throw new Error(`Backend run failed: ${pollResult.error || 'Unknown error from backend run'}`);
      }

    } catch (error) {
        console.error(`[POST /api/chat - Polling+GetState] Error during create/poll (runId: ${runId}):`, error);
        // Re-throw to be caught by the outer catch block
        throw new Error(`Backend interaction error: ${error instanceof Error ? error.message : String(error)}`); 
    }

    // --- Fetch Final State --- 
    try {
        console.log(`[POST /api/chat - Polling+GetState] Fetching final state for thread: ${threadId}`);
        const serverClient = createServerClient(); // Re-create client just in case
        const finalThreadState = await serverClient.client.threads.getState(threadId);
        console.log('[POST /api/chat - Polling+GetState] Final thread state received:', JSON.stringify(finalThreadState, null, 2));

        // --- Extract final response and sources from the Thread State --- 
        let finalResponseContent = 'Error: Could not extract response content from thread state.';
        let finalSources: PDFDocument[] = [];
        // The thread state structure is often { values: { key1: val1, key2: val2, ... } }
        const stateValues = finalThreadState?.values || {}; 
        const stateValuesAsAny = stateValues as any; // Use 'as any' if types are uncertain

        // Extract AI message (look in stateValues.messages)
        if (stateValuesAsAny.messages && Array.isArray(stateValuesAsAny.messages)) {
            const assistantMessages = stateValuesAsAny.messages.filter((m: any) => m.type === 'ai' || m.role === 'assistant');
            if (assistantMessages.length > 0) {
                finalResponseContent = assistantMessages[assistantMessages.length - 1].content;
            }
        }

        // Extract sources (look in stateValues.documents)
        if (stateValuesAsAny.documents && Array.isArray(stateValuesAsAny.documents)) {
            finalSources = stateValuesAsAny.documents;
        } 

        console.log('[POST /api/chat - Polling+GetState] Extracted content:', finalResponseContent);
        console.log('[POST /api/chat - Polling+GetState] Extracted sources count:', finalSources.length);

        // Save messages to Supabase for persistence
        const conversation = await getConversationByThreadId(threadId);
        if (conversation) {
          // First save the user message
          await addMessageToConversation(conversation.id, {
            content: messageContent,
            role: 'user'
          });
          
          // Then save the assistant's response
          await addMessageToConversation(conversation.id, {
            content: finalResponseContent,
            role: 'assistant',
            metadata: { sources: finalSources || [] }
          });
          
          console.log(`[SSE] Saved conversation messages to Supabase for thread ${threadId}`);
        } else {
          console.warn(`[SSE] Could not find conversation record for thread ${threadId}`);
        }

        return NextResponse.json({
            response: finalResponseContent, 
            sources: finalSources,
            newThreadId: threadId // Return the new threadId to the client
        });

    } catch (error) {
        console.error(`[POST /api/chat - Polling+GetState] Error fetching/processing final state for thread ${threadId}:`, error);
        // Throw a specific error for this stage
        throw new Error(`Failed to retrieve final state: ${error instanceof Error ? error.message : String(error)}`); 
    }

  } catch (error) {
      // Catch errors from validation, create/poll, or getState stages
      console.error('[POST /api/chat - Polling+GetState] Overall route error:', error);
      return new NextResponse(JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
      });
  }
}
