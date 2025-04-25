/* eslint-disable @typescript-eslint/no-unused-vars */
import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentStateAnnotation } from './state.js';
import { makeRetriever, /* retrieveFullPowerPoint, isPowerPointQuery, */ extractDocumentNameFromQuery } from '../shared/retrieval.js'; // Commented out unused imports
import { formatDocs } from './utils.js';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { 
  RESPONSE_SYSTEM_PROMPT, 
  ROUTER_SYSTEM_PROMPT,
} from './prompts.js';
import { RunnableConfig } from '@langchain/core/runnables';
import {
  AgentConfigurationAnnotation,
  ensureAgentConfiguration,
} from './configuration.js';
import { loadChatModel } from '../shared/utils.js';
import { createClient } from '@supabase/supabase-js';
// import { ChatOpenAI } from '@langchain/openai'; // Commented out unused import
import { EventEmitter } from 'events';
// Import the base checkpointer interface
// import { BaseCheckpointSaver } from "@langchain/langgraph"; // Commented out unused import
// Revert to importing PostgresSaver from its specific package
// import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"; // Comment out unused import causing lint error
import { MemorySaver } from "@langchain/langgraph";
import { Document } from "@langchain/core/documents";
// import { AgentState } from "./state.js"; // Remove this potential incorrect import

// Define AgentState as an alias for the actual state type
type AgentState = typeof AgentStateAnnotation.State;

// Define the expected structure for the result of retriever.invoke
// This might need adjustment based on the actual retriever implementation
type RetrieverResultType = {
  documents: Document<Record<string, any>>[];
  // Include other potential fields returned by your specific retriever if needed
  // active_document_filter?: { source: string; filterApplied?: string } | null;
  // new_explicit_filter_set?: boolean;
};

// Define types for filters to fix "filterApplied" property issues
/* // REMOVE Unused Interface
interface DocumentFilters {
  [key: string]: string | boolean | number | undefined;
  filterApplied?: string;
}
*/

// Increase default max listeners to avoid warnings 
EventEmitter.defaultMaxListeners = 20;

// DEFINE MISSING TYPE:
// interface FilterExtractionOutput {
//   targets: string[];
//   cleaned_query: string;
// }

// DEFINE MISSING CONSTANT (Placeholder - User should refine this prompt)
// REPLACE THE OLD PROMPT BELOW with the SIMPLIFIED version:
// const FILTER_EXTRACTION_TEMPLATE = `Analyze the user query to identify if it refers to specific filenames.
// Filenames often end with extensions like .pdf, .docx, .pptx, .txt, etc., and can contain spaces (e.g., 'report v2.pdf').
//
// Your goal is to:
// 1. Extract any specific filenames mentioned. If found, list them exactly in a JSON array under the key "targets".
// 2. If no specific filenames are mentioned, return an empty JSON array for "targets".
// 3. Provide a "cleaned_query" suitable for semantic search. If filenames were extracted, remove them from the query. If no filenames were found, return the original query.
//
// Respond ONLY with a valid JSON object containing the keys "targets" (an array of strings) and "cleaned_query" (a string).
//
// Query: {query}
//
// JSON Output:
// `;

