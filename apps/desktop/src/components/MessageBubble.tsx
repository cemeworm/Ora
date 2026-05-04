import type { ReactNode } from "react";
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
    <div className={cn("group relative flex w-full flex-col gap-2", isUser ? "items-end" : "items-start", className)}>
      <div className="flex max-w-full">
        <div className={cn("min-w-0 max-w-full text-sm leading-6", isUser ? "w-fit max-w-[min(72ch,calc(100vw-6rem))]" : "w-full")}>
          <div
            className={cn(
              isUser
                ? "rounded-[22px] bg-secondary px-4 py-3 text-foreground"
                : "rounded-[22px] border border-transparent bg-transparent text-foreground",
            )}
          >
            {content ? <MarkdownContent content={content} /> : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
