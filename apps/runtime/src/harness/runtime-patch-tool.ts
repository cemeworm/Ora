import fs from "node:fs";
import path from "node:path";
import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { ResolvedToolLimits, RuntimeFileChangeMetadata, RuntimeToolExecutionContext } from "./runtime-tool-executor.js";
import type { RuntimeToolResultPreview } from "./runtime-tool-definition-v2.js";
import { prefersChinese } from "./runtime-tool-approval.js";
import { withWorkspaceFileMutationQueue } from "./runtime-file-mutation-queue.js";
import {
  relativeWorkspacePath,
  requireWorkspaceRoot,
  resolveWorkspacePath,
} from "./runtime-tool-utils.js";

type HunkLine = {
  kind: "context" | "add" | "remove";
  text: string;
  noNewlineAtEnd?: boolean;
};

type ParsedHunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: HunkLine[];
};

type ParsedFilePatch = {
  oldPath: string | null;
  newPath: string | null;
  hunks: ParsedHunk[];
};

type PatchLineRecord = {
  text: string;
  hasNewline: boolean;
};

type AppliedFilePatch = {
  path: string;
  additions: number;
  deletions: number;
  sizeBytes: number;
  firstChangedLine?: number;
  diff: string;
  created: boolean;
  operation: RuntimeFileChangeMetadata["operation"];
  beforeContent: string;
  afterContent: string;
};

export function applyPatchToolRuntimeFields(): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  return {
    promptExample: "{\"tool\":\"file.apply_patch\",\"args\":{\"patch\":\"--- a/src/file.ts\\n+++ b/src/file.ts\\n@@ -1,1 +1,1 @@\\n-old\\n+new\\n\"}}",
    requiresApprovalCopy: true,
    actionRiskLevel: () => "high",
    approvalRequest: applyPatchApprovalRequest,
    execute: (args, context) => applyWorkspaceUnifiedPatch(requireWorkspaceRoot(context.workspace), args, context.limits),
    resultPreview: (result) => applyPatchResultPreview((result as { output: unknown }).output),
  };
}

function applyPatchApprovalRequest(args: Record<string, unknown>, context: { userPrompt?: string }) {
  const zh = prefersChinese(context.userPrompt);
  const summary = summarizePatchTargets(typeof args.patch === "string" ? args.patch : "");
  if (zh) {
    return {
      title: "需要你确认应用补丁",
      summary: summary
        ? `我准备在项目中应用 unified diff 补丁，目标包括：${summary}。`
        : "我准备在项目中应用 unified diff 补丁。",
      whatWillChange: "补丁中的一个或多个文件会按 diff 内容被精确修改或创建。",
      whyNeeded: "这是完成你要求的本地代码/文件修改所必需的步骤。",
      riskNote: "补丁会直接改动项目文件；如果上下文不匹配或路径越界，执行会被拒绝。",
      confirmLabel: "批准并继续",
    };
  }
  return {
    title: "Confirm patch apply",
    summary: summary
      ? `I am ready to apply a unified diff patch touching ${summary}.`
      : "I am ready to apply a unified diff patch in the project.",
    whatWillChange: "One or more project files will be updated or created according to the patch.",
    whyNeeded: "This is required to complete the local code or file change you requested.",
    riskNote: "The patch changes project files directly; execution is rejected if context does not match or paths escape the workspace.",
    confirmLabel: "Approve and continue",
  };
}

async function applyWorkspaceUnifiedPatch(rootPath: string, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  const parsed = parseUnifiedDiff(args.patch);
  const queuePaths = uniqueSortedTargetPaths(rootPath, parsed);
  return queuePatchTargets(queuePaths, async () => {
    const applied = parsed.map((filePatch) => applyFilePatch(rootPath, filePatch, limits));
    const files = applied.map((change) => ({
      path: change.path,
      additions: change.additions,
      deletions: change.deletions,
      sizeBytes: change.sizeBytes,
      firstChangedLine: change.firstChangedLine,
      created: change.created,
      diff: change.diff,
    }));
    const output = {
      files,
      fileCount: files.length,
      additions: applied.reduce((sum, item) => sum + item.additions, 0),
      deletions: applied.reduce((sum, item) => sum + item.deletions, 0),
      createdCount: applied.filter((item) => item.created).length,
    };
    return {
      output,
      fileChange: applied.length === 1
        ? buildFileChangeMetadata(applied[0]!)
        : undefined,
    };
  });
}

