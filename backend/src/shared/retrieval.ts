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

// Interface for data returned by Supabase RPC (match_documents_enhanced)
interface SupabaseRpcResult {
  content: string;
  metadata: Record<string, any>;
  // Add other common fields if known, e.g., id? similarity?
  id?: string | number;
  similarity?: number;
}

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
        const requestedSource = options?.['metadata.source']; 
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
            targetFilenameForSearch = latestDocData[0].filename;
            console.log(`[Retrieval] Resolved __LATEST__ to filename: \"${targetFilenameForSearch}\"`);
            filterUsedForSearch = { source: targetFilenameForSearch, filterApplied: `Latest Document (${targetFilenameForSearch})` };
          } else {
            console.warn("[Retrieval] __LATEST__ request failed: Could not find latest document in registry.");
          }
        } else if (requestedSource) {
          targetFilenameForSearch = requestedSource;
          filterUsedForSearch = { source: targetFilenameForSearch, filterApplied: options?.filter?.filterApplied || `Explicit: ${targetFilenameForSearch}` };
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
              // **** Strategy: Load All Chunks ****
              console.log(`[Retrieval] Chunk count (${chunkCount}) <= ${MAX_CHUNKS_FOR_FULL_LOAD}. Attempting full document load.`);
              const { data: allChunksData, error: allChunksError } = await supabaseClient
                .from('documents')
                .select('content, metadata')
                .eq('metadata->>source', targetFilenameForSearch)
                .order('metadata->chunkIndex', { ascending: true }); // Ensure correct order
              
              if (allChunksError) {
                 console.error(`[Retrieval] Error fetching all chunks for ${targetFilenameForSearch}:`, allChunksError.message);
                 // Fallback to vector search could be added here, but for now, return empty
                 return []; 
              } else if (allChunksData && allChunksData.length > 0) {
                 console.log(`[Retrieval] Successfully loaded ${allChunksData.length} chunks for full document context.`);
                 exactMatchResults = allChunksData.map((item: any) => new Document({ 
                   pageContent: item.content || '',
                    metadata: {
                      ...item.metadata,
                      retrieval: {
                       retrievalStrategy: 'full-document-load',
                       retrievalFilters: { source: targetFilenameForSearch },
                       documentTitle: item.metadata?.title || targetFilenameForSearch
                      },
                    },
                  }));
                 // Set filter used for search state correctly for saving
                 filterUsedForSearch = { source: targetFilenameForSearch, filterApplied: `Full Load: ${targetFilenameForSearch}` }; 
              } else {
                 console.warn(`[Retrieval] Full document load query returned no results for ${targetFilenameForSearch}.`);
              }
            } else {
              // **** Strategy: Vector Search within Document (RPC) ****
              if (chunkCount === null) {
                  console.log(`[Retrieval] Chunk count unknown for ${targetFilenameForSearch}. Using vector search.`);
              } else {
                  console.log(`[Retrieval] Chunk count (${chunkCount}) > ${MAX_CHUNKS_FOR_FULL_LOAD}. Using vector search.`);
              }
              console.log(`[Retrieval] Performing direct similarity search filtered by source: \"${targetFilenameForSearch}\" using query: \"${finalSearchQuery}\"`);
              
              // <<< BYPASS RPC and use standard similarity search with filter >>>
              const filterOptions = { 'metadata.source': targetFilenameForSearch };
              // Add other filters from options if necessary, but avoid overwriting source
              if (options.filter) {
                 for (const key in options.filter) {
                     if (key !== 'metadata.source') {
                         filterOptions[key] = options.filter[key];
                     }
                 }
              }

              exactMatchResults = await vectorStore.similaritySearch(
                 finalSearchQuery, 
                 options?.k || 5, 
                 filterOptions
              );
              console.log(`[Retrieval] Direct similarity search found ${exactMatchResults.length} chunks for \"${targetFilenameForSearch}\".`);

              // Add retrieval metadata
              exactMatchResults = exactMatchResults.map((doc: Document) => { 
                  if (!doc.metadata) doc.metadata = {};
                  doc.metadata.retrieval = {
                      retrievalStrategy: isLatestRequest ? 'latest-document-direct-search' : 'document-specific-direct-search',
                      retrievalFilters: filterOptions,
                      documentTitle: doc.metadata?.title || targetFilenameForSearch
                  };
                  doc.metadata.exactMatch = true; // Still consider it an exact doc match
                  return doc;
              });

              // Ensure filterUsedForSearch reflects the target
              filterUsedForSearch = { source: targetFilenameForSearch, filterApplied: options?.filter?.filterApplied || `Direct Filter: ${targetFilenameForSearch}` };

              // <<< COMMENT OUT ORIGINAL RPC CALL AND FALLBACK >>>
              /*
               console.log(`[Retrieval] Attempting RPC match_documents_enhanced for: \"${targetFilenameForSearch}\" using query: \"${finalSearchQuery}\"`);
               const { data: rpcData, error: rpcError } = await supabaseClient
                 .rpc('match_documents_enhanced', {
                   query_embedding: await embeddings.embedQuery(finalSearchQuery),
                   document_name: targetFilenameForSearch,
                   match_count: options?.k || 5
                 });
                 
               if (rpcError) {
                 console.warn(`[Retrieval] RPC match_documents_enhanced failed for \"${targetFilenameForSearch}\":`, rpcError.message);
               } else if (rpcData && rpcData.length > 0) {
                 // << Log the ACTUAL source metadata from the RPC results >>
                 console.log("--- Checking RPC Result Metadata --- ");
                 rpcData.slice(0, 3).forEach((item: SupabaseRpcResult, index: number) => {
                   console.log(`  RPC Result [${index}] Metadata Source: ${item.metadata?.source}`);
                 });
                 console.log("-----------------------------------");
                 // << End Log >>
                 
                 console.log(`[Retrieval] Found ${rpcData.length} chunks purportedly for document \"${targetFilenameForSearch}\" via RPC`); // Changed log msg slightly
                 exactMatchResults = rpcData.map((item: SupabaseRpcResult) => new Document({ 
                   pageContent: item.content,
                   metadata: {
                     ...item.metadata,
                     exactMatch: true, // Indicate it came from a specific document search
                     retrieval: {
                       retrievalStrategy: isLatestRequest ? 'latest-document-rpc' : 'document-specific-rpc',
                       retrievalFilters: { source: targetFilenameForSearch }, // Store the target filename
                       documentTitle: item.metadata?.title || targetFilenameForSearch
                     },
                   },
                 }));
                 // Ensure filterUsedForSearch reflects the RPC target
                 filterUsedForSearch = { source: targetFilenameForSearch, filterApplied: options?.filter?.filterApplied || `RPC Match: ${targetFilenameForSearch}` };
               } else {
                 console.warn(`[Retrieval] RPC returned no results for \"${targetFilenameForSearch}\".`);
                 // Fallback logic is currently disabled, so result will be empty
               }
               */
              } // End if(targetFilenameForSearch)
              
              // Sort results if any were found from Stage 1 (applies to both full load and RPC)
              if (exactMatchResults.length > 0) {
                exactMatchResults.sort((a, b) => (a.metadata?.chunkIndex ?? 0) - (b.metadata?.chunkIndex ?? 0));
                console.log(`[Retrieval] Document-specific handling completed. Found ${exactMatchResults.length} results.`);
                // Do not return early here, let the function return at the end
              }

          } catch (stage1Error: any) { 
            console.error('[Retrieval] Error during document-specific handling stage:', stage1Error);
            // Reset results and filter on error
            exactMatchResults = [];
            filterUsedForSearch = null;
          }
        } // --- End Stage 1 ---
        
        // --- Stage 2: Standard Vector Search (Only if Stage 1 found nothing AND wasn't targeting a specific doc) ---
        if (exactMatchResults.length === 0 && !targetFilenameForSearch) {
            console.log(`[Retrieval] Performing standard vector search (no specific document targeted or specific search yielded no results). Using query: \"${finalSearchQuery}\"`);
            // Prepare filters for standard search
            const baseOptions = { ...options }; 
            let standardSearchFilters: Record<string, any> = {};
            if (baseOptions.filter) {
                standardSearchFilters = { ...baseOptions.filter };
                delete standardSearchFilters['metadata.source']; 
            }
            delete baseOptions.filter;
            delete baseOptions['__LATEST__']; 
            const finalSearchOptions = { ...standardSearchFilters, ...baseOptions };

            try {
               let vectorResults = await vectorStore.similaritySearch(finalSearchQuery, options?.k || 4, finalSearchOptions); 
              console.log(`[Retrieval] Standard vector search returned ${vectorResults.length} results`);
              
               vectorResults = vectorResults.map((doc: Document) => { 
                if (!doc.metadata) doc.metadata = {};
                doc.metadata.retrieval = {
                  retrievalStrategy: 'vector-search',
                   retrievalFilters: finalSearchOptions,
                };
                return doc;
              });
               exactMatchResults = vectorResults; // Assign to the main results variable

            } catch (stage2Error: any) { 
               console.error('[Retrieval] Error during standard vector search:', stage2Error);
               exactMatchResults = []; // Ensure empty results on error
            }
        } else if (exactMatchResults.length === 0 && targetFilenameForSearch) {
            console.log(`[Retrieval] Document-specific search for "${targetFilenameForSearch}" yielded no results. Returning empty.`);
            // No standard search fallback if a specific document was requested but not found/yielded no chunks.
        }

        // Log final snippets before returning
        console.log("--- Final Retrieved Documents Snippets ---");
        exactMatchResults.forEach((doc, index) => {
            const snippet = doc.pageContent.substring(0, 150).replace(/\n/g, " ");
            console.log(`  [${index}] Source: ${doc.metadata?.source}, Chunk: ${doc.metadata?.chunkIndex}, Strategy: ${doc.metadata?.retrieval?.retrievalStrategy || 'N/A'} => ${snippet}...`);
        });
        console.log("------------------------------------");

        console.log("--- Exiting retrieveDocuments (Success) ---");
        console.log(`[RetrievalGraph] SAVING active_document_filter:`, JSON.stringify(filterUsedForSearch));
        return { 
          documents: exactMatchResults, 
          active_document_filter: filterUsedForSearch,
          new_explicit_filter_set: newExplicitFilterSet // Pass the flag through
        };

      } catch (generalError: any) { 
        console.error('[Retrieval] General error during retrieval invoke:', generalError);
        console.log("--- Exiting retrieveDocuments (General Error) ---");
        return { documents: [], active_document_filter: null, new_explicit_filter_set: false };
      }
    }, // End of invoke method definition
    
    // Method to add documents
    addDocuments: async (documents: Document[]) => {
      // Try-catch for adding documents
      try {
        console.log(`[Retrieval] Adding ${documents.length} documents to vector store`);
        await vectorStore.addDocuments(documents);
        console.log('[Retrieval] Successfully added documents to vector store');
        
        // Optionally trigger registry update (might be redundant if DB trigger exists)
        try {
          await supabaseClient.rpc('populate_document_registry');
          console.log('[Retrieval] Manually triggered document registry update after adding documents');
        } catch (registryError: any) { // Add type
          console.warn('[Retrieval] Error triggering document registry update:', registryError?.message || registryError);
        }
      } catch (addDocsError: any) { // Add type
        console.error('[Retrieval] Error adding documents to vector store:', addDocsError);
        throw addDocsError; // Rethrow to be handled by caller
      }
    } // End of addDocuments method definition

  }; // End of the main returned object from makeRetriever
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
        metadata: item.metadata || {},
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

