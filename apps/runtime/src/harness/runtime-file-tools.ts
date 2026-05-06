import fs from "node:fs";
import path from "node:path";
import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { ResolvedToolLimits, RuntimeFileChangeMetadata, RuntimeToolExecutionContext } from "./runtime-tool-executor.js";
import {
  readPositiveInt,
  relativeWorkspacePath,
  requireWorkspaceRoot,
  resolveWorkspacePath,
} from "./runtime-tool-utils.js";
import { prefersChinese, stringArg } from "./runtime-tool-approval.js";

const SKIPPED_DIRS = new Set([".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "target"]);

export function fileToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  switch (toolId) {
    case "file.read":
      return {
        promptExample: "{\"tool\":\"file.read\",\"args\":{\"path\":\"relative/path.ts\"}}",
        execute: (args, context) => ({ output: readWorkspaceFile(requireWorkspaceRoot(context.workspace), args, context.limits) }),
      };
    case "file.list":
      return {
        promptExample: "{\"tool\":\"file.list\",\"args\":{\"path\":\"src\"}}",
        execute: (args, context) => ({ output: listWorkspaceFiles(requireWorkspaceRoot(context.workspace), args, context.limits) }),
      };
    case "file.glob":
      return {
        promptExample: "{\"tool\":\"file.glob\",\"args\":{\"pattern\":\"**/*.ts\"}}",
        execute: (args, context) => ({ output: globWorkspaceFiles(requireWorkspaceRoot(context.workspace), args, context.limits) }),
      };
    case "file.grep":
      return {
        promptExample: "{\"tool\":\"file.grep\",\"args\":{\"pattern\":\"functionName\",\"include\":\"**/*.ts\"}}",
        execute: (args, context) => ({ output: grepWorkspaceFiles(requireWorkspaceRoot(context.workspace), args, context.limits) }),
      };
    case "file.write":
      return {
        promptExample: "{\"tool\":\"file.write\",\"args\":{\"path\":\"notes/result.md\",\"content\":\"...\"}}",
        requiresApprovalCopy: true,
        actionRiskLevel: () => "high",
        approvalRequest: fileWriteApprovalRequest,
        execute: (args, context) => writeWorkspaceFile(requireWorkspaceRoot(context.workspace), args, context.limits),
      };
    case "file.patch":
      return {
        promptExample: "{\"tool\":\"file.patch\",\"args\":{\"path\":\"src/file.ts\",\"search\":\"old\",\"replace\":\"new\"}}",
        requiresApprovalCopy: true,
        actionRiskLevel: () => "high",
        approvalRequest: filePatchApprovalRequest,
        execute: (args, context) => patchWorkspaceFile(requireWorkspaceRoot(context.workspace), args, context.limits),
      };
    default:
      return {};
  }
}

function fileWriteApprovalRequest(args: Record<string, unknown>, context: { userPrompt?: string }) {
  const zh = prefersChinese(context.userPrompt);
  const target = stringArg(args, "path", zh ? "目标文件" : "the target file");
  return zh
    ? {
        title: "需要你确认写入文件",
        summary: `我准备在项目中写入“${target}”。`,
        whatWillChange: "该文件内容会被创建或覆盖。",
        whyNeeded: "这是完成你要求的本地文件变更所必需的步骤。",
        riskNote: "写入文件会改变你的项目内容，请确认路径和变更意图正确。",
        confirmLabel: "批准并继续",
      }
    : {
        title: "Confirm file write",
        summary: `I am ready to write "${target}" in the project.`,
        whatWillChange: "The file will be created or overwritten.",
        whyNeeded: "This is required to complete the local file change you requested.",
        riskNote: "Writing a file changes project contents, so confirm the path and intent first.",
        confirmLabel: "Approve and continue",
      };
}

function filePatchApprovalRequest(args: Record<string, unknown>, context: { userPrompt?: string }) {
  const zh = prefersChinese(context.userPrompt);
  const target = stringArg(args, "path", zh ? "目标文件" : "the target file");
  return zh
    ? {
        title: "需要你确认修改文件",
        summary: `我准备修改项目中的“${target}”。`,
        whatWillChange: "文件中的一段内容会被替换。",
        whyNeeded: "这是完成你要求的本地文件修改所必需的步骤。",
        riskNote: "修改文件会改变你的项目内容，请确认目标文件正确。",
        confirmLabel: "批准并继续",
      }
    : {
        title: "Confirm file change",
        summary: `I am ready to modify "${target}" in the project.`,
        whatWillChange: "One matching section in the file will be replaced.",
        whyNeeded: "This is required to complete the local file edit you requested.",
        riskNote: "Editing a file changes project contents, so confirm the target file first.",
        confirmLabel: "Approve and continue",
      };
}

function readWorkspaceFile(rootPath: string, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  const absolutePath = resolveWorkspacePath(rootPath, args.path);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    throw new Error("file.read target must be a file.");
  }
  if (stat.size > limits.fileReadMaxBytes) {
    throw new Error(`file.read target is too large (${stat.size} bytes).`);
  }
  return {
    path: relativeWorkspacePath(rootPath, absolutePath),
    sizeBytes: stat.size,
    content: fs.readFileSync(absolutePath, "utf8"),
  };
}

