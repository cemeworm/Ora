import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

// Minimal DeerFlow-inspired AI element subset for Ora desktop.
export function Conversation({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="log" className={cn("relative flex flex-1 flex-col overflow-y-auto", className)} {...props} />;
}

export function ConversationContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-8 p-4", className)} {...props} />;
}
