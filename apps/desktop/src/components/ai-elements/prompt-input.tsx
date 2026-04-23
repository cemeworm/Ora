import type { FormHTMLAttributes, HTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function PromptInput({ className, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  return <form className={cn("rounded-2xl border border-border bg-background/85 shadow-lift backdrop-blur-sm", className)} {...props} />;
}

export function PromptInputBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("relative", className)} {...props} />;
}

export function PromptInputFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-between gap-2 px-2 pb-2", className)} {...props} />;
}

export function PromptInputTextarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn("w-full resize-none bg-transparent px-4 py-4 text-sm outline-none placeholder:text-muted-foreground", className)}
      {...props}
    />
  );
}