// Utility function to add timeout to any promise
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  
  // Create a timeout promise that rejects after timeoutMs
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`[RetrievalGraph] Operation '${operation}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  
  try {
    // Race the original promise against the timeout
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    // Clear the timeout when the promise resolves or rejects
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function checkQueryType(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<{
  route: 'retrieve' | 'direct';
}> {
  console.log('[RetrievalGraph] Checking query type for routing');
  
  // Quick pattern matching for simple messages that shouldn't trigger retrieval
  const simpleMessagePatterns = [
    /^hi+\s*$/i,                 // "hi", "hii", etc.
    /^hello+\s*$/i,              // "hello", "helloo", etc.
    /^hey+\s*$/i,                // "hey", "heyy", etc.
    /^(good\s*)?(morning|afternoon|evening|day)\s*$/i, // greetings
    /^how\s+(are\s+)?you\s*$/i,  // "how are you"
    /^what('?s| is)\s+up\s*$/i,  // "what's up", "what is up"
    /^thanks?(\s+you)?\s*$/i,    // "thank you", "thanks"
    /^ok(ay)?\s*$/i,             // "ok", "okay"
    /^yes\s*$/i,                 // "yes"
    /^no\s*$/i,                  // "no"
    /^what\s+can\s+you\s+do\s*$/i, // "what can you do"
    /^help\s*$/i                 // "help"
  ];
  
  // Check if the query matches any simple message pattern
  const query = state.query.trim();
  for (const pattern of simpleMessagePatterns) {
    if (pattern.test(query)) {
      console.log(`[RetrievalGraph] Detected simple message pattern: "${query}" - using direct route`);
      return { route: 'direct' };
    }
  }
  
  // If query is very short (1-2 words) and doesn't look like a document query, use direct route
  if (query.split(/\s+/).length <= 2 && !query.includes('.') && !query.match(/pdf|doc|presentation|file|slide/i)) {
    console.log(`[RetrievalGraph] Short query detected: "${query}" - using direct route`);
    return { route: 'direct' };
  }

  try {
    const configuration = ensureAgentConfiguration(config);
    const model = await loadChatModel(configuration.queryModel);
    const routingPrompt = ROUTER_SYSTEM_PROMPT;

    console.log('[RetrievalGraph] Formatting routing prompt');
    const formattedPrompt = await withTimeout(
      routingPrompt.invoke({ query: state.query }),
      10000,
      'format routing prompt'
    );

    console.log('[RetrievalGraph] Calling LLM for query type determination');
    // Get raw text response instead of structured output
    const response = await withTimeout(
      model.invoke(formattedPrompt.toString()),
      30000,
      'query type determination LLM call'  
    );

    // Basic parsing of the raw text response
    const responseContent = response.content.toString().toLowerCase();
    let route: 'retrieve' | 'direct' = 'retrieve'; // Default to retrieve
    if (responseContent.includes('direct')) { // Simple check
      route = 'direct';
    }
    console.log(`[RetrievalGraph] Determined route from LLM: ${route}`);

    return { route };

  } catch (error) {
    console.error('[RetrievalGraph] Error in checkQueryType:', error);
    
    // If it's likely a document-related question, use retrieve as fallback
    if (query.match(/pdf|document|file|presentation|slide|ppt|docx?|read|find/i)) {
      console.log('[RetrievalGraph] Query appears document-related, defaulting to "retrieve" route');
      return { route: 'retrieve' };
    }
    
    // Default to direct for error cases, as it's safer than retrieving incorrect documents
    console.log('[RetrievalGraph] Defaulting to "direct" route due to error');
    return { route: 'direct' };
  }
}

async function answerQueryDirectly(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<typeof AgentStateAnnotation.Update> {
  console.log('[RetrievalGraph] Answering query directly without retrieval');
  try {
    const configuration = ensureAgentConfiguration(config);
    const model = await loadChatModel(configuration.queryModel);
    
    // Create context from previous messages if available
    const messages = [];
    
    // Add system prompt
    messages.push(new SystemMessage(
      `You are a helpful AI assistant that directly answers user questions without needing to search through documents.
       
       For greetings and casual conversation:
       - Be friendly and concise
       - Keep responses under 2 sentences
       - Don't mention documents or searching unless the user asks about capabilities
       
       If asked about your capabilities:
       - Explain that you can answer general questions directly
       - Mention you can also search through uploaded documents when needed
       - Suggest that document-specific questions should include clear references to document names
       
       Always be helpful and straightforward in your responses.`
    ));
    
    // Add context messages from previous conversation if available
    if (state.contextMessages && state.contextMessages.length > 0) {
      console.log(`[RetrievalGraph] Adding ${state.contextMessages.length} context messages to prompt`);
      
      // Convert context messages to proper format
      for (const msg of state.contextMessages) {
        if (msg.type === 'human' || msg.role === 'user') {
          messages.push(new HumanMessage(msg.content));
        } else if (msg.type === 'ai' || msg.role === 'assistant') {
          messages.push(new AIMessage(msg.content));
        }
      }
    }
    
    // Add current user query
    const userHumanMessage = new HumanMessage(state.query);
    messages.push(userHumanMessage);

    console.log('[RetrievalGraph] Calling LLM for direct answer');
    const response = await withTimeout(
      model.invoke(messages),
      30000,
      'direct answer LLM call'
    );
    
    // Update thread info if available
    let threadInfoUpdate = null;
    if (state.threadInfo) {
      threadInfoUpdate = {
        ...state.threadInfo,
        lastUpdated: Date.now(),
        messageCount: (state.threadInfo.messageCount || 0) + 2, // +1 for user message, +1 for response
      };
    }
    
    // --- ADD LOGGING --- 
    // Create the state update object
    const successUpdate = { 
      ...state, // Spread the existing state first
      messages: [userHumanMessage, response],
      threadInfo: threadInfoUpdate
    };
    console.log('[RetrievalGraph | answerQueryDirectly] Returning SUCCESS state update:', JSON.stringify(successUpdate, null, 2));
    // --- END LOGGING --- 
    // Return the full state object 
    return successUpdate; 

  } catch (error: any) { // Add :any to error type
    console.error('[RetrievalGraph] Error in answerQueryDirectly:', error);
    
    // Create a fallback response for common greetings if LLM call fails
    const query = state.query.trim().toLowerCase();
    let fallbackResponse = "I'm here to help. What would you like to know?";
    
    if (query.match(/^(hi+|hello+|hey+)/)) {
      fallbackResponse = "Hello! How can I assist you today?";
    } else if (query.match(/how are you/)) {
      fallbackResponse = "I'm doing well, thanks for asking! How can I help you?";
    } else if (query.match(/thank/)) {
      fallbackResponse = "You're welcome!";
    } else if (query.match(/what can you do/)) {
      fallbackResponse = "I can answer questions directly or search through your uploaded documents to find specific information.";
    }
    
    // Reconstruct HumanMessage using state.query
    const originalUserMessage = new HumanMessage(state.query); 
    const fallbackAiMessage = new AIMessage(fallbackResponse);
    
    // Create the error state update object
    const errorUpdate = {
      ...state, // Spread the existing state first
      messages: [originalUserMessage, fallbackAiMessage],
      error: error.message // Add error message to state
    };
    // --- ADD LOGGING (Fixed variable name) --- 
    console.log('[RetrievalGraph | answerQueryDirectly] Returning ERROR state update:', JSON.stringify(errorUpdate, null, 2));
    // --- END LOGGING --- 
    // Return the full state object
    return errorUpdate;
  }
}

async function routeQuery(
  state: typeof AgentStateAnnotation.State,
): Promise<'retrieveDocuments' | 'directAnswer'> {
  console.log('[RetrievalGraph] Routing query based on determined type');
  const route = state.route;
  if (!route) {
    console.error('[RetrievalGraph] Route is not set, defaulting to retrieveDocuments');
    return 'retrieveDocuments';
  }

  if (route === 'retrieve') {
    return 'retrieveDocuments';
  } else if (route === 'direct') {
    return 'directAnswer';
  } else {
    console.error(`[RetrievalGraph] Invalid route: ${route}, defaulting to retrieveDocuments`);
    return 'retrieveDocuments';
  }
}

/**
 * Extract any document-specific filters from the query
 */
export async function extractQueryFilters(
  state: AgentState,
  _config: RunnableConfig
): Promise<{ 
  queryFilters: Record<string, any>;
  cleanedQuery: string; 
  active_document_filter: { source: string; filterApplied?: string } | null; 
  new_explicit_filter_set: boolean;
}> {
  // << Enhanced State Logging Start >>
  console.log("\n--- Entering extractQueryFilters ---");
  console.log(`  Query: \"${state.query}\"`);
  console.log(`  Original Query: \"${state.originalQuery}\"`);
  console.log(`  Refinement Count: ${state.refinementCount || 0}`);
  console.log(`  Incoming active_document_filter:`, JSON.stringify(state.active_document_filter));
  // << End Enhanced State Logging Start >>

  const currentQuery = state.query; // Use original state query for logs etc.
  const existingFilter = state.active_document_filter; // Get existing filter from state
  const isRefinement = (state.refinementCount || 0) > 0; // Check if this is a refinement step

  // console.log(`[RetrievalGraph] Extracting filters from query: \"${currentQuery}\"`); // Redundant now
  // console.log(`[RetrievalGraph] Incoming active_document_filter state:`, JSON.stringify(existingFilter)); // Redundant now
  console.log(`[RetrievalGraph] Is Refinement Step: ${isRefinement}`);

  // << Initialize filter variables based on incoming state >>
  let finalActiveFilter: { source: string; filterApplied?: string } | null = existingFilter; 
  let cleanedQuery = currentQuery; // Start with original query
  let queryFilters: Record<string, any> = existingFilter 
    ? { 'metadata.source': existingFilter.source, filterApplied: existingFilter.filterApplied || `Initial: ${existingFilter.source}` }
    : {};
  let newExplicitFilterSet = false; // << Initialize flag

  // --- 0. Check for Contextual References --- 
  const contextualPhrases = ['this document', 'this file', 'this presentation', 'that document', 'that file', 'the document', 'said document', 'its summary', 'it says', 'it mentions'];
  const queryToProcess = currentQuery.toLowerCase().trim();
  const isContextual = contextualPhrases.some(phrase => queryToProcess.includes(phrase));

  if (isContextual && existingFilter) {
    console.log(`[RetrievalGraph] Contextual query: Reusing existing filter.`);
    // Clean query if needed
    contextualPhrases.forEach(phrase => {
       if (currentQuery.toLowerCase().includes(phrase)) {
           cleanedQuery = currentQuery.replace(new RegExp(phrase, 'i'), '').trim();
       }
    });
    // Keep existing filter - finalActiveFilter and queryFilters are already set based on it
    // Update filterApplied message for clarity
    queryFilters.filterApplied = existingFilter.filterApplied || `Context: ${existingFilter.source}`;
    console.log(`[RetrievalGraph] Context Reuse path finished.`);
    // No return here, let logic continue
  } else if (isContextual && !existingFilter) {
     console.log("[RetrievalGraph] Contextual query, but NO active filter found. Clearing filter.");
     finalActiveFilter = null; // Ensure filter is cleared
     queryFilters = {}; // Ensure query filters are also cleared
  } else {
     // Not explicitly contextual, continue with existing filter as default
     console.log("[RetrievalGraph] Not a contextual query, proceeding with extraction.");
  }

  // --- 1. Try explicit extraction first --- 
  let explicitExtractionResult: string | null = null;
  // let explicitFoundFilename = false; // Commented out unused variable
  try {
    explicitExtractionResult = extractDocumentNameFromQuery(currentQuery);
    if (explicitExtractionResult && explicitExtractionResult !== '__LATEST__') {
      console.log(`[RetrievalGraph] Explicit regex potentially matched: "${explicitExtractionResult}". Validating via registry...`);
      
      // Validate against registry
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !supabaseKey) {
        throw new Error("Missing Supabase credentials for registry lookup");
      }
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data: registryMatches, error: rpcError } = await supabase
        .rpc('find_document_by_name', { 
           search_term: explicitExtractionResult, // Use the regex result here
           exact_match: false // Allow fuzzy matching
        });

      if (rpcError) {
        console.error("[RetrievalGraph] Registry validation RPC error:", rpcError);
      } else if (registryMatches && registryMatches.length > 0) {
        // Check confidence of the top match from registry
        const bestMatch = registryMatches[0];
        const confidence = bestMatch.similarity;
        const matchedFilename = bestMatch.filename; // Get the canonical name
        const CONFIDENCE_THRESHOLD = 0.75; // Increased threshold from 0.15

        if (confidence >= CONFIDENCE_THRESHOLD) {
          console.log(`[RetrievalGraph] Registry validated explicit match: \"${matchedFilename}\" (Confidence: ${confidence.toFixed(2)})`);
          // Explicit filename *validated*. OVERRIDE any previous filter.
          if (!existingFilter || existingFilter.source !== matchedFilename) {
              console.log(`[RetrievalGraph] Validated explicit filename \"${matchedFilename}\" OVERRIDES existing filter. Resetting refinement count.`);
              newExplicitFilterSet = true; // Set flag
          } else {
              console.log(`[RetrievalGraph] Validated explicit filename \"${matchedFilename}\" matches existing filter. Not resetting count.`);
              newExplicitFilterSet = false;
          }
          const filterApplied = `Explicit/Registry: ${matchedFilename}`;
          finalActiveFilter = { source: matchedFilename, filterApplied: filterApplied };
          cleanedQuery = currentQuery; // Maybe clean based on matchedFilename later? For now, keep original.
          queryFilters = { "metadata.source": matchedFilename, filterApplied: filterApplied };
          // explicitFoundFilename = true; // Commented out unused variable assignment
        } else {
          console.log(`[RetrievalGraph] Explicit regex match \"${explicitExtractionResult}\" failed registry validation (Confidence: ${confidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD}).`);
          // explicitFoundFilename = false; // Commented out unused variable assignment
          // <<< FIX: Clear the filter if explicit validation fails >>>
          console.log("[RetrievalGraph] Clearing active filter due to failed explicit validation.");
          finalActiveFilter = null;
          queryFilters = {}; // Also clear query filters
          newExplicitFilterSet = false;
          // Keep existing filter (or null) // <<< Removed incorrect comment
        }
      } else {
        console.log(`[RetrievalGraph] Explicit regex match \"${explicitExtractionResult}\" not found in registry.`);
        // explicitFoundFilename = false; // Commented out unused variable assignment
        // <<< FIX: Clear the filter if explicit match not found in registry >>>
        console.log("[RetrievalGraph] Clearing active filter because explicit match was not found in registry.");
        finalActiveFilter = null;
        queryFilters = {}; // Also clear query filters
        newExplicitFilterSet = false;
        // Keep existing filter (or null) // <<< Removed incorrect comment
      }

    } else if (explicitExtractionResult === '__LATEST__') {
      console.log("[RetrievalGraph] Explicit __LATEST__ found. Setting queryFilters, not overriding finalActiveFilter yet.");
      cleanedQuery = currentQuery.replace(/\b(latest|newest|most recent)\s+(document|file|pdf)\b/gi, "").trim();
      queryFilters = { "__LATEST__": true, filterApplied: "Latest Document (Explicit)" };
      // << FIX: Clear the active filter when __LATEST__ is requested >>
      console.log("[RetrievalGraph] Clearing active_document_filter because __LATEST__ was requested.");
      finalActiveFilter = null; 
      // explicitFoundFilename = false; // Commented out unused variable assignment
    } else {
       console.log("[RetrievalGraph] Explicit extraction did not find any potential match.");
       // explicitFoundFilename = false; // Commented out unused variable assignment
    }
  } catch (error) {
    console.error("[RetrievalGraph] Error during explicit filter extraction/validation:", error);
    // On error, revert to the original incoming filter state
    finalActiveFilter = existingFilter; 
    queryFilters = existingFilter 
      ? { 'metadata.source': existingFilter.source, filterApplied: existingFilter.filterApplied || `Initial: ${existingFilter.source}` }
      : {};
    cleanedQuery = currentQuery; // Revert cleaned query too
    // explicitFoundFilename = (existingFilter !== null); // Commented out unused variable assignment
    newExplicitFilterSet = false; // Ensure flag is false on error
  }
  
  // --- 2. Try registry lookup ONLY if no specific filename filter is active yet ---
  // Run if we don't have a filter set from context or explicit+validated match
  if (finalActiveFilter === null) { 
    console.log("[RetrievalGraph] No active filter after explicit step, trying broad registry lookup...");
    try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
        throw new Error("Missing Supabase credentials for registry lookup");
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
      const searchTerms = extractKeyTerms(currentQuery); // Use original query for terms
      console.log(`[RetrievalGraph] Using terms for registry search: ${searchTerms.join(', ')}`);
      
      if (searchTerms.length > 0) {
        const { data: registryMatches, error: rpcError } = await supabase
          .rpc('find_document_by_name', { 
             search_term: searchTerms.join(' '),
             exact_match: false
          });

        if (rpcError) {
          console.error("[RetrievalGraph] Registry lookup RPC error:", rpcError);
        } else if (registryMatches && registryMatches.length > 0) {
          // ...(Smarter Match Selection logic - simplified) ...
          const numericIdentifiers = searchTerms.filter(term => /^\d+$/.test(term));
          let potentialMatches = registryMatches.filter((match: { filename: string }) => 
            numericIdentifiers.every((num: string) => match.filename.includes(num))
          );
          if (potentialMatches.length > 0) {
            potentialMatches.sort((a: { similarity: number }, b: { similarity: number }) => b.similarity - a.similarity);
            const bestMatch = potentialMatches[0];
            const confidence = bestMatch.similarity;
            const matchedFilename = bestMatch.filename;
            const CONFIDENCE_THRESHOLD = 0.15;
            if (confidence >= CONFIDENCE_THRESHOLD) {
              console.log(`[RetrievalGraph] Registry Match found and above threshold. Setting filter.`);
              const filterApplied = `Registry Match: ${matchedFilename} (Conf: ${confidence.toFixed(2)})`;
              finalActiveFilter = { source: matchedFilename, filterApplied: filterApplied }; 
              queryFilters = { "metadata.source": matchedFilename, filterApplied: filterApplied };
              newExplicitFilterSet = true; // << Set flag here too if filter is newly set
            } else { 
              console.log(`[RetrievalGraph] Registry Match confidence below threshold.`); 
            }
          } else { 
            console.log("[RetrievalGraph] No suitable registry match found after filtering."); 
          }
        } else { 
          console.log("[RetrievalGraph] No promising matches found in document registry."); 
        }
        }
      } catch (error) {
       console.error("[RetrievalGraph] Error during registry lookup:", error);
       finalActiveFilter = null;
       queryFilters = {}; // Clear query filters too
       newExplicitFilterSet = false; // Ensure flag is false on error
    }
  } else {
     console.log("[RetrievalGraph] Skipping registry lookup as a specific filename filter is already active OR __LATEST__ was found explicitly.");
  }

  // --- 3. Final Return --- 
  console.log(`[RetrievalGraph] FINAL Filter Determination:`, JSON.stringify(finalActiveFilter));
  const returnValue = { 
    queryFilters: queryFilters, 
    cleanedQuery: cleanedQuery, 
    active_document_filter: finalActiveFilter, 
    new_explicit_filter_set: newExplicitFilterSet // Return the flag
  };
  // << Enhanced State Logging End >>
  console.log(`[RetrievalGraph] FINAL RETURN VALUE:`, JSON.stringify(returnValue));
  console.log("--- Exiting extractQueryFilters ---");
  // << End Enhanced State Logging End >>
  return returnValue;
}

