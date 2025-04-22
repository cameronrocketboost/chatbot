'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Trash2Icon, FileBoxIcon, HomeIcon, ChevronRight, FileText, Loader2, UploadCloud } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";
import { FilePreview } from '@/components/file-preview';
import { Input } from '@/components/ui/input';
import { UploadProgress } from '@/components/upload-progress';

// Interface matching the API response structure
interface SupabaseDocumentChunk {
  id: string; // Or number
  content: string;
  metadata: { [key: string]: any };
}

// Define expected polling response structure
interface IngestStatusResponse {
  status: 'running' | 'success' | 'failed' | 'canceled' | string;
  isComplete: boolean;
  finalStatus: string | null;
  processedFiles?: {
    success: number;
    skipped: number;
    skippedFiles: string[];
    total: number;
  };
  progress?: {
    percentComplete: number;
    currentStage: string;
    processingFile: string | null;
    estimatedTimeRemaining: string | null;
  } | null;
  error?: string | null;
  timing?: {
    startTime: string;
    endTime: string | null;
    durationMs: number | null;
  };
}

export default function DocumentsPage() {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<Record<string, SupabaseDocumentChunk[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceCount, setSourceCount] = useState(0);
  
  // File upload state
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [progressMinimized, setProgressMinimized] = useState(false);
  
  // State for tracking polling
  const [pollingRunId, setPollingRunId] = useState<string | null>(null);
  const [pollingThreadId, setPollingThreadId] = useState<string | null>(null);
  const [pollingProgress, setPollingProgress] = useState<IngestStatusResponse['progress']>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/documents');
      if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
      }
      const data = await response.json();
  
      // Check if data is an object (grouped documents)
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        // Data is already grouped by source
        setDocuments(data);
        setSourceCount(Object.keys(data).length);
      } else if (Array.isArray(data)) {
        // Handle array data (original behavior)
        const groupedDocuments: Record<string, SupabaseDocumentChunk[]> = {};
        let totalSources = 0;
    
        data.forEach((doc: SupabaseDocumentChunk) => {
          const source = doc.metadata?.source || 'Unknown Source';
          if (!groupedDocuments[source]) {
            groupedDocuments[source] = [];
            totalSources++;
          }
          groupedDocuments[source].push(doc);
        });
    
        setDocuments(groupedDocuments);
        setSourceCount(totalSources);
      } else {
        // Handle unexpected data format
        throw new Error('Unexpected data format received from API');
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Error fetching documents:', error);
      setError(error instanceof Error ? error.message : 'An error occurred');
      setLoading(false);
    }
  };

  const handleDeleteDocument = async (source: string) => {
    if (!confirm(`Are you sure you want to delete all chunks from '${source}'?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/documents/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename: source }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to delete document: ${response.statusText}`);
      }

      const result = await response.json();
      toast({
        title: 'Document Deleted',
        description: result.message,
        variant: 'default',
      });

      // Refresh the document list
      fetchDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete document',
        variant: 'destructive',
      });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];

    console.log('[handleFileSelect] Validating selected files:', selectedFiles.map(f => ({name: f.name, type: f.type})) );
    console.log('[handleFileSelect] Allowed types:', allowedTypes);

    const invalidFiles = selectedFiles.filter((file) => {
      const isAllowed = allowedTypes.includes(file.type);
      console.log(`[handleFileSelect] Checking file: ${file.name}, Type: ${file.type}, Allowed: ${isAllowed}`);
      return !isAllowed;
    });

    if (invalidFiles.length > 0) {
      console.error('[handleFileSelect] Invalid file type detected:', invalidFiles.map(f=>f.type));
      toast({
        title: 'Invalid file type',
        description: `Please upload only PDF, DOCX, or PPTX files. Invalid file(s): ${invalidFiles.map((f) => f.name).join(', ')}`,
        variant: 'destructive',
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    if (files.length + selectedFiles.length > 5) {
      toast({
        title: 'File limit exceeded',
        description: 'You can upload a maximum of 5 files.',
        variant: 'destructive',
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    const oversizedFiles = selectedFiles.filter(
      (file) => file.size > 50 * 1024 * 1024,
    );

    if (oversizedFiles.length > 0) {
      toast({
        title: 'File size exceeded',
        description: `The following files are larger than 50MB: ${oversizedFiles.map((f) => f.name).join(', ')}`,
        variant: 'destructive',
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    setFiles((prev) => {
        const existingNames = new Set(prev.map(f => f.name));
        const uniqueNewFiles = selectedFiles.filter(f => !existingNames.has(f.name));
        return [...prev, ...uniqueNewFiles];
    });

    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (fileNameToRemove: string) => {
    setFiles(files.filter((file) => file.name !== fileNameToRemove));
    toast({
      title: 'File removed',
      description: `${fileNameToRemove} has been removed from the list.`,
      variant: 'default',
    });
  };

  // Define stopPolling FIRST
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      console.log('[stopPolling] Stopping polling.');
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      setPollingRunId(null);
      setPollingThreadId(null);
    }
  }, []); // No dependencies needed here

  // Define pollIngestionStatus SECOND (now it can safely depend on stopPolling)
  const pollIngestionStatus = useCallback(async (currentRunId: string, currentThreadId: string) => {
    console.log(`[pollIngestionStatus] Polling for runId: ${currentRunId}`);
    try {
      const response = await fetch(`/api/ingest/status/${currentThreadId}/${currentRunId}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`[pollIngestionStatus] Polling failed with status ${response.status}:`, errorData?.error || 'Unknown error');
        stopPolling(); // Use stopPolling
        setIsProcessing(false);
        toast({
          title: 'Ingestion Status Error',
          description: `Could not get status for run ${currentRunId}: ${errorData?.error || response.statusText}`,
          variant: 'destructive',
        });
        return; 
      }

      const data: IngestStatusResponse = await response.json();
      console.log('[pollIngestionStatus] Received status:', data);

      // Update the progress information if available
      if (data.progress) {
        setPollingProgress(data.progress);
      }

      if (data.isComplete) {
        stopPolling(); // Use stopPolling
        setIsProcessing(false);
        setPollingProgress(null); // Clear progress when complete
        
        // Use the new response format
        const finalStatus = data.finalStatus;
        const processedFiles = data.processedFiles || { success: 0, skipped: 0, skippedFiles: [], total: 0 };
        const skippedFiles = processedFiles.skippedFiles || [];
        const successCount = processedFiles.success || 0;
        const backendError = data.error;

        if (data.status === 'success' && finalStatus === 'CompletedSuccess') {
          toast({
            title: 'Ingestion Complete',
            description: `Successfully processed ${successCount} document(s).`,
            variant: 'default',
          });
          setFiles([]); 
          fetchDocuments(); // Refresh documents
        } else if (data.status === 'success' && finalStatus === 'CompletedWithSkips') {
          toast({
            title: 'Ingestion Complete (with skips)',
            description: `Processing finished. Added ${successCount} document(s). Skipped ${skippedFiles.length} duplicate file(s): ${skippedFiles.join(', ')}`,
            variant: 'default',
          });
          setFiles([]); 
          fetchDocuments(); // Refresh documents
        } else if (data.status === 'success' && finalStatus === 'CompletedNoNewDocs') {
          toast({
            title: 'Ingestion Complete',
            description: 'No new documents were added (files might be empty or unsupported after parsing).'
          });
          setFiles([]); 
        } else if (finalStatus === 'Failed' || data.status === 'failed') {
          toast({
            title: 'Ingestion Failed',
            description: backendError || 'An unknown error occurred during processing.',
            variant: 'destructive',
          });
        } else if (data.status === 'canceled') {
          toast({
            title: 'Ingestion Canceled',
            description: 'The document processing was canceled.',
            variant: 'default',
          });
        } else {
          // Completed with some other status
          toast({
            title: 'Ingestion Complete',
            description: `Processing completed with status: ${finalStatus || 'Unknown'}`,
            variant: 'default',
          });
          setFiles([]);
          fetchDocuments(); // Refresh documents
        }
      } else {
        // For running processes, can optionally show progress if available
        console.log(`[pollIngestionStatus] Run ${currentRunId} is still running.`);
      }

    } catch (error) {
      console.error('[pollIngestionStatus] Error during polling fetch:', error);
      stopPolling(); // Use stopPolling
      setIsProcessing(false);
      toast({
        title: 'Polling Error',
        description: 'An error occurred while checking file processing status.',
        variant: 'destructive',
      });
    }
  }, [stopPolling, toast, fetchDocuments]); 

  // Define startPolling THIRD (depends on stopPolling and pollIngestionStatus)
  const startPolling = useCallback((runId: string, threadId: string) => {
    stopPolling(); 
    setPollingRunId(runId);
    setPollingThreadId(threadId);
    console.log(`[startPolling] Starting polling for runId: ${runId}, threadId: ${threadId}`);
    pollIngestionStatus(runId, threadId);
    pollingIntervalRef.current = setInterval(() => {
      pollIngestionStatus(runId, threadId);
    }, 5000); 
  }, [pollIngestionStatus, stopPolling]);

  // Cleanup polling on unmount (depends on stopPolling)
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const handleProcessFiles = async () => {
    if (files.length === 0) {
      toast({ title: 'No Files Selected', description: 'Please select files to process.', variant: 'default' });
      return;
    }
    if (isProcessing || pollingRunId) { 
        toast({ title: "Processing", description: "Already processing previous files.", variant: "default" });
        return;
    }

    setIsProcessing(true);
    toast({ title: 'Processing Files', description: `Starting processing for ${files.length} file(s)...`, variant: 'default' });

    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });

    try {
      const response = await fetch('/api/ingest', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to process files.' }));
        throw new Error(errorData.error || 'Failed to process files.');
      }

      const result = await response.json();
      toast({ title: 'Processing Started', description: result.message || 'File processing initiated successfully!', variant: 'default' });
      
      // --- Integration with Polling --- 
      const runId = result.runId;
      const resultThreadId = result.threadId;
      if (runId && resultThreadId) {
          console.log(`[handleProcessFiles] Ingestion run started. RunId: ${runId}, ThreadId: ${resultThreadId}`);
          startPolling(runId, resultThreadId); // Start polling 
      } else {
          setIsProcessing(false);
          throw new Error('Backend did not return run/thread ID needed for status check.');
      }
      // --- End Polling Integration --- 

    } catch (error: any) {
      console.error('Error processing files:', error);
      toast({ title: 'Processing Error', description: `Error processing files: ${error.message}`, variant: 'destructive' });
      setProcessingError(error.message || 'Unknown error occurred');
      setIsProcessing(false);
      stopPolling();
    } 
  };

  // Function to handle upload progress minimize event
  const handleProgressMinimize = (minimized: boolean) => {
    setProgressMinimized(minimized);
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-1/3 mb-6" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4 text-red-700">
          <p className="text-lg font-medium">Error</p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">
                <HomeIcon className="h-4 w-4 mr-1" />
                Home
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Documents</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* File Upload Section */}
      <div className="mb-10 bg-white border border-sladen-navy/10 rounded-lg shadow-sm">
        <div className="p-6 border-b border-sladen-navy/10 bg-sladen-navy/5">
          <h1 className="text-2xl font-bold text-sladen-navy flex items-center">
            <UploadCloud className="h-6 w-6 mr-2 text-sladen-teal" /> 
            Upload Documents
          </h1>
          <p className="text-sladen-navy/70 mt-1">Add new documents to your knowledge base</p>
        </div>
        
        <div className="p-6">
          <div className="mb-6">
            <input
              type="file"
              id="file-upload"
              ref={fileInputRef}
              className="hidden"
              onChange={handleFileSelect}
              multiple
              accept=".pdf,.docx,.pptx"
            />
            
            <div 
              className="border-2 border-dashed border-sladen-navy/30 rounded-lg p-10 text-center cursor-pointer hover:border-sladen-teal transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="flex flex-col items-center">
                <FileText className="h-12 w-12 text-sladen-teal mb-3" />
                <p className="text-sladen-navy font-medium mb-1">Drag files here or click to browse</p>
                <p className="text-sm text-sladen-navy/60">PDF, DOCX, PPTX (Max 5 files, 50MB each)</p>
              </div>
            </div>
          </div>

          {files.length > 0 && (
            <div className="space-y-4">
              <FilePreview 
                files={files} 
                onRemove={handleRemoveFile} 
              />
              
              <Button 
                onClick={handleProcessFiles}
                disabled={isProcessing || pollingRunId !== null || files.length === 0}
                className="w-full bg-sladen-teal hover:bg-sladen-navy text-white"
              >
                {isProcessing || pollingRunId ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <UploadCloud className="mr-2 h-4 w-4" />
                    Process {files.length} {files.length === 1 ? 'File' : 'Files'}
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Document List */}
      <div className="pb-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
          <FileBoxIcon className="mr-2 h-5 w-5 text-sladen-red" />
          Available Documents <span className="ml-2 text-sm font-normal text-sladen-navy/60">({sourceCount} sources)</span>
        </h2>

        {Object.keys(documents).length === 0 ? (
          <div className="text-center p-10 bg-white rounded-lg border border-sladen-navy/10 shadow-sm">
            <FileBoxIcon className="h-12 w-12 mx-auto text-sladen-navy/30 mb-3" />
            <h3 className="text-lg font-medium text-sladen-navy mb-2">No documents yet</h3>
            <p className="text-sladen-navy/60 mb-6">Upload files above to add documents to your knowledge base</p>
          </div>
        ) : (
          <Accordion type="multiple" className="space-y-2">
            {Object.entries(documents).map(([source, chunks]) => (
              <AccordionItem 
                key={source} 
                value={source}
                className="bg-white border border-sladen-navy/10 rounded-lg shadow-sm overflow-hidden"
              >
                <div className="flex items-start justify-between p-4">
                  <AccordionTrigger className="flex-1 hover:no-underline">
                    <div className="flex items-center">
                      <FileBoxIcon className="h-4 w-4 mr-2 text-sladen-teal flex-shrink-0" />
                      <div className="text-left">
                        <div className="font-medium text-sladen-navy">{source}</div>
                        <div className="text-xs text-sladen-navy/60">{chunks.length} chunks</div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-2 text-sladen-navy/40 hover:text-sladen-red hover:bg-sladen-red/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteDocument(source);
                    }}
                  >
                    <Trash2Icon className="h-4 w-4" />
                  </Button>
                </div>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-4">
                    {chunks.map((chunk, index) => (
                      <Card key={chunk.id} className="border border-sladen-navy/10">
                        <CardHeader className="p-3 pb-0">
                          <CardTitle className="text-sm font-medium flex items-center">
                            <div 
                              className="flex items-center justify-center h-5 w-5 rounded-full bg-sladen-navy/10 text-sladen-navy text-xs mr-2"
                            >
                              {index + 1}
                            </div>
                            Chunk {index + 1}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-3 pt-2">
                          <div className="text-sm text-sladen-navy/80 whitespace-pre-wrap line-clamp-4">
                            {chunk.content}
                          </div>
                          
                          <Accordion 
                            type="single" 
                            collapsible 
                            className="mt-2"
                          >
                            <AccordionItem value="metadata" className="border-b-0">
                              <AccordionTrigger className="text-xs px-0 py-1 text-sladen-navy/60 hover:text-sladen-teal hover:no-underline">
                                <span className="flex items-center">
                                  <ChevronRight className="h-3 w-3 mr-1 transform transition-transform" />
                                  <span>View Metadata</span>
                                </span>
                              </AccordionTrigger>
                              <AccordionContent className="text-xs px-0 py-2">
                                <div className="space-y-3 text-sladen-navy/70 w-full">
                                  {/* Source & File Info */}
                                  {chunk.metadata?.source && (
                                    <div className="space-y-2 w-full">
                                      <div className="flex items-center">
                                        <span className="bg-sladen-teal/10 text-sladen-teal text-[10px] font-medium px-2 py-0.5 rounded uppercase tracking-wider">
                                          Source
                                        </span>
                                      </div>
                                      <div className="flex items-start pl-2 w-full">
                                        <span className="font-semibold text-sladen-navy truncate">
                                          {chunk.metadata.source}
                                        </span>
                                      </div>
                                      
                                      <div className="flex flex-wrap gap-2 pl-2 w-full">
                                        {chunk.metadata.fileSize && (
                                          <span className="inline-flex items-center bg-sladen-navy/5 px-2 py-0.5 rounded text-[10px]">
                                            <span className="text-sladen-navy/50 mr-1">Size:</span>
                                            <span className="font-medium text-sladen-navy">
                                              {(chunk.metadata.fileSize / (1024 * 1024)).toFixed(2)} MB
                                            </span>
                                          </span>
                                        )}
                                        
                                        {chunk.metadata.contentType && (
                                          <span className="inline-flex items-center bg-sladen-navy/5 px-2 py-0.5 rounded text-[10px]">
                                            <span className="text-sladen-navy/50 mr-1">Type:</span>
                                            <span className="font-medium text-sladen-navy">
                                              {(() => {
                                                // Convert content type to user-friendly format name
                                                const contentType = chunk.metadata.contentType.toLowerCase();
                                                if (contentType.includes('pdf')) return 'PDF';
                                                if (contentType.includes('wordprocessingml')) return 'DOCX';
                                                if (contentType.includes('presentationml')) return 'PPTX';
                                                if (contentType.includes('spreadsheetml')) return 'XLSX';
                                                // Fallback to simple format extraction
                                                return contentType.split('/')[1]?.toUpperCase() || contentType;
                                              })()}
                                            </span>
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  
                                  {/* Chunk Position Info */}
                                  {(chunk.metadata?.chunkIndex !== undefined || chunk.metadata?.totalChunks) && (
                                    <div className="space-y-2 w-full">
                                      <div className="flex items-center">
                                        <span className="bg-sladen-red/10 text-sladen-red text-[10px] font-medium px-2 py-0.5 rounded uppercase tracking-wider">
                                          Position
                                        </span>
                                      </div>
                                      <div className="flex flex-wrap gap-2 pl-2 w-full">
                                        {chunk.metadata.chunkIndex !== undefined && (
                                          <span className="inline-flex items-center bg-sladen-navy/5 px-2 py-0.5 rounded text-[10px]">
                                            <span className="text-sladen-navy/50 mr-1">Chunk:</span>
                                            <span className="font-medium text-sladen-navy">
                                              {chunk.metadata.chunkIndex + 1} of {chunk.metadata.totalChunks || '?'}
                                            </span>
                                          </span>
                                        )}
                                        
                                        {chunk.metadata.loc && (
                                          <span className="inline-flex items-center bg-sladen-navy/5 px-2 py-0.5 rounded text-[10px]">
                                            <span className="text-sladen-navy/50 mr-1">Range:</span>
                                            <span className="font-medium text-sladen-navy">
                                              {typeof chunk.metadata.loc === 'object' 
                                                ? (() => {
                                                    // Handle different loc object formats
                                                    if (chunk.metadata.loc.lines) {
                                                      return `Lines ${chunk.metadata.loc.lines.from}-${chunk.metadata.loc.lines.to}`;
                                                    } else if (chunk.metadata.loc.from !== undefined && chunk.metadata.loc.to !== undefined) {
                                                      return `Lines ${chunk.metadata.loc.from}-${chunk.metadata.loc.to}`;
                                                    } else {
                                                      return JSON.stringify(chunk.metadata.loc);
                                                    }
                                                  })()
                                                : chunk.metadata.loc}
                                            </span>
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  
                                  {/* Timestamp Info */}
                                  {chunk.metadata?.parsedAt && (
                                    <div className="space-y-2 w-full">
                                      <div className="flex items-center">
                                        <span className="bg-sladen-navy/10 text-sladen-navy text-[10px] font-medium px-2 py-0.5 rounded uppercase tracking-wider">
                                          Timestamp
                                        </span>
                                      </div>
                                      <div className="flex flex-wrap gap-2 pl-2">
                                        <span className="inline-flex items-center bg-sladen-navy/5 px-2 py-0.5 rounded text-[10px]">
                                          <span className="text-sladen-navy/50 mr-1">Parsed:</span>
                                          <span className="font-medium text-sladen-navy">
                                            {new Date(chunk.metadata.parsedAt).toLocaleString()}
                                          </span>
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                  
                                  {/* Other Metadata */}
                                  {(() => {
                                    const standardKeys = ['source', 'fileSize', 'contentType', 'chunkIndex', 'totalChunks', 'loc', 'parsedAt'];
                                    const otherMetadata = Object.entries(chunk.metadata || {})
                                      .filter(([key]) => !standardKeys.includes(key) && !key.startsWith('_'));
                                    
                                    if (otherMetadata.length === 0) return null;
                                    
                                    return (
                                      <div className="space-y-2">
                                        <Accordion type="single" collapsible className="w-full">
                                          <AccordionItem value="other-metadata" className="border-0">
                                            <AccordionTrigger className="p-0 py-1 hover:no-underline">
                                              <span className="bg-slate-200 text-slate-700 text-[10px] font-medium px-2 py-0.5 rounded uppercase tracking-wider">
                                                Other Metadata
                                              </span>
                                            </AccordionTrigger>
                                            <AccordionContent className="pt-2 pb-0">
                                              <div className="grid grid-cols-3 gap-x-4 gap-y-2 pl-2">
                                                {otherMetadata.map(([key, value]) => (
                                                  <div key={key} className="flex flex-col">
                                                    <span className="text-sladen-navy/50 text-[10px]">{key}:</span>
                                                    <span className="font-medium text-sladen-navy text-[11px] break-words overflow-hidden max-h-12">
                                                      {typeof value === 'object'
                                                        ? (function() {
                                                            try {
                                                              // Format JSON objects nicely
                                                              const stringValue = JSON.stringify(value, null, 2);
                                                              return stringValue.length > 50 
                                                                ? stringValue.substring(0, 50) + '...' 
                                                                : stringValue;
                                                            } catch (e) {
                                                              return String(value);
                                                            }
                                                          })()
                                                        : String(value)}
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                            </AccordionContent>
                                          </AccordionItem>
                                        </Accordion>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          </Accordion>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>

      {/* Upload Progress component */}
      {(isProcessing || pollingRunId) && pollingProgress && (
        <UploadProgress
          progress={pollingProgress}
          minimized={progressMinimized}
          onMinimize={handleProgressMinimize}
          error={processingError}
        />
      )}
    </div>
  );
} 