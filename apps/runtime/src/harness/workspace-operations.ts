import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { relativeWorkspacePath, resolveWorkspacePath } from "./runtime-tool-utils.js";
import { getShellExecutionContext } from "./shell-snapshot.js";

/**
 * Abstract workspace operations interface.
 * Default implementation uses local filesystem and shell.
 * Swap for remote / container / cloud workspace backends.
 */
export interface WorkspaceOperations {
  readFile(rootPath: string, relativePath: string, maxBytes: number): WorkspaceFileContent;
  writeFile(rootPath: string, relativePath: string, content: string): void;
  listFiles(rootPath: string, relativePath: string): WorkspaceFileEntry[];
  globFiles(rootPath: string, pattern: string, basePath?: string): string[];
  grepFiles(rootPath: string, pattern: string, options: WorkspaceGrepOptions): WorkspaceGrepMatch[];
  exec(rootPath: string, command: string, options: WorkspaceExecOptions): Promise<WorkspaceExecResult>;
}

export interface WorkspaceFileContent {
  path: string;
  absolutePath: string;
  sizeBytes: number;
  content: string;
  binary: boolean;
  skippedReason?: "binary_file" | "too_large";
}

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "other";
  sizeBytes?: number;
}

export interface WorkspaceGrepOptions {
  include?: string;
  basePath?: string;
  caseSensitive?: boolean;
  maxFiles: number;
  maxMatches: number;
  maxBytes: number;
}

export interface WorkspaceGrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface WorkspaceExecOptions {
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

export interface WorkspaceExecResult {
  command: string;
  cwd: string;
  exitCode: number;
  signal?: string;
  stdout: string;
  stderr: string;
  output: string;
  truncated: boolean;
  durationMs: number;
  interrupted?: boolean;
}

/**
 * Default local-filesystem workspace operations adapter.
 */
export const localWorkspaceOperations: WorkspaceOperations = {
  readFile(rootPath, relativePath, maxBytes) {
    const absolutePath = resolveWorkspacePath(rootPath, relativePath);
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      throw new Error("Workspace read target must be a file.");
    }
    if (stat.size > maxBytes) {
      return {
        path: relativePath,
        absolutePath,
        sizeBytes: stat.size,
        content: "",
        binary: false,
        skippedReason: "too_large",
      };
    }
    if (isBinaryFile(absolutePath)) {
      return {
        path: relativePath,
        absolutePath,
        sizeBytes: stat.size,
        content: "",
        binary: true,
        skippedReason: "binary_file",
      };
    }
    return {
      path: relativePath,
      absolutePath,
      sizeBytes: stat.size,
      content: fs.readFileSync(absolutePath, "utf8"),
      binary: false,
    };
  },

  writeFile(rootPath, relativePath, content) {
    const absolutePath = resolveWorkspacePath(rootPath, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf8");
  },

  listFiles(rootPath, relativePath) {
    const absolutePath = resolveWorkspacePath(rootPath, relativePath);
    const stat = fs.statSync(absolutePath);
    if (!stat.isDirectory()) {
      throw new Error("Workspace list target must be a directory.");
    }
    return fs.readdirSync(absolutePath, { withFileTypes: true })
      .map((entry) => {
        const entryPath = path.join(absolutePath, entry.name);
        const entryStat = fs.statSync(entryPath);
        return {
          name: entry.name,
          path: relativeWorkspacePath(rootPath, entryPath),
          kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
          sizeBytes: entry.isFile() ? entryStat.size : undefined,
        } as WorkspaceFileEntry;
      });
  },

  globFiles(rootPath, pattern, basePath?) {
    const startPath = basePath ? resolveWorkspacePath(rootPath, basePath) : rootPath;
    const matcher = globToRegExp(pattern);
    const results: string[] = [];
    for (const filePath of walkFiles(startPath, 10_000)) {
      const relative = relativeWorkspacePath(rootPath, filePath);
      if (matcher.test(relative)) {
        results.push(relative);
      }
    }
    return results;
  },

  grepFiles(rootPath, pattern, options) {
    const basePath = options.basePath ? resolveWorkspacePath(rootPath, options.basePath) : rootPath;
    const include = options.include ? globToRegExp(options.include) : undefined;
    const caseSensitive = options.caseSensitive !== false;
    const needle = caseSensitive ? pattern : pattern.toLowerCase();
    const matches: WorkspaceGrepMatch[] = [];
    for (const filePath of walkFiles(basePath, options.maxFiles)) {
      const relative = relativeWorkspacePath(rootPath, filePath);
      if (include && !include.test(relative)) continue;
      const stat = fs.statSync(filePath);
      if (stat.size > options.maxBytes) continue;
      if (isBinaryFile(filePath)) continue;
      const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        const haystack = caseSensitive ? line : line.toLowerCase();
        if (haystack.includes(needle)) {
          matches.push({ path: relative, line: index + 1, text: line });
          if (matches.length >= options.maxMatches) return matches;
        }
      }
    }
    return matches;
  },

