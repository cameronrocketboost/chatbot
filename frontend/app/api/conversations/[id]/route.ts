import { NextRequest, NextResponse } from 'next/server';
import { getConversationWithMessages, updateConversationTitle, deleteConversation } from '@/lib/supabase-conversations';
import { getSupabaseServerClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic'; // Prevent build-time execution

// GET single conversation with messages
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const conversation = await getConversationWithMessages(params.id);
    
    return NextResponse.json(conversation);
  } catch (error: any) {
    console.error(`[API /conversations/${params.id}] Error fetching conversation:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch conversation' },
      { status: 500 }
    );
  }
}

// PATCH to update conversation title
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { title } = await request.json();
    
    if (!title) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
    }
    
    const updatedConversation = await updateConversationTitle(params.id, title);
    
    return NextResponse.json(updatedConversation);
  } catch (error: any) {
    console.error(`[API /conversations/${params.id}] Error updating conversation:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to update conversation' },
      { status: 500 }
    );
  }
}

// DELETE conversation
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await deleteConversation(params.id);
    
    return NextResponse.json(
      { success: true, message: 'Conversation deleted successfully' },
      { status: 200 }
    );
  } catch (error: any) {
    console.error(`[API /conversations/${params.id}] Error deleting conversation:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete conversation' },
      { status: 500 }
    );
  }
} 