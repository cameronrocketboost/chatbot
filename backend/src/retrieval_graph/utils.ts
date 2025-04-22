import { Document } from '@langchain/core/documents';

// Helper to format a single document with potential suggestion prefix
function formatSingleDoc(doc: Document, index: number, isSuggestionContext: boolean = false): string {
  const metadata = doc.metadata || {};
  const sourceInfo = metadata.source ? ` source="${metadata.source}"` : '';
  const prefix = isSuggestionContext ? `Suggested Document ${index + 1} ` : '';
  
  // Basic metadata string (you might want to customize this further)
  const meta = Object.entries(metadata)
    .filter(([k]) => k !== 'source' && k !== 'retrieval' && k !== 'suggestedMatch' && k !== 'exactMatch') // Exclude some verbose/internal metadata
    .map(([k, v]) => ` ${k}=${JSON.stringify(v)}`) // Stringify values for safety
    .join('');
  const metaStr = meta ? ` ${meta}` : '';

  return `<document index="${index}"${sourceInfo}${metaStr}>\n${prefix}${doc.pageContent}\n</document>`;
}

// Updated formatDocs to handle the suggestion context flag
export function formatDocs(docs?: Document[], isSuggestionContext: boolean = false): string {
  /**Format a list of documents as XML, handling suggestions. */
  if (!docs || docs.length === 0) {
    return '<documents></documents>';
  }
  // Pass the isSuggestionContext flag to the single doc formatter
  const formatted = docs.map((doc, i) => formatSingleDoc(doc, i, isSuggestionContext)).join('\n');
  return `<documents>\n${formatted}\n</documents>`;
}
