import { NextRequest, NextResponse } from 'next/server';
import { createConversation } from '@/lib/supabase-conversations';

export const dynamic = 'force-dynamic'; // Prevent build-time execution

export async function POST(req: NextRequest) {
  try {
    console.log('POST /api/conversations/create called');
    // Create a new thread via the chat service
    const apiUrl = process.env.NEXT_PUBLIC_CHAT_API_URL;
    if (!apiUrl) throw new Error('Missing NEXT_PUBLIC_CHAT_API_URL');
    const threadRes = await fetch(`${apiUrl}/chat/threads`, { method: 'POST' });
    if (!threadRes.ok) throw new Error(`Failed to create thread: ${threadRes.statusText}`);
    const threadData = await threadRes.json();
    const threadId = threadData.threadId;
    console.log(`Created new thread via API: ${threadId}`);

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