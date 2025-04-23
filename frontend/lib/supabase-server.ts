import { createClient } from '@supabase/supabase-js';

// Ensure environment variables are loaded (adjust path if necessary)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  // Log the error but avoid throwing at module scope
  // Errors during client creation will be handled where the client is used
  console.error('Error: Missing Supabase URL or Service Role Key in environment variables for server client.');
}

// Create a single instance of the Supabase client for server-side use
// Use persistSession: false as recommended for server-side operations
// https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs#server-side-rendering-ssr
const supabaseServerClient = createClient(supabaseUrl || '', supabaseServiceRoleKey || '', {
  auth: {
    persistSession: false, // don't store session cookies on the server
    autoRefreshToken: false, // don't automatically refresh tokens
    detectSessionInUrl: false // don't detect sessions from URL fragments
  },
});

// Export a function to get the initialized client
// This pattern is often preferred over exporting the client directly
// to allow for potential future setup logic or context-based clients.
export function getSupabaseServerClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    // Throw an error if used when configuration is missing
    throw new Error('Supabase server client cannot be used: Missing URL or Service Role Key.');
  }
  return supabaseServerClient;
}

// Optional: Export the client directly if preferred, but the function approach is safer
// export { supabaseServerClient }; 