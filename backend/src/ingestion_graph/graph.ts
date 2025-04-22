/**
 * This "graph" simply accepts Document chunks and adds them to the vector store.
 */

import { RunnableConfig } from '@langchain/core/runnables';
import { StateGraph, END } from '@langchain/langgraph';
import { Document } from '@langchain/core/documents';
import { Buffer } from 'buffer';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { createClient } from '@supabase/supabase-js';
import officeParser from 'officeparser';

// Use original State/Config annotations
import { IndexStateAnnotation, IndexStateType } from './state.js';
// Comment out unused imports
// import {
//   ensureIndexConfiguration,
//   IndexConfigurationAnnotation,
// } from './configuration.js';
import { makeRetriever } from '../shared/retrieval.js';

// Define the separator
const SLIDE_SEPARATOR = '\n\n---SLIDE_SEPARATOR---\n\n';

// Define file size limits
const MAX_PPTX_SIZE = 100 * 1024 * 1024; // 100MB for PPTX files

// Initialize text splitter with different settings for different document types
const defaultSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

// Special splitter for PowerPoint presentations with larger chunks and more overlap
const pptxSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1500,
  chunkOverlap: 300,
  separators: [SLIDE_SEPARATOR, "\n\n", "\n", " ", ""]
});

/**
 * Node: Processes uploaded files, checks for duplicates, parses content, and prepares docs.
 */
