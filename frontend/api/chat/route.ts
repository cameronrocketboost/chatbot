import { NextRequest, NextResponse } from 'next/server';
import { client } from '@/lib/langgraph-client';
import { langGraphServerClient } from '@/lib/langgraph-server';

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
        
        // Call LangGraph
        const iterator = await client.threadContinue({
          threadId,
          inputs: { query: message }
        }, {
          stream: true,
        });
        
        let prevNode = null;
        for await (const event of iterator) {
          if (event.event_type === 'update') {
            // Handle node-specific updates
            if (event.data) {
              const nodeUpdates = event.data;
              
              // Check if this update contains retrieved documents
              if (nodeUpdates.retrieveDocuments && nodeUpdates.retrieveDocuments.documents) {
                // Enhance documents with retrieval metadata
                const enhancedDocs = mapRetrievalStrategy(nodeUpdates.retrieveDocuments.documents);
                
                // Send enhanced documents
                const enhancedUpdate = {
                  ...nodeUpdates,
                  retrieveDocuments: {
                    ...nodeUpdates.retrieveDocuments,
                    documents: enhancedDocs
                  }
                };
                sendSSE('updates', enhancedUpdate);
              } else {
                // Pass through other updates
                sendSSE('updates', nodeUpdates);
              }
            }
          } else if (event.event_type === 'intermediate_step') {
            // Handle intermediate steps if needed
          } else if (event.event_type === 'message') {
            // Handle full messages
            if (event.data?.messages) {
              sendSSE('messages/partial', event.data.messages);
            }
          }
          
          const currentNode = event.data?.node;
          if (currentNode !== prevNode) {
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
        
        // Fetch finalThreadState
        const finalThreadState = await langGraphServerClient.getThreadState(threadId);
        const finalResponseContent = finalThreadState.response;
        const finalSources = finalThreadState.sources;

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