function listWorkspaceFiles(rootPath: string, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  const absolutePath = resolveWorkspacePath(rootPath, args.path ?? ".");
  const stat = fs.statSync(absolutePath);
  if (!stat.isDirectory()) {
    throw new Error("file.list target must be a directory.");
  }
  const entries = fs.readdirSync(absolutePath, { withFileTypes: true })
    .slice(0, readPositiveInt(args.limit, limits.fileListMaxEntries, limits.fileListMaxEntries))
    .map((entry) => {
      const entryPath = path.join(absolutePath, entry.name);
      const entryStat = fs.statSync(entryPath);
      return {
        name: entry.name,
        path: relativeWorkspacePath(rootPath, entryPath),
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
        sizeBytes: entry.isFile() ? entryStat.size : undefined,
      };
    });
  return {
    path: relativeWorkspacePath(rootPath, absolutePath),
    entries,
  };
}

function globWorkspaceFiles(rootPath: string, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  const pattern = typeof args.pattern === "string" && args.pattern.trim() ? args.pattern : undefined;
  if (!pattern) {
    throw new Error("file.glob requires a non-empty pattern.");
  }
  const basePath = resolveWorkspacePath(rootPath, args.path ?? ".");
  const matcher = globToRegExp(pattern);
  const limit = readPositiveInt(args.limit, limits.fileListMaxEntries, limits.fileListMaxEntries);
  const matches: string[] = [];
  for (const filePath of walkFiles(rootPath, basePath, limits.fileSearchMaxFiles)) {
    const relative = relativeWorkspacePath(rootPath, filePath);
    if (matcher.test(relative)) {
      matches.push(relative);
      if (matches.length >= limit) {
        break;
      }
    }
  }
  return { pattern, matches };
}

function grepWorkspaceFiles(rootPath: string, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  const pattern = typeof args.pattern === "string" && args.pattern.trim() ? args.pattern : undefined;
  if (!pattern) {
    throw new Error("file.grep requires a non-empty pattern.");
  }
  const include = typeof args.include === "string" && args.include.trim() ? globToRegExp(args.include) : undefined;
  const basePath = resolveWorkspacePath(rootPath, args.path ?? ".");
  const caseSensitive = args.caseSensitive !== false;
  const needle = caseSensitive ? pattern : pattern.toLowerCase();
  const limit = readPositiveInt(args.limit, limits.fileSearchMaxMatches, limits.fileSearchMaxMatches);
  const matches: Array<{ path: string; line: number; text: string }> = [];

  for (const filePath of walkFiles(rootPath, basePath, limits.fileSearchMaxFiles)) {
    const relative = relativeWorkspacePath(rootPath, filePath);
    if (include && !include.test(relative)) {
      continue;
    }
    const stat = fs.statSync(filePath);
    if (stat.size > limits.fileSearchMaxBytes) {
      continue;
    }
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const haystack = caseSensitive ? line : line.toLowerCase();
      if (haystack.includes(needle)) {
        matches.push({ path: relative, line: index + 1, text: line });
        if (matches.length >= limit) {
          return { pattern, matches, truncated: true };
        }
      }
    }
  }
  return { pattern, matches, truncated: false };
}

