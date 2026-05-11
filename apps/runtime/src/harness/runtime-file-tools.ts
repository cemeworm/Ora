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
import { withWorkspaceFileMutationQueue } from "./runtime-file-mutation-queue.js";

const SKIPPED_DIRS = new Set([".git", ".next", ".turbo", ".ora", "build", "coverage", "dist", "node_modules", "target"]);
const SKIPPED_FILE_SUFFIXES = [
  ".db",
  ".db-shm",
  ".db-wal",
  ".sqlite",
  ".sqlite-shm",
  ".sqlite-wal",
  ".wal",
];
const BINARY_SNIFF_BYTES = 4096;

type SkippedWorkspaceFile = {
  path: string;
  reason: "default_excluded" | "too_large" | "binary";
  sizeBytes?: number;
};

export function fileToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  switch (toolId) {
    case "file.read":
      return {
        promptExample: "{\"tool\":\"file.read\",\"args\":{\"path\":\"relative/path.ts\"}}",
        execute: (args, context) => ({ output: readWorkspaceFile(requireWorkspaceRoot(context.workspace), args, context.limits) }),
      };
    case "file.list":
      return {
        promptExample: "{\"tool\":\"file.list\",\"args\":{\"path\":\".\"}}",
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
        promptExample: "{\"tool\":\"file.patch\",\"args\":{\"path\":\"src/file.ts\",\"edits\":[{\"oldText\":\"old\",\"newText\":\"new\"}]}}",
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
  if (isProbablyBinaryFile(absolutePath)) {
    return {
      path: relativeWorkspacePath(rootPath, absolutePath),
      sizeBytes: stat.size,
      binary: true,
      content: "",
      skippedReason: "binary_file",
    };
  }
  return {
    path: relativeWorkspacePath(rootPath, absolutePath),
    sizeBytes: stat.size,
    content: fs.readFileSync(absolutePath, "utf8"),
  };
}

function listWorkspaceFiles(rootPath: string, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  const absolutePath = resolveWorkspacePath(rootPath, args.path ?? ".");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolutePath);
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return {
        path: relativeWorkspacePath(rootPath, absolutePath),
        entries: [],
        missing: true,
      };
    }
    throw error;
  }
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

function isErrnoCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function globWorkspaceFiles(rootPath: string, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  const pattern = typeof args.pattern === "string" && args.pattern.trim() ? args.pattern : undefined;
  if (!pattern) {
    throw new Error("file.glob requires a non-empty pattern.");
  }
  const basePath = resolveWorkspacePath(rootPath, args.path ?? ".");
  const matcher = globToRegExp(pattern);
  const limit = readPositiveInt(args.limit, limits.fileListMaxEntries, limits.fileListMaxEntries);
  const explicitTarget = hasExplicitSearchTarget(rootPath, basePath, pattern, args);
  const skipped: SkippedWorkspaceFile[] = [];
  const matches: string[] = [];
  for (const filePath of walkFiles(rootPath, basePath, limits.fileSearchMaxFiles, { includeDefaultExcluded: explicitTarget, skipped })) {
    const relative = relativeWorkspacePath(rootPath, filePath);
    if (!explicitTarget && isDefaultExcludedFile(relative)) {
      skipped.push({ path: relative, reason: "default_excluded" });
      continue;
    }
    if (matcher.test(relative)) {
      matches.push(relative);
      if (matches.length >= limit) {
        break;
      }
    }
  }
  return { pattern, matches, skipped };
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
  const explicitTarget = hasExplicitSearchTarget(rootPath, basePath, include ? String(args.include) : undefined, args);
  const matches: Array<{ path: string; line: number; text: string }> = [];
  const skipped: SkippedWorkspaceFile[] = [];

  for (const filePath of walkFiles(rootPath, basePath, limits.fileSearchMaxFiles, { includeDefaultExcluded: explicitTarget, skipped })) {
    const relative = relativeWorkspacePath(rootPath, filePath);
    if (include && !include.test(relative)) {
      continue;
    }
    if (!explicitTarget && isDefaultExcludedFile(relative)) {
      skipped.push({ path: relative, reason: "default_excluded" });
      continue;
    }
    const stat = fs.statSync(filePath);
    if (stat.size > limits.fileSearchMaxBytes) {
      skipped.push({ path: relative, reason: "too_large", sizeBytes: stat.size });
      continue;
    }
    if (isProbablyBinaryFile(filePath)) {
      skipped.push({ path: relative, reason: "binary", sizeBytes: stat.size });
      continue;
    }
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const haystack = caseSensitive ? line : line.toLowerCase();
      if (haystack.includes(needle)) {
        matches.push({ path: relative, line: index + 1, text: line });
        if (matches.length >= limit) {
          return { pattern, matches, truncated: true, skipped };
        }
      }
    }
  }
  return { pattern, matches, truncated: false, skipped };
}

