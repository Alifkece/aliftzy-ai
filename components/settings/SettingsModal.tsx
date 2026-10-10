"use client";

import { useState } from "react";
import type { AppSettings, ThemeSetting } from "@/types";
import { Modal } from "@/components/ui/Modal";
import { Logo } from "@/components/ui/Logo";
import { MonitorIcon, MoonIcon, SunIcon } from "@/components/ui/icons";

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  modelLabel: string;
  onClose: () => void;
  onChange: (s: AppSettings) => void;
  onClearAll: () => void;
}

const THEMES: { id: ThemeSetting; label: string; Icon: typeof SunIcon }[] = [
  { id: "dark", label: "Dark", Icon: MoonIcon },
  { id: "light", label: "Light", Icon: SunIcon },
  { id: "system", label: "System", Icon: MonitorIcon },
];

export function SettingsModal({ open, settings, modelLabel, onClose, onChange, onClearAll }: SettingsModalProps) {
  const [confirming, setConfirming] = useState(false);

  const close = () => {
    setConfirming(false);
    onClose();
  };

  return (
    <Modal open={open} title="Settings" onClose={close}>
      <section aria-labelledby="theme-heading">
        <h3 id="theme-heading" className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
          Theme
        </h3>
        <div role="radiogroup" aria-labelledby="theme-heading" className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-bg/60 p-1">
          {THEMES.map(({ id, label, Icon }) => {
            const selected = settings.theme === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ ...settings, theme: id })}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition duration-200 active:scale-95 ${
                  selected ? "bg-raised text-fg shadow" : "text-muted hover:text-fg"
                }`}
              >
                <Icon width={15} height={15} />
                {label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-6" aria-labelledby="data-heading">
        <h3 id="data-heading" className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
          Data
        </h3>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="w-full rounded-xl border border-line px-4 py-2.5 text-left text-sm transition hover:border-red-500/40 hover:text-red-400 active:scale-[0.99]"
          >
            Clear Conversations
          </button>
        ) : (
          <div className="animate-pop rounded-xl border border-red-500/30 bg-red-500/5 p-3.5">
            <p className="text-sm">Delete all conversations stored in this browser?</p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-line px-3 py-1.5 text-sm transition hover:bg-raised active:scale-95">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onClearAll();
                  close();
                }}
                className="rounded-lg bg-red-500/90 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-500 active:scale-95"
              >
                Delete all
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="mt-6 border-t border-line pt-5" aria-labelledby="about-heading">
        <h3 id="about-heading" className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
          About
        </h3>
        <div className="flex items-start gap-3">
          <Logo size={34} />
          <div className="text-sm">
            <p className="font-medium">Aliftzy Codes AI</p>
            <p className="mt-0.5 text-muted">
              A private AI chat powered by {modelLabel}. Your API key stays on the server; conversations are stored only in this browser.
            </p>
          </div>
        </div>
      </section>
    </Modal>
  );
}
