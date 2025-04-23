import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// IMPORTANT: Ideally, these should come from frontend environment variables (
// process.env.NEXT_PUBLIC_SUPABASE_URL and process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
// Using backend keys here for simplicity, but less secure if exposed client-side.
const supabaseUrl = process.env.SUPABASE_URL || 'https://uqefoagmfyoczyykbcyy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxZWZvYWdtZnlvY3p5eWtiY3l5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Mzg2NTk4OSwiZXhwIjoyMDU5NDQxOTg5fQ._HCf0IN15JLy-exi3nGIuyLCsRZSXNvZfdtaZRpo_xU';

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase URL or Key is missing. Check environment variables.');
}

// Initialize Supabase client (consider moving to a shared lib)
const supabase = createClient(supabaseUrl, supabaseKey);

// Define the structure of the document data we expect from Supabase
// Adjust based on your actual table structure
interface SupabaseDocumentChunk {
  id: string; // Or number, depending on your primary key
  content: string; // The text chunk (pageContent)
  embedding: number[]; // Or string, depending on how pg_vector stores it
  metadata: { [key: string]: any }; // Includes source, type, etc.
}

export const dynamic = 'force-dynamic'; // Prevent pre-rendering at build time

export async function GET(request: NextRequest) {
  console.log("GET /api/documents called");
  try {
    // Fetch all documents from the 'documents' table
    // WARNING: This fetches EVERYTHING. Implement pagination/filtering for production.
    const { data, error } = await supabase
      .from('documents') // Ensure this table name matches your Supabase setup
      .select('id, content, metadata') // Select relevant columns (omit embedding for brevity)
      .order('id'); // Optional: Order results

    if (error) {
      console.error('Supabase query error:', error);
      throw error;
    }

    console.log(`Fetched ${data?.length || 0} document chunks from Supabase.`);

    // Group chunks by source filename found in metadata
    const groupedDocuments: { [filename: string]: SupabaseDocumentChunk[] } = {};
    if (data) {
      for (const chunk of data as SupabaseDocumentChunk[]) {
        const filename = chunk.metadata?.source || 'Unknown Source';
        if (!groupedDocuments[filename]) {
          groupedDocuments[filename] = [];
        }
        groupedDocuments[filename].push(chunk);
      }
    }

    return NextResponse.json(groupedDocuments);

  } catch (error: any) {
    console.error('Error fetching documents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents', details: error.message },
      { status: 500 }
    );
  }
} 