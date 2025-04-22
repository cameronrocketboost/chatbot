import { NextRequest, NextResponse } from 'next/server';
import { client } from '@/lib/langgraph-client';
import { langGraphServerClient } from '@/lib/langgraph-server';

// Placeholder definition for THINKING_STAGES - Adjust if defined elsewhere
const THINKING_STAGES = {
  RETRIEVING: { stage: 'retrieving', description: 'Searching for relevant documents...' },
  EVALUATING: { stage: 'evaluating', description: 'Evaluating document relevance...' },
  // Add other stages as needed
};

// Enhanced retrieval information mapping
function mapRetrievalStrategy(documents: any[]) {
  if (!documents || documents.length === 0) return documents;
  
  return documents.map(doc => {
    // Create a retrieval metadata object if not exists
    if (!doc.metadata) {
      doc.metadata = {};
    }
    
    if (!doc.metadata.retrieval) {
      doc.metadata.retrieval = {};
    }
    
    // Detect PowerPoint specific retrieval
    if (doc.metadata.contentType?.includes('presentation') || 
        doc.metadata.source?.toLowerCase().endsWith('.pptx')) {
      doc.metadata.retrieval.retrievalStrategy = 'powerpoint';
    }
    // Detect if it's part of a chunk group
    else if (doc.metadata.isPartOfGroup || doc.metadata.groupId) {
      doc.metadata.retrieval.retrievalStrategy = 'hybrid';
    }
    // Otherwise standard retrieval
    else {
      doc.metadata.retrieval.retrievalStrategy = 'standard';
    }
    
    // Map any filters
    if (doc.metadata.filterApplied) {
      doc.metadata.retrieval.retrievalFilters = doc.metadata.filterApplied;
    }
    
    return doc;
  });
}

const encoder = new TextEncoder();
const sendThinkingUpdate = (data: any) => {
  return encoder.encode(`data: ${JSON.stringify(data)}\\n\\n`);
};

export async function POST(request: NextRequest) {
  const { message, threadId } = await request.json();
  
  // Check for required parameters
  if (!message) {
    return NextResponse.json(
      { error: 'Message is required' },
      { status: 400 }
    );
  }
  
  if (!threadId) {
    return NextResponse.json(
      { error: 'Thread ID is required' },
      { status: 400 }
    );
  }
  
  // Create an SSE response
  const customReadable = new ReadableStream({
    async start(controller) {
      try {
        // Helper function to send an SSE message
        function sendSSE(event: string, data: any) {
          const sseMessage = JSON.stringify({ event, data });
          controller.enqueue(encoder.encode(`data: ${sseMessage}\n\n`));
        }
        
        // Call LangGraph server client to stream events for the thread
        const iterator = langGraphServerClient.streamThreadEvents(threadId, { query: message });
        
        let prevNode = null;
        for await (const event of iterator) {
          // LangGraph streamLog yields events with 'ops'
          for (const op of event.ops) {
            // Check operation path to see if it's a state update
            // path often looks like '/logs/...' or '/final_state'
            // We are interested in updates to the state, particularly messages and documents
            // Example path for state update: "/logs/retrieveDocuments/final_state"
            if (op.op === 'add' || op.op === 'replace') { // Look for state updates
              // Check if the update is for messages
              if (op.path === `/logs/${op.run_id}/streamed_output/-` || op.path.endsWith('/messages/-')) {
                 // Send message updates (might need specific handling based on exact path/value structure)
                 // Assuming op.value contains the message object or array
                 sendSSE('messages/partial', op.value); 
              }
              // Check if the update is for documents (assuming stored under retrieveDocuments node state)
              else if (op.path.endsWith('/retrieveDocuments/final_state/documents')) {
                 const documents = op.value ?? [];
                 const enhancedDocs = mapRetrievalStrategy(documents);
                 sendSSE('updates', { retrieveDocuments: { documents: enhancedDocs } });
              }
              // Check for node execution updates to drive 'thinking' state
              else if (op.path.startsWith('/logs/') && op.path.endsWith('/final_state')) {
                 const nodeNameMatch = op.path.match(/\/logs\/([^\/]+)\/final_state/);
                 const currentNode = nodeNameMatch ? nodeNameMatch[1] : null;
                 
                 if (currentNode && currentNode !== prevNode) {
                    prevNode = currentNode;
                    if (currentNode.includes('retrieveDocuments')) {
                      controller.enqueue(sendThinkingUpdate({
                        thinking: true,
                        ...THINKING_STAGES.RETRIEVING,
                      }));
                    } else if (currentNode.includes('evaluateRetrievalQuality')) {
                      controller.enqueue(sendThinkingUpdate({
                        thinking: true,
                        ...THINKING_STAGES.EVALUATING,
                      }));
                    }
                 }
              } 
              // Add more checks for other state updates if needed
            }
          }
        }
        
        // Fetch finalThreadState
        const finalThreadState = await langGraphServerClient.getThreadState(threadId);
        
        // Access response and documents (sources) from the .values property of the state
        const finalValues = finalThreadState?.values ?? {};
        const finalResponseContent = finalValues.response ?? 'Sorry, I encountered an issue generating a final response.'; // Provide fallback
        const finalSources = finalValues.documents ?? []; // Assuming documents hold the sources

        // Send final response
        controller.enqueue(sendThinkingUpdate({
          thinking: false,
          response: finalResponseContent,
          sources: finalSources,
          threadId: threadId
        }));

        // Close the stream
        controller.close();
      } catch (error) {
        console.error('Error in chat stream:', error);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              event: 'error',
              data: { message: 'Error processing your request' },
            })}\n\n`,
          ),
        );
        controller.close();
      }
    },
  });
  
  return new NextResponse(customReadable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
} 