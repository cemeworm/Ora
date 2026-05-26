import { useEffect, useState } from "react";
import { FileImage, FileJson, FileText } from "lucide-react";
import { JsonTree } from "./JsonTree";
import { MarkdownContent } from "./MarkdownContent";
import { Button } from "./ui/button";
import type { ArtifactRecord } from "../types";

interface ArtifactDrawerProps {
  artifact?: ArtifactRecord;
}

export function ArtifactDrawer({ artifact }: ArtifactDrawerProps) {
  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-transparent">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
        {artifact ? (
          <div data-i18n-skip="" className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex shrink-0 items-center gap-2 border-b border-border/50 pb-2">
              <ArtifactKindIcon artifact={artifact} />
              <p className="min-w-0 truncate text-[12px] font-medium text-muted-foreground">
                {artifact.label}
              </p>
              {artifact.mimeType ? (
                <span className="shrink-0 text-[11px] text-muted-foreground/60">
                  {artifact.mimeType}
                </span>
              ) : null}
            </div>
            <ArtifactPreviewContent artifact={artifact} />
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

export function ArtifactPreviewContent({ artifact }: { artifact: ArtifactRecord }) {
  const fileChange = fileChangePayload(artifact.payload);
  if (fileChange) {
    if (isHtmlArtifact(artifact)) {
      return (
        <HtmlArtifactBrowser
          artifact={artifact}
          html={fileChange.afterContent}
          sourceText={fileChange.afterContent}
        />
      );
    }

    if (isMarkdownArtifact(artifact)) {
      return (
        <section className="flex min-h-0 flex-1 p-4">
          <MarkdownContent content={fileChange.afterContent} className="min-h-0 flex-1 overflow-auto pr-1 text-sm leading-6 text-foreground" />
        </section>
      );
    }

    return <SourceTextPanel text={fileChange.afterContent} />;
  }

  if (artifact.mimeType.startsWith("image/") && artifact.uri) {
    return (
      <section className="flex min-h-0 flex-1 overflow-hidden">
        <img src={artifact.uri} alt={artifact.label} className="h-full max-h-[70vh] w-full object-contain" />
      </section>
    );
  }

  if (artifact.mimeType.startsWith("video/") && artifact.uri) {
    return (
      <section className="flex min-h-0 flex-1 overflow-hidden">
        <video
          src={artifact.uri}
          controls
          className="h-full max-h-[70vh] w-full object-contain"
        >
          Your browser does not support the video tag.
        </video>
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
        <HtmlArtifactBrowser
          artifact={artifact}
          html={text}
          sourceText={text}
        />
      );
    }

    return <SourceTextPanel text={text} />;
  }

  if (isHtmlArtifact(artifact) && artifact.uri) {
    return <HtmlArtifactBrowser artifact={artifact} uri={artifact.uri} />;
  }

  return (
    <section className="flex-1 rounded-xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
      No inline preview is available for this artifact yet.
      {artifact.uri ? <p data-i18n-skip="" className="mt-2 break-all text-xs">{artifact.uri}</p> : null}
    </section>
  );
}

function HtmlArtifactBrowser({
  artifact,
  html,
  uri,
  sourceText,
}: {
  artifact: ArtifactRecord;
  html?: string;
  uri?: string;
  sourceText?: string;
}) {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const canShowSource = sourceText !== undefined;

  useEffect(() => {
    setMode("preview");
  }, [artifact.id]);

  if (mode === "source" && canShowSource) {
    return (
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <HtmlPreviewToolbar mode={mode} onModeChange={setMode} />
        <SourceTextPanel text={sourceText} className="rounded-none border-0" />
      </section>
    );
  }

  const iframeSource = html !== undefined
    ? { srcDoc: html }
    : uri
      ? { src: uri }
      : undefined;

  if (!iframeSource) {
    return (
      <section className="flex-1 rounded-xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
        No HTML preview is available for this artifact yet.
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {canShowSource ? <HtmlPreviewToolbar mode={mode} onModeChange={setMode} /> : null}
      <iframe
        title={`HTML preview: ${artifact.label}`}
        sandbox="allow-scripts"
        className="h-full min-h-[70vh] w-full flex-1 bg-white"
        {...iframeSource}
      />
    </section>
  );
}

function HtmlPreviewToolbar({
  mode,
  onModeChange,
}: {
  mode: "preview" | "source";
  onModeChange: (mode: "preview" | "source") => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border bg-card/70 px-2 py-1.5">
      <Button
        type="button"
        size="sm"
        variant={mode === "preview" ? "secondary" : "ghost"}
        onClick={() => onModeChange("preview")}
      >
        Preview
      </Button>
      <Button
        type="button"
        size="sm"
        variant={mode === "source" ? "secondary" : "ghost"}
        onClick={() => onModeChange("source")}
      >
        Source
      </Button>
    </div>
  );
}

function SourceTextPanel({ text, className = "" }: { text: string; className?: string }) {
  return (
    <section className={`flex min-h-0 flex-1 p-3 ${className}`}>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-bench-800">
        {text}
      </pre>
    </section>
  );
}

function fileChangePayload(value: unknown): { afterContent: string } | undefined {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === "file_change" &&
    typeof (value as { afterContent?: unknown }).afterContent === "string"
  ) {
    return { afterContent: (value as { afterContent: string }).afterContent };
  }
  return undefined;
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
