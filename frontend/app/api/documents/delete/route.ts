import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
// import { supabaseAdmin } from '@/lib/supabase-admin'; // Removed potentially incorrect import

// Ensure environment variables are loaded (adjust path if necessary)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Error: Missing Supabase URL or Service Role Key in environment variables.');
  // Avoid throwing at module scope, handle in POST
}

export const dynamic = 'force-dynamic'; // Prevent build-time execution

export async function POST(request: Request) {
  console.log('[API /documents/delete] Request received.');

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[API /documents/delete] Supabase credentials missing.');
    return NextResponse.json({ error: 'Server configuration error: Supabase credentials missing.' }, { status: 500 });
  }

  let filename: string;
  try {
    const body = await request.json();
    if (!body.filename || typeof body.filename !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid filename in request body.' }, { status: 400 });
    }
    filename = body.filename;
    console.log(`[API /documents/delete] Attempting to delete document: ${filename}`);
  } catch (error) {
    console.error('[API /documents/delete] Error parsing request body:', error);
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  try {
    const supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false }
    });

    // Delete documents where metadata->>source matches the filename
    // Using exact match for safety.
    const { error: deleteError, count } = await supabaseClient
      .from('documents') // Make sure 'documents' is your table name
      .delete()
      .eq('metadata->>source', filename); 

    if (deleteError) {
      console.error(`[API /documents/delete] Supabase error deleting ${filename}:`, deleteError);
      return NextResponse.json({ error: `Database error deleting document: ${deleteError.message}` }, { status: 500 });
    }

    if (count === null || count === 0) { // Supabase delete might return null for count
       console.warn(`[API /documents/delete] No documents found with source matching ${filename}. Nothing deleted.`);
       // Still return success as the desired state (no docs with that name) is achieved.
        return NextResponse.json({ message: `No documents found matching ${filename}. No deletion occurred.` }, { status: 200 });
    }

    console.log(`[API /documents/delete] Successfully deleted ${count} document chunks for ${filename}.`);
    return NextResponse.json({ message: `Successfully deleted document ${filename} (${count} chunks).` }, { status: 200 });

  } catch (error: any) {
    console.error(`[API /documents/delete] Unexpected error deleting ${filename}:`, error);
    return NextResponse.json({ error: `Unexpected server error: ${error.message}` }, { status: 500 });
  }
} 