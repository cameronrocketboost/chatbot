import { Annotation } from '@langchain/langgraph';
import { Document } from '@langchain/core/documents';

// Define the type for the input file payload
export type FilePayload = {
  filename: string;
  contentType: string;
  contentBase64: string;
};

/**
 * Represents the state for document indexing and retrieval.
 *
 * This interface defines the structure of the index state, which includes
 * the documents to be indexed and the retriever used for searching
 * these documents.
 */
export const IndexStateAnnotation = Annotation.Root({
  /**
   * The initial list of files uploaded by the user to be processed.
   */
  files: Annotation<FilePayload[]>({
      value: (_x, y) => y, // Default replace reducer
      default: () => [],
  }),
  /**
   * A list of documents that the agent can index.
   */
  docs: Annotation<Document[]>({ 
      value: (_x, y) => y, // Default replace reducer
      default: () => [],
  }),
  
  /**
   * Optional field for storing errors encountered during the process.
   */
  error: Annotation<string | null>({
      value: (_x, y) => y, // Default replace reducer
      default: () => null,
  }),
  
  /**
   * List of filenames skipped during processing (e.g., duplicates).
   */
  skippedFilenames: Annotation<string[]>({
      value: (_x, y) => (_x ?? []).concat(y ?? []), // Append reducer
      default: () => [],
  }),
  
  /**
   * Final status of the ingestion process.
   * Possible values: 'InProgress', 'CompletedSuccess', 'CompletedWithSkips', 'CompletedNoNewDocs', 'Failed'
   */
  finalStatus: Annotation<string>({
      value: (_x, y) => y, // Default replace reducer
      default: () => 'InProgress', // Default to InProgress
  }),
  
  /**
   * Current processing step for progress tracking.
   * Possible values: 'processFiles', 'ingestDocs'
   */
  processingStep: Annotation<string>({
      value: (_x, y) => y, // Default replace reducer
      default: () => '',
  }),
  
  /**
   * Currently processing file name (for UI feedback).
   */
  currentFile: Annotation<string | null>({
      value: (_x, y) => y, // Default replace reducer
      default: () => null,
  }),
  
  /**
   * Total number of files being processed.
   */
  totalFiles: Annotation<number>({
      value: (_x, y) => y, // Default replace reducer
      default: () => 0,
  }),
  
  /**
   * Number of files processed so far.
   */
  processedFiles: Annotation<number>({
      value: (_x, y) => y, // Default replace reducer
      default: () => 0,
  }),
});

export type IndexStateType = typeof IndexStateAnnotation.State;
