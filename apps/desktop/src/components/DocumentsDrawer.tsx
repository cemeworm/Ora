import { BookOpenText, ChevronDown, ChevronRight, FileCode2, FileImage, FileText, Folder, FolderOpen, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { OraProjectFileEntry, OraProjectFilesResult, RuntimeClient } from "../lib/runtimeClient";
import { useWorkbench } from "../lib/state";
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
  const { state } = useWorkbench();
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
    void loadFiles();
  }, [projectId, runtimeClient]);

  const visibleFiles = useMemo(() => result?.files.slice(0, MAX_VISIBLE_FILES) ?? [], [result]);
  const tree = useMemo(() => buildFileTree(visibleFiles), [visibleFiles]);
  const hiddenCount = Math.max(0, (result?.files.length ?? 0) - visibleFiles.length);

  useEffect(() => {
    setExpandedPaths(expandedDirectoryPaths(tree));
  }, [tree]);

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
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card/74 px-4 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpenText size={16} className="text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium">Documents</h2>
            <p className="truncate text-[11px] text-muted-foreground">{projectLabel}</p>
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
          <div className="space-y-3">
            <section className="rounded-xl border border-border bg-card/70 p-3 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{formatFileCount(result.totalFiles, state.language)}</h3>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{result.rootPath}</p>
                </div>
                {result.truncated ? (
                  <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                    Truncated
                  </span>
                ) : null}
              </div>
              {hiddenCount > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">Showing first {formatCount(MAX_VISIBLE_FILES)} files.</p>
              ) : null}
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-background shadow-xs">
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
          </div>
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

function formatCount(count: number) {
  return count.toLocaleString();
}

function formatFileCount(count: number, language: "zh" | "en") {
  return language === "zh" ? `${formatCount(count)} 个文件` : `${formatCount(count)} files`;
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
    return left.name.localeCompare(right.name);
  });
  node.children.forEach(sortTree);
}

function expandedDirectoryPaths(root: FileTreeNode) {
  const paths = new Set<string>();
  const visit = (node: FileTreeNode) => {
    if (node.kind === "directory" && node.path) {
      paths.add(node.path);
    }
    node.children.forEach(visit);
  };
  root.children.forEach(visit);
  return paths;
}

function countFiles(node: FileTreeNode): number {
  if (node.kind === "file") {
    return 1;
  }
  return node.children.reduce((sum, child) => sum + countFiles(child), 0);
}
