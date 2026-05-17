import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { ImageIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { useMediaUrl } from "../hooks/useMediaUrl";
import { Dialog } from "./ui/dialog";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /**
   * Defer expensive re-parses while content is rapidly changing.
   * When true (default), content updates are batched at ~5 fps during streaming so the
   * ReactMarkdown pipeline doesn't re-run on every 1-3 char delta. Forced flushes still
   * occur at paragraph boundaries (double newline) and when content stops changing.
   */
  streaming?: boolean;
}

/**
 * Throttle live-streaming content to ~5 updates per second to limit how often
 * the heavyweight ReactMarkdown + remarkGfm + remarkBreaks pipeline re-parses.
 *
 * Flushes immediately on:
 *  - paragraph boundary (\n\n) detected in the latest tail
 *  - content shrinking (snapshot reset)
 *  - streaming -> false (final state)
 */
const STREAMING_UPDATE_INTERVAL_MS = 200;

function useDeferredStreamingContent(content: string, streaming: boolean): string {
  const [deferred, setDeferred] = useState(content);
  const lastFlushAtRef = useRef<number>(Date.now());
  const pendingRef = useRef<string>(content);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    pendingRef.current = content;

    if (!streaming) {
      // Settled: flush immediately and clear any pending timer.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      lastFlushAtRef.current = Date.now();
      setDeferred(content);
      return;
    }

    // Force immediate flush on content shrink (snapshot replaced) or paragraph boundary.
    const lastTail = content.slice(Math.max(0, content.length - 4));
    const isParagraphBoundary = lastTail.includes("\n\n");
    const isShrink = content.length < deferred.length;
    if (isShrink || isParagraphBoundary) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      lastFlushAtRef.current = Date.now();
      setDeferred(content);
      return;
    }

    // Streaming with no immediate-flush trigger: schedule next flush so we update at
    // most every STREAMING_UPDATE_INTERVAL_MS.
    const elapsed = Date.now() - lastFlushAtRef.current;
    const wait = Math.max(0, STREAMING_UPDATE_INTERVAL_MS - elapsed);
    if (timerRef.current) {
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastFlushAtRef.current = Date.now();
      setDeferred(pendingRef.current);
    }, wait);

    return () => {
      // Cleanup is handled by the next effect run or unmount.
    };
  }, [content, streaming, deferred.length]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return deferred;
}

