// import { VectorStoreRetriever } from '@langchain/core/vectorstores';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { createClient } from '@supabase/supabase-js';
import { RunnableConfig } from '@langchain/core/runnables';
import { Document } from '@langchain/core/documents';
// import {
//   BaseConfigurationAnnotation,
//   ensureBaseConfiguration,
// } from './configuration.js';
import { 
  getDynamicLevenshteinThreshold, 
  levenshteinDistance,
  calculateMatchConfidence 
} from './utils.js';
// import { loadEmbeddings } from "./utils.js"; // Commented out - unused
import { ensureAgentConfiguration } from "../retrieval_graph/configuration.js"; // Corrected import name
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
// import { DocumentRegistryEntry, findDocumentByName, getLatestDocument } from "./registry.js"; // Commented out - unused
// import { SupabaseRpcResult } from './types.js'; // Commented out - unused

// Interface for data returned by Supabase RPC (match_documents_enhanced)
/* // Commented out - unused
interface SupabaseRpcResult {
  content: string;
  metadata: Record<string, any>;
  // Add other common fields if known, e.g., id? similarity?
  id?: string | number;
  similarity?: number;
}
*/

// Interface for retriever options
interface RetrieverOptions {
  k?: number;
  filter?: {
    'metadata.source'?: string;
    'metadata.contentType'?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

// Threshold for switching to full document retrieval
const MAX_CHUNKS_FOR_FULL_LOAD = 20; // Configurable: load full doc if <= 20 chunks

/**
 * Check if the query is specifically asking for a document by name
 */
export function extractDocumentNameFromQuery(query: string): string | null {
  // Check for "latest document" requests - Keep these as they are specific
  const latestDocumentPatterns = [
    /latest\s+(?:document|file|pdf|docx|presentation|pptx)/i,
    /most\s+recent\s+(?:document|file|pdf|docx|presentation|pptx)/i,
    /newest\s+(?:document|file|pdf|docx|presentation|pptx)/i
  ];
  
  for (const pattern of latestDocumentPatterns) {
    if (pattern.test(query)) {
      console.log("[Retrieval] Detected latest document request via regex");
      return '__LATEST__';
    }
  }
  
  // Patterns to detect *explicit* document-specific queries
  // Make these much stricter
  const documentPatterns = [
    // 1. Explicit filenames ending in common extensions (case-insensitive)
    // Allows spaces, numbers, underscores, hyphens before the extension.
    /\b([a-zA-Z0-9_\s-]+\.(pdf|docx?|pptx?|txt))\b/i,

    // 2. Phrases explicitly quoting a name after "document", "file", etc.
    // Looks for "document named 'X'", "file called \"Y\"", etc.
    /\b(?:document|file|presentation|pdf|docx?|pptx?|ppt|slides?)(?:\s+named|\s+called|\s+titled)?\s+["']([^"'.,;!?()]+)["']/i,

    // 3. Specific known document patterns (IF ANY - Add cautiously)
    // e.g., /\b(Merck_Presentation_Q[1-4]_\d{4}\.pptx)\b/i 
    // Add specific, unambiguous patterns here if needed

    // 4. Pattern for "[number] [name] ..." type references (Simplified)
    // Captures number followed by one or more words (non-greedy)
    // Avoids capturing trailing keywords like 'document'.
    /\b(\d+[\s_-]+[a-zA-Z0-9\s_-]+?)\b/i,

  ];
  
  // Check each pattern for a match
  for (const pattern of documentPatterns) {
    const match = query.match(pattern);
    if (match && match[1]) { // Ensure group 1 (the identifier part) exists
      let potentialName = match[1].trim(); // Get the captured part
      
      // Clean up any trailing spaces or hyphens just in case
      potentialName = potentialName.replace(/[\s_-]+$/, ''); 

      console.log(`[Retrieval] Detected EXPLICIT document name/reference via regex: \"${potentialName}\"`);
      // Basic check to avoid matching overly generic terms 
      if (potentialName.length > 3) { 
        return potentialName;
      }
    }
  }
  
  // If no explicit pattern matches, return null - DO NOT try broad matches here.
  // The registry lookup in extractQueryFilters will handle ambiguous cases.
  console.log("[Retrieval] No EXPLICIT document name pattern matched in query.");
  return null;
}

// << ADDED HELPER FUNCTION >>
function refineSearchQuery(query: string, sourceToRemove?: string): string {
  let refined = query;
  const lowerQuery = query.toLowerCase();
  // Remove common leading phrases
  const prefixes = [
    "tell me about", "what is", "what are", "summarize", "explain", "describe",
    "give me details on", "provide information on", "find details about", "key findings for", "key insights for"
  ];
  for (const prefix of prefixes) {
    if (lowerQuery.startsWith(prefix)) {
      refined = query.substring(prefix.length).trim(); // Use original query casing for slicing
      break; // Remove only the first matching prefix
    }
  }

  // Remove the source filename if provided (and long enough to be meaningful) - Simple replacement
  if (sourceToRemove && sourceToRemove.length > 3) { 
     // Remove extension for simpler matching
     const sourceBase = sourceToRemove.replace(/\.(pdf|docx?|pptx?|txt)$/i, '');
     // Simple, case-insensitive replace of the base name and the full name
     const regexBase = new RegExp(sourceBase.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
     const regexFull = new RegExp(sourceToRemove.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
     refined = refined.replace(regexFull, '').trim();
     if (sourceBase !== sourceToRemove) {
        refined = refined.replace(regexBase, '').trim();
     }
     // Also attempt removal of number-name pattern if matched earlier by regex 4
     // (This regex seems problematic based on previous error, let's simplify)
     const numberNameMatch = sourceToRemove.match(/^(\d+[\s_-]+[a-zA-Z0-9\s_-]+?)\b/i);
     if (numberNameMatch && numberNameMatch[1]) {
       const numberNamePart = numberNameMatch[1];
       const regexNumberName = new RegExp(numberNamePart.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
       refined = refined.replace(regexNumberName, '').trim();
     }
  }

  // Remove potential leftover connecting words or punctuation
  refined = refined.replace(/^(\s*(in|on|about|for|related to|of|the)\s*)+/i, '').trim();
  refined = refined.replace(/[?.!]$/, '').trim(); // Remove trailing punctuation

  // Return original if cleaning results in empty string or something very short
  return refined.length > 2 ? refined : query; 
}
// << END HELPER FUNCTION >>

/**
 * Initialize a retriever with the given configuration.
 */
export async function makeRetriever(_config: RunnableConfig) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[Retrieval] Supabase credentials missing');
    throw new Error('Supabase credentials not set');
  }

  const supabaseClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const embeddings = new OpenAIEmbeddings();
  const vectorStore = new SupabaseVectorStore(embeddings, {
    client: supabaseClient,
    tableName: 'documents',
    queryName: 'match_documents', // Default query function
  });
  
  // Return an object containing the invoke and addDocuments methods
  return {
    // The main function to invoke the retriever
    invoke: async (query: string, options: RetrieverOptions = {}) => {
      // Outer try-catch for the entire invoke process
      try {
        console.log(`[Retrieval] Searching for: \"${query}\" with options:`, options);
        let exactMatchResults: Document[] = [];
        // Determine the source we *intend* to search for
        const requestedSource = options?.filter?.['metadata.source'];
        const isLatestRequest = options?.['__LATEST__'] === true;
        
        // << Determine targeted filename AFTER potential __LATEST__ resolution >>
        let targetFilenameForSearch: string | null = null;
        let filterUsedForSearch: { source: string; filterApplied?: string } | null = options?.filter ? { source: options.filter['metadata.source'] || 'unknown', filterApplied: options.filter.filterApplied } : null;
        let newExplicitFilterSet = options?.new_explicit_filter_set || false; // Assume passed via config if needed, or recalculate/pass from extractQueryFilters if separated

        if (isLatestRequest) {
          console.log("[Retrieval] Handling __LATEST__ request internally.");
          const { data: latestDocData, error: latestDocError } = await supabaseClient
            .from('document_registry')
            .select('filename') 
            .order('upload_date', { ascending: false })
            .limit(1);
          
          if (latestDocError) {
             console.error("[Retrieval] Error fetching latest document from registry:", latestDocError);
          } else if (latestDocData && latestDocData.length > 0) {
            // Check if filename exists and is a string before assigning
            const latestFilename = latestDocData[0].filename;
            if (typeof latestFilename === 'string' && latestFilename.length > 0) {
                targetFilenameForSearch = latestFilename;
                console.log(`[Retrieval] Resolved __LATEST__ to filename: \\\"${targetFilenameForSearch}\\\"`);
                // Now targetFilenameForSearch is guaranteed to be a string here
                filterUsedForSearch = { source: targetFilenameForSearch, filterApplied: `Latest Document (${targetFilenameForSearch})` };
            } else {
                console.warn("[Retrieval] __LATEST__ request succeeded but filename was null or empty in registry.");
                // Handle case where filename is missing - don't set the filter
                filterUsedForSearch = null; 
                targetFilenameForSearch = null;
            }
          } else {
            console.warn("[Retrieval] __LATEST__ request failed: Could not find latest document in registry.");
             // Ensure filter is null if no document is found
             filterUsedForSearch = null;
             targetFilenameForSearch = null;
          }
        } else if (requestedSource) {
          targetFilenameForSearch = requestedSource;
          // Ensure source is not null or undefined before assigning
          // Apply nullish coalescing to targetFilenameForSearch here as well
          filterUsedForSearch = { source: targetFilenameForSearch ?? 'unknown', filterApplied: options?.filter?.filterApplied || `Explicit: ${targetFilenameForSearch ?? 'unknown'}` };
        } else {
          filterUsedForSearch = null; // No specific document target
        }

        // <<< REFINE SEARCH QUERY BASED ON CONTEXT >>>
        let finalSearchQuery = query;
        if (targetFilenameForSearch) {
            // If we already know the target document, refine the query for embedding
            finalSearchQuery = refineSearchQuery(query, targetFilenameForSearch);
            console.log(`[Retrieval] Refined query for embedding (specific doc): \"${finalSearchQuery}\"`);
        } else if (isLatestRequest) {
            // Refine query but don't remove a specific source name yet
            finalSearchQuery = refineSearchQuery(query);
            console.log(`[Retrieval] Refined query for embedding (__LATEST__): \"${finalSearchQuery}\"`);
        } else {
             console.log(`[Retrieval] Using original query for embedding (no specific doc): \"${finalSearchQuery}\"`);
        }
        // <<< END QUERY REFINEMENT >>>

        // --- Stage 1: Document-Specific Handling (Full Load or Vector Search) ---
        if (targetFilenameForSearch) {
          console.log(`[Retrieval] Entering document-specific handling for: \"${targetFilenameForSearch}\"`);
          try {
            let chunkCount: number | null = null;
            // Get chunk count from registry
            const { data: registryData, error: registryError } = await supabaseClient
                .from('document_registry')
              .select('chunk_count')
              .eq('filename', targetFilenameForSearch)
              .maybeSingle(); 

            if (registryError) {
              console.warn(`[Retrieval] Error fetching chunk count for ${targetFilenameForSearch}:`, registryError.message);
            } else if (registryData) {
              chunkCount = registryData.chunk_count;
              console.log(`[Retrieval] Document ${targetFilenameForSearch} has ${chunkCount} chunks.`);
            }

            // Strategy Decision: Full Load or Vector Search?
            if (chunkCount !== null && chunkCount <= MAX_CHUNKS_FOR_FULL_LOAD) {
              // << Load full document >>
              console.log(`[Retrieval] Loading full document for ${targetFilenameForSearch} (<= ${MAX_CHUNKS_FOR_FULL_LOAD} chunks)`);
              const { data: fullDocData, error: fullDocError } = await supabaseClient
                .from('documents')
                .select('content, metadata')
                .eq('metadata->>source', targetFilenameForSearch); // Filter by source in metadata JSONB

              if (fullDocError) {
                console.error(`[Retrieval] Error fetching full document for ${targetFilenameForSearch}:`, fullDocError.message);
                // Fallback to vector search if full load fails? Or just return empty? Let's try vector search.
              } else if (fullDocData && fullDocData.length > 0) {
                console.log(`[Retrieval] Successfully loaded ${fullDocData.length} chunks for full document ${targetFilenameForSearch}`);
                exactMatchResults = fullDocData.map((row: any, index: number) => new Document({
                  pageContent: row.content ?? '', // Ensure content is string
                  metadata: {
                    ...row.metadata,
                    source: row.metadata?.source ?? 'unknown', // Handle null source
                    chunkIndex: row.metadata?.chunkIndex ?? index, // Provide fallback index
                    fullDocumentMatch: true // Mark as part of a full document match
                  }
                }));
                console.log(`[Retrieval] Prepared ${exactMatchResults.length} documents from full load.`);
                // Skip vector search since we have the full document
                // Proceed directly to result processing
              } else {
                 console.log(`[Retrieval] No content found for full document load: ${targetFilenameForSearch}. Proceeding to vector search.`);
              }
            } else {
              // If we didn't load the full document (either too many chunks or error), proceed with vector search
              if (exactMatchResults.length === 0) {
                // << Vector Search within the specific document >>
                console.log(`[Retrieval] Performing vector search within document: \"${targetFilenameForSearch}\"`);
                // IMPORTANT: Use the refined query for vector search when targeting a specific document
                const vectorSearchResults = await vectorStore.similaritySearch(
                  finalSearchQuery, 
                  options?.k || 10, // Use provided k or default
                  { 'metadata.source': targetFilenameForSearch } // Apply the specific document filter
                );
                console.log(`[Retrieval] Vector search in ${targetFilenameForSearch} returned ${vectorSearchResults.length} results.`);
                exactMatchResults = vectorSearchResults;
                
                // Add a flag to indicate these came from a targeted vector search
                exactMatchResults.forEach(doc => {
                    doc.metadata = { ...doc.metadata, targetedVectorSearch: true };
                });
              }
            }

          } catch (docSpecificError) {
            console.error(`[Retrieval] Error during document-specific handling for ${targetFilenameForSearch}:`, docSpecificError);
            // Fallback to general vector search if document-specific logic fails
            exactMatchResults = []; // Reset results
          }
        }

        // --- Stage 2: General Vector Search (if no specific doc or specific failed) ---
        let generalSearchResults: Document[] = [];
        if (exactMatchResults.length === 0) {
          console.log(`[Retrieval] Performing general vector search for query: \"${finalSearchQuery}\"`);
          // Use the potentially refined query (finalSearchQuery)
          generalSearchResults = await vectorStore.similaritySearch(
            finalSearchQuery,
            options?.k || 5, // Use a potentially smaller k for general search
            options?.filter // Use any general filters provided
          );
          console.log(`[Retrieval] General vector search returned ${generalSearchResults.length} results.`);
        }

        // --- Stage 3: Combine and Process Results ---
        // Prioritize exact match results if they exist
        let combinedResults = exactMatchResults.length > 0 ? exactMatchResults : generalSearchResults;

        // Simple de-duplication based on content (can be improved)
        const uniqueDocs = new Map<string, Document>();
        combinedResults.forEach(doc => {
          // Normalize whitespace and content for better comparison
          const normalizedContent = (doc.pageContent ?? '').replace(/\s+/g, ' ').trim();
          if (!uniqueDocs.has(normalizedContent)) {
            uniqueDocs.set(normalizedContent, doc);
          }
        });

        const finalResults = Array.from(uniqueDocs.values());
        
        console.log(`[Retrieval] Returning ${finalResults.length} unique documents after processing.`);

        // Include filter information used for the search in the final return
        return {
          documents: finalResults,
          active_document_filter: filterUsedForSearch, // Return the filter actually used
          new_explicit_filter_set: newExplicitFilterSet // Pass this through
        };

      } catch (invokeError) {
         console.error(`[Retrieval] Critical error in retriever invoke:`, invokeError);
         // Return an empty result set in case of a major failure
         return {
           documents: [],
           active_document_filter: null,
           new_explicit_filter_set: false,
         };
      }
    }, // End invoke

    // Function to add or update documents (placeholder, might need adjustments)
    addDocuments: async (docs: Document[], options?: { ids?: string[] }) => {
      // Basic validation
      if (!docs || docs.length === 0) {
        console.log("[Retrieval] No documents provided to addDocuments.");
        return [];
      }

      console.log(`[Retrieval] Attempting to add/update ${docs.length} documents.`);

      // Example: Add a timestamp or version to metadata before adding
      const docsWithMeta = docs.map(doc => ({
        ...doc,
        metadata: {
          ...doc.metadata,
          lastUpdated: new Date().toISOString(),
          source: doc.metadata?.source ?? 'unknown', // Ensure source exists
        },
      }));
      
      try {
         const resultIds = await vectorStore.addDocuments(docsWithMeta, options);
         console.log(`[Retrieval] Successfully added/updated documents with IDs:`, resultIds);
         return resultIds;
      } catch (addError) {
         console.error(`[Retrieval] Error adding documents to vector store:`, addError);
         // Depending on requirements, might want to throw or handle differently
         return []; // Return empty array on failure
      }
    } // End addDocuments
  }; // End return object
}

// New function to retrieve the entire PowerPoint content based on the filename
export async function retrieveFullPowerPoint(
  filename: string,
  _config: RunnableConfig
): Promise<Document[]> {
  console.log(`[Retrieval] Retrieving full PowerPoint document object for: ${filename}`);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
      'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables are not defined',
    );
  }
  
  const supabaseClient = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    {
      auth: {
        persistSession: false,
      },
      global: {
        fetch: (url, options) => {
          return fetch(url, {
            ...options,
            signal: AbortSignal.timeout(60000),
          });
        },
      },
    }
  );
  
