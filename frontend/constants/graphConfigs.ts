import { AgentConfiguration, IndexConfiguration } from '@/types/graphTypes';

type StreamConfigurables = AgentConfiguration;
type IndexConfigurables = IndexConfiguration;

export const retrievalAssistantStreamConfig: StreamConfigurables = {
  queryModel: 'openai/gpt-4o-mini',
  retrieverProvider: 'supabase',
  k: 5,
  messageBatchSize: 10,
  maxConcurrency: 2,
  timeout: 60000,
  messageHistoryLength: 10,
  retrySettings: {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 5000,
    backoffFactor: 2
  }
};

/**
 * The configuration for the indexing/ingestion process.
 */
export const indexConfig: IndexConfigurables = {
  useSampleDocs: false,
  retrieverProvider: 'supabase',
  chunkSize: 1000,
  chunkOverlap: 200,
  timeout: 120000
};
