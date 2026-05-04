import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

// Minimal DeerFlow-inspired AI element subset for Ora desktop.
export const Conversation = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Conversation(
  { className, ...props },
  ref,
) {
  return <div ref={ref} role="log" className={cn("relative flex flex-1 flex-col", className)} {...props} />;
});

export function ConversationContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-8 p-4", className)} {...props} />;
}
