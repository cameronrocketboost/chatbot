import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import dotenv from 'dotenv';
dotenv.config();

// Import the graph module 
import * as graphModule from '../../src/retrieval_graph/graph.js';

// Mock the console methods to prevent test output clutter
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Create a test wrapper function to access the private extractQueryFilters function
const testExtractQueryFilters = async (query: string, _config: any = {}) => {
  // We're using the fact that the retrieval_graph exports a graph object
  // that uses extractQueryFilters internally in the retrieveDocuments node
  
  // Mock the retrieveDocuments function to capture the filters
  let capturedFilters: any = null;
  
  // Save original implementation
  const originalImplementation = (graphModule as any).retrieveDocuments;
  
  // Override implementation to capture filters
  (graphModule as any).retrieveDocuments = async (_state: any, config: any) => {
    // This simulates the line where extractQueryFilters is called
    const result = await (graphModule as any).extractQueryFilters(query, config);
    capturedFilters = result;
    return { documents: [] }; // Return empty document array
  };
  
  // Call with minimal state to trigger our mock
  await (graphModule as any).graph.invoke({
    messages: [],
    query: query
  });
  
  // Restore original implementation
  (graphModule as any).retrieveDocuments = originalImplementation;
  
  return capturedFilters;
};

describe('Merck Document Extraction Tests', () => {
  const expectedFilename = "1306 Merck Fertility Forum Nov 23 Dis Doc (1).pptx";
  
  it('should extract exact document name with extension', async () => {
    const result = await testExtractQueryFilters(`Tell me about ${expectedFilename}`);
    
    expect(result.filters).toBeDefined();
    expect(result.filters['metadata.source']).toBe(expectedFilename);
  });

  it('should recognize document by partial name', async () => {
    const result = await testExtractQueryFilters('Tell me about the Merck Fertility Forum presentation');
    
    expect(result.filters).toBeDefined();
    expect(result.filters['metadata.source']).toBe(expectedFilename);
  });

  it('should recognize document by 1306 reference', async () => {
    const result = await testExtractQueryFilters('Show me information from the 1306 Fertility document');
    
    expect(result.filters).toBeDefined();
    expect(result.filters['metadata.source']).toBe(expectedFilename);
  });

  it('should handle complex queries about the document', async () => {
    const result = await testExtractQueryFilters('What are the key points about fertility discussed in the Merck forum?');
    
    expect(result.filters).toBeDefined();
    expect(result.filters['metadata.source']).toBe(expectedFilename);
  });

  it('should not match when there are insufficient document identifiers', async () => {
    const result = await testExtractQueryFilters('Tell me about fertility treatments');
    
    // Should not match with just "fertility" alone - needs more context
    expect(result.filters['metadata.source']).toBeUndefined();
  });

  it('should not match unrelated queries with the document', async () => {
    const result = await testExtractQueryFilters('What is the capital of France?');
    
    expect(result.filters['metadata.source']).toBeUndefined();
  });
  
  it('should correctly prioritize exact filename match over general references', async () => {
    const result = await testExtractQueryFilters('Show me the Merck Fertility Forum Nov 23 Dis Doc.pptx file');
    
    expect(result.filters).toBeDefined();
    expect(result.filters['filterApplied'].matchType).toBe('exact-extension');
  });
}); 