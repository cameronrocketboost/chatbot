import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/langgraph-server';
import { createConversation, getConversationWithMessages } from '@/lib/supabase-conversations';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic'; // Prevent build-time execution

export async function POST(req: NextRequest) {
  try {
    console.log('POST /api/conversations/create called');
    const serverClient = createServerClient(); // Get client at runtime

    // Create a new thread using LangGraph SDK client
    const thread = await serverClient.createThread();
    const threadId = thread.thread_id;
    console.log(`Created new thread: ${threadId}`);

    // Extract parameters
    const body = await req.json();
    const title = body.title || 'New Conversation';
    
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