/**
 * Retrieves documents based on the query
 */
export async function retrieveDocuments(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig
): Promise<Partial<AgentState>> {
  console.log("--- Entering retrieveDocuments ---");
  console.log(`  Query: \"${state.query}\"`);
  console.log(`  Original Query: \"${state.originalQuery}\"`);
  console.log(`  Refinement Count: ${state.refinementCount}`);
  console.log(`  Incoming active_document_filter (from state):`, state.active_document_filter);

  try {
    const retriever = await makeRetriever(config);

    // Extract filters and potentially refine the query
    console.log("--- Entering extractQueryFilters ---");
    // Destructure results from extractQueryFilters, renaming to avoid scope conflicts
    const extractedFilters = await extractQueryFilters({ ...state, query: state.query }, config);
    const { 
      queryFilters, 
      cleanedQuery, 
      active_document_filter: extracted_active_filter, // Use the renamed variable
      new_explicit_filter_set: extracted_new_filter_flag // Use the renamed variable
    } = extractedFilters;
    console.log("--- Exiting extractQueryFilters ---");

    // Prepare options for the retriever
    const retrieverOptions: Record<string, any> = {};
    
    // Merge the extracted queryFilters (like contentType) into the retriever options
    if (queryFilters && Object.keys(queryFilters).length > 0) {
       retrieverOptions.filter = { ...(retrieverOptions.filter || {}), ...queryFilters };
       console.log(`[RetrievalGraph] Added queryFilters to retriever options:`, queryFilters);
    }

    // If a specific document source was identified by extractQueryFilters, add it to the filter
    // Use the renamed variable 'extracted_active_filter'
    if (extracted_active_filter?.source) {
      retrieverOptions.filter = { 
          ...(retrieverOptions.filter || {}), 
          'metadata.source': extracted_active_filter.source 
      };
      // Pass the descriptive filter text if available
      if (extracted_active_filter.filterApplied) {
        retrieverOptions.filter.filterApplied = extracted_active_filter.filterApplied; 
      }
      console.log(`[RetrievalGraph] Added source filter for: ${extracted_active_filter.source}`);
    }
    
    // Pass the flag indicating if a new explicit filter was just set
    // Use the renamed variable 'extracted_new_filter_flag'
    retrieverOptions.new_explicit_filter_set = extracted_new_filter_flag;

    // Call the retriever with the cleaned query and constructed options
    console.log('[RetrievalGraph] Preparing to call retriever.invoke');
    console.log(`[RetrievalGraph]   Query for invoke: \"${cleanedQuery}\"`);
    console.log(`[RetrievalGraph]   Options for invoke:`, retrieverOptions);

    // Use the specific return type defined earlier
    const retrieverResult = await retriever.invoke(cleanedQuery, retrieverOptions) as RetrieverResultType;
    // Ensure documents is always an array, even if retrieverResult.documents is null/undefined
    const relevantDocs = retrieverResult.documents ?? []; 
    
    console.log(`[RetrievalGraph] retriever.invoke returned ${relevantDocs.length} documents.`);

    // Log snippets (optional)
    if (relevantDocs.length > 0) {
      console.log("--- Snippets from retriever.invoke results ---");
      // Add explicit types for doc and index in the forEach callback
      relevantDocs.slice(0, 5).forEach((doc: Document, index: number) => { 
        const source = doc.metadata?.source ?? 'Unknown';
        const chunkIndex = doc.metadata?.chunkIndex ?? 'N/A';
        const strategy = doc.metadata?.retrieval?.retrievalStrategy ?? 'N/A';
        const snippet = doc.pageContent.substring(0, 100).replace(/\n/g, ' ') + '...';
        console.log(`  [${index}] Source: ${source}, Chunk: ${chunkIndex}, Strategy: ${strategy} => ${snippet}`);
      });
      console.log("-----------------------------------------");
    } else {
        console.log("--- No documents returned by retriever.invoke ---");
    }

    // Update state with retrieved documents and filter info from the extraction step
    // Use the renamed variables 'extracted_active_filter' and 'extracted_new_filter_flag'
    const updatedState: Partial<AgentState> = {
      documents: relevantDocs,
      active_document_filter: extracted_active_filter, 
      new_explicit_filter_set: extracted_new_filter_flag, 
    };
    
    console.log("--- Exiting retrieveDocuments Node ---");
    console.log(`[RetrievalGraph] Documents count: ${relevantDocs.length}`);
    // Use the correctly scoped variables for logging
    console.log(`[RetrievalGraph] SAVING active_document_filter:`, extracted_active_filter);
    console.log(`[RetrievalGraph] New explicit filter set flag: ${extracted_new_filter_flag}`);
    
    // If no new explicit filter was set during THIS retrieval step, maintain the existing refinement count
    // Use the renamed variable 'extracted_new_filter_flag'
    if (!extracted_new_filter_flag) {
      updatedState.refinementCount = state.refinementCount;
      console.log(`[RetrievalGraph] No new explicit filter set, keeping existing refinement count: ${state.refinementCount}`);
    }
    
    return updatedState;

  } catch (error: any) {
      console.error("[RetrievalGraph] Error during document retrieval process:", error);
      // Return a state update indicating error, keeping other state fields if possible
      return { 
        ...state, // Keep existing state where possible
        documents: [], // Ensure documents is empty on error
        error: { // Assign an object conforming to the state definition
          message: `Retrieval failed: ${error.message}`,
          node: 'retrieveDocuments', // Identify the source of the error
          timestamp: Date.now(), // Add a timestamp for when the error occurred
        }, 
        // Preserve previous filter state on error if possible, otherwise could reset
        active_document_filter: state.active_document_filter, 
        // You might want to reset this flag or keep state's flag depending on desired error behavior
        new_explicit_filter_set: state.new_explicit_filter_set, 
      };
  }
}