function uniqueSortedTargetPaths(rootPath: string, patches: readonly ParsedFilePatch[]): string[] {
  const paths = new Set<string>();
  for (const patch of patches) {
    const targetPath = patch.newPath ?? patch.oldPath;
    if (!targetPath) {
      throw new Error("file.apply_patch requires each file patch to target a workspace file.");
    }
    paths.add(resolveWorkspacePath(rootPath, targetPath));
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

async function queuePatchTargets<T>(absolutePaths: readonly string[], fn: () => Promise<T>): Promise<T> {
  if (absolutePaths.length === 0) {
    return fn();
  }
  const [first, ...rest] = absolutePaths;
  return withWorkspaceFileMutationQueue(first!, () => queuePatchTargets(rest, fn));
}

function applyFilePatch(rootPath: string, filePatch: ParsedFilePatch, limits: ResolvedToolLimits): AppliedFilePatch {
  const oldPath = filePatch.oldPath;
  const newPath = filePatch.newPath;
  const targetPath = newPath ?? oldPath;
  if (!targetPath) {
    throw new Error("file.apply_patch could not determine the target path for one file patch.");
  }
  if (oldPath && newPath && oldPath !== newPath) {
    throw new Error(`file.apply_patch does not support renaming files (${oldPath} -> ${newPath}).`);
  }
  if (newPath === null) {
    throw new Error(`file.apply_patch does not support deleting files yet (${oldPath ?? targetPath}).`);
  }

  const absolutePath = resolveWorkspacePath(rootPath, targetPath);
  const existed = fs.existsSync(absolutePath);
  if (existed) {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`file.apply_patch target must be a file: ${targetPath}`);
    }
    if (stat.size > limits.fileWriteMaxBytes) {
      throw new Error(`file.apply_patch target is too large (${stat.size} bytes): ${targetPath}`);
    }
  }

  const beforeContent = existed ? fs.readFileSync(absolutePath, "utf8") : "";
  if (!existed && oldPath !== null) {
    throw new Error(`file.apply_patch target does not exist: ${targetPath}`);
  }
  if (existed && oldPath === null) {
    throw new Error(`file.apply_patch new file already exists: ${targetPath}`);
  }

  const afterContent = applyUnifiedHunks(beforeContent, filePatch, targetPath);
  const sizeBytes = Buffer.byteLength(afterContent);
  if (sizeBytes > limits.fileWriteMaxBytes) {
    throw new Error(`file.apply_patch output is too large (${sizeBytes} bytes): ${targetPath}`);
  }

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, afterContent, "utf8");

  const relativePath = relativeWorkspacePath(rootPath, absolutePath);
  const { additions, deletions } = countLineChanges(beforeContent, afterContent);
  return {
    path: relativePath,
    additions,
    deletions,
    sizeBytes,
    firstChangedLine: firstChangedLine(beforeContent, afterContent),
    diff: unifiedDiff(relativePath, beforeContent, afterContent),
    created: !existed,
    operation: "patch",
    beforeContent,
    afterContent,
  };
}

function applyUnifiedHunks(beforeContent: string, filePatch: ParsedFilePatch, targetPath: string): string {
  const lineEnding = beforeContent.includes("\r\n") ? "\r\n" : "\n";
  const originalLines = parseContentLines(beforeContent);
  let workingLines = [...originalLines];
  let lineDelta = 0;

  for (const hunk of filePatch.hunks) {
    const expectedOriginal = hunk.lines.filter((line) => line.kind !== "add");
    const replacement = hunk.lines.filter((line) => line.kind !== "remove");

    // Derive effective counts from the body, fixing up header mismatches
    // that can happen with LLM-generated patches.
    const effectiveOldCount = expectedOriginal.length;
    const effectiveNewCount = replacement.length;

    let startIndex = Math.max(0, hunk.oldStart - 1 + lineDelta);
    const actual = workingLines.slice(startIndex, startIndex + effectiveOldCount);

    if (!matchesHunk(actual, expectedOriginal)) {
      // Fuzzy fallback: ignore leading/trailing whitespace.
      if (!matchesHunkTrimmed(actual, expectedOriginal)) {
        // Fuzzy fallback: search in a window around the expected position.
        const found = searchHunkInWindow(workingLines, expectedOriginal, startIndex);
        if (found < 0) {
          throw new Error(`file.apply_patch context mismatch for ${targetPath} at ${hunk.header}`);
        }
        startIndex = found;
      }
    }

    const finalActual = workingLines.slice(startIndex, startIndex + effectiveOldCount);
    const replacementLines = materializeReplacementLines(finalActual, replacement);
    workingLines.splice(startIndex, effectiveOldCount, ...replacementLines);
    lineDelta += effectiveNewCount - effectiveOldCount;
  }

  return composeContentLines(workingLines, lineEnding);
}

