import { NextRequest, NextResponse } from 'next/server';
import { getConversations, getConversationByThreadId } from '@/lib/supabase-conversations';

export const dynamic = 'force-dynamic'; // Prevent build-time execution

export async function GET(request: NextRequest) {
  try {
    // Extract query parameters
    const url = new URL(request.url);
    const userId = url.searchParams.get('user_id');
    const threadId = url.searchParams.get('thread_id');
    
    // If thread_id is provided, get a specific conversation
    if (threadId) {
      const conversation = await getConversationByThreadId(threadId);
      
      if (!conversation) {
        return NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 }
        );
      }
      
      return NextResponse.json(conversation);
    }
    
    // Otherwise get all conversations
    const conversations = await getConversations(userId || undefined);
    
    return NextResponse.json(conversations);
  } catch (error: any) {
    console.error('[API /conversations] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch conversations' },
      { status: 500 }
    );
  }
} 