// Utility function to check if a query is about a PowerPoint file
export function isPowerPointQuery(query: string): { isPPT: boolean, filename: string | null } {
  const powerPointPatterns = [
    /(?:show|get|retrieve|give me|view|display).*(?:powerpoint|pptx|presentation|slides|deck).*(?:called|named|titled|file:?)\s+["']?([^"\'?!.]+\.pptx?)["']?/i,
    /(?:show|get|retrieve|give me|view|display).*(?:called|named|titled|file:?)\s+["']?([^"\'?!.]+\.pptx?)["']?.+(?:powerpoint|pptx|presentation|slides|deck)/i,
    /(?:show|get|retrieve|give me|view|display).+(?:full|entire|complete|all).*(?:powerpoint|pptx|presentation|slides|deck).*(?:called|named|titled|file:?)\s+["']?([^"\'?!.]+\.pptx?)["']?/i,
    /(?:powerpoint|pptx|presentation|slides|deck).*(?:called|named|titled|file:?)\s+["']?([^"\'?!.]+\.pptx?)["']?/i
  ];
  
  for (const pattern of powerPointPatterns) {
    const match = query.match(pattern);
    if (match && match[1]) {
      return { isPPT: true, filename: match[1].trim() };
    }
  }
  
  return { isPPT: false, filename: null };
}