function writeWorkspaceFile(rootPath: string, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  if (typeof args.content !== "string") {
    throw new Error("file.write requires string content.");
  }
  const sizeBytes = Buffer.byteLength(args.content);
  if (sizeBytes > limits.fileWriteMaxBytes) {
    throw new Error(`file.write content is too large (${sizeBytes} bytes).`);
  }
  const absolutePath = resolveWorkspacePath(rootPath, args.path);
  const existed = fs.existsSync(absolutePath);
  const beforeContent = existed ? fs.readFileSync(absolutePath, "utf8") : "";
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, args.content, "utf8");
  const output = {
    path: relativeWorkspacePath(rootPath, absolutePath),
    sizeBytes,
  };
  return {
    output,
    fileChange: buildFileChangeMetadata({
      path: output.path,
      operation: "write",
      beforeContent,
      afterContent: args.content,
      sizeBytes,
      created: !existed,
    }),
  };
}

function patchWorkspaceFile(rootPath: string, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  if (typeof args.search !== "string" || args.search.length === 0) {
    throw new Error("file.patch requires a non-empty search string.");
  }
  if (typeof args.replace !== "string") {
    throw new Error("file.patch requires a replacement string.");
  }
  const absolutePath = resolveWorkspacePath(rootPath, args.path);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    throw new Error("file.patch target must be a file.");
  }
  if (stat.size > limits.fileWriteMaxBytes) {
    throw new Error(`file.patch target is too large (${stat.size} bytes).`);
  }
  const current = fs.readFileSync(absolutePath, "utf8");
  if (!current.includes(args.search)) {
    throw new Error("file.patch search string was not found.");
  }
  const next = current.replace(args.search, args.replace);
  fs.writeFileSync(absolutePath, next, "utf8");
  const output = {
    path: relativeWorkspacePath(rootPath, absolutePath),
    replacements: 1,
    sizeBytes: Buffer.byteLength(next),
  };
  return {
    output,
    fileChange: buildFileChangeMetadata({
      path: output.path,
      operation: "patch",
      beforeContent: current,
      afterContent: next,
      sizeBytes: output.sizeBytes,
      replacements: output.replacements,
      created: false,
    }),
  };
}

function buildFileChangeMetadata(params: {
  path: string;
  operation: RuntimeFileChangeMetadata["operation"];
  beforeContent: string;
  afterContent: string;
  sizeBytes: number;
  replacements?: number;
  created: boolean;
}): RuntimeFileChangeMetadata {
  const { additions, deletions } = countLineChanges(params.beforeContent, params.afterContent);
  return {
    kind: "file_change",
    path: params.path,
    operation: params.operation,
    beforeContent: params.beforeContent,
    afterContent: params.afterContent,
    additions,
    deletions,
    metadata: {
      sizeBytes: params.sizeBytes,
      replacements: params.replacements,
      created: params.created,
    },
  };
}

function countLineChanges(beforeContent: string, afterContent: string): { additions: number; deletions: number } {
  const beforeLines = splitComparableLines(beforeContent);
  const afterLines = splitComparableLines(afterContent);
  const common = longestCommonSubsequenceLength(beforeLines, afterLines);
  return {
    additions: afterLines.length - common,
    deletions: beforeLines.length - common,
  };
}

function splitComparableLines(content: string): string[] {
  if (!content) {
    return [];
  }
  return content.split(/\r?\n/);
}

function longestCommonSubsequenceLength(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const previous = new Array(right.length + 1).fill(0);
  const current = new Array(right.length + 1).fill(0);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current[rightIndex + 1] = left[leftIndex] === right[rightIndex]
        ? previous[rightIndex] + 1
        : Math.max(previous[rightIndex + 1], current[rightIndex]);
    }
    previous.splice(0, previous.length, ...current);
    current.fill(0);
  }
  return previous[right.length] ?? 0;
}

function walkFiles(rootPath: string, startPath: string, maxFiles: number): string[] {
  const files: string[] = [];
  const visit = (currentPath: string) => {
    if (files.length >= maxFiles) {
      return;
    }
    const stat = fs.statSync(currentPath);
    if (stat.isFile()) {
      files.push(currentPath);
      return;
    }
    if (!stat.isDirectory()) {
      return;
    }
    const name = path.basename(currentPath);
    if (SKIPPED_DIRS.has(name) && currentPath !== rootPath) {
      return;
    }
    for (const entry of fs.readdirSync(currentPath)) {
      visit(path.join(currentPath, entry));
      if (files.length >= maxFiles) {
        return;
      }
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
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}
