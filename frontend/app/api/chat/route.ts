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
  
  // Get the client instance at runtime (outside specific handlers for now,
  // assuming it's okay to create it once per request)
  const serverClient = createServerClient(); 
  
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
            const assistantId = process.env.LANGGRAPH_RETRIEVAL_ASSISTANT_ID;
            if (!assistantId) throw new Error('LANGGRAPH_RETRIEVAL_ASSISTANT_ID is not set');

            // Create thread if needed (using the same serverClient instance)
            if (isNewThread) {
              const threadResponse = await serverClient.client.threads.create();
              threadId = threadResponse.thread_id;
              console.log(`[POST /api/chat] Created new thread: ${threadId}`);
            } else if (!threadId) {
              throw new Error('Error: Attempting to use existing thread but threadId is missing.');
            }
            
            // Add context from previous messages if needed
            let contextSetup = {};
            if (!isNewThread && body.messages.length > 1) {
              // Get previous messages to provide context (up to 5 most recent)
              const recentMessages = body.messages.slice(-6, -1);
              if (recentMessages.length > 0) {
                // Format previous messages for context
                contextSetup = {
                  contextMessages: recentMessages.map(msg => ({ type: msg.role === 'user' ? 'human' : 'ai', content: msg.content }))
                };
                
                console.log(`[POST /api/chat] Added ${recentMessages.length} messages as context`);
              }
            }
            
            // --- Use Streaming with streamMode: 'values' --- 
            console.log(`[SSE] Starting graph stream (values) for thread ${threadId}...`);

            const streamResponse = serverClient.client.runs.stream(
              threadId!,
              assistantId,
              {
                input: { query: messageContent, ...contextSetup },
                streamMode: "values", // Get final state values
                config: {
                  configurable: {
                    ...retrievalAssistantStreamConfig,
                    thread_id: threadId,
                  }
                },
              }
            );

            let finalResponseContent = '';
            let finalSources: PDFDocument[] = [];
            let extractedData = false;

            // Process the final value(s) from the stream
            for await (const finalValue of streamResponse) {
              console.log("[SSE Value Chunk]:", JSON.stringify(finalValue).substring(0, 500) + "...");
              // Attempt to extract data from the structure yielded by streamMode: values
              // This structure can vary, often nesting output under node names
              const valuesToCheck = Object.values(finalValue || {});
              for (const nodeOutput of valuesToCheck) {
                  if (typeof nodeOutput === 'object' && nodeOutput !== null) {
                      // Check for common keys where response/documents might appear
                      const potentialResponse = nodeOutput.response || nodeOutput.answer || nodeOutput.content || (typeof nodeOutput === 'string' ? nodeOutput : null);
                      const potentialDocuments = nodeOutput.documents || nodeOutput.sources;
                      if (potentialResponse && typeof potentialResponse === 'string') {
                          finalResponseContent = potentialResponse;
                          extractedData = true;
                      }
                      if (potentialDocuments && Array.isArray(potentialDocuments)) {
                          finalSources = potentialDocuments as PDFDocument[];
                          extractedData = true;
                      }
                  }
              }
              if (extractedData) {
                 console.log("[SSE] Extracted final data from stream value.");
                 break; // Assume the last chunk with data is the final state
              }
            }

            console.log("[SSE] Stream finished.");

            // Fallback if stream didn't yield expected data
            if (!extractedData) {
              console.warn("[SSE] Final response/sources not found in stream values, attempting getState fallback...");
              try {
                  const finalThreadState = await serverClient.client.threads.getState(threadId!); 
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
                  console.log("[SSE Fallback] Extracted via getState:", { responseLength: finalResponseContent.length, sourcesCount: finalSources.length });
              } catch (getStateError) {
                  console.error("[SSE Fallback] Error getting final state:", getStateError);
                  finalResponseContent = "Error retrieving final response.";
              }
            }
            
            // --- Send Final SSE Message (Mimic AI SDK Text Stream) --- 
            if (finalResponseContent) {
              // Escape the response content properly for JSON string embedding
              const escapedContent = JSON.stringify(finalResponseContent).slice(1, -1);
              const messageChunk = `0:"${escapedContent}"\n`;
              console.log('[SSE] Sending final response text chunk:', messageChunk);
              controller.enqueue(encoder.encode(messageChunk));
              await new Promise(resolve => setTimeout(resolve, 1)); // Small delay
            } else {
              // Send empty text chunk if no response
              const emptyChunk = `0:""\n`;
              console.log('[SSE] Sending empty text chunk.');
              controller.enqueue(encoder.encode(emptyChunk));
              await new Promise(resolve => setTimeout(resolve, 1));
            }
            
            // --- Save to Supabase (using the extracted finalResponseContent) --- 
            const conversation = await getConversationByThreadId(threadId!); 
            if (conversation) {
              await addMessageToConversation(conversation.id, { content: messageContent, role: 'user' });
              await addMessageToConversation(conversation.id, { content: finalResponseContent, role: 'assistant', metadata: { sources: finalSources || [] } });
              console.log(`[SSE] Saved conversation messages to Supabase for thread ${threadId}`);
            } else {
              console.warn(`[SSE] Could not find conversation record for thread ${threadId}`);
            }

            controller.close(); // Close the stream after sending final data
          } catch (error) {
            console.error('[SSE Stream] Error:', error);
            const errorData = { thinking: false, error: error instanceof Error ? error.message : 'Unknown stream error' };
            try {
              controller.enqueue(sendThinkingUpdate(errorData));
            } catch (enqueueError) {
              console.error("[SSE] Error enqueuing error message:", enqueueError);
            } finally {
              controller.close();
            }
          }
        }
      });

      // Return the stream response
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      });

    } catch (error) {
      // Error during initial setup before stream starts
      console.error('[SSE] Overall setup error:', error);
      return new NextResponse(JSON.stringify({ 
        error: 'Failed to initialize chat stream', 
        details: error instanceof Error ? error.message : String(error) 
      }), { status: 500 });
    }
  } else {
    // --- Removed the non-SSE (polling) block --- 
    console.error("[POST /api/chat] Non-SSE request received. This endpoint only supports SSE.");
    return new NextResponse(JSON.stringify({ error: 'Server-Sent Events required for this endpoint.' }), {
        status: 400, // Bad Request
        headers: { 'Content-Type': 'application/json' },
    });
  }
}

