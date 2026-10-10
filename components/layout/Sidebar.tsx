"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Conversation } from "@/types";
import { formatTime, groupConversations } from "@/lib/chat/group";
import { Logo } from "@/components/ui/Logo";
import { Modal } from "@/components/ui/Modal";
import { DotsIcon, PencilIcon, PlusIcon, SearchIcon, SettingsIcon, TrashIcon } from "@/components/ui/icons";

interface SidebarProps {
  open: boolean;
  conversations: Conversation[];
  activeId: string | null;
  onClose: () => void;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
}

interface MenuState {
  id: string;
  top: number;
  left: number;
}

export function Sidebar({ open, conversations, activeId, onClose, onNewChat, onSelect, onRename, onDelete, onOpenSettings }: SidebarProps) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? conversations.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)))
      : conversations;
    return groupConversations(filtered);
  }, [conversations, query]);

  // Close menu on outside click / Escape.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    if (renamingId) renameRef.current?.select();
  }, [renamingId]);

  // Escape closes the drawer on small screens.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && window.matchMedia("(max-width: 1023px)").matches && !menu && !deleteTarget) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, menu, deleteTarget]);

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue);
    setRenamingId(null);
  };

  const openMenu = (e: ReactMouseEvent<HTMLButtonElement>, id: string) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu(menu?.id === id ? null : { id, top: r.bottom + 4, left: Math.max(8, r.right - 168) });
  };

  const menuTarget = menu ? conversations.find((c) => c.id === menu.id) : undefined;

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-black/60 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        id="sidebar"
        aria-label="Sidebar"
        inert={!open}
        className={`fixed inset-y-0 left-0 z-40 w-[300px] max-w-[86vw] overflow-hidden border-r border-line bg-surface transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:relative lg:z-auto lg:max-w-none lg:translate-x-0 ${
          open ? "translate-x-0 lg:w-[290px]" : "-translate-x-full lg:w-0 lg:border-r-0"
        }`}
      >
        <div className="flex h-full w-[300px] max-w-[86vw] flex-col lg:w-[290px] lg:max-w-none">
          <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
            <Logo size={26} title="Aliftzy Codes AI" />
            <span className="text-[13px] font-semibold uppercase tracking-[0.2em]">Aliftzy Codes AI</span>
          </div>

          <div className="px-3">
            <button
              type="button"
              onClick={() => {
                onNewChat();
                if (window.matchMedia("(max-width: 1023px)").matches) onClose();
              }}
              className="group flex w-full items-center gap-2.5 rounded-xl border border-line bg-raised px-3.5 py-2.5 text-sm font-medium transition duration-200 hover:border-violet/50 active:scale-[0.98]"
            >
              <PlusIcon className="text-violet transition-transform duration-300 group-hover:rotate-90" />
              New Chat
            </button>

            <div className="relative mt-2.5">
              <SearchIcon width={16} height={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <label htmlFor="search-conversations" className="sr-only">
                Search conversations
              </label>
              <input
                id="search-conversations"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                autoComplete="off"
                className="w-full rounded-xl border border-transparent bg-bg/60 py-2 pl-9 pr-3 text-sm outline-none transition placeholder:text-muted/70 focus:border-violet/50 focus:bg-bg"
              />
            </div>
          </div>

          <nav aria-label="Conversation history" className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {groups.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted">{query ? "No conversations found." : "No conversations yet."}</p>
            )}
            {groups.map((g) => (
              <section key={g.label} className="mb-3">
                <h2 className="px-3 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted">{g.label}</h2>
                <ul className="space-y-0.5">
                  {g.items.map((c) => {
                    const active = c.id === activeId;
                    return (
                      <li key={c.id} className="group relative">
                        {renamingId === c.id ? (
                          <input
                            ref={renameRef}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename();
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            maxLength={80}
                            aria-label="Rename conversation"
                            className="w-full rounded-xl border border-violet/50 bg-bg px-3 py-2 text-sm outline-none"
                          />
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                onSelect(c.id);
                                if (window.matchMedia("(max-width: 1023px)").matches) onClose();
                              }}
                              aria-current={active ? "page" : undefined}
                              className={`flex w-full flex-col rounded-xl px-3 py-2 pr-9 text-left transition duration-150 active:scale-[0.99] ${
                                active ? "bg-raised" : "hover:bg-raised/60"
                              }`}
                            >
                              <span className={`truncate text-sm ${active ? "text-fg" : "text-fg/85"}`}>{c.title}</span>
                              <span className="text-[11px] text-muted">{formatTime(c.updatedAt)}</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => openMenu(e, c.id)}
                              aria-label={`Options for ${c.title}`}
                              aria-haspopup="menu"
                              aria-expanded={menu?.id === c.id}
                              className={`absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition hover:bg-bg hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 ${
                                menu?.id === c.id ? "opacity-100" : "opacity-0 max-lg:opacity-100"
                              }`}
                            >
                              <DotsIcon width={16} height={16} />
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </nav>

          <div className="border-t border-line p-2">
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-fg/85 transition hover:bg-raised active:scale-[0.98]"
            >
              <SettingsIcon className="text-muted" />
              Settings
            </button>
          </div>
        </div>
      </aside>

      {menu && menuTarget && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Conversation options"
          style={{ top: menu.top, left: menu.left }}
          className="fixed z-[60] w-[168px] animate-pop rounded-xl border border-line bg-raised p-1 shadow-2xl"
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              setRenameValue(menuTarget.title);
              setRenamingId(menuTarget.id);
              setMenu(null);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition hover:bg-surface"
          >
            <PencilIcon width={15} height={15} className="text-muted" />
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setDeleteTarget(menuTarget);
              setMenu(null);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-400 transition hover:bg-red-500/10"
          >
            <TrashIcon width={15} height={15} />
            Delete
          </button>
        </div>
      )}

      <Modal open={deleteTarget !== null} title="Delete conversation?" onClose={() => setDeleteTarget(null)}>
        <p className="text-sm text-muted">
          “{deleteTarget?.title}” will be permanently removed from this browser. This can’t be undone.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={() => setDeleteTarget(null)} className="rounded-xl border border-line px-4 py-2 text-sm transition hover:bg-raised active:scale-95">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (deleteTarget) onDelete(deleteTarget.id);
              setDeleteTarget(null);
            }}
            className="rounded-xl bg-red-500/90 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 active:scale-95"
          >
            Delete
          </button>
        </div>
      </Modal>
    </>
  );
}
