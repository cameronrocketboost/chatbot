import { NextRequest, NextResponse } from 'next/server';
import { createConversation } from '@/lib/supabase-conversations';
import { langGraphServerClient } from '@/lib/langgraph-server';

export async function POST(request: NextRequest) {
  try {
    // Extract parameters
    const body = await request.json();
    const title = body.title || 'New Conversation';
    
    // Create a new thread in LangGraph
    console.log('[API /conversations/create] Creating a new LangGraph thread');
    const thread = await langGraphServerClient.createThread();
    
    if (!thread || !thread.thread_id) {
      throw new Error('Failed to create LangGraph thread');
    }
    
    const threadId = thread.thread_id;
    console.log(`[API /conversations/create] Created LangGraph thread: ${threadId}`);
    
    // Create conversation record in Supabase
    console.log(`[API /conversations/create] Creating Supabase conversation record for thread: ${threadId}`);
    const conversation = await createConversation(threadId, title);
    
    return NextResponse.json({
      ...conversation,
      threadId
    });
  } catch (error: any) {
    console.error('[API /conversations/create] Error creating conversation:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create conversation' },
      { status: 500 }
    );
  }
} 