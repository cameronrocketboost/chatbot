import { NextRequest, NextResponse } from 'next/server';
import { client } from '@/lib/langgraph-client';
import { createServerClient } from '@/lib/langgraph-server';

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
  
  // Get client instance at runtime
  const serverClient = createServerClient();
  
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
        // const iterator = langGraphServerClient.streamThreadEvents(threadId, { query: message }); // OLD INCORRECT METHOD
        
        // Use the runtime client instance
        const streamResponse = serverClient.client.runs.stream(
          threadId,
          "retrieval_graph", // Use the graph name exposed by the backend
          {
            input: { messages: [{ role: "user", content: message }] }, // Adjust input structure if needed
            streamMode: "updates", // Or "events" - choose based on required detail
          }
        );
        
        let prevNode = null;
        // TODO: The logic within this loop needs to be updated to handle the event structure
        //       yielded by client.runs.stream (chunks typically have 'event' and 'data' properties).
        //       The current logic based on event.ops and specific paths is likely incompatible.
        //       Inspect the actual 'chunk' objects from streamResponse to adapt this logic.
        for await (const chunk of streamResponse) { 
          // --- REPLACED INCOMPATIBLE LOGIC --- 
          console.log("Received stream chunk:", chunk);
          // TODO: Add logic here to handle the actual chunk structure.
          //       Check chunk.event ('values', 'messages', 'updates', 'metadata', etc.) 
          //       and chunk.data or other properties based on the event type
          //       to extract thinking states, partial messages, documents, etc.
          //       and send appropriate SSE messages using sendSSE().
          // --- END OF REPLACEMENT --- 
         }
        
        // Fetch finalThreadState - Use the runtime client instance
        const finalThreadState = await serverClient.getThreadState(threadId);
        
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