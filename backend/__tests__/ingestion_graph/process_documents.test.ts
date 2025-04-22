import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { Document } from '@langchain/core/documents';
dotenv.config();

// Import the graph module
import * as graphModule from '../../src/ingestion_graph/graph.js';
import { FilePayload } from '../../src/ingestion_graph/state.js';

// Set up mocks
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});

  // Mock the Supabase client
  jest.mock('@supabase/supabase-js', () => {
    return {
      createClient: jest.fn(() => ({
        from: jest.fn(() => ({
          select: jest.fn(() => ({
            ilike: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({ data: [], error: null }))
            }))
          })),
          delete: jest.fn(() => ({
            eq: jest.fn(() => Promise.resolve({ error: null }))
          }))
        }))
      }))
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

// Helper function to read test files
async function readTestFile(filename: string): Promise<Buffer> {
  try {
    return await fs.readFile(path.join(process.cwd(), 'test_docs', filename));
  } catch (error) {
    console.error(`Error reading test file ${filename}:`, error);
    throw error;
  }
}

// Helper function to create a file payload for testing
async function createFilePayload(filename: string, contentType: string): Promise<FilePayload> {
  try {
    const fileBuffer = await readTestFile(filename);
    return {
      filename,
      contentType,
      contentBase64: fileBuffer.toString('base64')
    };
  } catch (error) {
    console.error(`Error creating file payload for ${filename}:`, error);
    throw error;
  }
}

describe('Document Processing Pipeline', () => {
  // Skip tests if we don't have test documents
  const runTest = async () => {
    try {
      await fs.access(path.join(process.cwd(), 'test_docs'));
      return true;
    } catch (error) {
      console.warn('Test documents directory not found, skipping tests');
      return false;
    }
  };

  it('should process a PDF document correctly', async () => {
    if (!(await runTest())) return;
    
    // Look for a sample PDF in the test_docs directory
    let samplePdf;
    try {
      const files = await fs.readdir(path.join(process.cwd(), 'test_docs'));
      samplePdf = files.find(file => file.endsWith('.pdf'));
      if (!samplePdf) {
        console.warn('No sample PDF found in test_docs directory, skipping test');
        return;
      }
    } catch (error) {
      console.error('Error reading test_docs directory:', error);
      return;
    }

    const filePayload = await createFilePayload(samplePdf, 'application/pdf');
    
    // Create a minimal state for the processFiles function
    const state = {
      files: [filePayload],
      docs: [],
      error: null,
      skippedFilenames: [],
      finalStatus: 'InProgress',
      processingStep: '',
      currentFile: null,
      totalFiles: 1,
      processedFiles: 0
    };

    // Call the processFiles function
    const result = await (graphModule as any).processFiles(state);
    
    // Basic assertions
    expect(result).toBeDefined();
    expect(result.docs).toBeDefined();
    expect(Array.isArray(result.docs)).toBe(true);
    expect(result.docs.length).toBeGreaterThan(0);
    
    // Check that each document has the correct structure
    for (const doc of result.docs) {
      expect(doc).toBeInstanceOf(Document);
      expect(doc.pageContent).toBeDefined();
      expect(typeof doc.pageContent).toBe('string');
      expect(doc.pageContent.length).toBeGreaterThan(0);
      
      // Check metadata
      expect(doc.metadata).toBeDefined();
      expect(doc.metadata.source).toBe(samplePdf);
      expect(doc.metadata.contentType).toBe('application/pdf');
      expect(doc.metadata.chunkIndex).toBeDefined();
      expect(doc.metadata.totalChunks).toBeDefined();
    }
  });

  it('should handle duplicate documents correctly', async () => {
    if (!(await runTest())) return;
    
    // Mock the Supabase response to simulate a duplicate
    const createClientMock = jest.fn(() => ({
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          ilike: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve({ 
              data: [{ id: 'test-id' }], 
              error: null 
            }))
          }))
        }))
      }))
    }));
    
    // Override the createClient mock
    jest.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));
    
    // Look for a sample PDF
    let samplePdf;
    try {
      const files = await fs.readdir(path.join(process.cwd(), 'test_docs'));
      samplePdf = files.find(file => file.endsWith('.pdf'));
      if (!samplePdf) {
        console.warn('No sample PDF found in test_docs directory, skipping test');
        return;
      }
    } catch (error) {
      console.error('Error reading test_docs directory:', error);
      return;
    }

    const filePayload = await createFilePayload(samplePdf, 'application/pdf');
    
    // Create a minimal state
    const state = {
      files: [filePayload],
      docs: [],
      error: null,
      skippedFilenames: [],
      finalStatus: 'InProgress',
      processingStep: '',
      currentFile: null,
      totalFiles: 1,
      processedFiles: 0
    };

    // Call processFiles
    const result = await (graphModule as any).processFiles(state);
    
    // Check that the document was skipped
    expect(result).toBeDefined();
    expect(result.skippedFilenames).toContain(samplePdf);
    expect(result.docs).toHaveLength(0);
    expect(result.finalStatus).toBe('CompletedWithSkips');
  });

  it('should handle unsupported file types gracefully', async () => {
    if (!(await runTest())) return;
    
    // Create a file payload with an unsupported content type
    const filePayload = {
      filename: 'test.xyz',
      contentType: 'application/xyz',
      contentBase64: 'VGVzdCBjb250ZW50' // Base64 of "Test content"
    };
    
    // Create a minimal state
    const state = {
      files: [filePayload],
      docs: [],
      error: null,
      skippedFilenames: [],
      finalStatus: 'InProgress',
      processingStep: '',
      currentFile: null,
      totalFiles: 1,
      processedFiles: 0
    };

    // Call processFiles
    const result = await (graphModule as any).processFiles(state);
    
    // Check that processing handled the unsupported type gracefully
    expect(result).toBeDefined();
    expect(result.docs).toHaveLength(0);
    expect(result.finalStatus).not.toBe('InProgress'); // Should be changed from InProgress
  });
}); 