async function writeWorkspaceFile(rootPath: string, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  if (typeof args.content !== "string") {
    throw new Error("file.write requires string content.");
  }
  const content = args.content;
  const sizeBytes = Buffer.byteLength(content);
  if (sizeBytes > limits.fileWriteMaxBytes) {
    throw new Error(`file.write content is too large (${sizeBytes} bytes).`);
  }
  const absolutePath = resolveWorkspacePath(rootPath, args.path);
  return withWorkspaceFileMutationQueue(absolutePath, () => {
    const existed = fs.existsSync(absolutePath);
    const beforeContent = existed ? fs.readFileSync(absolutePath, "utf8") : "";
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf8");
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
        afterContent: content,
        sizeBytes,
        created: !existed,
      }),
    };
  });
}

async function patchWorkspaceFile(rootPath: string, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  const edits = parsePatchEdits(args);
  const absolutePath = resolveWorkspacePath(rootPath, args.path);
  return withWorkspaceFileMutationQueue(absolutePath, () => {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      throw new Error("file.patch target must be a file.");
    }
    if (stat.size > limits.fileWriteMaxBytes) {
      throw new Error(`file.patch target is too large (${stat.size} bytes).`);
    }
    const current = fs.readFileSync(absolutePath, "utf8");
    const replacements = findPatchReplacements(current, edits);
    const next = applyPatchReplacements(current, replacements);
    fs.writeFileSync(absolutePath, next, "utf8");
    const relativePath = relativeWorkspacePath(rootPath, absolutePath);
    const output = {
      path: relativePath,
      replacements: replacements.length,
      sizeBytes: Buffer.byteLength(next),
      firstChangedLine: firstChangedLine(current, next),
      diff: unifiedDiff(relativePath, current, next),
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
        firstChangedLine: output.firstChangedLine,
        diff: output.diff,
        created: false,
      }),
    };
  });
}

type PatchEdit = {
  oldText: string;
  newText: string;
};

type PatchReplacement = PatchEdit & {
  start: number;
  end: number;
};

function parsePatchEdits(args: Record<string, unknown>): PatchEdit[] {
  if (Array.isArray(args.edits)) {
    const edits = args.edits.map((edit, index) => {
      if (!edit || typeof edit !== "object" || Array.isArray(edit)) {
        throw new Error(`file.patch edits[${index}] must be an object.`);
      }
      const record = edit as Record<string, unknown>;
      if (typeof record.oldText !== "string" || record.oldText.length === 0) {
        throw new Error(`file.patch edits[${index}].oldText must be a non-empty string.`);
      }
      if (typeof record.newText !== "string") {
        throw new Error(`file.patch edits[${index}].newText must be a string.`);
      }
      return { oldText: record.oldText, newText: record.newText };
    });
    if (edits.length === 0) {
      throw new Error("file.patch requires at least one edit.");
    }
    return edits;
  }
  if (typeof args.search !== "string" || args.search.length === 0) {
    throw new Error("file.patch requires edits[] or a non-empty search string.");
  }
  if (typeof args.replace !== "string") {
    throw new Error("file.patch requires edits[] or a replacement string.");
  }
  return [{ oldText: args.search, newText: args.replace }];
}

function findPatchReplacements(content: string, edits: PatchEdit[]): PatchReplacement[] {
  const replacements = edits.map((edit, index) => {
    const first = content.indexOf(edit.oldText);
    if (first === -1) {
      throw new Error(`file.patch edit ${index + 1} oldText was not found.`);
    }
    const second = content.indexOf(edit.oldText, first + edit.oldText.length);
    if (second !== -1) {
      throw new Error(`file.patch edit ${index + 1} oldText matched more than once.`);
    }
    return {
      ...edit,
      start: first,
      end: first + edit.oldText.length,
    };
  }).sort((left, right) => left.start - right.start);

  for (let index = 1; index < replacements.length; index += 1) {
    const previous = replacements[index - 1]!;
    const current = replacements[index]!;
    if (current.start < previous.end) {
      throw new Error("file.patch edits must not overlap.");
    }
  }
  return replacements;
}

function applyPatchReplacements(content: string, replacements: PatchReplacement[]): string {
  let next = "";
  let cursor = 0;
  for (const replacement of replacements) {
    next += content.slice(cursor, replacement.start);
    next += replacement.newText;
    cursor = replacement.end;
  }
  return next + content.slice(cursor);
}

