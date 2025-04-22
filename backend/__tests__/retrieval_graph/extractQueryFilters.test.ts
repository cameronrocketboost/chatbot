import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import dotenv from 'dotenv';
dotenv.config();

// We need to access the extractQueryFilters function directly
// Since it's not exported, we'll need to mock it or create a test wrapper
// For now, we'll create a wrapper to test the functionality

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
// This is a common technique for testing private functions
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

describe('extractQueryFilters Function', () => {
  it('should extract PDF filename with extension', async () => {
    const result = await testExtractQueryFilters('Tell me about test.pdf');
    
    expect(result.filters).toBeDefined();
    expect(result.filters['metadata.source']).toBe('test.pdf');
    expect(result.cleanedQuery).toBe('Tell me about test.pdf');
  });

  it('should extract PDF filename without extension and add it', async () => {
    const result = await testExtractQueryFilters('What does the test pdf contain?');
    
    expect(result.filters).toBeDefined();
    expect(result.filters['metadata.source']).toBe('test.pdf');
  });

  it('should extract DOCX filename', async () => {
    const result = await testExtractQueryFilters('Summarize the report.docx document');
    
    expect(result.filters).toBeDefined();
    expect(result.filters['metadata.source']).toBe('report.docx');
  });

  it('should extract PPTX filename', async () => {
    const result = await testExtractQueryFilters('What is in the sales presentation.pptx?');
    
    expect(result.filters).toBeDefined();
    expect(result.filters['metadata.source']).toBe('sales presentation.pptx');
  });

  it('should handle filenames with spaces correctly', async () => {
    const result = await testExtractQueryFilters('Can you tell me about the Annual Report 2023.pdf?');
    
    expect(result.filters).toBeDefined();
    expect(result.filters['metadata.source']).toBe('Annual Report 2023.pdf');
  });

  it('should extract content type filters when no filename is present', async () => {
    const result = await testExtractQueryFilters('Show me all the PDFs');
    
    expect(result.filters).toBeDefined();
    expect(result.filters['metadata.contentType']).toBe('application/pdf');
    expect(result.filters['metadata.source']).toBeUndefined();
  });

  it('should extract recency filters', async () => {
    const result = await testExtractQueryFilters('Show me the latest documents');
    
    expect(result.filters).toBeDefined();
    expect(result.filters['sortBy']).toBe('metadata.parsedAt');
    expect(result.filters['sortDirection']).toBe('desc');
  });

  it('should handle compound filters - content type and recency', async () => {
    const result = await testExtractQueryFilters('Show me the recent PDFs');
    
    expect(result.filters).toBeDefined();
    expect(result.filters['metadata.contentType']).toBe('application/pdf');
    expect(result.filters['sortBy']).toBe('metadata.parsedAt');
    expect(result.filters['sortDirection']).toBe('desc');
  });

  it('should prioritize filename filters over content type filters', async () => {
    const result = await testExtractQueryFilters('Show me the content of report.pdf and other PDFs');
    
    expect(result.filters).toBeDefined();
    expect(result.filters['metadata.source']).toBe('report.pdf');
    expect(result.filters['metadata.contentType']).toBeUndefined();
  });

  it('should handle special characters in filenames', async () => {
    const result = await testExtractQueryFilters('What is in the Q1-2023_results.pdf?');
    
    expect(result.filters).toBeDefined();
    expect(result.filters['metadata.source']).toBe('Q1-2023_results.pdf');
  });

  it('should handle queries with no filters gracefully', async () => {
    const result = await testExtractQueryFilters('What is the capital of France?');
    
    expect(result.filters).toBeDefined();
    // Should not have any specific filters set
    expect(Object.keys(result.filters).filter(k => k !== 'filterApplied')).toHaveLength(0);
  });
}); 