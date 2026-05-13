import { useState, useCallback } from "react";
import { ExternalLink } from "lucide-react";
import type { CitationSource } from "../types";
import { cn } from "../lib/utils";
import { Popover } from "./ui/popover";

export function SourcesPopover({ sources }: { sources: CitationSource[] }) {
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  if (sources.length === 0) return null;

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      align="end"
      trigger={
        <button
          type="button"
          onClick={() => setOpen(!open)}
          title="引用来源"
          aria-label="引用来源"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
        >
          <ExternalLink size={14} />
        </button>
      }
    >
      <div className="min-w-60 max-w-80">
        <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
          引用来源
        </p>
        <ul className="space-y-0.5">
          {sources.map((source) => (
            <li key={source.url}>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "block truncate rounded-sm px-1 py-1 text-sm",
                  "text-popover-foreground hover:bg-accent hover:text-accent-foreground",
                  "transition-colors",
                )}
                title={source.url}
              >
                {source.title || source.url}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Popover>
  );
}
