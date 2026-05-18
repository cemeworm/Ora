import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import type { ChatMessage } from "../types";
import { cn } from "../lib/utils";
import { MarkdownContent } from "./MarkdownContent";

interface MessageBubbleProps {
  role: ChatMessage["role"];
  content: string;
  children?: ReactNode;
  className?: string;
}

export function MessageBubble({ role, content, children, className }: MessageBubbleProps) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);
  const canCopyContent = isUser && content.trim().length > 0;

  async function handleCopyContent() {
    if (!content.trim()) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const copiedWithFallback = document.execCommand("copy");
        document.body.removeChild(textarea);

        if (!copiedWithFallback) {
          return;
        }
      }

      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (role === "system") {
    return (
      <div className="flex w-full justify-center">
        <div className="rounded-full border border-border bg-background/80 px-3 py-1 text-xs text-muted-foreground shadow-xs backdrop-blur">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("group relative flex w-full flex-col gap-1.5", isUser ? "items-end" : "items-start", className)}>
      <div className="flex max-w-full">
        <div className={cn("min-w-0 max-w-full text-sm leading-6", isUser ? "w-fit max-w-[min(72ch,calc(100vw-6rem))]" : "w-full")}>
          <div
            className={cn(
              isUser
                ? "rounded-2xl rounded-br-md bg-card px-3.5 py-2.5 text-foreground shadow-xs ring-1 ring-inset ring-border"
                : "rounded-[22px] border border-transparent bg-transparent text-foreground",
            )}
          >
            {content ? <MarkdownContent content={content} /> : null}
          </div>
          {children}
          {canCopyContent ? (
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => void handleCopyContent()}
                title={copied ? "已复制" : "复制"}
                aria-label={copied ? "已复制" : "复制消息"}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 opacity-80 transition hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
