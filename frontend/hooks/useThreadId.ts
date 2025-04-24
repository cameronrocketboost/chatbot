'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from './use-toast';

interface UseThreadIdReturn {
  threadId: string | null;
  isLoading: boolean;
  createAndSetNewThreadId: () => Promise<string | null>;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || '';
const THREAD_ID_LOCAL_STORAGE_KEY = 'chat_thread_id';

export function useThreadId(): UseThreadIdReturn {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true); // Start loading true

  useEffect(() => {
    setIsLoading(true);
    const initialThreadIdFromUrl = searchParams.get('threadId');
    console.log('useThreadId: Initial check - URL param:', initialThreadIdFromUrl);

    if (initialThreadIdFromUrl) {
      console.log('useThreadId: Using threadId from URL:', initialThreadIdFromUrl);
      // Only update state and localStorage if it's different from current state
      if (threadId !== initialThreadIdFromUrl) {
        setThreadId(initialThreadIdFromUrl);
        // Ensure localStorage is only written in the browser
        if (typeof window !== 'undefined') {
          localStorage.setItem(THREAD_ID_LOCAL_STORAGE_KEY, initialThreadIdFromUrl);
        }
        console.log('useThreadId: Synced URL threadId to state and localStorage');
      }
      setIsLoading(false);
    } else {
      // Ensure localStorage is only read in the browser
      const storedThreadId = typeof window !== 'undefined' ? localStorage.getItem(THREAD_ID_LOCAL_STORAGE_KEY) : null;
      console.log('useThreadId: No URL param, checking localStorage:', storedThreadId);
      if (storedThreadId) {
        console.log('useThreadId: Using threadId from localStorage:', storedThreadId);
        if (threadId !== storedThreadId) {
           setThreadId(storedThreadId);
           // Update URL only if it doesn\'t match the stored ID
           console.log('useThreadId: Replacing URL with stored threadId');
           router.replace(`/?threadId=${storedThreadId}`, { scroll: false });
        }
      } else {
        console.log('useThreadId: No threadId found in URL or localStorage.');
      }
      setIsLoading(false);
    }
    // Dependencies: Trigger effect if URL params change or if the router instance changes.
    // Avoid adding threadId here to prevent loops if state updates trigger URL changes that re-trigger the effect.
  }, [searchParams, router]);

  // Function to explicitly create a new thread
  const createAndSetNewThreadId = useCallback(async (): Promise<string | null> => {
    console.log('useThreadId: Creating new chat thread via API...');
    if (!BACKEND_URL) {
      console.error('useThreadId Error: Backend URL is not configured.');
      toast({ title: 'Error', description: 'Backend URL not configured.', variant: 'destructive' });
      return null;
    }
    setIsLoading(true); // Set loading state while creating
    try {
      const response = await fetch(`${BACKEND_URL}/chat/threads`, { method: 'POST' });
      if (!response.ok) {
        const errorText = await response.text(); // Get more details
        throw new Error(`Failed to create thread: ${response.statusText} (${response.status}) - ${errorText}`);
      }
      const data = await response.json();
      const newThreadId = data.threadId;
      if (!newThreadId || typeof newThreadId !== 'string') {
        throw new Error('API did not return a valid threadId.');
      }
      console.log('useThreadId: New thread created:', newThreadId);
      setThreadId(newThreadId);
      if (typeof window !== 'undefined') {
        localStorage.setItem(THREAD_ID_LOCAL_STORAGE_KEY, newThreadId);
      }
      router.push(`/?threadId=${newThreadId}`); // Use push to navigate
      setIsLoading(false);
      return newThreadId;
    } catch (err: any) {
      console.error('useThreadId: Error creating new chat:', err);
      toast({ title: 'Error', description: err.message || 'Failed to create new chat thread.', variant: 'destructive' });
      setIsLoading(false);
      return null;
    }
  }, [router, toast]); // Removed BACKEND_URL from deps as it comes from process.env

  // Return state and creation function
  return { threadId, isLoading, createAndSetNewThreadId };
}
