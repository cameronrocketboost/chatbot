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
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import officeParser from 'officeparser';

// Use original State/Config annotations
import { IndexStateAnnotation, IndexStateType } from './state.js';
// Comment out unused imports
// import {
//   ensureIndexConfiguration,
//   IndexConfigurationAnnotation,
// } from './configuration.js';
import { makeRetriever } from '../shared/retrieval.js';

// Define the separator - NOTE: officeParser doesn't insert this, so it's currently unused by pptxSplitter
// const SLIDE_SEPARATOR = '\n\n---SLIDE_SEPARATOR---\n\n';

// Define file size limits
const MAX_PPTX_SIZE = 100 * 1024 * 1024; // 100MB for PPTX files

// Initialize text splitter with different settings for different document types
const defaultSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

// Special splitter for PowerPoint presentations with larger chunks and more overlap
// Removed SLIDE_SEPARATOR as officeParser doesn't provide it (Suggestion 1-C fix)
const pptxSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1500, // Consider tuning this further (Suggestion 1-C)
  chunkOverlap: 300,
  separators: ["\n\n", "\n", " ", ""] // Removed SLIDE_SEPARATOR
});

// --- Helper function to process a single file (for parallelization) ---
async function processSingleFile(
  file: IndexStateType['files'][0],
  supabaseClient: SupabaseClient<any, "public", any>,
): Promise<{ doc: Document | null; skipped: boolean; error: string | null }> {
  const fileType = file.contentType === 'application/pdf' ? 'PDF' :
                   file.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? 'DOCX' :
                   file.contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ? 'PPTX' : 
                   'Document';
  console.log(`[IngestionGraph] Starting processing for ${fileType} file: ${file.filename}`);
  
  try {
    // --- Duplicate Check --- 
    console.log(`[IngestionGraph] Checking for duplicates: ${file.filename}`);
    const { data: existingDocs, error: checkError } = await supabaseClient
      .from('documents')
      .select('id')
      .ilike('metadata->>source', file.filename)
      .limit(1);

    if (checkError) {
      console.error(`[IngestionGraph] Error checking duplicates for ${file.filename}:`, checkError);
      // Return error for this file
      return { doc: null, skipped: false, error: `Error checking duplicates: ${checkError.message}` }; 
    } else if (existingDocs && existingDocs.length > 0) {
      console.warn(`[IngestionGraph] Duplicate detected: ${file.filename}. Skipping.`);
      return { doc: null, skipped: true, error: null }; // Mark as skipped
    }
    // --- End Duplicate Check ---

    console.log(`[IngestionGraph] No duplicate found for ${file.filename}. Proceeding with parsing.`);
    const buffer = Buffer.from(file.contentBase64, 'base64');
    const baseMetadata = {
      source: file.filename,
      contentType: file.contentType,
      fileSize: buffer.length,
      parsedAt: new Date().toISOString(),
    };

    // --- Parsing Logic --- 
    if (file.contentType === 'application/pdf') {
      const data = await pdf(buffer); // Assume await works here
      if (data.text.trim()) {
        return { doc: new Document({ pageContent: data.text, metadata: baseMetadata }), skipped: false, error: null };
      } else {
        console.warn(`[IngestionGraph] Parsed PDF content is empty: ${file.filename}`);
        return { doc: null, skipped: true, error: 'Parsed PDF content is empty' }; // Skip empty parsed content
      }
    } else if (file.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const { value } = await mammoth.extractRawText({ buffer });
      if (value.trim()) {
        return { doc: new Document({ pageContent: value, metadata: baseMetadata }), skipped: false, error: null };
      } else {
        console.warn(`[IngestionGraph] Parsed DOCX content is empty: ${file.filename}`);
        return { doc: null, skipped: true, error: 'Parsed DOCX content is empty' }; // Skip empty
      }
    } else if (file.contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      if (buffer.length > MAX_PPTX_SIZE) {
        console.error(`[IngestionGraph] PPTX file exceeds max size: ${file.filename}`);
        return { doc: null, skipped: true, error: `Exceeds max PPTX size (${MAX_PPTX_SIZE / 1024 / 1024}MB)` };
      }
      // Using officeParser directly here instead of separate processPowerPoint for simplicity in parallel func
      // NOTE: This brings the pptxSplitter logic dependency here
      const pptxContent = await officeParser.parseOfficeAsync(buffer);
      if (pptxContent.trim()) {
         // We get raw text here, need to handle potential chunking later if needed
         // For now, return one large doc per PPTX
         return { doc: new Document({ pageContent: pptxContent, metadata: { ...baseMetadata, documentType: 'pptx' } }), skipped: false, error: null };
      } else {
          console.warn(`[IngestionGraph] Parsed PPTX content is empty: ${file.filename}`);
          return { doc: null, skipped: true, error: 'Parsed PPTX content is empty' }; // Skip empty
      }
      
    } else {
      console.warn(`[IngestionGraph] Unsupported content type: ${file.contentType} for file ${file.filename}. Skipping.`);
      return { doc: null, skipped: true, error: `Unsupported content type: ${file.contentType}` }; // Skip unsupported
    }
  } catch (error: any) {
    console.error(`[IngestionGraph] Error processing file ${file.filename}:`, error);
    return { doc: null, skipped: false, error: error.message || 'Unknown processing error' }; // Return error
  }
}

