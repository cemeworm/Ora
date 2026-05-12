/**
 * In-memory fake WorkspaceOperations adapter for tests.
 * Replaces local filesystem and shell with virtual filesystem and command outputs.
 */
import type {
  WorkspaceOperations,
  WorkspaceFileContent,
  WorkspaceFileEntry,
  WorkspaceGrepMatch,
  WorkspaceGrepOptions,
  WorkspaceExecResult,
} from "./workspace-operations.js";

interface VirtualFile {
  content: string;
}

export interface FakeWorkspaceFiles {
  [relativePath: string]: VirtualFile | undefined;
}

export function createFakeWorkspaceOperations(
  files: FakeWorkspaceFiles = {},
  execResults: Map<string, WorkspaceExecResult> = new Map(),
): WorkspaceOperations {
  return {
    readFile(_rootPath, relativePath, maxBytes) {
      const file = files[relativePath];
      if (!file) {
        throw new Error(`ENOENT: ${relativePath} not found in fake workspace.`);
      }
      const sizeBytes = Buffer.byteLength(file.content);
      if (sizeBytes > maxBytes) {
        return {
          path: relativePath,
          absolutePath: `/fake/${relativePath}`,
          sizeBytes,
          content: "",
          binary: false,
          skippedReason: "too_large",
        };
      }
      return {
        path: relativePath,
        absolutePath: `/fake/${relativePath}`,
        sizeBytes,
        content: file.content,
        binary: false,
      };
    },

    writeFile(_rootPath, relativePath, content) {
      files[relativePath] = { content };
    },

    listFiles(_rootPath, relativePath) {
      const dir = relativePath === "." ? "" : `${relativePath}/`;
      const seen = new Set<string>();
      const entries: WorkspaceFileEntry[] = [];
      for (const filePath of Object.keys(files)) {
        if (dir && !filePath.startsWith(dir)) continue;
        const rest = filePath.slice(dir.length);
        const topName = rest.split("/")[0]!;
        const entryPath = dir ? `${dir}${topName}` : topName;
        if (seen.has(entryPath)) continue;
        seen.add(entryPath);
        entries.push({
          name: topName,
          path: entryPath,
          kind: "file",
          sizeBytes: files[filePath] ? Buffer.byteLength(files[filePath]!.content) : 0,
        });
      }
      return entries;
    },

    globFiles(_rootPath, pattern) {
      const regex = new RegExp("^" + pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
      return Object.keys(files).filter((p) => regex.test(p));
    },

    grepFiles(_rootPath, pattern, options) {
      const caseSensitive = options.caseSensitive !== false;
      const needle = caseSensitive ? pattern : pattern.toLowerCase();
      const include = options.include ? new RegExp("^" + options.include.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$") : undefined;
      const matches: WorkspaceGrepMatch[] = [];
      for (const [filePath, file] of Object.entries(files)) {
        if (!file) continue;
        if (include && !include.test(filePath)) continue;
        const lines = file.content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const haystack = caseSensitive ? line : line.toLowerCase();
          if (haystack.includes(needle)) {
            matches.push({ path: filePath, line: i + 1, text: line });
            if (matches.length >= options.maxMatches) return matches;
          }
        }
      }
      return matches;
    },

    async exec(_rootPath, command, options) {
      const cached = execResults.get(command);
      if (cached) return cached;
      return {
        command,
        cwd: "/fake",
        exitCode: 0,
        stdout: `Fake output for: ${command}`,
        stderr: "",
        output: `Fake output for: ${command}`,
        truncated: false,
        durationMs: 1,
      };
    },
  };
}