function matchesHunk(actual: readonly PatchLineRecord[], expected: readonly HunkLine[]): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  for (let index = 0; index < expected.length; index += 1) {
    const expectedLine = expected[index]!;
    const actualLine = actual[index]!;
    if (expectedLine.text !== actualLine.text) {
      return false;
    }
    if (expectedLine.noNewlineAtEnd === true && actualLine.hasNewline) {
      return false;
    }
  }
  return true;
}

function matchesHunkTrimmed(actual: readonly PatchLineRecord[], expected: readonly HunkLine[]): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  for (let index = 0; index < expected.length; index += 1) {
    const expectedLine = expected[index]!;
    const actualLine = actual[index]!;
    if (expectedLine.text.trim() !== actualLine.text.trim()) {
      return false;
    }
    if (expectedLine.noNewlineAtEnd === true && actualLine.hasNewline) {
      return false;
    }
  }
  return true;
}

const HUNK_SEARCH_WINDOW = 50;

function searchHunkInWindow(
  workingLines: readonly PatchLineRecord[],
  expected: readonly HunkLine[],
  expectedStart: number,
): number {
  const windowStart = Math.max(0, expectedStart - HUNK_SEARCH_WINDOW);
  const windowEnd = Math.min(workingLines.length, expectedStart + HUNK_SEARCH_WINDOW);
  for (let i = windowStart; i <= windowEnd - expected.length; i += 1) {
    const candidate = workingLines.slice(i, i + expected.length);
    if (matchesHunkTrimmed(candidate, expected)) {
      return i;
    }
  }
  return -1;
}

function materializeReplacementLines(actual: readonly PatchLineRecord[], replacement: readonly HunkLine[]): PatchLineRecord[] {
  const lines: PatchLineRecord[] = [];
  let contextIndex = 0;
  for (const item of replacement) {
    if (item.kind === "context") {
      const actualLine = actual[contextIndex];
      if (!actualLine) {
        throw new Error("file.apply_patch could not materialize context line.");
      }
      lines.push(item.noNewlineAtEnd === true
        ? { ...actualLine, hasNewline: false }
        : actualLine);
      contextIndex += 1;
      continue;
    }
    lines.push({
      text: item.text,
      hasNewline: item.noNewlineAtEnd !== true,
    });
  }
  return lines;
}

function parseUnifiedDiff(input: unknown): ParsedFilePatch[] {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error("file.apply_patch requires a non-empty patch string.");
  }
  const lines = input.split(/\r?\n/);
  const files: ParsedFilePatch[] = [];
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && !lines[index]!.startsWith("--- ")) {
      index += 1;
    }
    if (index >= lines.length) {
      break;
    }
    const oldHeader = lines[index++]!;
    const newHeader = lines[index];
    if (!newHeader?.startsWith("+++ ")) {
      throw new Error(`file.apply_patch expected +++ header after ${oldHeader}`);
    }
    index += 1;
    const oldPath = parseDiffHeaderPath(oldHeader.slice(4));
    const newPath = parseDiffHeaderPath(newHeader.slice(4));
    const hunks: ParsedHunk[] = [];
    while (index < lines.length) {
      const line = lines[index]!;
      if (line.startsWith("--- ")) {
        break;
      }
      if (!line.startsWith("@@ ")) {
        index += 1;
        continue;
      }
      const header = line;
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
      if (!match) {
        throw new Error(`file.apply_patch could not parse hunk header: ${header}`);
      }
      index += 1;
      const hunkLines: HunkLine[] = [];
      while (index < lines.length) {
        const current = lines[index]!;
        if (current.startsWith("@@ ") || current.startsWith("--- ")) {
          break;
        }
        if (current.length === 0) {
          if (index === lines.length - 1) {
            index += 1;
            break;
          }
          throw new Error("file.apply_patch encountered an unexpected blank line inside a hunk.");
        }
        if (current === "\\ No newline at end of file") {
          const previous = hunkLines[hunkLines.length - 1];
          if (!previous) {
            throw new Error("file.apply_patch encountered an invalid no-newline marker.");
          }
          previous.noNewlineAtEnd = true;
          index += 1;
          continue;
        }
        const prefix = current[0];
        if (prefix !== " " && prefix !== "+" && prefix !== "-") {
          throw new Error(`file.apply_patch encountered an invalid hunk line: ${current}`);
        }
        hunkLines.push({
          kind: prefix === " " ? "context" : prefix === "+" ? "add" : "remove",
          text: current.slice(1),
        });
        index += 1;
      }
      hunks.push({
        header,
        oldStart: Number.parseInt(match[1]!, 10),
        oldCount: match[2] !== undefined ? Number.parseInt(match[2], 10) : 1,
        newStart: Number.parseInt(match[3]!, 10),
        newCount: match[4] !== undefined ? Number.parseInt(match[4], 10) : 1,
        lines: hunkLines,
      });
    }
    if (hunks.length === 0) {
      throw new Error(`file.apply_patch found no hunks for ${newPath ?? oldPath ?? "<unknown>"}.`);
    }
    files.push({ oldPath, newPath, hunks });
  }
  if (files.length === 0) {
    throw new Error("file.apply_patch did not find any file hunks in the patch.");
  }
  const duplicateTarget = findDuplicateTarget(files);
  if (duplicateTarget) {
    throw new Error(`file.apply_patch does not support multiple patch blocks for the same file: ${duplicateTarget}`);
  }
  return files;
}

