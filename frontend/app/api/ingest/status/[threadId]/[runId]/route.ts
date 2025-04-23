import { NextRequest, NextResponse } from 'next/server';
import { langGraphServerClient } from '@/lib/langgraph-server';

// Add cache control headers to prevent Next.js from caching large responses
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * Calculates an estimated progress percentage based on run state information
 */
function calculateProgress(runState: any, threadValues?: Record<string, any>): number {
  // Default progress for different states
  if (runState.status === 'success') return 100;
  if (runState.status === 'failed') return 100;
  if (runState.status === 'pending') return 0;
  
  // For running state, try to estimate progress from state values
  if (runState.status === 'running') {
    // If the thread includes processing step info
    if (threadValues?.processingStep) {
      switch (threadValues.processingStep) {
        case 'ingestDocs': {
          // For storing embeddings, start at 75% and gradually increase
          const timeInEmbedding = getElapsedTime(runState.created_at);
          // Assume embedding takes about 30 seconds, increase from 75% to 95% during this time
          return Math.min(95, 75 + Math.min(20, (timeInEmbedding / 30000) * 20));
        }
        
        case 'processFiles': {
          // If we have file processing details
          const totalFiles = threadValues.totalFiles || 1;
          const processedFiles = threadValues.processedFiles || 0;
          
          if (processedFiles === 0) {
            // Just started, give a small percentage based on elapsed time
            const elapsed = getElapsedTime(runState.created_at);
            return Math.min(10, Math.max(1, (elapsed / 1000))); // 1% per second up to 10%
          }
          
          // Calculate file-based progress, but weight it to show faster initial progress
          // This makes the UX feel more responsive
          const fileProgress = (processedFiles / totalFiles);
          
          // Weight the progress calculation to show faster initial progress
          // Square root provides a nice curve that moves quickly at first then slows down
          return Math.min(75, Math.round(Math.sqrt(fileProgress) * 70));
        }
        default: {
          // Time-based fallback for unknown processing step
          const elapsed = getElapsedTime(runState.created_at);
          const estimatedTotalTime = 60 * 1000; // Assume 1 minute total time
          return Math.min(75, Math.round((elapsed / estimatedTotalTime) * 70));
        }
      }
    }
    
    // Time-based estimate as fallback
    const elapsed = getElapsedTime(runState.created_at);
    
    // Assume most processes finish within 2 minutes, but use a non-linear curve
    // This creates a more satisfying progress experience
    const estimatedTotalTime = 2 * 60 * 1000;
    const progress = elapsed / estimatedTotalTime;
    
    // Use cubic-bezier style curve: start slower, accelerate, then slow down again
    return Math.min(95, Math.round(calculateBezierProgress(progress) * 100));
  }
  
  return 50; // Default to 50% for unknown states
}

/**
 * Calculate progress along a bezier curve for smoother progress visualization
 */
function calculateBezierProgress(t: number): number {
  // Simple cubic bezier approximation
  // Starts slow, accelerates in the middle, slows down at the end
  return t < 0.5
    ? 2 * t * t
    : -1 + (4 - 2 * t) * t;
}

/**
 * Get elapsed time in milliseconds since a given start time
 */
function getElapsedTime(startTime: string): number {
  return Date.now() - new Date(startTime).getTime();
}

/**
 * Determines the current processing stage based on state information
 */
function determineCurrentStage(runState: any, threadValues?: Record<string, any>): string {
  if (runState.status === 'pending') return 'Initializing';
  if (runState.status === 'failed') return 'Failed';
  if (runState.status === 'success') return 'Completed';
  
  // For running state, estimate the stage
  if (threadValues?.processingStep) {
    switch (threadValues.processingStep) {
      case 'processFiles': return 'Parsing documents';
      case 'ingestDocs': return 'Storing document embeddings';
      default: return 'Processing documents';
    }
  }
  
  return 'Processing documents';
}

/**
 * Estimates remaining time based on progress percentage and start time
 */
