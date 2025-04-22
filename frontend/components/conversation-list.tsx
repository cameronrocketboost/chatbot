'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PlusCircle, Trash2, Edit, CheckCircle } from 'lucide-react';
import { Conversation } from '@/lib/supabase-conversations';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatDistanceToNow } from 'date-fns';
import { Input } from '@/components/ui/input';

export function ConversationList() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const router = useRouter();

  // Get the current thread ID from URL query parameter
  const currentThreadId = typeof window !== 'undefined' 
    ? new URLSearchParams(window.location.search).get('threadId')
    : null;

  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const response = await fetch('/api/conversations');
        if (!response.ok) {
          throw new Error('Failed to fetch conversations');
        }
        const data = await response.json();
        setConversations(data);
      } catch (err) {
        console.error('Error fetching conversations:', err);
        setError('Failed to load conversations');
      } finally {
        setLoading(false);
      }
    };

    fetchConversations();
  }, []);

  const handleNewChat = async () => {
    try {
      const response = await fetch('/api/conversations/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'New Conversation' }),
      });

      if (!response.ok) {
        throw new Error('Failed to create new conversation');
      }

      const data = await response.json();
      // Redirect to the new conversation
      router.push(`/?threadId=${data.thread_id}`);
      
      // Reload the page to reset the message state
      window.location.href = `/?threadId=${data.thread_id}`;
    } catch (err) {
      console.error('Error creating new conversation:', err);
      setError('Failed to create new conversation');
    }
  };

  const handleSelectConversation = (threadId: string) => {
    if (editingId) return; // Don't navigate if we're editing
    router.push(`/?threadId=${threadId}`);
    
    // Reload the page to reset the message state
    window.location.href = `/?threadId=${threadId}`;
  };

  const handleDeleteConversation = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    
    try {
      const response = await fetch(`/api/conversations/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete conversation');
      }

      // Remove from local state
      setConversations(conversations.filter(conv => conv.id !== id));

      // If this was the current conversation, create a new one
      if (conversations.find(conv => conv.thread_id === currentThreadId)?.id === id) {
        handleNewChat();
      }
    } catch (err) {
      console.error('Error deleting conversation:', err);
      setError('Failed to delete conversation');
    }
  };

  const startEditing = (conversation: Conversation, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingId(conversation.id);
    setEditTitle(conversation.title);
  };

  const saveTitle = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }
    
    try {
      const response = await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: editTitle }),
      });

      if (!response.ok) {
        throw new Error('Failed to update conversation title');
      }

      // Update in local state
      setConversations(
        conversations.map(conv => 
          conv.id === id ? { ...conv, title: editTitle } : conv
        )
      );
      
      setEditingId(null);
    } catch (err) {
      console.error('Error updating conversation title:', err);
      setError('Failed to update title');
      setEditingId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      saveTitle(id, e as unknown as React.MouseEvent);
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  };

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-5 w-full mb-4" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-red-500">{error}</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4">
        <Button 
          onClick={handleNewChat}
          className="w-full mb-4 bg-sladen-teal hover:bg-sladen-navy text-white"
        >
          <PlusCircle className="mr-2 h-4 w-4" /> New Chat
        </Button>
      </div>
      
      <div className="flex-1 overflow-y-auto px-2">
        {conversations.length === 0 ? (
          <div className="text-center text-sladen-navy/50 p-4">
            No conversations yet
          </div>
        ) : (
          <ul className="space-y-2">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <div 
                  className={`
                    flex items-center justify-between p-3 rounded-md cursor-pointer
                    hover:bg-sladen-teal/5 transition-colors
                    ${currentThreadId === conversation.thread_id ? 
                      'bg-sladen-teal/10 border-l-4 border-sladen-teal' : 
                      'border-l-4 border-transparent'}
                  `}
                  onClick={() => handleSelectConversation(conversation.thread_id)}
                >
                  <div className="flex-1 truncate mr-2">
                    {editingId === conversation.id ? (
                      <div onClick={(e) => e.stopPropagation()} className="flex items-center">
                        <Input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, conversation.id)}
                          autoFocus
                          className="h-7 py-1 border-sladen-teal"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 ml-1 text-sladen-teal hover:text-sladen-teal hover:bg-sladen-teal/10"
                          onClick={(e) => saveTitle(conversation.id, e)}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="font-medium truncate text-sladen-navy">{conversation.title}</div>
                        <div className="text-xs text-sladen-navy/60">{formatDate(conversation.updated_at)}</div>
                      </>
                    )}
                  </div>
                  
                  {!editingId && (
                    <div className="flex items-center">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-sladen-navy/40 hover:text-sladen-teal hover:bg-sladen-teal/10"
                              onClick={(e) => startEditing(conversation, e)}
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p>Edit title</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-sladen-navy/40 hover:text-sladen-red hover:bg-sladen-red/10"
                              onClick={(e) => handleDeleteConversation(conversation.id, e)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p>Delete conversation</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
} 