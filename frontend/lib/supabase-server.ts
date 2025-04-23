import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Lazily create the Supabase Service Role client the first time it's needed.
 */
let _serviceClientInstance: SupabaseClient | null = null;

export function getSupabaseService(): SupabaseClient {
  if (_serviceClientInstance) return _serviceClientInstance;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; // Use NEXT_PUBLIC_ for URL consistency?
  const roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !roleKey) {
    throw new Error("Supabase URL or Service Role Key environment variable is missing");
  }

  _serviceClientInstance = createClient(url, roleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
  });

  return _serviceClientInstance;
}

// Remove old top-level initialization and getter function
// const supabaseUrl = process.env.SUPABASE_URL;
// const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
// ... (rest of old code removed) ... 