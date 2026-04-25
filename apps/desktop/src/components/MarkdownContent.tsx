import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/utils";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

const markdownComponents: Components = {
  p: ({ className, ...props }) => (
    <p className={cn("my-2 whitespace-pre-wrap break-words first:mt-0 last:mb-0", className)} {...props} />
  ),
  h1: ({ className, ...props }) => (
    <h1 className={cn("mb-3 mt-5 text-lg font-semibold leading-7 first:mt-0", className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cn("mb-2.5 mt-4 text-base font-semibold leading-7 first:mt-0", className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn("mb-2 mt-3 text-sm font-semibold leading-6 first:mt-0", className)} {...props} />
  ),
  ul: ({ className, ...props }) => <ul className={cn("my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0", className)} {...props} />,
  ol: ({ className, ...props }) => <ol className={cn("my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0", className)} {...props} />,
  li: ({ className, ...props }) => <li className={cn("pl-1 marker:text-muted-foreground", className)} {...props} />,
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn("my-3 border-l-2 border-border pl-3 text-muted-foreground first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn("font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground", className)}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = className?.startsWith("language-") || String(children).includes("\n");
    return (
      <code
        className={cn(
          isBlock
            ? "block bg-transparent p-0 font-mono text-[0.82rem] leading-6"
            : "rounded-sm border border-border bg-muted/55 px-1 py-0.5 font-mono text-[0.82em]",
          className,
        )}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "my-3 max-w-full overflow-x-auto rounded-md border border-border bg-muted/45 p-3 text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => <hr className={cn("my-4 border-border", className)} {...props} />,
  table: ({ className, ...props }) => (
    <div className="my-3 max-w-full overflow-x-auto first:mt-0 last:mb-0">
      <table className={cn("w-full border-collapse text-left text-sm", className)} {...props} />
    </div>
  ),
  th: ({ className, ...props }) => (
    <th className={cn("border border-border bg-muted/45 px-2 py-1.5 font-semibold", className)} {...props} />
  ),
  td: ({ className, ...props }) => <td className={cn("border border-border px-2 py-1.5 align-top", className)} {...props} />,
};

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn("max-w-full break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
