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
    sources?: string[];
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
    Array.isArray(sources) &&
    sources.length > 0;

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
            
            {showSources && (
              <div className="mt-4 pt-3 border-t border-sladen-navy/10">
                  <h4 className="text-xs font-semibold mb-2 text-sladen-navy uppercase tracking-wider flex items-center">
                    <Info className="h-3 w-3 mr-1.5 text-sladen-red flex-shrink-0" />
                    Sources:
                  </h4>
                  <ul className="list-none pl-0 space-y-1">
                    {sources?.map((source, index) => (
                      <li key={index} className="text-xs text-sladen-navy/80 bg-sladen-peach/10 p-1.5 rounded border border-sladen-navy/10 truncate" title={source}>
                        <FileText className="h-3 w-3 mr-1 inline-block align-middle text-sladen-teal" />
                        {source} 
                      </li>
                    ))}
                  </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
