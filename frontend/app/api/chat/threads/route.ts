import { NextResponse } from 'next/server';
import { langGraphServerClient } from '@/lib/langgraph-server';

export async function POST() {
  console.log("[/api/chat/threads] Received POST request to create thread.");
  try {
    // Use the LangServe client to create a new thread on the backend
    const thread = await langGraphServerClient.createThread();
    
    if (!thread || !thread.thread_id) {
      throw new Error('Backend did not return a valid thread object.');
    }

    console.log(`[/api/chat/threads] Successfully created thread: ${thread.thread_id}`);
    return NextResponse.json({ threadId: thread.thread_id });

  } catch (error: any) {
    console.error("[/api/chat/threads] Error creating thread:", error);
    return NextResponse.json(
      { error: "Failed to create chat thread", details: error.message },
      { status: 500 }
    );
  }
} 