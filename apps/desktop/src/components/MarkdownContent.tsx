import { lazy, Suspense } from "react";
import { cn } from "../lib/utils";

const MarkdownRenderer = lazy(() => import("./MarkdownRenderer"));

interface MarkdownContentProps {
  content: string;
  className?: string;
  /**
   * Pass `true` when this content is currently being streamed (delta-by-delta).
   * The renderer throttles re-parses to ~5 fps to avoid dominating frame budget.
   */
  streaming?: boolean;
}

export function MarkdownContent({ content, className, streaming }: MarkdownContentProps) {
  return (
    <Suspense
      fallback={
        <div className={cn("max-w-full break-words whitespace-pre-wrap", className)}>
          {content}
        </div>
      }
    >
      <MarkdownRenderer content={content} className={className} streaming={streaming} />
    </Suspense>
  );
}
