import { getModelLabel } from "@/lib/gemini/config";
import type { ModelInfo } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Exposes only the display label. Never the key, never the raw env. */
export async function GET(): Promise<Response> {
  const info: ModelInfo = { label: getModelLabel() };
  return Response.json(info, { headers: { "Cache-Control": "no-store" } });
}
