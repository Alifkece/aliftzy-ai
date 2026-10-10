import "server-only";
import { GoogleGenAI } from "@google/genai";

/**
 * `new GoogleGenAI({})` reads the API key from the server environment (GEMINI_API_KEY).
 * The key is never passed through code, props, or the browser.
 */
let cached: GoogleGenAI | null = null;

export function getClient(): GoogleGenAI {
  if (!cached) cached = new GoogleGenAI({});
  return cached;
}
