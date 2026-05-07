import { lazy, Suspense } from "react";
import { cn } from "../lib/utils";

const MarkdownRenderer = lazy(() => import("./MarkdownRenderer"));

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <Suspense
      fallback={
        <div className={cn("max-w-full break-words whitespace-pre-wrap", className)}>
          {content}
        </div>
      }
    >
      <MarkdownRenderer content={content} className={className} />
    </Suspense>
  );
}
