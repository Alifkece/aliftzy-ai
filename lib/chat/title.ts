const FILLER = /^(please|pls|can you|could you|would you|will you|help me|i want you to|i want to|i need you to|i need to|i'd like you to|tolong|bisa|bantu saya|saya ingin|saya mau)\s+/i;

/** Short title from the first user message via clean truncation (no extra AI call). */
export function makeTitle(text: string, fallback = "New chat"): string {
  let t = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3 && FILLER.test(t); i++) t = t.replace(FILLER, "");
  t = t.replace(/^[^\p{L}\p{N}]+/u, "");
  if (!t) return fallback;
  const first = t.split(/(?<=[.!?])\s/)[0] ?? t;
  const base = first.length >= 8 ? first : t;
  const cut = base.length > 48 ? base.slice(0, 48).replace(/\s+\S*$/, "") + "…" : base;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}