  async exec(rootPath, command, options) {
    const { env, shellPath } = await getShellExecutionContext();
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let fullOutput = "";
    let truncated = false;
    let timedOut = false;
    let interrupted = false;

    return new Promise((resolve, reject) => {
      const child = spawn(command, [], {
        cwd: rootPath,
        env,
        detached: process.platform !== "win32",
        shell: process.platform === "win32" ? true : shellPath,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeoutMs);

      const onAbort = () => {
        interrupted = true;
        killProcessTree(child);
      };
      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        fullOutput += text;
        const currentBytes = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
        if (currentBytes >= options.maxOutputBytes) { truncated = true; return; }
        const remaining = options.maxOutputBytes - currentBytes;
        stdout += text.length > remaining ? text.slice(0, remaining) : text;
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        fullOutput += text;
        const currentBytes = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
        if (currentBytes >= options.maxOutputBytes) { truncated = true; return; }
        const remaining = options.maxOutputBytes - currentBytes;
        stderr += text.length > remaining ? text.slice(0, remaining) : text;
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (options.signal) options.signal.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.on("close", (code, sig) => {
        clearTimeout(timer);
        if (options.signal) options.signal.removeEventListener("abort", onAbort);
        resolve({
          command,
          cwd: rootPath,
          exitCode: timedOut ? 124 : interrupted ? 130 : code ?? 1,
          signal: sig ?? (interrupted ? "SIGTERM" : undefined),
          stdout,
          stderr,
          output: stdout || stderr,
          truncated,
          durationMs: Date.now() - startedAt,
          interrupted,
        });
      });
    });
  },
};

function killProcessTree(child: ReturnType<typeof spawn>): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill("SIGTERM");
    return;
  }
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    child.kill("SIGTERM");
  }
}

const BINARY_SNIFF_BYTES = 4096;

function isBinaryFile(filePath: string): boolean {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(BINARY_SNIFF_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (bytesRead === 0) return false;
    for (let index = 0; index < bytesRead; index += 1) {
      if (buffer[index] === 0) return true;
    }
    const sample = buffer.subarray(0, bytesRead).toString("utf8");
    return sample.includes("�");
  } finally {
    fs.closeSync(fd);
  }
}

function walkFiles(startPath: string, maxFiles: number): string[] {
  const files: string[] = [];
  const SKIPPED_DIRS = new Set([".git", ".next", ".turbo", ".ora", "build", "coverage", "dist", "node_modules", "target"]);
  const visit = (currentPath: string) => {
    if (files.length >= maxFiles) return;
    const stat = fs.statSync(currentPath);
    if (stat.isFile()) { files.push(currentPath); return; }
    if (!stat.isDirectory()) return;
    if (SKIPPED_DIRS.has(path.basename(currentPath)) && currentPath !== startPath) return;
    for (const entry of fs.readdirSync(currentPath)) {
      visit(path.join(currentPath, entry));
      if (files.length >= maxFiles) return;
    }
  };
  visit(startPath);
  return files;
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    const next = pattern[index + 1];
    if (char === "*" && next === "*") { source += ".*"; index += 1; }
    else if (char === "*") { source += "[^/]*"; }
    else if (char === "?") { source += "[^/]"; }
    else { source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"); }
  }
  return new RegExp(`^${source}$`);
}
