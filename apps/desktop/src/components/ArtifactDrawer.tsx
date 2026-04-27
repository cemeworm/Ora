import { FileImage, FileJson, FileText, X } from "lucide-react";
import { JsonTree } from "./JsonTree";
import { MarkdownContent } from "./MarkdownContent";
import { Button } from "./ui/button";
import type { ArtifactRecord } from "../types";

interface ArtifactDrawerProps {
  artifact?: ArtifactRecord;
  onClose: () => void;
}

export function ArtifactDrawer({ artifact, onClose }: ArtifactDrawerProps) {
  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-transparent">
      <header className="flex h-12 shrink-0 items-center justify-between bg-card/74 px-4 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2">
          <ArtifactKindIcon artifact={artifact} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium">Artifact</h2>
            <p data-i18n-skip={artifact ? "" : undefined} className="truncate text-[11px] text-muted-foreground">
              {artifact?.label ?? "No artifact selected"}
            </p>
          </div>
        </div>
        <Button onClick={onClose} variant="ghost" size="icon-sm" title="Close artifact">
          <X size={16} />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
        {artifact ? (
          <div data-i18n-skip="" className="flex min-h-0 flex-1 flex-col">
            <ArtifactPreview artifact={artifact} />
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
            Select an artifact from the chat stream to preview it here.
          </div>
        )}
      </div>
    </aside>
  );
}

function ArtifactKindIcon({ artifact }: { artifact?: ArtifactRecord }) {
  if (artifact?.mimeType.startsWith("image/")) {
    return <FileImage size={16} className="text-muted-foreground" />;
  }
  if (isJsonArtifact(artifact)) {
    return <FileJson size={16} className="text-muted-foreground" />;
  }
  return <FileText size={16} className="text-muted-foreground" />;
}

function ArtifactPreview({ artifact }: { artifact: ArtifactRecord }) {
  if (artifact.mimeType.startsWith("image/") && artifact.uri) {
    return (
      <section className="flex min-h-0 flex-1 overflow-hidden">
        <img src={artifact.uri} alt={artifact.label} className="h-full max-h-[70vh] w-full object-contain" />
      </section>
    );
  }

  if (isJsonArtifact(artifact) && artifact.payload !== undefined) {
    return (
      <section className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <JsonTree data={artifact.payload} defaultExpanded={2} />
        </div>
      </section>
    );
  }

  const text = artifactText(artifact);
  if (text) {
    if (isMarkdownArtifact(artifact)) {
      return (
        <section className="flex min-h-0 flex-1 p-4">
          <MarkdownContent content={text} className="min-h-0 flex-1 overflow-auto pr-1 text-sm leading-6 text-foreground" />
        </section>
      );
    }

    if (isHtmlArtifact(artifact)) {
      return (
        <section className="min-h-0 flex-1 overflow-hidden">
          <iframe
            title={artifact.label}
            srcDoc={text}
            sandbox=""
            className="h-full min-h-[70vh] w-full bg-white"
          />
        </section>
      );
    }

    return (
      <section className="flex min-h-0 flex-1 p-3">
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-bench-800">
          {text}
        </pre>
      </section>
    );
  }

  return (
    <section className="flex-1 rounded-xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
      No inline preview is available for this artifact yet.
      {artifact.uri ? <p data-i18n-skip="" className="mt-2 break-all text-xs">{artifact.uri}</p> : null}
    </section>
  );
}

function isJsonArtifact(artifact?: ArtifactRecord) {
  return Boolean(artifact && (artifact.mimeType.includes("json") || typeof artifact.payload === "object" && artifact.payload !== null));
}

function isMarkdownArtifact(artifact: ArtifactRecord) {
  const label = artifact.label.toLowerCase();
  return artifact.mimeType.includes("markdown") || label.endsWith(".md") || label.endsWith(".mdx");
}

function isHtmlArtifact(artifact: ArtifactRecord) {
  const label = artifact.label.toLowerCase();
  return artifact.mimeType.includes("html") || label.endsWith(".html") || label.endsWith(".htm");
}

function artifactText(artifact: ArtifactRecord): string | undefined {
  if (typeof artifact.payload === "string") {
    return artifact.payload;
  }
  if (artifact.mimeType.startsWith("text/") || artifact.kind === "log") {
    return artifact.payload === undefined ? undefined : String(artifact.payload);
  }
  return undefined;
}
