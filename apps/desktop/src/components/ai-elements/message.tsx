import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Message({
  className,
  from,
  ...props
}: HTMLAttributes<HTMLDivElement> & { from: "user" | "assistant" | "system" }) {
  return (
    <div
      className={cn("group flex w-full flex-col gap-2", from === "user" ? "ml-auto items-end" : "items-start", className)}
      {...props}
    />
  );
}

export function MessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("max-w-full text-sm leading-6", className)} {...props} />;
}