/**
 * Node: Processes uploaded files, checks for duplicates, parses content, and prepares docs.
 */
async function processFiles(
  state: IndexStateType,
  _config?: RunnableConfig,
): Promise<Partial<IndexStateType>> {
  console.log('[IngestionGraph] Starting processFiles node (parallel version)...');
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

  // Initialize state tracking
  let currentState: Partial<IndexStateType> = {
    processingStep: 'processFiles',
    totalFiles: state.files.length,
    processedFiles: 0, // Will be updated after Promise.allSettled
    currentFile: null, // Less relevant with parallel processing
    skippedFilenames: [...(state.skippedFilenames || [])], // Preserve existing skipped files
    error: state.error, // Preserve existing error
  };

  // Initialize Supabase client 
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

  console.log(`[IngestionGraph] Processing ${state.files.length} files in parallel...`);
  const docsForChunking: Document[] = [];
  const processingErrors: string[] = currentState.error ? [currentState.error] : []; // Collect errors
  const filesSkippedThisNode: string[] = [];

  // --- Create promises for each file processing task (Suggestion 1-B) ---
  const fileProcessingPromises = state.files.map(file => 
    processSingleFile(file, supabaseClient)
  );

  // --- Execute promises in parallel --- 
  const results = await Promise.allSettled(fileProcessingPromises);

  // --- Process results --- 
  results.forEach((result, index) => {
    const originalFile = state.files[index]; // Get corresponding file info
    currentState.processedFiles!++; // Increment processed count regardless of outcome
    
    if (result.status === 'fulfilled') {
      const { doc, skipped, error } = result.value;
      if (error) {
        // Handle errors reported by processSingleFile (e.g., parsing, duplicate check error)
        console.error(`[IngestionGraph] Error processing ${originalFile.filename}: ${error}`);
        processingErrors.push(`${originalFile.filename}: ${error}`);
        if (skipped) { // Also mark as skipped if the error led to skipping
           filesSkippedThisNode.push(originalFile.filename);
        }
      } else if (skipped) {
        // Handle files explicitly skipped (duplicate, empty, unsupported)
        console.warn(`[IngestionGraph] File skipped: ${originalFile.filename}`);
        filesSkippedThisNode.push(originalFile.filename);
      } else if (doc) {
        // Successfully processed document
        console.log(`[IngestionGraph] Successfully processed: ${originalFile.filename}`);
        docsForChunking.push(doc);
      }
    } else { // result.status === 'rejected'
      // Handle unexpected errors during processSingleFile execution itself
      console.error(`[IngestionGraph] Unexpected rejection processing ${originalFile.filename}:`, result.reason);
      processingErrors.push(`${originalFile.filename}: Unexpected error - ${result.reason?.message || result.reason}`);
    }
  });
  
  console.log(`[IngestionGraph] Parallel processing finished. Processed: ${currentState.processedFiles}. Successful docs: ${docsForChunking.length}. Skipped: ${filesSkippedThisNode.length}. Errors: ${processingErrors.length}`);

  // Combine skipped files from this node with previous ones
  const allSkippedFiles = Array.from(new Set([...(state.skippedFilenames || []), ...filesSkippedThisNode]));

  // Update state with results
     return {
    ...currentState, // Keep totalFiles, processedFiles updates
    docs: docsForChunking,
    skippedFilenames: allSkippedFiles,
    error: processingErrors.length > 0 ? processingErrors.join('; \n') : null, // Combine errors
    finalStatus: processingErrors.length > 0 ? 'Failed' : state.finalStatus // Mark as failed if any errors occurred
    // Note: finalStatus might be further updated by later nodes
  };
}

