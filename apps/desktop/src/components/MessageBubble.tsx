import type { ReactNode } from "react";
import { Bot, UserRound } from "lucide-react";
import type { ChatMessage } from "../types";
import { cn } from "../lib/utils";

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
      <div className={cn("flex max-w-full gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
        <div
          className={cn(
            "mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs",
            isUser && "mt-2.5 bg-secondary text-foreground",
          )}
        >
          {isUser ? <UserRound size={14} /> : <Bot size={14} />}
        </div>
        <div className={cn("min-w-0 max-w-full text-sm leading-6", isUser ? "w-fit max-w-[min(72ch,calc(100vw-6rem))]" : "w-full")}>
          <div
            className={cn(
              isUser
                ? "rounded-[22px] bg-secondary px-4 py-3 text-foreground"
                : "rounded-[22px] border border-transparent bg-transparent text-foreground",
            )}
          >
            {content ? <p className="whitespace-pre-wrap break-words">{content}</p> : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
