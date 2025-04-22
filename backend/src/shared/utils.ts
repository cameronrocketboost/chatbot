import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { initChatModel } from 'langchain/chat_models/universal';

const SUPPORTED_PROVIDERS = [
  'openai',
  'anthropic',
  'azure_openai',
  'cohere',
  'google-vertexai',
  'google-vertexai-web',
  'google-genai',
  'ollama',
  'together',
  'fireworks',
  'mistralai',
  'groq',
  'bedrock',
  'cerebras',
  'deepseek',
  'xai',
] as const;
/**
 * Load a chat model from a fully specified name.
 * @param fullySpecifiedName - String in the format 'provider/model' or 'provider/account/provider/model'.
 * @returns A Promise that resolves to a BaseChatModel instance.
 */
export async function loadChatModel(
  fullySpecifiedName: string,
  temperature: number = 0.2,
): Promise<BaseChatModel> {
  const index = fullySpecifiedName.indexOf('/');
  if (index === -1) {
    // If there's no "/", assume it's just the model
    if (
      !SUPPORTED_PROVIDERS.includes(
        fullySpecifiedName as (typeof SUPPORTED_PROVIDERS)[number],
      )
    ) {
      throw new Error(`Unsupported model: ${fullySpecifiedName}`);
    }
    return await initChatModel(fullySpecifiedName, {
      temperature: temperature,
    });
  } else {
    const provider = fullySpecifiedName.slice(0, index);
    const model = fullySpecifiedName.slice(index + 1);
    if (
      !SUPPORTED_PROVIDERS.includes(
        provider as (typeof SUPPORTED_PROVIDERS)[number],
      )
    ) {
      throw new Error(`Unsupported provider: ${provider}`);
    }
    return await initChatModel(model, {
      modelProvider: provider,
      temperature: temperature,
    });
  }
}

/**
 * Calculate a dynamic Levenshtein distance threshold based on string length.
 * Shorter strings should have stricter thresholds while longer strings can 
 * tolerate more differences.
 * 
 * @param queryLength - The length of the string being compared
 * @returns A number representing the maximum allowed Levenshtein distance
 */
export function getDynamicLevenshteinThreshold(queryLength: number): number {
  // For very short strings (1-5 chars), allow at most 1-2 differences
  if (queryLength <= 5) {
    return Math.max(1, Math.floor(queryLength * 0.3));
  }
  
  // For medium strings (6-15 chars), scale from ~2-4 differences
  if (queryLength <= 15) {
    return Math.max(2, Math.floor(queryLength * 0.25));
  }
  
  // For longer strings, allow more differences but cap at reasonable level
  // to prevent too permissive matching
  return Math.min(5, Math.max(3, Math.floor(queryLength * 0.2)));
}

/**
 * Calculate a confidence score for string similarity matches.
 * Returns a value between 0 (no confidence) and 1 (perfect match)
 * 
 * @param s1 - First string
 * @param s2 - Second string
 * @returns A number between 0-1 representing match confidence
 */
export function calculateMatchConfidence(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  
  // Normalize strings
  const str1 = s1.toLowerCase().trim();
  const str2 = s2.toLowerCase().trim();
  
  // Perfect match
  if (str1 === str2) return 1.0;
  
  // Get the Levenshtein distance
  const distance = levenshteinDistance(str1, str2);
  
  // Calculate max possible distance
  const maxLength = Math.max(str1.length, str2.length);
  
  // If distance is nearly equal to max length, confidence is very low
  if (distance >= maxLength - 1) return 0.1;
  
  // Calculate confidence score (1 - normalized distance)
  // Higher number = better match
  const confidence = maxLength > 0 ? 1 - (distance / maxLength) : 0;
  
  return confidence;
}

/**
 * Simple Levenshtein distance implementation.
 * Measures the difference between two strings.
 * 
 * @param s1 - First string
 * @param s2 - Second string
 * @returns Number of operations needed to transform s1 into s2
 */
export function levenshteinDistance(s1: string, s2: string): number {
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();

  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else {
        if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
    }
    if (i > 0) {
      costs[s2.length] = lastValue;
    }
  }
  return costs[s2.length];
}