// Helper function to extract document-specific key terms from a query
/* // Commented out unused function
function extractDocumentKeyTerms(query: string): string[] {
  // Corporate document identifiers - capture numbers, names, and key terms
  const corporatePatterns = [
// ... (rest of function commented out) ...
  return keyTerms;
}
*/

// Helper function to extract key terms from a query
function extractKeyTerms(query: string): string[] {
  // Remove common stop words and punctuation
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with',
    'about', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'shall', 'may',
    'might', 'must', 'of', 'from', 'by', 'as', 'this', 'that', 'these', 'those'
  ]);
  
  // Clean the query and split into words
  const cleanedQuery = query.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
  const words = cleanedQuery.split(/\s+/);
  
  // Filter out stop words and short words
  const keyTerms = words.filter(word => 
    word.length > 2 && !stopWords.has(word)
  );
  
  return [...new Set(keyTerms)]; // Remove duplicates
}

// Helper function to re-rank documents based on keyword matches
/* // Commented out unused function
function reRankByKeywordMatch(documents: any[], keyTerms: string[]): any[] {
  // Calculate a keyword match score for each document
  const scoredDocs = documents.map(doc => {
// ... (rest of function commented out) ...
  return reranked;
}
*/

// Helper function to create chunk groups by finding adjacent and related chunks
/* // Commented out unused function
function createChunkGroups(documents: any[]): any[] {
  // Exit early if we don't have enough documents to group
  if (documents.length <= 1) {
// ... (rest of function commented out) ...
  return resultGroups;
}
*/

