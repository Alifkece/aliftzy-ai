"use client";

import { Logo } from "@/components/ui/Logo";
import { MenuIcon } from "@/components/ui/icons";

interface HeaderProps {
  title: string | null;
  modelLabel: string;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

export function Header({ title, modelLabel, onToggleSidebar, sidebarOpen }: HeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line/70 px-3 sm:px-5">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        aria-expanded={sidebarOpen}
        aria-controls="sidebar"
        className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-raised hover:text-fg active:scale-90"
      >
        <MenuIcon />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Logo size={20} className="shrink-0 sm:hidden" />
        <span className="hidden text-[11px] font-semibold uppercase tracking-[0.22em] sm:block">Aliftzy Codes AI</span>
        {title && (
          <>
            <span className="hidden text-line sm:block" aria-hidden="true">
              /
            </span>
            <h1 className="truncate text-sm text-muted" title={title}>
              {title}
            </h1>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan" aria-hidden="true" />
        <span className="sr-only">Model:</span>
        {modelLabel}
      </div>
    </header>
  );
}
