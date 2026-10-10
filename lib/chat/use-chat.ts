"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Attachment,
  ChatAttachmentPayload,
  ChatMessagePayload,
  Conversation,
  Message,
  StoredAttachment,
} from "@/types";
import { ERRORS, LIMITS, classifyFile } from "@/lib/files/rules";
import { payloadWeight, processFile, revokePreview } from "@/lib/files/process";
import { clearConversations, loadConversations, saveConversations } from "./storage";
import { streamChat } from "./stream";
import { makeTitle } from "./title";
import { uid } from "@/lib/utils/id";

const MAX_HISTORY = 40;
/** Budget for text attachments of OLDER messages that are re-sent so edits keep the user's file as source of truth. */
const OLD_TEXT_ATTACHMENT_BUDGET = 1_500_000;

function toStored(a: Attachment): StoredAttachment {
  return { id: a.id, name: a.name, kind: a.kind, mime: a.mime, size: a.size };
}

function toPayloadAttachment(a: Attachment): ChatAttachmentPayload {
  return { name: a.name, kind: a.kind, mime: a.mime, size: a.size, data: a.data, text: a.text };
}

export function useChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);

  const convRef = useRef<Conversation[]>([]);
  const activeRef = useRef<string | null>(null);
  const streamingRef = useRef(false);
  const pendingRef = useRef<Attachment[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  /** Identifies the running generation; a finished/aborted older one must never touch newer state. */
  const genRef = useRef(0);
  /** Binary attachments live in memory only (never localStorage): user message id -> attachments. */
  const liveStore = useRef(new Map<string, Attachment[]>());

  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const update = useCallback((fn: (prev: Conversation[]) => Conversation[]) => {
    setConversations((prev) => {
      const next = fn(prev);
      convRef.current = next;
      return next;
    });
  }, []);

  const patchMessage = useCallback(
    (convId: string, messageId: string, fn: (m: Message) => Message) => {
      update((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? fn(m) : m)) } : c)),
      );
    },
    [update],
  );

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    const list = loadConversations();
    convRef.current = list;
    setConversations(list);
    setHydrated(true);
  }, []);

  // Debounced persistence.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => saveConversations(conversations), 300);
    return () => clearTimeout(t);
  }, [conversations, hydrated]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const releaseMessages = useCallback((messages: Message[]) => {
    for (const m of messages) {
      const live = liveStore.current.get(m.id);
      if (live) live.forEach(revokePreview);
      liveStore.current.delete(m.id);
    }
  }, []);

  const clearPending = useCallback((revoke: boolean) => {
    if (revoke) pendingRef.current.forEach(revokePreview);
    setPending([]);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Aborts the running generation and frees the UI immediately (new chat, switching, deleting). */
  const abortActive = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    genRef.current += 1;
    streamingRef.current = false;
    setStreamingId(null);
  }, []);

  const buildRequest = useCallback((all: Message[]): ChatMessagePayload[] => {
    // Only the latest turns are sent: keeps requests small and responses fast.
    let history = all.slice(-MAX_HISTORY);
    while (history.length > 0 && history[0].role !== "user") history = history.slice(1);
    let lastUser = -1;
    history.forEach((m, i) => {
      if (m.role === "user") lastUser = i;
    });
    let oldTextBudget = OLD_TEXT_ATTACHMENT_BUDGET;
    const payload = history.map((m, i): ChatMessagePayload => {
      if (m.role === "assistant") return { role: "assistant", content: m.content };
      const stored = m.attachments ?? [];
      const liveAll = liveStore.current.get(m.id) ?? [];
      // Newest user message: everything. Older ones: only text files (within a budget), so an edit
      // request later in the chat still sees the file the user attached earlier.
      const sendable =
        i === lastUser
          ? liveAll
          : liveAll.filter((a) => {
              if (a.kind !== "document" || a.text === undefined || a.text.length > oldTextBudget) return false;
              oldTextBudget -= a.text.length;
              return true;
            });
      const unavailable = stored.filter((s) => !sendable.some((l) => l.id === s.id));
      let content = m.content;
      if (unavailable.length > 0) {
        const note = `[Previously attached: ${unavailable.map((a) => a.name).join(", ")}]`;
        content = content ? `${content}\n\n${note}` : note;
      }
      return { role: "user", content, attachments: sendable.length > 0 ? sendable.map(toPayloadAttachment) : undefined };
    });
    return payload;
  }, []);

  const generate = useCallback(
    async (convId: string, history: Message[]) => {
      const assistant: Message = { id: uid(), role: "assistant", content: "", createdAt: Date.now() };
      update((prev) => prev.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, assistant], updatedAt: Date.now() } : c)));
      const gen = ++genRef.current;
      setStreamingId(assistant.id);
      streamingRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      let buffer = "";
      let raf = 0;
      const flush = () => {
        raf = 0;
        if (!buffer) return;
        const chunk = buffer;
        buffer = "";
        patchMessage(convId, assistant.id, (m) => ({ ...m, content: m.content + chunk }));
      };

      const result = await streamChat(
        { messages: buildRequest(history) },
        {
          signal: controller.signal,
          onText: (t) => {
            buffer += t;
            if (!raf) raf = requestAnimationFrame(flush);
          },
          onReplace: (full) => {
            // Authoritative text: pending chunks are obsolete.
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
            buffer = "";
            patchMessage(convId, assistant.id, (m) => ({ ...m, content: full }));
          },
          onProgress: (message) => patchMessage(convId, assistant.id, (m) => ({ ...m, progress: message })),
        },
      );

      if (raf) cancelAnimationFrame(raf);
      flush();

      // Everything received stays in `content` whatever happened: it is a draft, never silently discarded.
      if (controller.signal.aborted) {
        patchMessage(convId, assistant.id, (m) => ({ ...m, stopped: true, progress: undefined }));
      } else if (!result.ok) {
        patchMessage(convId, assistant.id, (m) => ({ ...m, error: result.message, progress: undefined }));
      } else {
        patchMessage(convId, assistant.id, (m) => ({ ...m, progress: undefined }));
      }

      if (genRef.current === gen) {
        abortRef.current = null;
        streamingRef.current = false;
        setStreamingId(null);
      }
      update((prev) => prev.map((c) => (c.id === convId ? { ...c, updatedAt: Date.now() } : c)));
    },
    [buildRequest, patchMessage, update],
  );

  const send = useCallback(
    (text: string): boolean => {
      if (streamingRef.current) return false;
      const ready = pendingRef.current.filter((a) => a.status === "ready");
      if (pendingRef.current.some((a) => a.status === "processing")) return false;
      const content = text.trim();
      if (!content && ready.length === 0) return false;

      const weight = ready.reduce((sum, a) => sum + payloadWeight(a), content.length);
      if (weight > LIMITS.maxPayloadChars) {
        setNotice(ERRORS.tooLarge);
        return false;
      }

      const now = Date.now();
      const userMsg: Message = { id: uid(), role: "user", content, createdAt: now, attachments: ready.map(toStored) };
      if (ready.length > 0) liveStore.current.set(userMsg.id, ready);

      const existing = activeRef.current ? convRef.current.find((c) => c.id === activeRef.current) : undefined;
      const convId = existing?.id ?? uid();
      const history = [...(existing?.messages ?? []), userMsg];

      update((prev) => {
        if (existing) return prev.map((c) => (c.id === convId ? { ...c, messages: history, updatedAt: now } : c));
        const created: Conversation = {
          id: convId,
          title: makeTitle(content || ready[0]?.name || ""),
          messages: history,
          createdAt: now,
          updatedAt: now,
        };
        return [created, ...prev];
      });
      activeRef.current = convId;
      setActiveId(convId);
      setDraft("");
      clearPending(false);
      void generate(convId, history);
      return true;
    },
    [clearPending, generate, update],
  );

  const regenerate = useCallback(() => {
    if (streamingRef.current) return;
    const conv = convRef.current.find((c) => c.id === activeRef.current);
    if (!conv) return;
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const history = conv.messages.slice(0, -1);
    if (history.length === 0) return;
    update((prev) => prev.map((c) => (c.id === conv.id ? { ...c, messages: history } : c)));
    void generate(conv.id, history);
  }, [generate, update]);

  const newChat = useCallback(() => {
    abortActive();
    setActiveId(null);
    activeRef.current = null;
    setDraft("");
    clearPending(true);
  }, [abortActive, clearPending]);

  const selectConversation = useCallback(
    (id: string) => {
      if (id === activeRef.current) return;
      abortActive();
      setActiveId(id);
      activeRef.current = id;
      setDraft("");
      clearPending(true);
    },
    [abortActive, clearPending],
  );

  const renameConversation = useCallback(
    (id: string, title: string) => {
      const next = title.trim().slice(0, 80);
      if (!next) return;
      update((prev) => prev.map((c) => (c.id === id ? { ...c, title: next } : c)));
    },
    [update],
  );

  const deleteConversation = useCallback(
    (id: string) => {
      if (activeRef.current === id) abortActive();
      const target = convRef.current.find((c) => c.id === id);
      if (target) releaseMessages(target.messages);
      update((prev) => prev.filter((c) => c.id !== id));
      if (activeRef.current === id) {
        setActiveId(null);
        activeRef.current = null;
      }
    },
    [abortActive, releaseMessages, update],
  );

  const clearAll = useCallback(() => {
    abortActive();
    convRef.current.forEach((c) => releaseMessages(c.messages));
    clearConversations();
    update(() => []);
    setActiveId(null);
    activeRef.current = null;
    setDraft("");
    clearPending(true);
  }, [abortActive, clearPending, releaseMessages, update]);

  const addFiles = useCallback(async (files: File[]) => {
    const room = LIMITS.maxAttachmentsPerMessage - pendingRef.current.length;
    if (room <= 0) {
      setNotice(ERRORS.tooMany);
      return;
    }
    const accepted = files.slice(0, room);
    if (files.length > room) setNotice(ERRORS.tooMany);

    const placeholders: Attachment[] = accepted.map((f) => ({
      id: uid(),
      name: f.name,
      kind: classifyFile(f.name, f.type) ?? "document",
      mime: f.type,
      size: f.size,
      status: "processing",
    }));
    setPending((prev) => [...prev, ...placeholders]);

    await Promise.all(
      accepted.map(async (file, i) => {
        const result = await processFile(file);
        const phId = placeholders[i].id;
        if (result.status === "error") setNotice(result.error ?? ERRORS.failed);
        setPending((prev) => {
          // Removed while processing: free the preview and drop the result.
          if (!prev.some((a) => a.id === phId)) {
            revokePreview(result);
            return prev;
          }
          return prev.map((a) => (a.id === phId ? result : a));
        });
      }),
    );
  }, []);

  const removePending = useCallback((id: string) => {
    setPending((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) revokePreview(target);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const getLive = useCallback((messageId: string) => liveStore.current.get(messageId), []);

  const active = useMemo(() => conversations.find((c) => c.id === activeId) ?? null, [conversations, activeId]);

  return {
    hydrated,
    conversations,
    active,
    activeId,
    streamingId,
    isStreaming: streamingId !== null,
    notice,
    dismissNotice: () => setNotice(null),
    draft,
    setDraft,
    pending,
    send,
    stop,
    regenerate,
    newChat,
    selectConversation,
    renameConversation,
    deleteConversation,
    clearAll,
    addFiles,
    removePending,
    getLive,
  };
}
