import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_LIMIT = 5;
const DEFAULT_MAX_DIRS = 12_000;
const SKIPPED_DIRS = new Set([
  ".Trash",
  ".cache",
  ".git",
  ".next",
  ".npm",
  ".pnpm-store",
  ".turbo",
  "Applications",
  "Library/Caches",
  "Library/Application Support",
  "Movies",
  "Music",
  "Pictures",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

export interface ProjectDiscoveryCandidate {
  label: string;
  path: string;
  score: number;
  markdownFiles: number;
  hasObsidianConfig: boolean;
  reason: string;
}

export interface ProjectDiscoveryOptions {
  query?: string;
  roots?: string[];
  limit?: number;
  maxDirs?: number;
}

export function discoverProjectCandidates(options: ProjectDiscoveryOptions = {}): ProjectDiscoveryCandidate[] {
  const roots = (options.roots?.length ? options.roots : [os.homedir()])
    .map((root) => path.resolve(root))
    .filter((root, index, all) => all.indexOf(root) === index && safeDirectory(root));
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const maxDirs = Math.max(1, options.maxDirs ?? DEFAULT_MAX_DIRS);
  const queryTerms = tokenizeQuery(options.query);
  const candidates = new Map<string, ProjectDiscoveryCandidate>();
  let visited = 0;

  const queue = [...roots];
  while (queue.length > 0 && visited < maxDirs) {
    const directory = queue.shift()!;
    visited += 1;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    const entryNames = new Set(entries.map((entry) => entry.name));
    const markdownFiles = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md")).length;
    const hasObsidianConfig = entryNames.has(".obsidian");
    const score = scoreDirectory(directory, {
      hasObsidianConfig,
      markdownFiles,
      queryTerms,
    });
    if (score > 0) {
      candidates.set(directory, {
        label: path.basename(directory) || directory,
        path: directory,
        score,
        markdownFiles,
        hasObsidianConfig,
        reason: hasObsidianConfig
          ? "contains .obsidian"
          : markdownFiles > 0
            ? `contains ${markdownFiles} markdown file${markdownFiles === 1 ? "" : "s"}`
            : "matches the request",
      });
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const child = path.join(directory, entry.name);
      if (shouldSkipDirectory(child, entry.name)) {
        continue;
      }
      queue.push(child);
    }
  }

  return [...candidates.values()]
    .sort((left, right) => right.score - left.score || left.path.length - right.path.length || left.path.localeCompare(right.path))
    .slice(0, limit);
}

export function formatCandidatePath(candidatePath: string, homeDir = os.homedir()): string {
  const resolvedHome = path.resolve(homeDir);
  const resolvedPath = path.resolve(candidatePath);
  const relative = path.relative(resolvedHome, resolvedPath);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative ? `~/${relative}` : "~";
  }
  return resolvedPath;
}

function scoreDirectory(
  directory: string,
  args: { hasObsidianConfig: boolean; markdownFiles: number; queryTerms: string[] },
): number {
  const normalizedPath = directory.toLowerCase();
  let score = 0;
  if (args.hasObsidianConfig) {
    score += 1000;
  }
  score += Math.min(args.markdownFiles * 8, 120);
  if (normalizedPath.includes("obsidian")) {
    score += 150;
  }
  for (const term of args.queryTerms) {
    if (normalizedPath.includes(term)) {
      score += 80;
    }
  }
  return score;
}

function tokenizeQuery(query: string | undefined): string[] {
  return (query ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !["project", "vault", "obsidian", "file", "files", "search", "local"].includes(term));
}

function safeDirectory(directory: string): boolean {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function shouldSkipDirectory(directory: string, name: string): boolean {
  if (name !== ".obsidian" && name.startsWith(".")) {
    return true;
  }
  const normalized = directory.split(path.sep).slice(-2).join("/");
  return SKIPPED_DIRS.has(name) || SKIPPED_DIRS.has(normalized);
}
