import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FileIcon, XIcon, FileText, Presentation } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface FilePreviewProps {
  files: File[];
  onRemove: (name: string) => void;
  isProcessing?: boolean;
}

export function FilePreview({ files, onRemove, isProcessing }: FilePreviewProps) {
  const getFileExtension = (filename: string) => {
    return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2).toLowerCase();
  };

  const getFileTypeLabel = (contentType: string, extension: string) => {
    if (contentType.startsWith('application/pdf') || extension === 'pdf') return 'PDF';
    if (
      contentType.startsWith(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) ||
      extension === 'docx'
    )
      return 'DOCX';
    if (
      contentType.startsWith(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ) ||
      extension === 'pptx'
    )
      return 'PPTX';
    return 'File';
  };

  const FileTypeIcon = ({ fileType }: { fileType: string }) => {
    switch (fileType) {
      case 'PDF':
        return <FileText className="h-5 w-5 text-sladen-red flex-shrink-0" />;
      case 'DOCX':
        return <FileText className="h-5 w-5 text-sladen-teal flex-shrink-0" />;
      case 'PPTX':
        return <Presentation className="h-5 w-5 text-sladen-navy flex-shrink-0" />;
      default:
        return <FileIcon className="h-5 w-5 text-sladen-gray flex-shrink-0" />;
    }
  };

  if (files.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {files.map((file, index) => {
        const extension = getFileExtension(file.name);
        const fileTypeLabel = getFileTypeLabel(file.type, extension);
        
        // Generate a slight rotation for each card for a more hand-drawn feel
        const rotation = (index % 3 - 1) * 0.5; // Values between -0.5 and 0.5 degrees
        
        return (
          <Card 
            key={file.name + index} 
            className="relative w-full group border border-sladen-navy/15 shadow-sm overflow-hidden" 
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            <CardHeader className="p-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-sladen-navy/5 flex items-center justify-center">
                    <FileTypeIcon fileType={fileTypeLabel} />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-medium truncate text-sladen-navy" title={file.name}>
                      {file.name}
                    </CardTitle>
                    <CardDescription className="text-xs text-sladen-navy/60 mt-0.5">
                      {fileTypeLabel} · {(file.size / 1024 / 1024).toFixed(2)} MB
                    </CardDescription>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-sladen-navy/40 hover:text-sladen-red hover:bg-sladen-red/5 disabled:opacity-50"
                  onClick={() => !isProcessing && onRemove(file.name)}
                  disabled={isProcessing}
                  aria-label="Remove file from list"
                >
                  <XIcon className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
          </Card>
        );
      })}
    </div>
  );
}

