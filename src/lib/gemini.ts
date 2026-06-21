import 'server-only';

import { GoogleGenAI } from '@google/genai';

// The current fast, GA Gemini model on the Developer API. Per
// ai.google.dev/gemini-api/docs/deprecations its earliest shutdown is
// 2026-10-16 and the documented successor is `gemini-3.5-flash`; this is a
// one-line swap if/when that date is confirmed. Single source of truth for
// every server-side AI route.
export const GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Returns a Gemini client built from the server-only GEMINI_API_KEY.
 * Throws if the key is missing so routes can surface a clean 500.
 */
export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  return new GoogleGenAI({ apiKey });
}
