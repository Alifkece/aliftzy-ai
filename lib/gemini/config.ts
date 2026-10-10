import "server-only";

/**
 * Server-side model configuration. The model id string lives ONLY here.
 * Change it with the GEMINI_MODEL environment variable; nothing is swapped silently.
 */
export const DEFAULT_MODEL = "gemini-3.8-flash";
export const DEFAULT_MODEL_LABEL = "Gemini Flash";
const DEFAULT_MAX_OUTPUT_TOKENS = 32768;

export function getModel(): string {
  const value = process.env.GEMINI_MODEL?.trim();
  return value ? value : DEFAULT_MODEL;
}

export function getModelLabel(): string {
  const value = process.env.GEMINI_MODEL_LABEL?.trim();
  return value ? value : DEFAULT_MODEL_LABEL;
}

export function getMaxOutputTokens(): number {
  const parsed = Number.parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65536 ? parsed : DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * Lower thinking = faster first token. gemini-3.8-flash accepts low | medium | high (default is medium).
 * Set GEMINI_THINKING_LEVEL to change it; an unknown value falls back to "low".
 */
const THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export function getThinkingLevel(): ThinkingLevel {
  const value = process.env.GEMINI_THINKING_LEVEL?.trim().toLowerCase();
  return (THINKING_LEVELS as readonly string[]).includes(value ?? "") ? (value as ThinkingLevel) : "low";
}

/** The SDK reads GEMINI_API_KEY (or GOOGLE_API_KEY) from the server environment. */
export function hasApiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim());
}
