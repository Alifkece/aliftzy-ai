"use client";

import { Children, isValidElement, memo, type ComponentProps, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./CodeBlock";
import { nameFromMeta } from "@/lib/chat/code-export";

/**
 * Safe rendering: react-markdown does not render raw HTML (no rehype-raw), and link URLs are
 * restricted to http(s)/mailto. Code is highlighted into React elements, never injected as HTML.
 */

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return "";
}

function safeUrl(url: string): string {
  try {
    const u = new URL(url, "https://placeholder.invalid");
    if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:") return url;
  } catch {
    /* fallthrough */
  }
  return "";
}

const components: Components = {
  a({ href, children }) {
    const safe = href ? safeUrl(href) : "";
    if (!safe) return <span>{children}</span>;
    return (
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  },
  pre({ node, children }) {
    const meta = (node?.children?.[0] as { data?: { meta?: string } } | undefined)?.data?.meta;
    const first = Children.toArray(children)[0] as ReactElement<ComponentProps<"code">> | undefined;
    const className = isValidElement(first) ? (first.props.className ?? "") : "";
    const language = /language-([\w+#-]+)/.exec(className)?.[1] ?? "";
    const text = nodeText(isValidElement(first) ? first.props.children : children).replace(/\n$/, "");
    return (
      <CodeBlock language={language} text={text} filename={nameFromMeta(meta)}>
        <pre className="scroll-thin">{children}</pre>
      </CodeBlock>
    );
  },
  table({ children }) {
    return (
      <div className="table-wrap scroll-thin">
        <table>{children}</table>
      </div>
    );
  },
  img({ alt }) {
    // Remote images are not loaded (privacy + no tracking pixels). Show alt text instead.
    return <span className="text-muted">[image{alt ? `: ${alt}` : ""}]</span>;
  },
};

interface MarkdownProps {
  content: string;
}

function MarkdownImpl({ content }: MarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
      components={components}
      urlTransform={safeUrl}
    >
      {content}
    </ReactMarkdown>
  );
}

export const Markdown = memo(MarkdownImpl);