function buildFileChangeMetadata(params: {
  path: string;
  operation: RuntimeFileChangeMetadata["operation"];
  beforeContent: string;
  afterContent: string;
  sizeBytes: number;
  replacements?: number;
  firstChangedLine?: number;
  diff?: string;
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
      firstChangedLine: params.firstChangedLine,
      diff: params.diff,
      created: params.created,
    },
  };
}

function firstChangedLine(beforeContent: string, afterContent: string): number | undefined {
  if (beforeContent === afterContent) {
    return undefined;
  }
  const beforeLines = beforeContent.split(/\r?\n/);
  const afterLines = afterContent.split(/\r?\n/);
  const length = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < length; index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      return index + 1;
    }
  }
  return undefined;
}

function unifiedDiff(filePath: string, beforeContent: string, afterContent: string): string {
  const beforeLines = beforeContent.split(/\r?\n/);
  const afterLines = afterContent.split(/\r?\n/);
  const lineEnding = beforeContent.includes("\r\n") ? "\r\n" : "\n";
  const lines = [`--- a/${filePath}`, `+++ b/${filePath}`, "@@"];
  for (const part of lineDiff(beforeLines, afterLines)) {
    lines.push(`${part.kind}${part.text}`);
  }
  return lines.join(lineEnding);
}

function lineDiff(beforeLines: string[], afterLines: string[]): Array<{ kind: " " | "-" | "+"; text: string }> {
  const table = new Array(beforeLines.length + 1)
    .fill(undefined)
    .map(() => new Array(afterLines.length + 1).fill(0));
  for (let left = beforeLines.length - 1; left >= 0; left -= 1) {
    for (let right = afterLines.length - 1; right >= 0; right -= 1) {
      table[left]![right] = beforeLines[left] === afterLines[right]
        ? table[left + 1]![right + 1]! + 1
        : Math.max(table[left + 1]![right]!, table[left]![right + 1]!);
    }
  }

  const diff: Array<{ kind: " " | "-" | "+"; text: string }> = [];
  let left = 0;
  let right = 0;
  while (left < beforeLines.length && right < afterLines.length) {
    if (beforeLines[left] === afterLines[right]) {
      diff.push({ kind: " ", text: beforeLines[left]! });
      left += 1;
      right += 1;
    } else if (table[left + 1]![right]! >= table[left]![right + 1]!) {
      diff.push({ kind: "-", text: beforeLines[left]! });
      left += 1;
    } else {
      diff.push({ kind: "+", text: afterLines[right]! });
      right += 1;
    }
  }
  while (left < beforeLines.length) {
    diff.push({ kind: "-", text: beforeLines[left]! });
    left += 1;
  }
  while (right < afterLines.length) {
    diff.push({ kind: "+", text: afterLines[right]! });
    right += 1;
  }
  return diff;
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

function walkFiles(
  rootPath: string,
  startPath: string,
  maxFiles: number,
  options: { includeDefaultExcluded?: boolean; skipped?: SkippedWorkspaceFile[] } = {},
): string[] {
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
    if (!options.includeDefaultExcluded && SKIPPED_DIRS.has(name) && currentPath !== rootPath) {
      options.skipped?.push({
        path: relativeWorkspacePath(rootPath, currentPath),
        reason: "default_excluded",
      });
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

function hasExplicitSearchTarget(
  rootPath: string,
  basePath: string,
  patternOrInclude: string | undefined,
  args: Record<string, unknown>,
): boolean {
  const relativeBase = relativeWorkspacePath(rootPath, basePath);
  if (relativeBase !== ".") {
    return true;
  }
  if (typeof args.include === "string" && referencesDefaultExcludedPath(args.include)) {
    return true;
  }
  return typeof patternOrInclude === "string" && referencesDefaultExcludedPath(patternOrInclude);
}

function referencesDefaultExcludedPath(value: string): boolean {
  const normalized = value.split(path.sep).join("/");
  return [...SKIPPED_DIRS].some((dir) => normalized === dir || normalized.startsWith(`${dir}/`) || normalized.includes(`/${dir}/`));
}

function isDefaultExcludedFile(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  const basename = path.basename(normalized).toLowerCase();
  return SKIPPED_FILE_SUFFIXES.some((suffix) => basename.endsWith(suffix));
}

function isProbablyBinaryFile(filePath: string): boolean {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(BINARY_SNIFF_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (bytesRead === 0) {
      return false;
    }
    for (let index = 0; index < bytesRead; index += 1) {
      if (buffer[index] === 0) {
        return true;
      }
    }
    const sample = buffer.subarray(0, bytesRead).toString("utf8");
    return sample.includes("\uFFFD");
  } finally {
    fs.closeSync(fd);
  }
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