function findDuplicateTarget(files: readonly ParsedFilePatch[]): string | undefined {
  const seen = new Set<string>();
  for (const file of files) {
    const target = file.newPath ?? file.oldPath;
    if (!target) {
      continue;
    }
    if (seen.has(target)) {
      return target;
    }
    seen.add(target);
  }
  return undefined;
}

function parseDiffHeaderPath(raw: string): string | null {
  const header = raw.trim();
  const withoutTimestamp = header.split("\t")[0]!.trim();
  if (withoutTimestamp === "/dev/null") {
    return null;
  }
  return withoutTimestamp.replace(/^[ab]\//, "");
}

function parseContentLines(content: string): PatchLineRecord[] {
  if (content.length === 0) {
    return [];
  }
  const rawLines = content.match(/.*(?:\r\n|\n|$)/g) ?? [];
  return rawLines
    .filter((line) => line.length > 0)
    .map((line) => ({
      text: line.replace(/\r?\n$/, ""),
      hasNewline: /\r?\n$/.test(line),
    }));
}

function composeContentLines(lines: readonly PatchLineRecord[], lineEnding: string): string {
  return lines
    .map((line) => line.text + (line.hasNewline ? lineEnding : ""))
    .join("");
}

function summarizePatchTargets(patch: string): string {
  try {
    const files = parseUnifiedDiff(patch);
    const targets = files
      .map((file) => file.newPath ?? file.oldPath)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (targets.length === 0) {
      return "";
    }
    const preview = targets.slice(0, 3).join(", ");
    return targets.length > 3 ? `${preview} 等 ${targets.length} 个文件` : preview;
  } catch {
    return "";
  }
}

function applyPatchResultPreview(output: unknown): RuntimeToolResultPreview {
  const result = output as {
    files?: Array<{ path: string; additions: number; deletions: number; created?: boolean; diff?: string }>;
    fileCount?: number;
    additions?: number;
    deletions?: number;
    createdCount?: number;
  } | undefined;
  const files = result?.files ?? [];
  return {
    kind: "file.apply_patch",
    summary: `Applied patch to ${result?.fileCount ?? files.length ?? 0} file(s) — ${result?.additions ?? 0} additions, ${result?.deletions ?? 0} deletions`,
    detail: {
      fileCount: result?.fileCount ?? files.length,
      additions: result?.additions ?? 0,
      deletions: result?.deletions ?? 0,
      createdCount: result?.createdCount ?? files.filter((file) => file.created).length,
    },
    preview: files.slice(0, 5),
  };
}

function buildFileChangeMetadata(params: AppliedFilePatch): RuntimeFileChangeMetadata {
  return {
    kind: "file_change",
    path: params.path,
    operation: params.operation,
    beforeContent: params.beforeContent,
    afterContent: params.afterContent,
    additions: params.additions,
    deletions: params.deletions,
    metadata: {
      sizeBytes: params.sizeBytes,
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
