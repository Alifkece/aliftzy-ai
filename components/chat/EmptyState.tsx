"use client";

import { AICore } from "@/components/ui/AICore";

export interface Suggestion {
  label: string;
  prompt: string;
  pickFile?: boolean;
}

export const SUGGESTIONS: Suggestion[] = [
  { label: "Build a website", prompt: "Build a modern, responsive landing page for a coffee roastery using HTML and CSS. " },
  { label: "Analyze this image", prompt: "Analyze this image and describe what you see in detail.", pickFile: true },
  { label: "Explain this code", prompt: "Explain what this code does, step by step:\n\n```\n\n```" },
  { label: "Help me debug", prompt: "Help me debug this problem. Here is the error and the relevant code:\n\n" },
  { label: "Write a script", prompt: "Write a script that " },
];

interface EmptyStateProps {
  onPick: (s: Suggestion) => void;
}

export function EmptyState({ onPick }: EmptyStateProps) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-5 py-10 text-center">
      <div className="animate-fade">
        <AICore size={132} float />
      </div>
      <p className="enter mt-9 text-xs font-medium uppercase tracking-[0.32em] text-muted [animation-delay:80ms]">Aliftzy Codes AI</p>
      <h1 className="enter mt-3 text-3xl font-semibold tracking-tight [animation-delay:140ms] sm:text-4xl">How can I help you today?</h1>
      <p className="enter mt-3 text-muted [animation-delay:200ms]">Ask anything. Build anything.</p>

      <ul className="mt-9 flex flex-wrap justify-center gap-2.5" aria-label="Suggested prompts">
        {SUGGESTIONS.map((s, i) => (
          <li key={s.label} className="enter" style={{ animationDelay: `${280 + i * 55}ms` }}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="rounded-full border border-line bg-surface px-4 py-2 text-sm text-fg/90 transition duration-200 hover:-translate-y-0.5 hover:border-violet/50 hover:bg-raised hover:text-fg active:translate-y-0 active:scale-[0.97]"
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
