// Simple script to test Supabase connection
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
// Add global fetch for Node.js environments before Node 18
import fetch from 'node-fetch';

// Polyfill fetch for Node.js
if (!globalThis.fetch) {
  globalThis.fetch = fetch;
}

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Testing Supabase connection...');
console.log(`URL: ${supabaseUrl}`);
console.log(`Key: ${supabaseKey?.slice(0, 10)}...`); // Only show first 10 chars of key for security

const supabase = createClient(supabaseUrl, supabaseKey);

// Simple test query
async function testConnection() {
  try {
    // Try to list tables first
    const { data: tables, error: tablesError } = await supabase
      .from('_tables')
      .select('*')
      .limit(5);

    if (tablesError) {
      console.log('Could not list tables. Trying basic query...');
      
      // Try a very simple query instead
      const { data: simpleData, error: simpleError } = await supabase
        .from('documents')
        .select('*')
        .limit(1);
      
      if (simpleError) {
        console.error('Simple query error:', simpleError);
        
        // Last resort - storage bucket list
        console.log('Trying storage buckets...');
        const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
        
        if (bucketsError) {
          console.error('Storage buckets error:', bucketsError);
          console.error('Could not connect to any Supabase resource.');
          return;
        }
        
        console.log('Successfully connected to Supabase Storage!');
        console.log('Buckets:', buckets);
        return;
      }
      
      console.log('Connection successful!');
      console.log('Sample data:', simpleData);
      return;
    }
    
    console.log('Connection successful!');
    console.log('Tables:', tables);
  } catch (err) {
    console.error('Exception:', err);
  }
}

testConnection(); 