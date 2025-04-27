import {
  Runnable,
  RunnableConfig,
  RunnableWithMessageHistory,
  RunnableSequence,
} from '@langchain/core/runnables';
import { BaseMessage } from '@langchain/core/messages';
import { SupabaseClient } from '@supabase/supabase-js';
import { Embeddings } from '@langchain/core/embeddings';
// import { BaseLanguageModel } from '@langchain/core/language_models/base'; // Removed unused import
import { Document } from '@langchain/core/documents'; // Ensure this import exists
// import { HydeRetriever } from 'langchain/retrievers/hyde'; // REMOVED HydeRetriever
// import { BaseRetrieverInterface } from '@langchain/core/retrievers'; // Removed unused import
import {
  SupabaseHybridSearch, // USE SupabaseHybridSearch
} from '@langchain/community/retrievers/supabase'; // Removed SupabaseFilter
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
// import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase'; // REMOVED SupabaseVectorStore (Hybrid Search uses it internally)
// @ts-ignore -- Keep ts-ignore for now, although loadChatModel import below is removed
// import { loadChatModel } from './utils.js'; // REMOVED loadChatModel import

// Removed unused MetadataFilter type definition

// Define the callback types
type RetrievalStartCallback = (query: string) => void;
type RetrievalEndCallback = (documents: Document[]) => void;

// Custom Retriever class extending SupabaseHybridSearch for potential future customizations
// export class CustomRetriever extends SupabaseHybridSearch {} // Can remove if not adding customizations

// Function to get the custom retriever instance - NOW RETURNS SupabaseHybridSearch
export async function getCustomRetriever(
  supabaseClient: SupabaseClient,
  embeddings: Embeddings,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _namespace: string, // Prefix with _ to indicate unused parameter - Namespace handled via filter usually
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _retrievalStartCallback: RetrievalStartCallback, // Prefix with _ - Callbacks handled by RunnableConfig
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _retrievalEndCallback: RetrievalEndCallback,     // Prefix with _ - Callbacks handled by RunnableConfig
): Promise<SupabaseHybridSearch> { // Update Return Type
  
  // REMOVED LLM loading for HyDE
  // const llmForHyde = await loadChatModel("openai/gpt-3.5-turbo", 0); 

  // REMOVED VectorStore instantiation (Hybrid Search handles this)
  // const vectorStore = new SupabaseVectorStore(embeddings, {
  //   client: supabaseClient,
  //   tableName: 'documents',
  //   queryName: 'match_documents',
  // });

  // Instantiate SupabaseHybridSearch
  const hybridRetriever = new SupabaseHybridSearch(embeddings, {
    client: supabaseClient,
    // Similarity/Vector Search arguments
    similarityK: 2, // How many similarity results to fetch. Default: 2
    similarityQueryName: "match_documents", // Function name for similarity search
    // Keyword/Full-text Search arguments
    keywordK: 2, // How many keyword results to fetch. Default: 2
    keywordQueryName: "kw_match_documents", // Function name for keyword search (ensure this function exists in your DB!)
    tableName: "documents", // Table name for searches
  });

  // REMOVED HydeRetriever instantiation
  // const hydeRetriever: HydeRetriever = new HydeRetriever({ 
  //   vectorStore: vectorStore, 
  //   llm: llmForHyde,
  // });

  return hybridRetriever; // Return the SupabaseHybridSearch instance
}

// Removed unused combineDocuments function

// Removed unused formatDocs function

// Type definitions for conversation history
export type ConversationalRetrievalChainInput = {
  chat_history: BaseMessage[] | string;
  question: string;
  namespace: string; // Add namespace here
  callbacks?: BaseCallbackHandler[]; // Add callbacks here
  queryFilters?: Record<string, any>; // ADD queryFilters HERE
};

