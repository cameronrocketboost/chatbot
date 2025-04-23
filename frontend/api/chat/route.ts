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
        // const iterator = langGraphServerClient.streamThreadEvents(threadId, { query: message }); // OLD INCORRECT METHOD
        
        // TODO: Replace "YOUR_ASSISTANT_ID" with the actual ID/name of your LangGraph graph (e.g., "retrieval_graph")
        // TODO: Verify the 'input' structure matches your graph's expected input schema.
        const streamResponse = langGraphServerClient.runs.stream(
          threadId,
          "YOUR_ASSISTANT_ID", // Replace with your graph ID
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
          // --- START OF LOGIC TO BE REVISED ---
          // LangGraph streamLog yields events with 'ops' // <-- This assumption might be wrong for runs.stream
          // The following logic based on event.ops and specific paths needs review/replacement
          if (chunk.event === 'on_chat_model_stream') { // Example: Handling LLM stream tokens
            // Assuming chunk.data.chunk contains the message content
            // Send message chunk...
             sendSSE('messages/partial', chunk.data.chunk); 
          } else if (chunk.event === 'on_tool_start' && chunk.name === 'retrieve') { // Example: Handle tool start
             sendSSE('updates', { retrieveDocuments: { thinking: true }});
          } else if (chunk.event === 'on_tool_end' && chunk.name === 'retrieve') { // Example: Handle tool end
             // Assuming chunk.data.output contains documents
             const documents = chunk.data.output ?? [];
             const enhancedDocs = mapRetrievalStrategy(documents);
             sendSSE('updates', { retrieveDocuments: { documents: enhancedDocs } });
          } // Add more handlers for other relevant event types ('on_chain_start', 'on_chain_end', etc.)
          // --- END OF LOGIC TO BE REVISED ---

        //   // Original logic (likely needs removal/replacement):
        //   for (const op of chunk.ops) { // Assuming chunk has 'ops' - VERIFY THIS
        //     if (op.op === 'add' || op.op === 'replace') { 
        //       if (op.path === `/logs/${op.run_id}/streamed_output/-` || op.path.endsWith('/messages/-')) {
        //          sendSSE('messages/partial', op.value); 
        //       }
        //       else if (op.path.endsWith('/retrieveDocuments/final_state/documents')) {
        //          const documents = op.value ?? [];
        //          const enhancedDocs = mapRetrievalStrategy(documents);
        //          sendSSE('updates', { retrieveDocuments: { documents: enhancedDocs } });
        //       }
        //       else if (op.path.startsWith('/logs/') && op.path.endsWith('/final_state')) {
        //          const nodeNameMatch = op.path.match(/\\/logs\\/([^\\/]+)\\/final_state/);
        //          const currentNode = nodeNameMatch ? nodeNameMatch[1] : null;
        //          
        //          if (currentNode && currentNode !== prevNode) {
        //             prevNode = currentNode;
        //             // ... existing thinking update logic ...
        //          }
        //       } 
        //     }
        //   }
         }
        
        // Fetch finalThreadState - This might also need adjustment depending on how state is finalized
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