export function normalizeMarkdownContent(content: string): string {
  const lines = content.split(/\r?\n/);
  const normalized: string[] = [];
  let inFencedCode = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\s*(```|~~~)/.test(line)) {
      inFencedCode = !inFencedCode;
      normalized.push(line);
      continue;
    }
    if (inFencedCode) {
      normalized.push(line);
      continue;
    }

    const nextLine = lines[index + 1] ?? "";
    const headingWithTableHeader = line.match(/^(\s{0,3})(#{1,6})(?!#)\s*([^|]+?)\s+(\|.+\|)\s*$/);
    if (headingWithTableHeader && isMarkdownTableDelimiter(nextLine)) {
      const [, indent, hashes, heading, tableHeader] = headingWithTableHeader;
      normalized.push(`${indent}${hashes} ${heading.trim()}`, "", `${indent}${tableHeader.trim()}`);
      continue;
    }

    const compactHeading = line.match(/^(\s{0,3})(#{1,6})(?!#)(\S.*)$/);
    if (compactHeading) {
      const [, indent, hashes, heading] = compactHeading;
      normalized.push(`${indent}${hashes} ${heading.trimStart()}`);
      continue;
    }

    normalized.push(line);
  }

  return normalized.join("\n");
}

function isMarkdownTableDelimiter(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

/**
 * Inline media image component.
 * Resolves local file paths via Tauri convertFileSrc or uses HTTP URLs directly.
 * Supports loading skeleton, error fallback, and click-to-enlarge.
 */
function MediaImg({ src, alt }: { src?: string; alt?: string }) {
  const { resolvedUrl, loading, error } = useMediaUrl(src);
  const [enlarged, setEnlarged] = useState(false);

  const handleClick = useCallback(() => {
    if (resolvedUrl && !loading && !error) {
      setEnlarged(true);
    }
  }, [resolvedUrl, loading, error]);

  // Loading skeleton
  if (loading) {
    return (
      <span
        className={cn(
          "my-3 block h-48 w-full max-w-full animate-pulse rounded-lg border border-border bg-muted/45",
        )}
        role="status"
        aria-label="Loading image"
      />
    );
  }

  // Error / unresolvable fallback
  if (error || !resolvedUrl) {
    return (
      <span
        className={cn(
          "my-3 flex items-center gap-2 rounded-lg border border-border bg-card/70 px-4 py-3 text-sm text-muted-foreground",
        )}
      >
        <ImageIcon size={16} className="shrink-0" />
        <span className="truncate">{alt || src || "Image unavailable"}</span>
      </span>
    );
  }

  return (
    <>
      <img
        src={resolvedUrl}
        alt={alt ?? ""}
        className="my-3 max-h-96 max-w-full cursor-pointer rounded-lg object-contain"
        loading="lazy"
        onClick={handleClick}
        onError={(e) => {
          // Fallback to broken image placeholder on load failure
          const target = e.currentTarget;
          target.style.display = "none";
          const placeholder = target.nextElementSibling;
          if (placeholder instanceof HTMLElement) {
            placeholder.style.display = "flex";
          }
        }}
      />
      {/* Hidden fallback shown via onError */}
      <span
        className="my-3 hidden items-center gap-2 rounded-lg border border-border bg-card/70 px-4 py-3 text-sm text-muted-foreground"
        aria-hidden="true"
      >
        <ImageIcon size={16} className="shrink-0" />
        <span className="truncate">Failed to load image</span>
      </span>
      {/* Click-to-enlarge dialog */}
      <Dialog open={enlarged} onOpenChange={setEnlarged}>
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setEnlarged(false)}
        >
          <img
            src={resolvedUrl}
            alt={alt ?? ""}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </Dialog>
    </>
  );
}

/**
 * Sanitize schema: allow only img, video, source HTML tags in addition to default schema.
 */
const mediaSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "img", "video", "source"],
  attributes: {
    ...defaultSchema.attributes,
    img: ["src", "alt", "width", "height", "loading"],
    video: ["src", "controls", "width", "height", "autoplay", "loop", "muted", "playsinline", "poster"],
    source: ["src", "type"],
  },
};

/**
 * Styles for inline <video> elements rendered via rehype-raw.
 * We inject a small CSS snippet via a wrapper class.
 */
const VIDEO_WRAPPER_CLASS = "ora-media-video-wrapper";

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
  img: ({ src, alt, ...props }) => <MediaImg src={src} alt={alt} {...props} />,
};

export default function MarkdownRenderer({ content, className, streaming = false }: MarkdownRendererProps) {
  const deferredContent = useDeferredStreamingContent(content, streaming);
  return (
    <div className={cn("max-w-full break-words", VIDEO_WRAPPER_CLASS, className)}>
      <style>{`
        .${VIDEO_WRAPPER_CLASS} video {
          max-width: 100%;
          max-height: 24rem;
          border-radius: 0.5rem;
          margin-top: 0.75rem;
          margin-bottom: 0.75rem;
        }
        .${VIDEO_WRAPPER_CLASS} video:first-child {
          margin-top: 0;
        }
        .${VIDEO_WRAPPER_CLASS} video:last-child {
          margin-bottom: 0;
        }
      `}</style>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, mediaSanitizeSchema],
        ]}
        components={markdownComponents}
      >
        {normalizeMarkdownContent(deferredContent)}
      </ReactMarkdown>
    </div>
  );
}
