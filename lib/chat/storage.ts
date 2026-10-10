import type { AppSettings, Conversation } from "@/types";

/**
 * Persistence boundary. Swap this module for a database-backed implementation later;
 * callers only use these functions. Binary attachment data is never stored here.
 */
const CONVERSATIONS_KEY = "aliftzy:conversations:v1";
const SETTINGS_KEY = "aliftzy:settings:v1";

export const DEFAULT_SETTINGS: AppSettings = { theme: "dark" };

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isConversation).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
  } catch {
    /* quota exceeded or storage unavailable: keep working in memory */
  }
}

export function clearConversations(): void {
  try {
    localStorage.removeItem(CONVERSATIONS_KEY);
  } catch {
    /* ignore */
  }
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const theme = parsed.theme === "light" || parsed.theme === "system" || parsed.theme === "dark" ? parsed.theme : "dark";
    return { theme };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

function isConversation(v: unknown): v is Conversation {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return typeof c.id === "string" && typeof c.title === "string" && Array.isArray(c.messages) && typeof c.updatedAt === "number" && typeof c.createdAt === "number";
}
