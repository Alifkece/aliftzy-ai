import "server-only";

export interface SafeError {
  status: number;
  message: string;
}

export const MISSING_KEY_MESSAGE = "Gemini API key is not configured on the server.";
const GENERIC = "Something went wrong. Please try again.";

/** Gemini's own error text is safe to show once key-like strings are removed. */
function upstreamDetail(err: unknown): string {
  let raw = err instanceof Error ? err.message : "";
  // ApiError messages are often a JSON string: {"error":{"code":400,"message":"..."}}
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown } };
    if (typeof parsed?.error?.message === "string") raw = parsed.error.message;
  } catch {
    /* not JSON */
  }
  return raw
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function statusOf(err: unknown): number | null {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : null;
}

/** Maps any thrown error to a user-safe message. Never leaks keys, stacks, or raw upstream bodies. */
export function toSafeError(err: unknown): SafeError {
  const status = statusOf(err);
  const detail = upstreamDetail(err);
  const withDetail = (prefix: string) => (detail ? `${prefix} ${detail}` : prefix);

  switch (status) {
    case 400:
      return { status: 400, message: withDetail("Gemini rejected this request:") };
    case 401:
    case 403:
      return { status: 502, message: withDetail("The server's Gemini API key was rejected:") };
    case 404:
      return { status: 502, message: "The configured Gemini model is unavailable. Check GEMINI_MODEL on the server." };
    case 429:
      return { status: 429, message: withDetail("Rate limit or quota reached:") };
    case 500:
    case 502:
    case 503:
    case 504:
      return { status: 503, message: "Gemini is temporarily unavailable. Please try again shortly." };
    default:
      break;
  }

  if (err instanceof Error && /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(err.message)) {
    return { status: 502, message: "Could not reach the Gemini API. Please try again." };
  }
  return { status: 500, message: GENERIC };
}
