import fs from "node:fs";
import path from "node:path";

const workspacePackageAliasCache = new Map<string, Map<string, string>>();

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
  const normalizedRequest = rawPath.trim();
  const resolved = path.resolve(rootPath, resolveWorkspacePackageAlias(rootPath, normalizedRequest));
  const relative = path.relative(rootPath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Workspace tool path must stay inside the project root.");
  }
  return resolved;
}

function resolveWorkspacePackageAlias(rootPath: string, requestedPath: string): string {
  const aliasTarget = parseWorkspacePackageAlias(requestedPath);
  if (!aliasTarget) {
    return requestedPath;
  }

  const workspaceRelativePath = workspacePackageAliases(rootPath).get(aliasTarget.packageName);
  if (!workspaceRelativePath) {
    return requestedPath;
  }

  const candidateRelativePath = aliasTarget.suffix
    ? path.join(workspaceRelativePath, ...aliasTarget.suffix.split("/"))
    : workspaceRelativePath;
  const candidateAbsolutePath = path.resolve(rootPath, candidateRelativePath);
  return fs.existsSync(candidateAbsolutePath) ? candidateRelativePath : requestedPath;
}

function workspacePackageAliases(rootPath: string): Map<string, string> {
  const cached = workspacePackageAliasCache.get(rootPath);
  if (cached) {
    return cached;
  }
  const aliases = scanWorkspacePackageAliases(rootPath);
  workspacePackageAliasCache.set(rootPath, aliases);
  return aliases;
}

function scanWorkspacePackageAliases(rootPath: string): Map<string, string> {
  const workspaceConfigPath = path.join(rootPath, "pnpm-workspace.yaml");
  if (!fs.existsSync(workspaceConfigPath)) {
    return new Map();
  }

  const workspacePatterns = readWorkspacePackagePatterns(workspaceConfigPath);
  const aliases = new Map<string, string>();
  const duplicates = new Set<string>();

  for (const workspacePattern of workspacePatterns) {
    if (!workspacePattern.endsWith("/*")) {
      continue;
    }

    const workspaceDir = path.join(rootPath, workspacePattern.slice(0, -2));
    if (!fs.existsSync(workspaceDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(workspaceDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packageDir = path.join(workspaceDir, entry.name);
      const packageJsonPath = path.join(packageDir, "package.json");
      if (!fs.existsSync(packageJsonPath)) {
        continue;
      }

      const packageName = readPackageName(packageJsonPath);
      if (!packageName) {
        continue;
      }

      if (aliases.has(packageName)) {
        aliases.delete(packageName);
        duplicates.add(packageName);
        continue;
      }
      if (duplicates.has(packageName)) {
        continue;
      }

      aliases.set(packageName, path.relative(rootPath, packageDir));
    }
  }

  return aliases;
}

function readWorkspacePackagePatterns(workspaceConfigPath: string): string[] {
  const workspaceConfig = fs.readFileSync(workspaceConfigPath, "utf8");
  const patterns: string[] = [];
  for (const line of workspaceConfig.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }
    const value = match[1]?.trim();
    if (!value) {
      continue;
    }
    patterns.push(value.replace(/^['"]|['"]$/g, ""));
  }
  return patterns;
}

function readPackageName(packageJsonPath: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : undefined;
  } catch {
    return undefined;
  }
}

function parseWorkspacePackageAlias(requestedPath: string): { packageName: string; suffix: string } | undefined {
  const normalized = requestedPath.split(path.sep).join("/");
  if (!normalized.startsWith("node_modules/")) {
    return undefined;
  }

  const segments = normalized.split("/");
  if (segments.length < 2) {
    return undefined;
  }

  const packageName = segments[1]?.startsWith("@")
    ? segments.slice(1, 3).join("/")
    : segments[1]!;
  if (!packageName || packageName === "@") {
    return undefined;
  }

  const suffixStart = packageName.startsWith("@") ? 3 : 2;
  return {
    packageName,
    suffix: segments.slice(suffixStart).join("/"),
  };
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
