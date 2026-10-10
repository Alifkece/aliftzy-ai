"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Attachment, Message } from "@/types";
import { ArrowDownIcon } from "@/components/ui/icons";
import { MessageItem } from "./MessageItem";
import { analyzeConversation } from "@/lib/chat/project";
import { detectIntent } from "@/lib/chat/intent";

interface MessageListProps {
  conversationId: string;
  messages: Message[];
  streamingId: string | null;
  getLive: (messageId: string) => Attachment[] | undefined;
  onRegenerate: () => void;
}

const THRESHOLD = 80;

export function MessageList({ conversationId, messages, streamingId, getLive, onRegenerate }: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD;
    pinned.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  }, []);

  // Opening a conversation: jump to the end.
  useLayoutEffect(() => {
    pinned.current = true;
    scrollToBottom();
  }, [conversationId, scrollToBottom]);

  const last = messages[messages.length - 1];

  // A new user message always pins to the bottom.
  useLayoutEffect(() => {
    if (last?.role === "user") {
      pinned.current = true;
      scrollToBottom();
    }
  }, [last?.id, last?.role, scrollToBottom]);

  // Streaming growth follows only while the reader is at the bottom.
  useLayoutEffect(() => {
    if (pinned.current) scrollToBottom();
  }, [last?.content, last?.error, last?.stopped, scrollToBottom]);

  // Layout changes (images, code blocks, window resize) keep a pinned view pinned.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const inner = el.firstElementChild;
    if (!inner) return;
    const ro = new ResizeObserver(() => {
      if (pinned.current) scrollToBottom();
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [scrollToBottom, conversationId]);

  const streaming = streamingId !== null;

  // Files per assistant message, classified against what the project already contained (attachments + earlier files).
  const analysis = useMemo(
    () =>
      analyzeConversation(messages, streamingId, (id) => {
        const live = getLive(id);
        return live?.map((a) => ({ name: a.name, text: a.text }));
      }),
    [messages, streamingId, getLive],
  );

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="scroll-thin h-full overflow-y-auto overscroll-contain" role="log" aria-live="off" aria-label="Conversation">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-10 pt-8 sm:px-6">
          {messages.map((m, i) => {
            // The request an assistant answer belongs to decides which download is emphasised.
            const asked = m.role === "assistant" ? detectIntent(messages[i - 1]?.role === "user" ? messages[i - 1].content : "") : { zip: false, changedOnly: false };
            return (
              <MessageItem
                key={m.id}
                message={m}
                streaming={m.id === streamingId}
                isLast={i === messages.length - 1}
                disabled={streaming}
                getLive={getLive}
                onRegenerate={onRegenerate}
                analysis={analysis.get(m.id)}
                wantsZip={asked.zip}
                changedOnly={asked.changedOnly}
              />
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          pinned.current = true;
          scrollToBottom(true);
        }}
        aria-label={streaming ? "Scroll to new response" : "Scroll to latest message"}
        tabIndex={atBottom ? -1 : 0}
        className={`absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-raised/95 px-3.5 py-2 text-xs font-medium shadow-lg backdrop-blur transition duration-300 hover:border-violet/50 active:scale-95 ${
          atBottom ? "pointer-events-none translate-y-2 opacity-0" : "translate-y-0 opacity-100"
        }`}
      >
        <ArrowDownIcon width={14} height={14} />
        {streaming ? "New response" : "Latest"}
      </button>
    </div>
  );
}