async function processFiles(
  state: IndexStateType,
  _config?: RunnableConfig,
): Promise<Partial<IndexStateType>> {
  console.log('[IngestionGraph] Starting processFiles node...');
  if (!state.files || state.files.length === 0) {
    console.warn('[IngestionGraph] No files provided to processFiles node.');
    // No files to process, but not necessarily an error state yet.
    // Let ingestDocs handle the empty docs state if needed.
    return { 
      docs: [], 
      error: null, 
      finalStatus: 'Failed', 
      skippedFilenames: [],
      processingStep: 'processFiles',
      totalFiles: 0,
      processedFiles: 0,
      currentFile: null
    };
  }

  // Initialize state tracking for progress 
  let currentState: Partial<IndexStateType> = {
    processingStep: 'processFiles',
    totalFiles: state.files.length,
    processedFiles: 0,
    currentFile: null
  };

  // Initialize Supabase client for duplicate check
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[IngestionGraph] Supabase credentials not found for duplicate check.');
    return { 
      ...currentState,
      docs: [], 
      error: 'Supabase credentials missing.', 
      finalStatus: 'Failed', 
      skippedFilenames: [] 
    };
  }
  
  const supabaseClient = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    { auth: { persistSession: false } }
  );

  console.log(`[IngestionGraph] Processing ${state.files.length} files...`);
  const docsForChunking: Document[] = [];
  let processingError: string | null = null;
  const filesSkippedThisNode: string[] = [];

  for (const file of state.files) {
    // Update current file for progress tracking with file type information
    currentState.currentFile = file.filename;
    // Extract file type from filename or content type
    const fileType = file.contentType === 'application/pdf' ? 'PDF' :
                     file.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? 'DOCX' :
                     file.contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ? 'PPTX' : 
                     'Document';
    
    console.log(`[IngestionGraph] Processing ${fileType} file ${currentState.processedFiles! + 1}/${currentState.totalFiles}: ${file.filename}`);
    
    // For different document types, adjust processing expectations
    if (file.contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      console.log(`[IngestionGraph] PowerPoint detected, using specialized processing`);
    }
    
    console.log(`[IngestionGraph] Checking for duplicates: ${file.filename}`);
    try {
      // --- Duplicate Check --- 
      const { data: existingDocs, error: checkError } = await supabaseClient
        .from('documents')
        .select('id') // Only need to check existence
        .ilike('metadata->>source', file.filename)
        .limit(1);

      if (checkError) {
        console.error(`[IngestionGraph] Error checking for duplicates for ${file.filename}:`, checkError);
        // Decide how to handle check errors - skip or proceed cautiously?
        // For now, let's proceed but log the error.
        if (!processingError) processingError = `Error checking duplicates for ${file.filename}`; 
      } else if (existingDocs && existingDocs.length > 0) {
        console.warn(`[IngestionGraph] Duplicate detected: ${file.filename} already exists. Skipping.`);
        filesSkippedThisNode.push(file.filename); // Add to list for this node's return
        continue; // Skip to the next file
      }
      // --- End Duplicate Check ---
      
      console.log(`[IngestionGraph] No duplicate found for ${file.filename}. Proceeding with processing.`);
      const buffer = Buffer.from(file.contentBase64, 'base64');
      const baseMetadata = {
        source: file.filename,
        contentType: file.contentType,
        fileSize: buffer.length,
        parsedAt: new Date().toISOString(),
      };

      console.log(`[IngestionGraph] Parsing file: ${file.filename}`);
      try { // Wrap parsing logic in try-catch
        if (file.contentType === 'application/pdf') {
          const data = await pdf(buffer);
          if (data.text.trim()) {
              docsForChunking.push(new Document({ pageContent: data.text, metadata: baseMetadata }));
          } else {
              console.warn(`[IngestionGraph] Parsed PDF content is empty: ${file.filename}`);
          }
        } else if (file.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          const { value } = await mammoth.extractRawText({ buffer });
          if (value.trim()) {
              docsForChunking.push(new Document({ pageContent: value, metadata: baseMetadata }));
          } else {
               console.warn(`[IngestionGraph] Parsed DOCX content is empty: ${file.filename}`);
          }
        } else if (file.contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
          console.log(`[IngestionGraph] Processing PPTX file: ${file.filename} (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);
          
          // Check if file size exceeds the special PowerPoint limit
          if (buffer.length > MAX_PPTX_SIZE) {
            console.error(`[IngestionGraph] PPTX file exceeds maximum size (100MB): ${file.filename}`);
            if (!processingError) processingError = `File ${file.filename} exceeds maximum PowerPoint size (100MB)`;
            filesSkippedThisNode.push(file.filename);
            continue;
          }
          
          try {
            // Use the specialized PowerPoint processor
            const pptxDocs = await processPowerPoint(buffer, baseMetadata);
            
            if (pptxDocs.length > 0) {
              // Add the PowerPoint chunks to the main docs array
              docsForChunking.push(...pptxDocs);
              console.log(`[IngestionGraph] Added ${pptxDocs.length} PowerPoint chunks for ${file.filename}`);
            } else {
              console.warn(`[IngestionGraph] No content extracted from PowerPoint: ${file.filename}`);
            }
          } catch (pptxError: any) {
            console.error(`[IngestionGraph] Error processing PPTX ${file.filename}:`, pptxError);
            if (!processingError) processingError = `Failed to process PPTX ${file.filename}: ${pptxError.message}`;
            continue;
          }
        } else {
          console.warn(`[IngestionGraph] Unsupported content type: ${file.contentType} for file ${file.filename}. Skipping.`);
          // Skip unsupported types (don't add to error unless needed)
          continue; 
        }
      } catch (parseError: any) {
          console.error(`[IngestionGraph] Error parsing ${file.filename} (type: ${file.contentType}):`, parseError);
          if (!processingError) processingError = `Failed to parse ${file.filename}: ${parseError.message}`;
          // Continue to next file even if one fails parsing
          continue;
      }
    } catch (outerError: any) {
      console.error(`[IngestionGraph] Outer error processing ${file.filename}:`, outerError);
      if (!processingError) processingError = `Error processing ${file.filename}: ${outerError.message}`;
      continue;
    } finally {
      // Update processed count after each file
      currentState.processedFiles = (currentState.processedFiles || 0) + 1;
    }
  }

  // Check if ANY documents were generated for chunking
  if (docsForChunking.length === 0) {
    if (filesSkippedThisNode.length === state.files.length) {
      // All files were skipped (likely duplicates)
      console.warn('[IngestionGraph] All input files were skipped.');
      return {
        ...currentState,
        docs: [],
        error: processingError, // Keep any check errors
        finalStatus: 'CompletedWithSkips',
        skippedFilenames: filesSkippedThisNode, // Pass skipped filenames
      };
    } else {
      // No docs parsed, and not all were skipped -> likely parsing errors or empty files
      console.error('[IngestionGraph] No documents successfully parsed.');
      return {
        ...currentState,
        docs: [],
        error: processingError ?? 'No documents could be successfully parsed.', 
        finalStatus: 'Failed', // Set final status to Failed
        skippedFilenames: filesSkippedThisNode, 
      };
    }
  }
  
  // Proceed to chunking
  try {
    console.log(`[IngestionGraph] Chunking ${docsForChunking.length} documents/slides...`);
    const chunkedDocs = await defaultSplitter.splitDocuments(docsForChunking);
    console.log(`[IngestionGraph] Created ${chunkedDocs.length} chunks.`);
    
    const enhancedChunks = chunkedDocs.map((doc, index) => {
      return new Document({
        pageContent: doc.pageContent,
        metadata: {
          ...doc.metadata,
          chunkIndex: index, 
          totalChunks: chunkedDocs.length, 
          // Remove specific PPTX metadata if no longer relevant
          // slideNumber: doc.metadata.slideNumber, 
          // isFullPresentation: false
        }
      });
    });
    
    console.log(`[IngestionGraph] Enhanced ${enhancedChunks.length} chunks with metadata.`);
    // Determine final status based on whether errors occurred or files were skipped
     const finalStatus = processingError ? 'CompletedWithErrors' : (filesSkippedThisNode.length > 0 ? 'CompletedWithSkips' : 'CompletedSuccess');
     return {
      ...currentState,
      docs: enhancedChunks, 
      error: processingError, 
      finalStatus: finalStatus,
      skippedFilenames: filesSkippedThisNode,
      // Clear large base64 content from state after processing
      files: state.files.map(file => ({
        filename: file.filename,
        contentType: file.contentType,
        contentBase64: '' // Clear the base64 content to reduce state size
      }))
    };
  } catch (chunkingError: any) {
     console.error('[IngestionGraph] Error chunking documents:', chunkingError);
     const combinedError = processingError ? `${processingError}. Chunking failed: ${chunkingError.message}` : `Chunking failed: ${chunkingError.message}`;
     return {
       ...currentState,
       docs: [], 
       error: combinedError, 
       finalStatus: 'Failed', 
       skippedFilenames: filesSkippedThisNode,
       // Clear large base64 content from state even on error
       files: state.files.map(file => ({
         filename: file.filename,
         contentType: file.contentType,
         contentBase64: '' // Clear the base64 content to reduce state size
       }))
     };
  }
}

/**
 * Node: Embeds and stores document chunks and full docs from the state.
 */
async function ingestDocs(
  state: IndexStateType,
  config?: RunnableConfig,
): Promise<Partial<IndexStateType>> {
  const docsToEmbed = state.docs ?? [];
  const skippedFiles = state.skippedFilenames ?? [];
  let currentError = state.error ?? null;
  
  // Update processing step for progress tracking
  const progressState: Partial<IndexStateType> = {
    processingStep: 'ingestDocs',
    currentFile: null, // No specific file in this step
    // Maintain existing progress counts
    totalFiles: state.totalFiles || 0,
    processedFiles: state.processedFiles || 0
  };
  
  // Inherit finalStatus if already set to Failed by processFiles
  let finalStatus = state.finalStatus === 'Failed' ? 'Failed' : 'InProgress'; 
  
  console.log(`[IngestionGraph] ingestDocs received ${docsToEmbed.length} docs. Skipped: ${skippedFiles.length}. Error: ${currentError}. Status: ${finalStatus}`);

  if (finalStatus === 'Failed') {
      // If processFiles already determined failure, just pass it through
      return { 
        ...progressState,
        docs: [], 
        error: currentError, 
        finalStatus: 'Failed', 
        skippedFilenames: skippedFiles 
      };
  }

  if (!config) {
    console.error('[IngestionGraph] Configuration required to run ingestDocs.');
    return { 
      ...progressState,
      docs: [], 
      error: currentError ?? 'Configuration missing', 
      finalStatus: 'Failed', 
      skippedFilenames: skippedFiles 
    };
  }

  // Filter out any potential empty documents (should be less likely now)
  const validDocs = docsToEmbed.filter(
    (doc) => doc.pageContent && doc.pageContent.trim() !== ''
  );
  console.log(`[IngestionGraph] Valid docs for embedding: ${validDocs.length}/${docsToEmbed.length}`);

  if (validDocs.length === 0) {
    console.warn('[IngestionGraph] No valid document content to embed.');
    if (skippedFiles.length > 0) {
      finalStatus = 'CompletedWithSkips';
    } else if (currentError) {
       // Should have been caught by initial status check, but as a fallback
      finalStatus = 'Failed';
    } else {
      finalStatus = 'CompletedNoNewDocs';
    }
    return { docs: [], error: currentError, finalStatus: finalStatus, skippedFilenames: skippedFiles };
  }

  // Proceed with embedding valid documents
  try {
    const retriever = await makeRetriever(config);
    await retriever.addDocuments(validDocs);
    console.log(`[IngestionGraph] Successfully added ${validDocs.length} documents (chunks/full) to vector store.`);
    
    finalStatus = skippedFiles.length > 0 ? 'CompletedWithSkips' : 'CompletedSuccess';
    currentError = null; // Clear error on success
    
  } catch (error: any) {
    console.error('[IngestionGraph] Error adding documents to vector store:', error);
    currentError = currentError ? `${currentError}. Vector store error: ${error.message}` : `Vector store error: ${error.message}`;
    finalStatus = 'Failed'; 
  } finally {
     return { 
        ...progressState,
        docs: [], // Clear docs state
        error: currentError, 
        finalStatus: finalStatus, 
        skippedFilenames: skippedFiles,
        // Ensure emptied files state is preserved through the graph
        files: state.files
      };
  }
}

/**
 * Processes a PowerPoint file into individual slide chunks for better handling
 * @param buffer The file buffer
 * @param metadata Base metadata for the document
 * @returns Array of Document objects, one per slide
 */
async function processPowerPoint(buffer: Buffer, metadata: Record<string, any>): Promise<Document[]> {
  console.log(`[IngestionGraph] Processing PowerPoint with size: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
  
  try {
    // Parse the PowerPoint content
    const parsedText = await officeParser.parseOfficeAsync(buffer);
    
    if (!parsedText.trim()) {
      console.warn(`[IngestionGraph] Parsed PPTX content is empty: ${metadata.source}`);
      return [];
    }
    
    // Option 1: Process as a single document with special PowerPoint splitter
    const singleDoc = new Document({ 
      pageContent: parsedText,
      metadata: {
        ...metadata,
        documentType: 'pptx',
        isPowerPoint: true
      }
    });
    
    // Use the specialized PowerPoint splitter to create chunks
    const chunks = await pptxSplitter.splitDocuments([singleDoc]);
    console.log(`[IngestionGraph] Split PowerPoint into ${chunks.length} chunks`);
    
    // Enhance each chunk with additional PowerPoint metadata
    return chunks.map((chunk, index) => {
      return new Document({
        pageContent: chunk.pageContent,
        metadata: {
          ...chunk.metadata,
          chunkIndex: index,
          totalChunks: chunks.length,
          isPptxChunk: true,
          // Try to determine slide number from content
          slideEstimate: estimateSlideNumber(chunk.pageContent, index)
        }
      });
    });
  } catch (error) {
    console.error(`[IngestionGraph] Error processing PowerPoint: ${error}`);
    throw error;
  }
}

/**
 * Estimates the slide number based on content patterns
 */
function estimateSlideNumber(content: string, fallbackIndex: number): number {
  // Simple heuristic: Try to find "Slide X" or similar patterns
  const slideMatch = content.match(/\bSlide\s+(\d+)\b/i);
  if (slideMatch && slideMatch[1]) {
    return parseInt(slideMatch[1], 10);
  }
  
  // Fallback to chunk index + 1 (to start from slide 1)
  return fallbackIndex + 1;
}

// --- Graph Definition ---

console.log("Defining Simple LangGraph Ingestion Graph...");

// Use the standard constructor with the Annotation object
const builder = new StateGraph(IndexStateAnnotation);

// Add the nodes
builder.addNode('processFiles', processFiles);
builder.addNode('ingestDocs', ingestDocs);

// Set the entry point to the first node after START
builder.setEntryPoint('processFiles' as any);

// Define edges - START implicitly connects to the entry point
// builder.addEdge(START as any, 'processFiles' as any); // Remove this redundant edge
builder.addEdge('processFiles' as any, 'ingestDocs' as any);
builder.addEdge('ingestDocs' as any, END as any);

// Compile the graph
export const graph = builder.compile().withConfig({ runName: 'IngestionGraph' });

console.log("Simple LangGraph Ingestion Graph defined.");