/**
 * Node: Embeds and stores document chunks.
 * Previously named ingestDocs, but now also handles chunking.
 */
async function chunkAndEmbedDocs(
  state: IndexStateType,
  config?: RunnableConfig,
): Promise<Partial<IndexStateType>> {
  const docsToChunk = state.docs ?? []; // Renamed for clarity
  const skippedFiles = state.skippedFilenames ?? [];
  let currentError = state.error ?? null;
  
  // Update processing step
  const progressState: Partial<IndexStateType> = {
    processingStep: 'chunkAndEmbedDocs', // Updated step name
    currentFile: null, 
    totalFiles: state.totalFiles || 0,
    processedFiles: state.processedFiles || 0
  };
  
  let finalStatus = state.finalStatus === 'Failed' ? 'Failed' : 'InProgress'; 
  
  console.log(`[IngestionGraph] chunkAndEmbedDocs received ${docsToChunk.length} docs. Skipped: ${skippedFiles.length}. Error: ${currentError}. Status: ${finalStatus}`);

  if (finalStatus === 'Failed') {
      return { /* ... return failed state ... */ };
  }

  if (!config) {
      return { /* ... return missing config state ... */ };
  }

  // Filter out any potential empty documents 
  const validDocs = docsToChunk.filter(
    (doc) => doc.pageContent && doc.pageContent.trim() !== ''
  );
  console.log(`[IngestionGraph] Valid docs for chunking: ${validDocs.length}/${docsToChunk.length}`);

  if (validDocs.length === 0) {
    // Determine status if no valid docs
    if (skippedFiles.length > 0) {
      finalStatus = 'CompletedWithSkips';
    } else if (currentError) {
      finalStatus = 'Failed';
    } else {
      finalStatus = 'CompletedNoNewDocs';
    }
    return { docs: [], error: currentError, finalStatus: finalStatus, skippedFilenames: skippedFiles, ...progressState, files: state.files };
  }

  // --- Chunking Logic --- 
  let allChunks: Document[] = [];
  try {
    console.log('[IngestionGraph] Starting document chunking...');
    // Separate docs based on type for specific splitters
    const pptxDocs = validDocs.filter(doc => doc.metadata?.documentType === 'pptx');
    const otherDocs = validDocs.filter(doc => doc.metadata?.documentType !== 'pptx');

    let pptxChunks: Document[] = [];
    if (pptxDocs.length > 0) {
        console.log(`[IngestionGraph] Chunking ${pptxDocs.length} PPTX documents with pptxSplitter...`);
        pptxChunks = await pptxSplitter.splitDocuments(pptxDocs);
        console.log(`[IngestionGraph] Created ${pptxChunks.length} PPTX chunks.`);
    }

    let otherChunks: Document[] = [];
    if (otherDocs.length > 0) {
        console.log(`[IngestionGraph] Chunking ${otherDocs.length} other documents with defaultSplitter...`);
        otherChunks = await defaultSplitter.splitDocuments(otherDocs);
        console.log(`[IngestionGraph] Created ${otherChunks.length} other chunks.`);
    }
    
    allChunks = [...pptxChunks, ...otherChunks];
    console.log(`[IngestionGraph] Total chunks created: ${allChunks.length}`);

    if (allChunks.length === 0) {
      console.warn('[IngestionGraph] Chunking resulted in zero chunks.');
      // No chunks means we can't proceed to embedding
      finalStatus = 'Failed'; // Treat as failure if valid docs existed but chunking yielded nothing
      currentError = currentError ? `${currentError}. Chunking produced no results.` : 'Chunking produced no results.';
    } else {
        // Enhance chunks with index metadata 
        allChunks = allChunks.map((doc, index) => new Document({
            pageContent: doc.pageContent,
            metadata: {
                ...doc.metadata,
                chunkIndex: index, 
            }
        }));
        console.log(`[IngestionGraph] Enhanced ${allChunks.length} chunks with metadata.`);
    }

  } catch (chunkingError: any) {
     console.error('[IngestionGraph] Error during document chunking:', chunkingError);
     currentError = currentError ? `${currentError}. Chunking failed: ${chunkingError.message}` : `Chunking failed: ${chunkingError.message}`;
     finalStatus = 'Failed'; 
     allChunks = []; // Prevent embedding attempt
  }
  // --- End Chunking --- 

  // --- Embedding Logic --- 
  if (finalStatus !== 'Failed' && allChunks.length > 0) {
      try {
        console.log(`[IngestionGraph] Embedding ${allChunks.length} chunks...`);
        const retriever = await makeRetriever(config);
        await retriever.addDocuments(allChunks); 
        console.log(`[IngestionGraph] Successfully added ${allChunks.length} chunks to vector store.`);
        
        // Determine final success status only if embedding succeeded
        finalStatus = skippedFiles.length > 0 ? 'CompletedWithSkips' : 'CompletedSuccess';
        currentError = null; // Clear error only on full success
        
      } catch (embeddingError: any) {
        console.error('[IngestionGraph] Error adding documents to vector store:', embeddingError);
        currentError = currentError ? `${currentError}. Vector store error: ${embeddingError.message}` : `Vector store error: ${embeddingError.message}`;
        finalStatus = 'Failed'; 
      }
  } else {
      console.log(`[IngestionGraph] Skipping embedding due to status: ${finalStatus} or 0 chunks.`);
      // If chunking failed or yielded no chunks, retain that status/error
  }

  // --- Return Final State --- 
  return { 
      ...progressState,
      docs: [], // Always clear docs after this node
      error: currentError, 
      finalStatus: finalStatus, // Reflect outcome of chunking & embedding
      skippedFilenames: skippedFiles,
      files: state.files // Preserve emptied files state 
  };
}

// --- Graph Definition ---

console.log("Defining Simple LangGraph Ingestion Graph...");

// Use the standard constructor with the Annotation object
const builder = new StateGraph(IndexStateAnnotation);

// Add the nodes (using updated function name)
builder.addNode('processFiles', processFiles);
builder.addNode('chunkAndEmbedDocs', chunkAndEmbedDocs);

// Set the entry point to the first node after START
builder.setEntryPoint('processFiles' as any);

// Define edges - START implicitly connects to the entry point
// builder.addEdge(START as any, 'processFiles' as any); // Remove this redundant edge
builder.addEdge('processFiles' as any, 'chunkAndEmbedDocs' as any);
builder.addEdge('chunkAndEmbedDocs' as any, END as any);

// Compile the graph
export const graph = builder.compile().withConfig({ runName: 'IngestionGraph' });

console.log("Simple LangGraph Ingestion Graph defined with updated chunking logic.");
