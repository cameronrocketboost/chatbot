#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function setupDocumentRegistry() {
  console.log('Setting up document registry...');
  
  try {
    // Load SQL file
    const sqlFilePath = path.resolve(__dirname, '../src/supabase/document_registry.sql');
    const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
    
    // Get Supabase credentials from environment
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
    }
    
    // Create Supabase client
    const supabaseClient = createClient(
      SUPABASE_URL as string,
      SUPABASE_SERVICE_ROLE_KEY as string
    );
    
    console.log('Executing SQL script...');
    // Execute the SQL script
    const { error } = await supabaseClient.rpc('exec_sql', { sql_string: sqlContent });
    
    if (error) {
      console.error('Error executing SQL script:', error);
      // Continue even if there are errors, as some errors might be because tables already exist
      console.log('Continuing with setup despite SQL errors (tables may already exist)');
    } else {
      console.log('SQL script executed successfully');
    }
    
    // Populate the document registry
    console.log('Populating document registry...');
    const { data: populateResult, error: populateError } = await supabaseClient.rpc('populate_document_registry');
    
    if (populateError) {
      console.error('Error populating document registry:', populateError);
    } else {
      console.log(`Document registry populated successfully. Added ${populateResult} documents.`);
    }
    
    console.log('Document registry setup complete!');
  } catch (error) {
    console.error('Error setting up document registry:', error);
    process.exit(1);
  }
}

// Run the setup
setupDocumentRegistry(); 