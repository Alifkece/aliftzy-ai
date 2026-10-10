"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@/lib/chat/use-chat";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "@/lib/chat/storage";
import type { AppSettings, ModelInfo } from "@/types";
import { DropZone } from "@/components/attachments/DropZone";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { CloseIcon } from "@/components/ui/icons";
import { Composer } from "./Composer";
import { EmptyState, type Suggestion } from "./EmptyState";
import { MessageList } from "./MessageList";

function applyTheme(theme: AppSettings["theme"]) {
  const resolved = theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function ChatApp() {
  const chat = useChat();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelLabel, setModelLabel] = useState("Gemini");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Settings + initial sidebar state (open on desktop, drawer closed on small screens).
  useEffect(() => {
    setSettings(loadSettings());
    setSidebarOpen(window.matchMedia("(min-width: 1024px)").matches);
  }, []);

  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings.theme]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<ModelInfo>) : null))
      .then((info) => {
        if (info && typeof info.label === "string") setModelLabel(info.label);
      })
      .catch(() => {
        /* keep default label */
      });
    return () => controller.abort();
  }, []);

  const changeSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const { setDraft, addFiles, send } = chat;

  const onSuggestion = useCallback(
    (s: Suggestion) => {
      setDraft(s.prompt);
      if (s.pickFile) fileInputRef.current?.click();
      else requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [setDraft],
  );

  const onSend = useCallback(() => {
    send(chat.draft);
  }, [send, chat.draft]);

  // Focus the composer when switching chats on desktop.
  useEffect(() => {
    if (chat.hydrated && window.matchMedia("(min-width: 1024px)").matches) textareaRef.current?.focus();
  }, [chat.activeId, chat.hydrated]);

  const hasMessages = chat.active !== null && chat.active.messages.length > 0;

  return (
    <div className="enter flex h-dvh w-full overflow-hidden bg-bg">
      <Sidebar
        open={sidebarOpen}
        conversations={chat.conversations}
        activeId={chat.activeId}
        onClose={() => setSidebarOpen(false)}
        onNewChat={chat.newChat}
        onSelect={chat.selectConversation}
        onRename={chat.renameConversation}
        onDelete={chat.deleteConversation}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <Header
          title={chat.active?.title ?? null}
          modelLabel={modelLabel}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />

        <DropZone onFiles={addFiles} className="flex min-h-0 flex-1 flex-col">
          {hasMessages && chat.active ? (
            <MessageList
              conversationId={chat.active.id}
              messages={chat.active.messages}
              streamingId={chat.streamingId}
              getLive={chat.getLive}
              onRegenerate={chat.regenerate}
            />
          ) : (
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              <EmptyState onPick={onSuggestion} />
            </div>
          )}

          {chat.notice && (
            <div className="px-3 sm:px-6">
              <div
                role="alert"
                className="mx-auto mb-2 flex max-w-3xl animate-rise items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-sm text-red-400"
              >
                <span>{chat.notice}</span>
                <button type="button" onClick={chat.dismissNotice} aria-label="Dismiss" className="rounded-md p-1 transition hover:bg-red-500/10 active:scale-90">
                  <CloseIcon width={14} height={14} />
                </button>
              </div>
            </div>
          )}

          <Composer
            value={chat.draft}
            onChange={chat.setDraft}
            attachments={chat.pending}
            onRemoveAttachment={chat.removePending}
            onFiles={addFiles}
            onSend={onSend}
            onStop={chat.stop}
            isStreaming={chat.isStreaming}
            textareaRef={textareaRef}
            fileInputRef={fileInputRef}
          />
        </DropZone>
      </main>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        modelLabel={modelLabel}
        onClose={() => setSettingsOpen(false)}
        onChange={changeSettings}
        onClearAll={chat.clearAll}
      />
    </div>
  );
}
