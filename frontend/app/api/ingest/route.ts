// frontend/app/api/ingest/route.ts
// app/api/ingest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Buffer } from 'buffer'; // Need Buffer again
import { createServerClient } from '@/lib/langgraph-server';
import { PDFDocument } from '@/types/graphTypes';
import { type Message as AIMessage } from 'ai';

export const dynamic = 'force-dynamic'; // Prevent pre-rendering at build time

// --- Remove unused imports ---
// import { Document } from "@langchain/core/documents"; // No longer creating docs here
// import pdf from 'pdf-parse';
// import mammoth from 'mammoth';
// import officeParser from 'officeparser';
// import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'; // Chunking moved to backend

// --- Keep necessary imports ---
import { indexConfig } from '@/constants/graphConfigs'; // Still needed for backend call

// --- Constants --- 
const MAX_FILE_SIZE = 50 * 1024 * 1024; 
const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', 
]; 
const ALLOWED_FILE_LABELS = 'PDF, DOCX, or PPTX'; 

// --- Remove Helper Functions --- 
// async function parseFileContent(...) { ... }
// async function chunkText(...) { ... }

// --- Main POST Handler (Send Encoded Files to Backend) --- 
export async function POST(request: NextRequest) {
  console.log("[/api/ingest] Received POST request (Send Encoded Files Plan).");
  
  // Get the client instance at runtime
  const serverClient = createServerClient(); 
  
  try {
    // --- Env Var Check --- 
    // Env var checks are now inside createServerClient()
    // ... removed check ...
    console.log("[/api/ingest] Ingestion Assistant ID found.");
    const formData = await request.formData();
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === 'files' && value instanceof File) { files.push(value); }
    }
    console.log(`[/api/ingest] Extracted ${files.length} file(s) from form data.`);
    // --- Basic Validations --- 
    if (files.length === 0) { 
        console.warn("[/api/ingest] No files provided.");
        return NextResponse.json({ error: 'No files provided' }, { status: 400 }); 
    }
    if (files.length > 5) { 
        console.warn(`[/api/ingest] Too many files: ${files.length}`);
        return NextResponse.json({ error: 'Max 5 files' }, { status: 400 }); 
    }
    const invalidFiles = files.filter((file) => {
        const isAllowedType = ALLOWED_FILE_TYPES.includes(file.type);
        const isAllowedSize = file.size <= MAX_FILE_SIZE;
        if (!isAllowedType || !isAllowedSize) {
            console.warn(`Invalid file detected: ${file.name} (Type: ${file.type}, Size: ${file.size})`);
        }
        return !isAllowedType || !isAllowedSize;
    });
    if (invalidFiles.length > 0) { 
        const invalidNames = invalidFiles.map(f => f.name).join(', ');
        console.warn(`[/api/ingest] Invalid files found: ${invalidNames}`);
        return NextResponse.json({ error: `Invalid file(s): ${invalidNames}. Only ${ALLOWED_FILE_LABELS} allowed (max 50MB).` }, { status: 400 }); 
    }
    console.log("[/api/ingest] File validation passed. Encoding files...");

    // --- Encode Files to Base64 --- 
    const filesToProcess: { filename: string; contentType: string; contentBase64: string }[] = [];
    for (const file of files) {
      try {
        console.log(`[/api/ingest] Encoding file: ${file.name}`);
        const arrayBuffer = await file.arrayBuffer(); 
        const buffer = Buffer.from(arrayBuffer); 
        const contentBase64 = buffer.toString('base64');
        filesToProcess.push({
            filename: file.name,
            contentType: file.type,
            contentBase64: contentBase64
        });
        console.log(`[/api/ingest] Successfully encoded ${file.name}`);
      } catch (error: any) {
        console.error(`[/api/ingest] Failed encoding file ${file.name}:`, error);
        // Optionally decide if one failed encoding should stop the whole process
        // For now, continue and the backend will receive fewer files.
      }
    }
    
    if (filesToProcess.length === 0 && files.length > 0) {
        console.error("[/api/ingest] Failed to encode any files.");
        return NextResponse.json({ error: 'Failed to prepare files for processing.' }, { status: 500 }); 
    }
    console.log(`[/api/ingest] Encoded ${filesToProcess.length} files successfully.`);

    // --- Call Backend Graph --- 
    console.log(`[/api/ingest] Calling backend graph with encoded files...`);
    // Use the runtime client instance
    const thread = await serverClient.createThread(); 
    console.log(`[/api/ingest] Created thread ${thread.thread_id}.`);
    const graphInput = { files: filesToProcess }; // Use the encoded files array
    
    // Use the runtime client instance
    const run = await serverClient.client.runs.create( 
        thread.thread_id,
        'ingestion_graph', // Target backend graph name 
        { 
          input: graphInput, 
          config: { configurable: { ...indexConfig } } 
        }
    );
    console.log(`[/api/ingest] Successfully started backend run: ${run.run_id}.`);
    
    // Remove the artificial wait
    // await new Promise(resolve => setTimeout(resolve, 10000)); 
    
    // Return success response with the runId for polling
    return NextResponse.json({
      message: 'Document processing initiated successfully', 
      runId: run.run_id, // Return the run ID
      threadId: thread.thread_id // Keep threadId if needed elsewhere
    });

  } catch (error: any) {
    console.error('[/api/ingest] Error in send-encoded-files POST handler:', error);
    return NextResponse.json(
      { error: 'Frontend failed to process request or backend failed', details: error.message }, 
      { status: 500 },
    );
  }
}