  try {
    console.log(`[Retrieval] Querying Supabase for full presentation document: ${filename}`);
    const { data, error } = await supabaseClient
      .from('documents')
      .select('*')
      // Filter specifically for the full presentation document using filename and the flag
      .eq('metadata->>source', filename)
      .eq('metadata->>isFullPresentation', true)
      .limit(1); // Should only be one
    
    if (error) {
      console.error('[Retrieval] Supabase query error for full presentation:', error);
      return [];
    }
    
    if (!data || data.length === 0) {
      console.log(`[Retrieval] No full presentation document found for: ${filename}`);
      return [];
    }
    
    console.log(`[Retrieval] Found full presentation document for: ${filename}`);
    
    // Expecting only one result
    const item = data[0];
    const fullDoc = new Document({
        pageContent: item.content || item.page_content,
        metadata: {
            ...(item.metadata || {}),
            source: item.metadata?.source ?? filename ?? '',
            chunkIndex: item.metadata?.chunkIndex ?? -1
        },
    });
    
    // Return it in an array as per the function signature
    return [fullDoc]; 
  } catch (error: unknown) {
    let errorMessage: string;
    if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = String(error);
    }
    console.error(`[Retrieval] Error retrieving PowerPoint content:`, errorMessage);
    return [];
  }
}

// Helper function to check if a query seems to be specifically about PowerPoint
export function isPowerPointQuery(query: string): { isPPT: boolean, filename: string | null } {
  const lowerQuery = query.toLowerCase();
  const pptKeywords = ['slide', 'powerpoint', 'presentation', '.pptx'];
  const containsKeyword = pptKeywords.some(kw => lowerQuery.includes(kw));

  if (!containsKeyword) {
    return { isPPT: false, filename: null };
  }

  // Try to extract a filename if keywords are present
  const extractedName = extractDocumentNameFromQuery(query);
  
  // Check if the extracted name actually ends with .pptx or .ppt
  if (extractedName && /\.pptx?$/i.test(extractedName)) {
     console.log(`[Retrieval] Identified PowerPoint query for specific file: ${extractedName}`);
     return { isPPT: true, filename: extractedName };
  }

  // If keywords are present but no specific .pptx name, assume general PPT query
  console.log(`[Retrieval] Identified general PowerPoint query (keywords found)`);
  return { isPPT: true, filename: null }; 
}

