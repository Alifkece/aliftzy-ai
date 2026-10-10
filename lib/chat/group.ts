import type { Conversation } from "@/types";

export interface ConversationGroup {
  label: string;
  items: Conversation[];
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function groupConversations(conversations: Conversation[], now = Date.now()): ConversationGroup[] {
  const today = startOfDay(now);
  const buckets: ConversationGroup[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 Days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const c of conversations) {
    const day = startOfDay(c.updatedAt);
    if (day >= today) buckets[0].items.push(c);
    else if (day >= today - DAY) buckets[1].items.push(c);
    else if (day >= today - 7 * DAY) buckets[2].items.push(c);
    else buckets[3].items.push(c);
  }
  return buckets.filter((b) => b.items.length > 0);
}

export function formatTime(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  if (startOfDay(ts) === startOfDay(now)) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
