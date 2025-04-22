import { Document } from '@langchain/core/documents';

/**
 * Represents the state of the retrieval graph / agent.
 */
export type documentType =
  | PDFDocument[]
  | { [key: string]: any }[]
  | string[]
  | string
  | 'delete';
export interface AgentState {
  query?: string;
  route?: string;
  messages: Array<{
    content: string;
    additional_kwargs: Record<string, any>;
    response_metadata: Record<string, any>;
    id: string;
    type: 'human' | 'assistant';
  }>;
  documents: documentType;
}

export interface RetrieveDocumentsNodeUpdates {
  retrieveDocuments: {
    documents: documentType;
  };
}

export interface RetrievalMetadata {
  // Basic retrieval information
  retrievalStrategy?: 'hybrid' | 'semantic' | 'powerpoint' | 'standard';
  retrievalFilters?: {
    contentType?: string;
    source?: string;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
  };
  // Document structure information
  chunkIndex?: number;
  totalChunks?: number;
  isFirstChunk?: boolean;
  isLastChunk?: boolean;
  contentType?: string;
  fileSize?: number;
  parsedAt?: string;
  // Ranking information
  similarityScore?: number;
  keywordMatchScore?: number;
  isPartOfGroup?: boolean;
  groupId?: string;
  groupPosition?: number;
}

export type PDFDocument = Document & {
  metadata?: {
    loc?: {
      lines?: {
        from: number;
        to: number;
      };
      pageNumber?: number;
    };
    pdf?: {
      info?: {
        Title?: string;
        Creator?: string;
        Producer?: string;
        CreationDate?: string;
        IsXFAPresent?: boolean;
        PDFFormatVersion?: string;
        IsAcroFormPresent?: boolean;
      };
      version?: string;
      metadata?: any;
      totalPages?: number;
    };
    uuid?: string;
    source?: string;
    // Enhanced retrieval metadata
    contentType?: string;
    fileSize?: number;
    parsedAt?: string;
    chunkIndex?: number;
    totalChunks?: number;
    isFirstChunk?: boolean;
    isLastChunk?: boolean;
    similarityScore?: number;
    keywordMatchScore?: number;
    isPartOfGroup?: boolean;
    groupId?: string;
    groupPosition?: number;
    retrieval?: RetrievalMetadata;
  };
};

export interface RetrySettings {
  /**
   * Maximum number of retry attempts
   */
  maxRetries: number;
  
  /**
   * Initial delay in milliseconds
   */
  initialDelayMs: number;
  
  /**
   * Maximum delay in milliseconds
   */
  maxDelayMs: number;
  
  /**
   * Backoff factor for exponential backoff
   */
  backoffFactor: number;
}

export interface BaseConfiguration {
  /**
   * The vector store provider to use for retrieval.
   * @default 'supabase'
   */
  retrieverProvider?: 'supabase';

  /**
   * Additional keyword arguments to pass to the search function of the retriever for filtering.
   * @default {}
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filterKwargs?: Record<string, any>;

  /**
   * The number of documents to retrieve.
   * @default 5
   */
  k?: number;
  
  /**
   * Timeout in milliseconds
   * @default 30000
   */
  timeout?: number;
}

export interface AgentConfiguration extends BaseConfiguration {
  // models
  /**
   * The language model used for processing and refining queries.
   * Should be in the form: provider/model-name.
   */
  queryModel?: string;
  
  /**
   * Number of messages to process in a batch
   * @default 5
   */
  messageBatchSize?: number;
  
  /**
   * Maximum number of concurrent operations
   * @default 1
   */
  maxConcurrency?: number;
  
  /**
   * Number of messages to keep in history
   * @default 10
   */
  messageHistoryLength?: number;
  
  /**
   * Settings for automatic retries
   */
  retrySettings?: RetrySettings;
}

export interface IndexConfiguration extends BaseConfiguration {
  /**
   * Path to a JSON file containing default documents to index.
   */
  docsFile?: string;

  /**
   * Whether to use sample documents for indexing.
   */
  useSampleDocs?: boolean;
  
  /**
   * Default size for document chunks
   * @default 1000
   */
  chunkSize?: number;
  
  /**
   * Overlap between adjacent chunks
   * @default 200
   */
  chunkOverlap?: number;
}
