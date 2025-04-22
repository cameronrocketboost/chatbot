import { Copy, Info, Filter, Cog, Search, FileText, CheckCircle2, AlarmClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useState } from 'react';
import { PDFDocument, RetrievalMetadata } from '@/types/graphTypes';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent
} from "@/components/ui/tooltip";
import {
  Badge
} from "@/components/ui/badge";

interface FilterMetadata {
    contentType?: string;
    source?: string;
    sortBy?: string;
    sortDirection?: string;
}

interface ChatMessageProps {
  message: {
    role: 'user' | 'assistant';
    content: string;
    sources?: PDFDocument[];
    thinking?: string;
    stage?: string;
  };
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const isLoading = message.role === 'assistant' && message.content === '';
  
  // Fix the isThinking check to be more strict and prioritized 
  const isThinking = message.role === 'assistant' && 
                   message.thinking && 
                   (message.content === '' || !message.content);

  // Debug log to check if the thinking state is properly identified
  if (message.role === 'assistant') {
    console.log('ChatMessage rendering assistant message:', {
      hasThinking: !!message.thinking,
      thinkingText: message.thinking,
      hasStage: !!message.stage,
      stage: message.stage,
      content: message.content,
      contentLength: message.content?.length,
      isThinking: isThinking,
      isLoading: isLoading
    });
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const sources = message.sources;
  const showSources =
    message.role === 'assistant' &&
    sources &&
    sources.length > 0;

  const appliedFilters: FilterMetadata | undefined = showSources ? 
    sources?.map(source => source.metadata?.retrieval?.retrievalFilters)
           .find(filters => filters !== undefined)
    : undefined;

  // Define styles based on Sladen design guide
  const userMessageStyle = "bg-sladen-navy text-sladen-white rounded-tr-xl rounded-bl-xl rounded-br-xl rounded-tl-sm transform rotate-[0.15deg]";
  const assistantMessageStyle = "bg-white border-2 border-sladen-navy/15 text-sladen-navy rounded-tl-xl rounded-tr-xl rounded-br-xl rounded-bl-sm shadow-sm transform rotate-[-0.1deg]";
  
  // Function to get the appropriate icon based on thinking stage
  const getThinkingIcon = () => {
    if (!message.stage) return <Cog className="h-5 w-5 animate-spin text-sladen-red" />;
    
    switch(message.stage.toLowerCase()) {
      case 'analyzing query':
        return <AlarmClock className="h-5 w-5 text-sladen-teal animate-pulse" />;
      case 'retrieving documents':
        return <Search className="h-5 w-5 text-sladen-navy animate-pulse" />;
      case 'evaluating results':
        return <FileText className="h-5 w-5 text-sladen-red animate-pulse" />;
      case 'refining search':
        return <Filter className="h-5 w-5 text-sladen-purple animate-pulse" />;
      case 'generating response':
        return <CheckCircle2 className="h-5 w-5 text-sladen-teal animate-spin" />;
      default:
        return <Cog className="h-5 w-5 animate-spin text-sladen-red" />;
    }
  };
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} my-6`}>
      <div className={`max-w-[85%] p-4 ${isUser ? userMessageStyle : assistantMessageStyle}`}>
        {isLoading ? (
          <div className="flex space-x-2 h-6 items-center">
            <div className="w-2 h-2 bg-sladen-teal rounded-full animate-[loading_1s_ease-in-out_infinite]" />
            <div className="w-2 h-2 bg-sladen-teal rounded-full animate-[loading_1s_ease-in-out_0.2s_infinite]" />
            <div className="w-2 h-2 bg-sladen-teal rounded-full animate-[loading_1s_ease-in-out_0.4s_infinite]" />
          </div>
        ) : isThinking ? (
          <div className="space-y-4 p-2 bg-sladen-peach/10 rounded-lg border-2 border-sladen-peach/30 shadow-md">
            <div className="flex items-center gap-2">
              {getThinkingIcon()}
              <span className="text-lg font-semibold text-sladen-navy">
                {message.stage || "Thinking..."} 
              </span>
            </div>
            
            {/* Progress indicator */}
            <div className="relative h-2 w-full bg-gray-100 rounded-full overflow-hidden">
              <div className="absolute top-0 left-0 h-full bg-sladen-teal rounded-full animate-thinking-progress"></div>
            </div>
            
            {message.thinking && (
              <div className="text-base text-sladen-navy/90 bg-white p-4 rounded-md border border-sladen-peach/30 shadow-sm">
                <p className="leading-relaxed">{message.thinking}</p>
              </div>
            )}
          </div>
        ) : (
          <>
            <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
            
            {!isUser && (
                <div className="mt-4 space-y-3">
                    {appliedFilters && (
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="border-sladen-teal bg-sladen-teal/10 text-sladen-navy cursor-help text-xs">
                                <Filter className="h-3 w-3 mr-1 text-sladen-teal" />
                                Filtered Results
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="bg-white p-3 shadow-md border rounded-md text-xs max-w-xs">
                              <p className="font-medium mb-1 text-sladen-navy">Filters Applied:</p>
                              <ul className="list-disc list-inside space-y-0.5 text-sladen-navy/80">
                                {appliedFilters.source && <li>Source: {appliedFilters.source}</li>}
                                {appliedFilters.contentType && <li>Type: {appliedFilters.contentType.split('/').pop()?.toUpperCase()}</li>}
                              </ul>
                            </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-sladen-navy/60 hover:text-sladen-navy hover:bg-sladen-teal/10"
                          onClick={handleCopy}
                          title={copied ? 'Copied!' : 'Copy to clipboard'}
                        >
                          <Copy
                            className={`h-4 w-4 ${copied ? 'text-sladen-teal' : ''}`}
                          />
                        </Button>
                    </div>
                </div>
            )}
            
            {showSources && sources && (
              <div className="mt-4 pt-3 border-t border-sladen-navy/10">
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="sources" className="border-b-0">
                      <AccordionTrigger className="text-sm py-1 justify-start gap-1 hover:no-underline font-medium text-sladen-navy hover:text-sladen-teal">
                         <Info className="h-4 w-4 mr-1 flex-shrink-0 text-sladen-red" /> 
                         <span>View Sources ({sources.length})</span>
                      </AccordionTrigger>
                      <AccordionContent className="pt-3 pb-0">
                        <TooltipProvider delayDuration={300}>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {sources.map((source, index) => {
                              // Extract document type from content type or file extension
                              const filename = source.metadata?.source || source.metadata?.filename || 'Unknown';
                              const fileExt = filename.split('.').pop()?.toUpperCase() || '';
                              const contentType = source.metadata?.contentType || '';
                              const documentType = 
                                contentType.includes('pdf') ? 'PDF' :
                                contentType.includes('presentation') ? 'PPTX' :
                                contentType.includes('wordprocessing') ? 'DOCX' :
                                fileExt || 'Document';
                                
                              // Get document title if available
                              const title = source.metadata?.pdf?.info?.Title || 
                                            filename.split('/').pop() || 
                                            'Untitled';
                                              
                              return (
                                <Tooltip key={index}>
                                  <TooltipTrigger asChild>
                                    <Card
                                      className="bg-white border border-sladen-navy/10 transition-all duration-200 hover:bg-sladen-peach/10 hover:shadow-md cursor-pointer rounded-lg overflow-hidden transform rotate-[-0.1deg]"
                                    >
                                      <CardContent className="p-3 space-y-2">
                                        <div className="flex justify-between items-start">
                                          <p className="text-sm font-medium truncate text-sladen-navy" title={filename}>
                                            {title}
                                          </p>
                                          <Badge variant="outline" className="ml-1 shrink-0 bg-sladen-navy/5 text-sladen-navy border-sladen-navy/10">
                                            {documentType}
                                          </Badge>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {source.metadata?.loc?.pageNumber && (
                                              <Badge variant="secondary" className="text-xs px-1.5 py-0.5 h-auto bg-sladen-peach/30 text-sladen-navy/80 border-none">
                                                  Page {source.metadata.loc.pageNumber}
                                              </Badge>
                                            )}
                                            {source.metadata?.chunkIndex !== undefined && (
                                              <Badge variant="secondary" className="text-xs px-1.5 py-0.5 h-auto bg-sladen-teal/20 text-sladen-navy/80 border-none">
                                                  Chunk {source.metadata.chunkIndex + 1}{source.metadata.totalChunks ? `/${source.metadata.totalChunks}` : ''}
                                              </Badge>
                                            )}
                                            {source.metadata?.fileSize && (
                                              <Badge variant="secondary" className="text-xs px-1.5 py-0.5 h-auto bg-sladen-navy/10 text-sladen-navy/70 border-none">
                                                {Math.round(source.metadata.fileSize / 1024)} KB
                                              </Badge>
                                            )}
                                        </div>
                                        {source.pageContent && (
                                            <p className="text-xs text-sladen-navy/60 mt-1 line-clamp-2 italic bg-white/80 p-1.5 rounded border border-sladen-navy/5">
                                                "{source.pageContent.substring(0, 120)}{source.pageContent.length > 120 ? '...' : ''}"
                                            </p>
                                        )}
                                      </CardContent>
                                    </Card>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-md bg-white text-sladen-navy p-4 shadow-lg rounded-md whitespace-pre-wrap border border-sladen-navy/10" side="top" align="center">
                                    <p className="text-sm">
                                      {source.pageContent || 'No content available'}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })}
                          </div>
                        </TooltipProvider>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
