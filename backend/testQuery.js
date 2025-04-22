// Simple test script to test queries against the LangGraph API
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const apiUrl = process.env.LANGGRAPH_API_URL || 'http://localhost:2024';

async function testQuery(query) {
  try {
    console.log(`Testing query: "${query}"`);
    
    // First create a thread
    const threadResponse = await fetch(`${apiUrl}/api/v1/threads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    
    if (!threadResponse.ok) {
      throw new Error(`Failed to create thread: ${threadResponse.status} ${threadResponse.statusText}`);
    }
    
    const threadData = await threadResponse.json();
    const threadId = threadData.thread_id;
    console.log(`Created thread: ${threadId}`);
    
    // Now run the query
    const runResponse = await fetch(`${apiUrl}/api/v1/graphs/retrieval_graph/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        thread_id: threadId,
        config: {},
        input: {
          messages: [],
          query: query
        }
      }),
    });
    
    if (!runResponse.ok) {
      throw new Error(`Failed to create run: ${runResponse.status} ${runResponse.statusText}`);
    }
    
    const runData = await runResponse.json();
    const runId = runData.run_id;
    console.log(`Created run: ${runId}`);
    
    // Poll for completion
    let completed = false;
    let result = null;
    
    while (!completed) {
      const statusResponse = await fetch(`${apiUrl}/api/v1/graphs/retrieval_graph/runs/${runId}`, {
        method: 'GET',
      });
      
      if (!statusResponse.ok) {
        throw new Error(`Failed to get run status: ${statusResponse.status} ${statusResponse.statusText}`);
      }
      
      const statusData = await statusResponse.json();
      completed = statusData.status === 'complete';
      
      if (completed) {
        result = statusData.output;
      } else {
        console.log('Run still in progress, waiting 1 second...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log('Run completed!');
    console.log('Query filters applied:');
    console.log(JSON.stringify(result.filters || {}, null, 2));
    console.log('\nDocuments retrieved:');
    console.log(`Number of documents: ${result.documents?.length || 0}`);
    
    // Check if we found the Merck document
    if (result.documents?.length > 0) {
      const foundMerck = result.documents.some(doc => 
        doc.metadata?.source?.includes('Merck') || 
        doc.metadata?.source?.includes('1306')
      );
      console.log(`Found Merck document: ${foundMerck}`);
      
      // Print one document sample
      console.log('\nSample document:');
      console.log(JSON.stringify(result.documents[0], null, 2));
    }
    
    return result;
  } catch (error) {
    console.error('Error testing query:', error);
    return null;
  }
}

// Test with the Merck document query
const query = process.argv[2] || 'Tell me about the Merck Fertility Forum presentation';
testQuery(query).then(() => console.log('Testing completed!')); 