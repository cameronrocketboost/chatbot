import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getConversationWithMessages, updateConversationTitle } from '@/lib/supabase-conversations';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { conversationId, message } = body;
    
    if (!conversationId) {
      return NextResponse.json(
        { error: 'Conversation ID is required' },
        { status: 400 }
      );
    }
    
    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }
    
    // Fetch conversation to confirm it exists
    const conversation = await getConversationWithMessages(conversationId);
    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }
    
    // Generate a title using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that generates short, descriptive titles (maximum 50 characters) for chat conversations based on the first message. Keep titles concise and relevant to the main topic in the message."
        },
        {
          role: "user",
          content: `Create a short, descriptive title (maximum 50 characters) for a conversation that starts with this message: "${message}"`
        }
      ],
      max_tokens: 30,
      temperature: 0.7,
    });
    
    const generatedTitle = completion.choices[0].message.content?.trim() || 'New Conversation';
    
    // Clean up title - remove quotes if present
    const cleanTitle = generatedTitle.replace(/^["'](.*)["']$/, '$1');
    
    // Update the conversation title
    await updateConversationTitle(conversationId, cleanTitle);
    
    return NextResponse.json({
      title: cleanTitle
    });
    
  } catch (error: any) {
    console.error('[API /conversations/generate-title] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate title' },
      { status: 500 }
    );
  }
} 