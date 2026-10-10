"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";

/**
 * Syntax-highlighted, read-only source view. Uses the pipeline that is already installed (react-markdown +
 * rehype-highlight). The fence is always longer than any backtick run inside the code, so file content that
 * itself contains ``` can never break out of the block. Highlighting produces React elements only.
 */
function fenceFor(code: string): string {
  const runs = code.match(/`+/g) ?? [];
  const longest = runs.reduce((m, r) => Math.max(m, r.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

function Impl({ code, language }: { code: string; language: string }) {
  const fence = fenceFor(code);
  const lang = language.replace(/[^a-z0-9+#-]/gi, "");
  return (
    <ReactMarkdown
      rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
      components={{ pre: ({ children }) => <pre className="file-code scroll-thin">{children}</pre> }}
    >
      {`${fence}${lang}\n${code}\n${fence}`}
    </ReactMarkdown>
  );
}

export const HighlightedCode = memo(Impl);