function estimateTimeRemaining(startTimeStr: string, progressPercent: number): string | null {
  if (progressPercent >= 100) return null;
  if (progressPercent <= 0) return 'Unknown';
  
  const startTime = new Date(startTimeStr).getTime();
  const now = Date.now();
  const elapsed = now - startTime;
  
  // Calculate estimated total time and remaining time
  const estimatedTotalTime = elapsed / (progressPercent / 100);
  const estimatedRemainingTime = estimatedTotalTime - elapsed;
  
  // Format the remaining time
  if (estimatedRemainingTime < 1000) return 'Almost done';
  if (estimatedRemainingTime < 60000) return `${Math.round(estimatedRemainingTime / 1000)}s`;
  return `${Math.round(estimatedRemainingTime / 60000)}m`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { threadId: string; runId: string } }
) {
  const threadId = params.threadId;
  const runId = params.runId;

  if (!threadId || !runId) {
    return NextResponse.json({ error: 'Thread ID and Run ID are required' }, { status: 400 });
  }

  try {
    console.log(`[/api/ingest/status] Polling status for threadId: ${threadId}, runId: ${runId}`);
    
    // Use the LangServe client to get the state of the run using both IDs
    const runState = await langGraphServerClient.client.runs.get(threadId, runId);
    
    console.log(`[/api/ingest/status] Run status for ${runId}: ${runState.status}`);

    // If run is completed successfully, get minimal thread state info without document content
    let finalStatus = null;
    let skippedFiles = [];
    let processedCount = 0;
    let errorDetails = null;
    let threadState = null;

    if (runState.status === 'success') {
      try {
        // Get the thread state with minimal information
        threadState = await langGraphServerClient.client.threads.getState(threadId);
        
        // Extract only what we need from the state (avoids large data transfer)
        if (threadState && threadState.values) {
          // Use a flexible type to access state values
          const values = threadState.values as Record<string, any>;
          finalStatus = values.finalStatus || 'Completed';
          skippedFiles = values.skippedFilenames || [];
          // Don't extract documents content, just count for UI feedback
          processedCount = values.docs?.length || 0;
          errorDetails = values.error;
        }
      } catch (stateError) {
        console.error('[/api/ingest/status] Error getting thread state:', stateError);
        // Continue even if state retrieval fails - we still know the run succeeded
      }
    }

    // Cast the entire runState to any to simplify access
    const stateAny = runState as any;

    // Prepare lightweight response with just the essential status information
    const responseData = {
      status: stateAny.status,
      isComplete: ['success', 'failed', 'canceled'].includes(stateAny.status),
      finalStatus: finalStatus,
      processedFiles: {
        success: processedCount,
        skipped: skippedFiles.length,
        skippedFiles: skippedFiles,
        // Only include names of files, not content
        total: processedCount + skippedFiles.length
      },
      // Add progress information if available (for running processes)
      progress: stateAny.status === 'running' ? {
        // Calculate rough percentage based on state data if available
        percentComplete: calculateProgress(stateAny, threadState?.values as Record<string, any>),
        currentStage: determineCurrentStage(stateAny, threadState?.values as Record<string, any>),
        processingFile: threadState?.values ? 
          ((threadState.values as Record<string, any>).currentFile || null) : null,
        // Estimated time remaining based on elapsed time and progress
        estimatedTimeRemaining: stateAny.created_at ? 
          estimateTimeRemaining(stateAny.created_at, calculateProgress(stateAny, threadState?.values as Record<string, any>)) : null
      } : null,
      error: stateAny.status === 'failed' ? 
        (stateAny.error || errorDetails || 'Unknown run failure') : 
        (errorDetails || null),
      // Include timing data if available
      timing: {
        startTime: stateAny.created_at,
        endTime: stateAny.ended_at,
        durationMs: stateAny.ended_at ? 
          (new Date(stateAny.ended_at).getTime() - new Date(stateAny.created_at).getTime()) : 
          null
      }
    };

    return NextResponse.json(responseData, {
      headers: {
        // Add cache control headers
        'Cache-Control': 'no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });

  } catch (error: any) {
    console.error(`[/api/ingest/status] Error polling status for runId ${runId}:`, error);
    
    let status = 500;
    let message = 'Failed to get run status';
    if (error.response && error.response.status === 404) {
        status = 404;
        message = 'Run or Thread ID not found.';
    } else if (error.message) {
        message = error.message;
    }

    return NextResponse.json(
      { error: message }, 
      { 
        status,
        headers: {
          'Cache-Control': 'no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }
    );
  }
} 