import OpenAI from "openai";

/**
 * Lazily create the OpenAI client the first time it's needed.
 */
let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (_client) return _client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  _client = new OpenAI({ apiKey: apiKey });
  return _client;
} 