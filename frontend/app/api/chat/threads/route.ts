import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // Prevent build-time execution

export async function POST(_req: NextRequest) {
  // Proxy creation of new thread to Render backend
  const apiUrl = process.env.NEXT_PUBLIC_LANGGRAPH_API_URL;
  if (!apiUrl) {
    return NextResponse.json({ error: 'Missing NEXT_PUBLIC_LANGGRAPH_API_URL' }, { status: 500 });
  }
  const response = await fetch(`${apiUrl}/chat/threads`, { method: 'POST' });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
} 