// Helper to get a unique ID for a document
/* // Commented out unused function
function getDocId(doc: any): string {
  if (doc.id) {
    return doc.id.toString();
  }
  
  if (doc.metadata && doc.metadata.source && doc.metadata.chunkIndex !== undefined) {
    return `${doc.metadata.source}-${doc.metadata.chunkIndex}`;
  }
  
  // Fallback to content hash
  const content = doc.pageContent || '';
  return `hash-${hashString(content)}`;
}
*/

// Simple hash function for strings
/* // Commented out unused function
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}
*/

async function generateResponse(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<typeof AgentStateAnnotation.Update> {
  console.log('[RetrievalGraph] Generating response based on retrieved documents');
  
  try {
    const configuration = ensureAgentConfiguration(config);
    const model = await loadChatModel(configuration.queryModel);
    
    // Format retrieved documents as a string for the context
    console.log('[RetrievalGraph] Formatting retrieved documents');
    const context = formatDocs(state.documents || []);
    console.log(`[RetrievalGraph] Formatted context length: ${context.length}`);
    
    // Create message array for LLM
    const messages = [];
    
    // Check if we have any meaningful content after multiple refinements
    if ((state.documents?.length === 0 || context.trim().length < 50) && state.refinementCount && state.refinementCount >= 2) {
      console.log('[RetrievalGraph] No relevant documents found after multiple refinements');
      
      // Handle the case where no relevant documents were found despite refinement
      const systemMessage = new SystemMessage(
        `You are a helpful assistant. The system tried but couldn't find relevant documents 
        for the user's query despite trying different refinements. Please politely let the user know 
        that you couldn't find specific information about their query in the documents.
        
        Suggest that they might:
        1. Try rephrasing their question
        2. Check that they are referring to the correct document name
        3. Upload the document if it's not already in the system`
      );
      
      messages.push(systemMessage);
      messages.push(new HumanMessage(state.query));
    } else {
      // Standard response generation with retrieved content
      // const systemPrompt = RESPONSE_SYSTEM_PROMPT; // Commented out unused variable
      const formattedPrompt = await RESPONSE_SYSTEM_PROMPT.invoke({
        context: context || 'No relevant documents were found.',
        query: state.query,
      });
      
      // Convert the formatted prompt to a SystemMessage
      messages.push(new SystemMessage(formattedPrompt.toString()));
    }
    
    // Add context messages if this is a continuing conversation
    if (state.contextMessages && state.contextMessages.length > 0 && messages.length < 5) {
      // Only add context if we don't already have too many messages
      const maxContextMessages = 3; // Limit context to avoid token issues
      const recentContextMessages = state.contextMessages.slice(-maxContextMessages);
      
      console.log(`[RetrievalGraph] Adding ${recentContextMessages.length} context messages for response generation`);
      
      // Add context messages, preserving system prompt
      // const systemPrompt = messages[0]; // Commented out unused variable
      messages.splice(1, 0, ...recentContextMessages.map(msg => {
        if (msg.type === 'human' || msg.role === 'user') {
          return new HumanMessage(msg.content);
        } else {
          return new AIMessage(msg.content);
        }
      }));
    }
    
    console.log('[RetrievalGraph] Calling LLM for response generation');
    const response = await withTimeout(
      model.invoke(messages),
      60000, // Increased timeout for complex responses
      'response generation LLM call'
    );
    
    // Build source list for frontend visualization
    const sourceDocs = state.documents || [];
    console.log(`[RetrievalGraph] Returning ${sourceDocs.length} source documents with response`);
    
    // Create human message for the query
    const userMessage = new HumanMessage(state.query);
    
    // Update thread info if available
    let threadInfoUpdate = null;
    if (state.threadInfo) {
      threadInfoUpdate = {
        ...state.threadInfo,
        lastUpdated: Date.now(),
        messageCount: (state.threadInfo.messageCount || 0) + 2, // +1 for user message, +1 for response
      };
    }
    
    return {
      messages: [userMessage, response],
      documents: sourceDocs,
      threadInfo: threadInfoUpdate
    };
  } catch (error) {
    console.error('[RetrievalGraph] Error in generateResponse:', error);
    
    // Provide a fallback response when the LLM call fails
    const errorMessage = new AIMessage(
      "I'm sorry, I encountered an error while generating a response. Please try again or rephrase your question."
    );
    
    // Record the error for debugging
    const errorInfo = {
      message: error instanceof Error ? error.message : 'Unknown error in response generation',
      node: 'generateResponse',
      timestamp: Date.now()
    };
    
    return {
      messages: [new HumanMessage(state.query), errorMessage],
      error: errorInfo,
      // Keep any documents that were retrieved
      documents: state.documents || []
    };
  }
}

/**
 * Evaluates the quality of retrieved documents and decides whether to refine the query
 */
export async function evaluateRetrievalQuality(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<typeof AgentStateAnnotation.Update> {
  console.log('[RetrievalGraph] Running evaluation on retrieved documents');
  
  // Store the original documents and query for reference
  const documents = state.documents || [];
  const originalQuery = state.originalQuery || state.query;
  
  // Skip evaluation if no documents were found
  if (documents.length === 0) {
    console.log('[RetrievalGraph] No documents retrieved, quality score 0');
    return { 
      retrievalQuality: 0,
      originalQuery,
      refinementCount: (state.refinementCount || 0)
    };
  }
  
  try {
    const configuration = ensureAgentConfiguration(config);
    const model = await loadChatModel(configuration.queryModel);
    
    // Format documents for evaluation
    const formattedDocs = formatDocs(documents, false);
    
    // Create evaluation prompt
    const evaluationPrompt = `
You are evaluating the quality of document retrieval results for a query.

**Query:**
"${state.query}"

**Retrieved Documents:**
${formattedDocs}

Evaluate how well these documents satisfy the information need in the query. Consider:
1. Relevance - Do the documents address the specific topic in the query?
2. Comprehensiveness - Do they cover the main aspects of the query?
3. Specificity - Do they provide detailed information rather than general statements?

Output a JSON object with:
- "quality_score": A number from 0-10 (0=completely irrelevant, 10=perfect match)
- "reasoning": Brief explanation of your score
- "should_refine": Boolean indicating if query should be refined (true if score < 6)

Response should be valid JSON only.
`;
    
    // Call the model directly with the prompt
    console.log('[RetrievalGraph] Calling LLM for document quality evaluation');
    const evaluationResponse = await withTimeout(
      model.invoke(evaluationPrompt),
      30000,
      'retrieval quality evaluation'
    );
    
    // Extract JSON from the response text
    const responseText = evaluationResponse.content.toString();
    let evaluation;
    try {
      // Attempt to extract JSON object from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : '{}';
      evaluation = JSON.parse(jsonString);
      
      // Basic validation
      if (typeof evaluation.quality_score !== 'number') {
        evaluation.quality_score = 5; // Default middle score
      }
      if (typeof evaluation.should_refine !== 'boolean') {
        evaluation.should_refine = evaluation.quality_score < 6;
      }
    } catch (parseError) {
      console.error('[RetrievalGraph] Error parsing evaluation JSON:', parseError);
      // Fallback evaluation
      evaluation = {
        quality_score: 5,
        reasoning: "Error parsing evaluation response",
        should_refine: false
      };
    }
    
    console.log(`[RetrievalGraph] Evaluation result: score=${evaluation.quality_score}, should_refine=${evaluation.should_refine}`);
    console.log(`[RetrievalGraph] Reasoning: ${evaluation.reasoning}`);
    
    return { 
      retrievalQuality: evaluation.quality_score,
      originalQuery,
      refinementCount: (state.refinementCount || 0)
    };
  } catch (error) {
    console.error('[RetrievalGraph] Error in evaluateRetrievalQuality:', error);
    // In case of error, return a middle-ground score to continue processing
    return { 
      retrievalQuality: 5,
      originalQuery: state.originalQuery || state.query,
      refinementCount: (state.refinementCount || 0)
    };
  }
}

/**
 * Decides whether to proceed with generation or try to refine the query
 */
async function routeRetrievalResult(
  state: typeof AgentStateAnnotation.State,
): Promise<'generateResponse' | 'refineQuery'> {
  console.log('[RetrievalGraph] Routing based on retrieval quality');
  
  const qualityScore = state.retrievalQuality || 0;
  const refinementCount = state.refinementCount || 0;
  
  // If we've already refined twice, proceed anyway to avoid loops
  if (refinementCount >= 2) {
    console.log('[RetrievalGraph] Already refined twice, proceeding to response generation');
    return 'generateResponse';
  }
  
  // Check if quality is good enough
  if (qualityScore >= 6) {
    console.log('[RetrievalGraph] Retrieval quality sufficient, proceeding to response generation');
    return 'generateResponse';
  } else {
    console.log('[RetrievalGraph] Retrieval quality insufficient, refining query');
    return 'refineQuery';
  }
}

/**
 * Refines the query to improve retrieval results
 */
async function refineQuery(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<typeof AgentStateAnnotation.Update> {
  console.log('[RetrievalGraph] Refining query to improve retrieval');
  
  try {
    const configuration = ensureAgentConfiguration(config);
    const model = await loadChatModel(configuration.queryModel);
    
    const originalQuery = state.originalQuery || state.query;
    const queryToRefine = state.query; // Use the query that failed evaluation
    const currentDocs = state.documents || [];
    const refinementCount = (state.refinementCount || 0) + 1;
    
    // Format current documents for context
    const formattedDocs = formatDocs(currentDocs);
    
    // Create refinement prompt directly
    console.log('[RetrievalGraph] Generating refined query');
    const promptContent = `
You are a query refinement specialist. Your job is to reformulate the user's query to improve document retrieval results.

**Query Being Refined:**
${queryToRefine}

**Original First Query (for reference):**
${originalQuery}

**Current Retrieval Results (documents that failed evaluation):**
${formattedDocs}

**Refinement Count:** ${refinementCount}

**Instructions:**
1. Analyze why the current retrieval results might be inadequate for the "Query Being Refined".
2. Reformulate the "Query Being Refined" to be more specific, using synonyms or alternative phrasing.
3. If the "Query Being Refined" mentioned a document name, ensure it's preserved but try alternative formulations.
4. If this is the second refinement attempt or more, try a more dramatic reformulation.
5. Keep the refined query concise (1-2 sentences) and focused on the information need of the "Query Being Refined".
6. Output a JSON with:
   - "refined_query": The reformulated query
   - "reasoning": Brief explanation of your refinement strategy

Output only valid JSON.
`;
    
    // Call the model directly with the prompt
    const refinementResponse = await withTimeout(
      model.invoke(promptContent),
      30000,
      'query refinement'
    );
    
    // Extract JSON from the response text
    const responseText = refinementResponse.content.toString();
    let refinement;
    try {
      // Attempt to extract JSON object from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : '{}';
      refinement = JSON.parse(jsonString);
      
      // Basic validation
      if (!refinement.refined_query) {
        refinement.refined_query = `More information about ${originalQuery}`;
        refinement.reasoning = "Fallback refinement";
      }
    } catch (parseError) {
      console.error('[RetrievalGraph] Error parsing refinement JSON:', parseError);
      // Fallback refinement
      refinement = {
        refined_query: `detailed information about ${originalQuery}`,
        reasoning: "Error parsing refinement response"
      };
    }
    
    console.log(`[RetrievalGraph] Refined query: "${refinement.refined_query}"`);
    console.log(`[RetrievalGraph] Refinement reasoning: ${refinement.reasoning}`);
    
    return { 
      refinedQuery: refinement.refined_query,
      query: refinement.refined_query, // Update the main query
      refinementCount,
      previousDocuments: currentDocs
    };
  } catch (error) {
    console.error('[RetrievalGraph] Error in refineQuery:', error);
    // In case of error, make a simple refinement by adding "detailed information about"
    const fallbackQuery = `detailed information about ${state.query}`;
    return { 
      refinedQuery: fallbackQuery,
      query: fallbackQuery,
      refinementCount: (state.refinementCount || 0) + 1
    };
  }
}

/**
 * Initial setup node to initialize state based on config
 */
async function initializeState(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig
): Promise<typeof AgentStateAnnotation.Update> {
  console.log('[RetrievalGraph] Initializing state with config:', 
    config?.configurable ? 'Has configurable options' : 'No configurable options');
  
  // Initialize state updates
  const stateUpdates: Record<string, any> = {};
  
  // Initialize thread information if provided in config
  if (config?.configurable?.thread_id) {
    stateUpdates.threadInfo = {
      threadId: config.configurable.thread_id as string,
      lastUpdated: Date.now(),
      messageCount: 0,
    };
    console.log(`[RetrievalGraph] Initialized thread info with ID: ${config.configurable.thread_id}`);
  }
  
  // Store original query for reference if refinement is needed
  if (state.query && !state.originalQuery) {
    stateUpdates.originalQuery = state.query;
  }
  
  return stateUpdates;
}

async function resetRefinementCounterIfNeeded(
  state: typeof AgentStateAnnotation.State,
): Promise<typeof AgentStateAnnotation.Update> {
  // This node relies on 'new_explicit_filter_set' being correctly
  // passed through retrieveDocuments from extractQueryFilters.
  // We need to ensure retrieveDocuments adds this field to its return object.
  
  // For now, assume it IS passed correctly in the state update from retrieveDocuments
  // (We will modify retrieveDocuments next)
  const newFilterSet = (state as any).new_explicit_filter_set; // Use 'as any' for now

  if (newFilterSet === true) {
    console.log('[RetrievalGraph] New explicit document filter was set. Resetting refinement count.');
    return { refinementCount: 0 };
  } else {
    console.log('[RetrievalGraph] No new explicit filter set, keeping existing refinement count.');
    // Return empty update, refinement count remains as is
    return {}; 
  }
}

// Create the graph with more detailed logging
console.log('[RetrievalGraph] Defining retrieval graph...');
const builder = new StateGraph(
  AgentStateAnnotation,
  AgentConfigurationAnnotation,
)
  .addNode('initializeState', initializeState)
  .addNode('retrieveDocuments', retrieveDocuments)
  .addNode('resetRefinementCounter', resetRefinementCounterIfNeeded)
  .addNode('generateResponse', generateResponse)
  .addNode('checkQueryType', checkQueryType)
  .addNode('directAnswer', answerQueryDirectly)
  .addNode('evaluateRetrievalQuality', evaluateRetrievalQuality)
  .addNode('refineQuery', refineQuery)
  .addEdge(START, 'initializeState')
  .addEdge('initializeState', 'checkQueryType')
  .addConditionalEdges('checkQueryType', routeQuery, [
    'retrieveDocuments',
    'directAnswer',
  ])
  .addEdge('retrieveDocuments', 'resetRefinementCounter')
  .addEdge('resetRefinementCounter', 'evaluateRetrievalQuality')
  .addConditionalEdges(
    'evaluateRetrievalQuality', 
    routeRetrievalResult, 
    ['generateResponse', 'refineQuery']
  )
  .addEdge('refineQuery', 'retrieveDocuments')
  .addEdge('generateResponse', END)
  .addEdge('directAnswer', END);

console.log('[RetrievalGraph] Compiling retrieval graph...');

// Initialize the checkpointer
// const checkpointer = new PostgresSaver(pgConnection);
const checkpointer = new MemorySaver(); // Use MemorySaver temporarily

// console.log("[RetrievalGraph] Postgres checkpointer configured. Attempting setup...");
// try {
//   await checkpointer.setup(); // Ensure tables are created
//   console.log("[RetrievalGraph] Postgres checkpointer setup completed (or already done).");
// } catch (error) {
//   console.error("[RetrievalGraph] Error setting up Postgres checkpointer:", error);
//   // Decide how to handle setup failure - maybe throw or fallback
// }

console.log("[RetrievalGraph] Using MemorySaver for checkpointer (temporary).");

// Compile the graph - Ensure setup promise is handled if needed before first use,
// although compile itself might not strictly require it.
export const graph = builder.compile({
    checkpointer: checkpointer,
    // Optional: Define interrupt points if needed
    // interruptBefore: ['generateResponse'], 
}).withConfig({
  runName: 'RetrievalGraph'
});

console.log('[RetrievalGraph] Retrieval graph defined and ready');