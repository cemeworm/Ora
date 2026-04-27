import { BookOpenText, ChevronDown, ChevronRight, FileCode2, FileImage, FileText, Folder, FolderOpen, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { OraProjectFileEntry, OraProjectFilesResult, RuntimeClient } from "../lib/runtimeClient";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

const MAX_VISIBLE_FILES = 2_000;

interface DocumentsDrawerProps {
  projectId: string;
  projectLabel: string;
  runtimeClient: RuntimeClient;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}

interface FileTreeNode {
  name: string;
  path: string;
  kind: "directory" | "file";
  children: FileTreeNode[];
  file?: OraProjectFileEntry;
}

export function DocumentsDrawer({ projectId, projectLabel, runtimeClient, onClose, onOpenFile }: DocumentsDrawerProps) {
  const [result, setResult] = useState<OraProjectFilesResult>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  async function loadFiles() {
    setLoading(true);
    setError(undefined);
    try {
      setResult(await runtimeClient.listProjectFiles(projectId));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Project files failed to load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setExpandedPaths(new Set());
    void loadFiles();
  }, [projectId, runtimeClient]);

  const visibleFiles = useMemo(() => result?.files.slice(0, MAX_VISIBLE_FILES) ?? [], [result]);
  const tree = useMemo(() => buildFileTree(visibleFiles), [visibleFiles]);

  function toggleDirectory(path: string) {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-transparent">
      <header className="flex h-12 shrink-0 items-center justify-between bg-card/74 px-4 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpenText size={16} className="text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium">Documents</h2>
            <p data-i18n-skip="" className="truncate text-[11px] text-muted-foreground">{result?.rootPath ?? projectLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button onClick={() => void loadFiles()} variant="ghost" size="icon-sm" title="Refresh documents" disabled={loading}>
            <RefreshCw size={15} className={cn(loading && "animate-spin")} />
          </Button>
          <Button onClick={onClose} variant="ghost" size="icon-sm" title="Close documents">
            <X size={16} />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && !result ? (
          <PanelMessage title="Loading documents" detail="Scanning the selected project folder." />
        ) : error ? (
          <PanelMessage title="Documents unavailable" detail={error} />
        ) : result && result.totalFiles === 0 ? (
          <PanelMessage title="No files found" detail="This project folder does not contain readable files." />
        ) : result ? (
          <section data-i18n-skip="" className="overflow-hidden">
            <div className="py-1">
              {tree.children.map((node) => (
                <TreeNodeRow
                  key={node.kind === "directory" ? `dir:${node.path}` : `file:${node.path}`}
                  node={node}
                  depth={0}
                  expandedPaths={expandedPaths}
                  onToggleDirectory={toggleDirectory}
                  onOpenFile={onOpenFile}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function PanelMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-2 leading-6">{detail}</p>
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  expandedPaths,
  onToggleDirectory,
  onOpenFile,
}: {
  node: FileTreeNode;
  depth: number;
  expandedPaths: Set<string>;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  if (node.kind === "directory") {
    const expanded = expandedPaths.has(node.path);
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggleDirectory(node.path)}
          className="flex min-h-[34px] w-full items-center gap-1.5 px-2 py-1.5 text-left transition hover:bg-accent hover:text-accent-foreground"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          title={node.path}
        >
          {expanded ? (
            <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
          )}
          {expanded ? (
            <FolderOpen size={15} className="shrink-0 text-muted-foreground" />
          ) : (
            <Folder size={15} className="shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{node.name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{countFiles(node)}</span>
        </button>
        {expanded ? (
          <div>
            {node.children.map((child) => (
              <TreeNodeRow
                key={child.kind === "directory" ? `dir:${child.path}` : `file:${child.path}`}
                node={child}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                onToggleDirectory={onToggleDirectory}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const file = node.file;
  if (!file) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={() => onOpenFile(file.path)}
      className="flex min-h-[36px] w-full items-center gap-2 px-2 py-1.5 text-left transition hover:bg-accent hover:text-accent-foreground"
      style={{ paddingLeft: `${30 + depth * 16}px` }}
      title={file.path}
    >
      <FileIcon mimeType={file.mimeType} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">{file.name}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{formatBytes(file.sizeBytes)} · {file.mimeType}</div>
      </div>
    </button>
  );
}

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith("image/")) {
    return <FileImage size={15} className="shrink-0 text-muted-foreground" />;
  }
  if (mimeType.includes("javascript") || mimeType.includes("typescript") || mimeType.includes("json")) {
    return <FileCode2 size={15} className="shrink-0 text-muted-foreground" />;
  }
  return <FileText size={15} className="shrink-0 text-muted-foreground" />;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildFileTree(files: OraProjectFileEntry[]): FileTreeNode {
  const root: FileTreeNode = { name: "", path: "", kind: "directory", children: [] };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const nodePath = parts.slice(0, index + 1).join("/");
      let child = current.children.find((item) => item.name === part && item.kind === (isFile ? "file" : "directory"));
      if (!child) {
        child = {
          name: part,
          path: nodePath,
          kind: isFile ? "file" : "directory",
          children: [],
          file: isFile ? file : undefined,
        };
        current.children.push(child);
      }
      current = child;
    });
  }

  sortTree(root);
  return root;
}

function sortTree(node: FileTreeNode) {
  node.children.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return compareFileTreeNames(left.name, right.name);
  });
  node.children.forEach(sortTree);
}

function compareFileTreeNames(left: string, right: string) {
  const leftHidden = left.startsWith(".");
  const rightHidden = right.startsWith(".");
  if (leftHidden !== rightHidden) {
    return leftHidden ? 1 : -1;
  }
  return left.localeCompare(right);
}

function countFiles(node: FileTreeNode): number {
  if (node.kind === "file") {
    return 1;
  }
  return node.children.reduce((sum, child) => sum + countFiles(child), 0);
}
