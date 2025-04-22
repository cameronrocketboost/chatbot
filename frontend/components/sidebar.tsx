'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConversationList } from '@/components/conversation-list';

interface SidebarProps {
  defaultOpen?: boolean;
}

export function Sidebar({ defaultOpen = false }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="relative h-full">
      {/* Sidebar toggle button */}
      <Button
        variant="ghost"
        size="icon"
        className={`absolute top-4 ${isOpen ? 'left-64' : 'left-4'} z-30 bg-white shadow-sm border hover:bg-sladen-teal/10 hover:text-sladen-teal`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? "Close sidebar" : "Open sidebar"}
      >
        {isOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </Button>

      {/* Sidebar content */}
      <div
        className={`
          fixed left-0 top-[4rem] bottom-0 z-20
          bg-white border-r border-sladen-navy/10
          transition-all duration-300 ease-in-out
          ${isOpen ? 'w-72 opacity-100' : 'w-0 opacity-0 pointer-events-none'}
          overflow-hidden
        `}
      >
        <div className="flex flex-col h-full">
          <div className="p-4 border-b border-sladen-navy/10 bg-sladen-navy/5">
            <h2 className="text-lg font-semibold flex items-center text-sladen-navy">
              <MessageSquare className="mr-2 h-5 w-5 text-sladen-teal" />
              Conversations
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto">
            <ConversationList />
          </div>
        </div>
      </div>
    </div>
  );
} 