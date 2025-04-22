import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, X, FileUp, CheckCircle, AlertCircle, File, FileText, Presentation, Maximize } from "lucide-react";
import { useEffect, useState } from "react";

interface UploadProgressProps {
  progress?: {
    percentComplete: number;
    currentStage: string;
    processingFile: string | null;
    estimatedTimeRemaining: string | null;
  } | null;
  minimized?: boolean;
  onMinimize?: (minimized: boolean) => void;
  error?: string | null;
}

export function UploadProgress({ 
  progress, 
  minimized = false,
  onMinimize,
  error
}: UploadProgressProps) {
  const [isMinimized, setIsMinimized] = useState(minimized);
  const [showAnimation, setShowAnimation] = useState(false);
  const [smoothProgress, setSmoothProgress] = useState(0);
  
  // Sync with parent's minimized state
  useEffect(() => {
    setIsMinimized(minimized);
  }, [minimized]);
  
  // Notify parent component when minimized state changes
  useEffect(() => {
    onMinimize?.(isMinimized);
  }, [isMinimized, onMinimize]);

  useEffect(() => {
    // Animate entrance
    setShowAnimation(true);
    
    // Auto-minimize after 5 seconds if progress is over 50%
    let timer: NodeJS.Timeout;
    if (progress?.percentComplete && progress.percentComplete > 50) {
      timer = setTimeout(() => {
        setIsMinimized(true);
        onMinimize?.(true); // Notify parent when auto-minimizing
      }, 5000);
    }
    
    // Smoothly update progress value
    if (progress?.percentComplete) {
      // Gradually move toward target value
      const target = progress.percentComplete;
      const interval = setInterval(() => {
        setSmoothProgress(prev => {
          const next = prev + Math.min(2, (target - prev) / 4);
          if (Math.abs(next - target) < 0.5) {
            clearInterval(interval);
            return target;
          }
          return next;
        });
      }, 50);
      
      return () => {
        if (timer) clearTimeout(timer);
        clearInterval(interval);
      };
    }
  }, [progress?.percentComplete]);
  
  // If not processing and no error, don't render
  if (!progress && !error) return null;
  
  // Determine status icon
  const StatusIcon = error ? 
    AlertCircle : 
    (progress ? Loader2 : CheckCircle);
  
  // Status color
  const statusColor = error ? 
    'text-sladen-red' : 
    (progress ? 'text-sladen-teal' : 'text-sladen-teal');

  // Add better visibility into current file type
  const getFileIcon = (filename: string | null) => {
    if (!filename) return null;
    
    const extension = filename.split('.').pop()?.toLowerCase() || '';
    
    switch (extension) {
      case 'pdf':
        return <FileText className="h-3.5 w-3.5 mr-1.5 text-sladen-red" />;
      case 'docx':
        return <FileText className="h-3.5 w-3.5 mr-1.5 text-sladen-teal" />;
      case 'pptx':
        return <Presentation className="h-3.5 w-3.5 mr-1.5 text-sladen-navy" />;
      default:
        return <File className="h-3.5 w-3.5 mr-1.5 text-sladen-gray" />;
    }
  };

  // Function to toggle minimized state
  const toggleMinimized = (value: boolean) => {
    setIsMinimized(value);
    onMinimize?.(value); // Notify parent component
  };

  // Use the hand-drawn style with slight rotation
  const rotation = "-0.5deg";

  return (
    <div 
      className={`fixed top-20 right-4 z-50 transition-all duration-500 transform ${
        showAnimation ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-2 opacity-0 scale-95'
      }`}
      style={{ 
        width: isMinimized ? '48px' : '320px', 
        transform: `rotate(${rotation})` 
      }}
    >
      <Card 
        className={`transition-all duration-300 shadow-md border-2 border-sladen-navy/15 bg-white/95 backdrop-blur-sm overflow-hidden ${
          progress ? 'ring-2 ring-sladen-teal/20' : ''
        }`}
      >
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            {/* Always visible - even when minimized */}
            <div className="flex items-center space-x-2 flex-grow">
              <div className={`relative ${progress ? 'animate-pulse' : ''}`} style={{ animationDuration: '1.5s' }}>
                <StatusIcon className={`h-5.5 w-5.5 ${statusColor} ${progress ? 'animate-spin' : ''}`} />
                {progress && (
                  <div className="absolute inset-0 rounded-full bg-sladen-teal/20 animate-ping opacity-75" 
                      style={{ animationDuration: '2s' }}></div>
                )}
              </div>
              
              {!isMinimized && (
                <span className="font-medium text-sm truncate text-sladen-navy">
                  {error ? 'Processing Error' : 
                   (progress ? `Processing Files (${Math.round(smoothProgress)}%)` : 'Processing Complete')}
                </span>
              )}
            </div>
            
            <div className="flex-shrink-0 flex space-x-1">
              {!isMinimized && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6 text-sladen-navy/50 hover:text-sladen-red hover:bg-sladen-red/5"
                  onClick={() => toggleMinimized(true)}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
              {isMinimized && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6 text-sladen-navy/50 hover:text-sladen-navy hover:bg-sladen-teal/10 p-0"
                  onClick={() => toggleMinimized(false)}
                >
                  <span className="sr-only">Expand</span>
                  <Maximize className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          
          {/* Content only visible when expanded */}
          {!isMinimized && (
            <>
              {progress && (
                <div className="mt-3 space-y-2">
                  {/* Progress bar */}
                  <div className="w-full bg-sladen-navy/5 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-sladen-teal h-full transition-all duration-500" 
                      style={{ 
                        width: `${Math.max(1, smoothProgress)}%`,
                        transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)"
                      }}
                    />
                  </div>
                  
                  {/* Status info */}
                  <div className="flex justify-between text-xs text-sladen-navy/70">
                    <span className="font-medium">{progress.currentStage || "Processing..."}</span>
                    {progress.estimatedTimeRemaining && (
                      <span className="text-sladen-teal">~{progress.estimatedTimeRemaining} remaining</span>
                    )}
                  </div>
                  
                  {/* Current file with file type icon */}
                  {progress.processingFile && (
                    <p className="text-xs text-sladen-navy/70 truncate flex items-center">
                      {getFileIcon(progress.processingFile)}
                      <span className="truncate">{progress.processingFile}</span>
                    </p>
                  )}
                </div>
              )}
              
              {/* Error message */}
              {error && (
                <div className="mt-3 bg-sladen-red/10 border border-sladen-red/20 rounded p-2 text-xs text-sladen-red">
                  {error}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 