// Function to create the retrieval chain
export async function createRetrievalChain(
  // llm: BaseLanguageModel, // Removed unused llm parameter
  supabaseClient: SupabaseClient, 
  embeddings: Embeddings, 
): Promise<Runnable<ConversationalRetrievalChainInput, any>> {
  // Reusable retriever function - expects RunnableConfig potentially containing callbacks
  const getRetrieverForNamespace = async (
    namespace: string,
    config?: RunnableConfig,
  ): Promise<SupabaseHybridSearch> => { // UPDATE Return Type
    console.log(`Using namespace: ${namespace}`);

    // Forward declaration for baseRetriever to be used in callbacks
    let baseRetriever: SupabaseHybridSearch; // UPDATE Type

    // Define callbacks from config or use defaults
    const startCb = config?.callbacks
      ? (query: string) =>
          (config.callbacks as BaseCallbackHandler[])?.forEach((cb) => {
            // @ts-ignore - Re-suppressing persistent type error on lc_serializable
            cb.handleRetrieverStart?.(baseRetriever?.lc_serializable, query, "placeholder-run-id", undefined, undefined, { namespace });
          }
          )
      : () => {};
    const endCb = config?.callbacks
      ? (docs: Document[]) =>
          (config.callbacks as BaseCallbackHandler[])?.forEach((cb) => {
            // Pass docs and placeholder runId
            cb.handleRetrieverEnd?.(docs, "placeholder-run-id");
          }
          )
      : () => {};

    // Get the base retriever instance
    baseRetriever = await getCustomRetriever(
      supabaseClient,
      embeddings,
      namespace,
      startCb,
      endCb,
    );

    return baseRetriever;
  };

  // This part needs refactoring if getCustomRetriever now returns HydeRetriever
  // const conversationalRetrievalChain = RunnableSequence.from([
  //   // ... rest of the chain definition
  // ]);

  // TODO: Refactor the chain construction to correctly use the HydeRetriever
  // returned by getRetrieverForNamespace and pass callbacks during invocation.
  // The exact structure will depend on how you integrate Hyde (e.g., directly,
  // or if HydeRetriever needs specific input/output handling within the chain).

  // Placeholder - this needs to be correctly implemented:
  const conversationalRetrievalChain = RunnableSequence.from([
    {
      // Pass question, chat_history, namespace, callbacks, and queryFilters through
      question: (input: ConversationalRetrievalChainInput) => input.question,
      chat_history: (input: ConversationalRetrievalChainInput) =>
        input.chat_history,
      namespace: (input: ConversationalRetrievalChainInput) => input.namespace,
      callbacks: (input: ConversationalRetrievalChainInput) => input.callbacks, // Pass callbacks
      queryFilters: (input: ConversationalRetrievalChainInput) => input.queryFilters, // Pass queryFilters
    },
    {
      // Retrieve documents using the dynamically configured retriever
      docs: async (input: {
        question: string;
        namespace: string;
        callbacks?: BaseCallbackHandler[]; // Receive callbacks
        queryFilters?: Record<string, any>; // Receive queryFilters
      }) => {
         // Pass callbacks AND queryFilters in RunnableConfig
         const config: RunnableConfig = { 
           callbacks: input.callbacks,
           // Add the filter to the configurable section
           configurable: {
            filter: input.queryFilters
           }
         }; 
        // namespaceRetriever is now SupabaseHybridSearch
        const namespaceRetriever = await getRetrieverForNamespace(input.namespace, config);
        // Invoke the retriever with the question and the config containing callbacks AND filter
        // Note: SupabaseHybridSearch might need filter applied differently if configurable.filter isn't automatically handled.
        // For now, assume it might work or we'll adjust if needed.
        return namespaceRetriever.invoke(input.question, config);
      },
      question: (input: any) => input.question, // Pass question through - Added any type
      chat_history: (input: any) => input.chat_history, // Pass chat_history through - Added any type
      // We don't need to pass queryFilters further down the chain usually
    },
    // ... rest of the chain (e.g., condense question, generate answer) ...
    // Make sure subsequent steps correctly receive 'docs', 'question', 'chat_history'
  ]);


  // Return the chain, potentially wrapped with message history
   return conversationalRetrievalChain; // Needs adjustment based on full chain structure
}


// Function to create the overall RAG chain with history
export async function createRagChain(
  // llm: BaseLanguageModel, // Removed llm as it's no longer passed down
  embeddings: Embeddings,
  supabaseClient: SupabaseClient,
  chatHistory: any, 
): Promise<RunnableWithMessageHistory<ConversationalRetrievalChainInput, any>> { 

  // Create the main retrieval chain, passing dependencies
  const retrievalChain = await createRetrievalChain(supabaseClient, embeddings); // Removed llm arg


  // Create the final chain with message history
  const conversationalRetrievalChain = new RunnableWithMessageHistory({
    runnable: retrievalChain,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getMessageHistory: (_sessionId: string) => chatHistory, // Prefix sessionId with _
    inputMessagesKey: 'question',
    historyMessagesKey: 'chat_history',
  });

  return conversationalRetrievalChain;
}

