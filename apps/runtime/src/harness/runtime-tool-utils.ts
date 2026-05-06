import path from "node:path";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function workspaceRootPath(workspace: unknown): string | undefined {
  if (!workspace || typeof workspace !== "object" || workspace === null) {
    return undefined;
  }
  const rootPath = (workspace as Record<string, unknown>).rootPath;
  return typeof rootPath === "string" && rootPath.trim() ? rootPath : undefined;
}

export function requireWorkspaceRoot(workspace: unknown): string {
  const rootPath = workspaceRootPath(workspace);
  if (!rootPath) {
    throw new Error("A selected project folder is required for this tool.");
  }
  return path.resolve(rootPath);
}

export function resolveWorkspacePath(rootPath: string, requestedPath: unknown): string {
  const rawPath = requestedPath === undefined ? "." : requestedPath;
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new Error("Workspace path must be a non-empty relative path.");
  }
  const resolved = path.resolve(rootPath, rawPath);
  const relative = path.relative(rootPath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Workspace tool path must stay inside the project root.");
  }
  return resolved;
}

export function relativeWorkspacePath(rootPath: string, absolutePath: string): string {
  const relative = path.relative(rootPath, absolutePath);
  return relative || ".";
}

export function parseHttpUrl(value: unknown, toolName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${toolName} requires a non-empty URL.`);
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${toolName} only supports http and https URLs.`);
  }
  return parsed.href;
}

export function readPositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, max);
}

export function truncateText(text: string, maxBytes: number): { content: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text);
  if (bytes <= maxBytes) {
    return { content: text, truncated: false };
  }
  return {
    content: text.slice(0, maxBytes),
    truncated: true,
  };
}
