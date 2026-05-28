import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { ResolvedToolLimits, RuntimeFileChangeMetadata, RuntimeToolExecutionContext } from "./runtime-tool-executor.js";
import type { RuntimeToolResultPreview } from "./runtime-tool-definition-v2.js";
import {
  readPositiveInt,
  relativeWorkspacePath,
  resolveFileToolTarget,
  workspaceRootPath,
  type ResolvedFileToolTarget,
} from "./runtime-tool-utils.js";
import { approvalRequestLanguage, stringArg } from "./runtime-tool-approval.js";
import { withWorkspaceFileMutationQueue } from "./runtime-file-mutation-queue.js";
import { applyPatchToolRuntimeFields } from "./runtime-patch-tool.js";
import { readTextFile, sniffTextFile } from "./text-file-sniffer.js";

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
type SkippedWorkspaceFile = {
  path: string;
  reason: "default_excluded" | "too_large" | "binary" | "missing_during_walk";
  sizeBytes?: number;
};

type FileTargetCorrectionReason = "case_mismatch" | "extension_variant";

type WorkspaceFileTargetCandidate = {
  absolutePath: string;
  displayPath: string;
  correctionReason: FileTargetCorrectionReason;
};

type WorkspaceFileTargetResolution =
  | { kind: "exact"; absolutePath: string; displayPath: string }
  | { kind: "autocorrected"; absolutePath: string; displayPath: string; requestedPath: string; correctionReason: FileTargetCorrectionReason }
  | { kind: "missing"; requestedPath: string; candidates: string[] };

export function fileToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  switch (toolId) {
    case "file.read":
      return {
        promptExample: "{\"tool\":\"file.read\",\"args\":{\"path\":\"relative/path.ts\"}}",
        prepareArguments: (args, context) => normalizeWorkspaceAbsoluteFileReadPath(args, context.workspace),
        execute: async (args, context) => ({
          output: await readLocalFile(
            resolveFileToolTarget({ workspace: context.workspace, hostFilesystem: context.hostFilesystem, args, capability: "read" }),
            args,
            context,
          ),
        }),
        resultPreview: (result) => fileReadResultPreview((result as { output: unknown }).output),
      };
    case "file.list":
      return {
        promptExample: "{\"tool\":\"file.list\",\"args\":{\"path\":\".\"}}",
        execute: (args, context) => ({ output: listLocalFiles(resolveFileToolTarget({ workspace: context.workspace, hostFilesystem: context.hostFilesystem, args: { ...args, path: args.path ?? "." }, capability: "list" }), args, context.limits) }),
        resultPreview: (result) => fileListResultPreview((result as { output: unknown }).output),
      };
    case "file.glob":
      return {
        promptExample: "{\"tool\":\"file.glob\",\"args\":{\"pattern\":\"**/*.ts\"}}",
        execute: (args, context) => ({ output: globLocalFiles(resolveFileToolTarget({ workspace: context.workspace, hostFilesystem: context.hostFilesystem, args: { ...args, path: args.path ?? "." }, capability: "search" }), args, context.limits) }),
        resultPreview: (result) => fileGlobResultPreview((result as { output: unknown }).output),
      };
    case "file.grep":
      return {
        promptExample: "{\"tool\":\"file.grep\",\"args\":{\"pattern\":\"functionName\",\"include\":\"**/*.ts\"}}",
        execute: (args, context) => ({ output: grepLocalFiles(resolveFileToolTarget({ workspace: context.workspace, hostFilesystem: context.hostFilesystem, args: { ...args, path: args.path ?? "." }, capability: "search" }), args, context.limits) }),
        resultPreview: (result) => fileGrepResultPreview((result as { output: unknown }).output),
      };
    case "file.write":
      return {
        promptExample: "{\"tool\":\"file.write\",\"args\":{\"path\":\"notes/result.md\",\"content\":\"...\"}}",
        requiresApprovalCopy: true,
        actionRiskLevel: () => "high",
        approvalRequest: fileWriteApprovalRequest,
        execute: (args, context) => writeLocalFile(resolveFileToolTarget({ workspace: context.workspace, hostFilesystem: context.hostFilesystem, args, capability: "write" }), args, context.limits),
        resultPreview: (result, args) => fileWriteResultPreview((result as { output: unknown; fileChange?: RuntimeFileChangeMetadata }).fileChange, args),
      };
    case "file.patch":
      return {
        promptExample: "{\"tool\":\"file.patch\",\"args\":{\"path\":\"src/file.ts\",\"edits\":[{\"oldText\":\"old\",\"newText\":\"new\"}]}}",
        requiresApprovalCopy: true,
        actionRiskLevel: () => "high",
        approvalRequest: filePatchApprovalRequest,
        execute: (args, context) => patchLocalFile(resolveFileToolTarget({ workspace: context.workspace, hostFilesystem: context.hostFilesystem, args, capability: "patch" }), args, context.limits),
        resultPreview: (result, args) => filePatchResultPreview((result as { output: unknown; fileChange?: RuntimeFileChangeMetadata }).fileChange, args),
      };
    case "file.apply_patch":
      return applyPatchToolRuntimeFields();
    default:
      return {};
  }
}

function normalizeWorkspaceAbsoluteFileReadPath(
  args: Record<string, unknown>,
  workspace: unknown,
): Record<string, unknown> {
  if (args.scope === "host_tmp" || args.scope === "host_grant") {
    return args;
  }
  const requestedPath = typeof args.path === "string" ? args.path.trim() : "";
  if (!requestedPath || !path.isAbsolute(requestedPath)) {
    return args;
  }
  const rootPath = workspaceRootPath(workspace);
  if (!rootPath) {
    return args;
  }
  // 符号链接规范化：比较规范路径而非裸字符串
  const canonicalRequested = canonicalizeExternalPath(requestedPath);
  const canonicalRoot = canonicalizeExternalPath(rootPath);
  const relative = path.relative(canonicalRoot, canonicalRequested);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return args;
  }
  return {
    ...args,
    path: relativeWorkspacePath(rootPath, path.resolve(requestedPath)),
  };
}

function canonicalizeExternalPath(targetPath: string): string {
  try {
    return fs.existsSync(targetPath) ? fs.realpathSync.native(path.resolve(targetPath)) : path.resolve(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function fileWriteApprovalRequest(args: Record<string, unknown>, context: { userPrompt?: string }) {
  const zh = approvalRequestLanguage({ userPrompt: context.userPrompt }) === "zh";
  const target = approvalTargetLabel(args, zh);
  return zh
    ? {
        title: "需要你确认写入文件",
        summary: `我准备写入“${target}”。`,
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
  const zh = approvalRequestLanguage({ userPrompt: context.userPrompt }) === "zh";
  const target = approvalTargetLabel(args, zh);
  return zh
    ? {
        title: "需要你确认修改文件",
        summary: `我准备修改“${target}”。`,
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

function approvalTargetLabel(args: Record<string, unknown>, zh: boolean): string {
  const target = stringArg(args, "path", zh ? "目标文件" : "the target file");
  const scope = typeof args.scope === "string" ? args.scope : "workspace";
  if (zh) {
    if (scope === "host_tmp") {
      return `临时目录中的“${target}”`;
    }
    if (scope === "host_grant") {
      return `宿主授权目录中的“${target}”`;
    }
    return `项目中的“${target}”`;
  }
  if (scope === "host_tmp") {
    return `"${target}" in the temporary directory`;
  }
  if (scope === "host_grant") {
    return `"${target}" in the approved host directory`;
  }
  return `"${target}" in the project`;
}

async function readLocalFile(
  target: ResolvedFileToolTarget,
  args: Record<string, unknown>,
  context: Pick<RuntimeToolExecutionContext, "limits" | "clarificationAnswer" | "ensureClarification" | "currentNodeId" | "currentNodeLabel">,
) {
  const resolvedTarget = resolveWorkspaceFileTarget(target, { allowExtensionVariant: true });
  if (resolvedTarget.kind === "missing") {
    const clarifiedPath = await maybeResolveFileReadClarification(target, resolvedTarget, context);
    if (clarifiedPath) {
      return readLocalFile({
        ...target,
        absolutePath: clarifiedPath.absolutePath,
        displayPath: clarifiedPath.displayPath,
      }, {
        ...args,
        path: clarifiedPath.displayPath,
      }, context);
    }
    return {
      ...targetScopeOutput(target),
      path: resolvedTarget.requestedPath,
      missing: true,
      candidates: resolvedTarget.candidates,
    };
  }
  const absolutePath = resolvedTarget.absolutePath;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolutePath);
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      throw new Error(`file.read target not found: ${target.displayPath}`);
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new Error("file.read target must be a file.");
  }
  if (stat.size > context.limits.fileReadMaxBytes) {
    throw new Error(`file.read target is too large (${stat.size} bytes).`);
  }
  const sniffed = sniffTextFile(absolutePath);
  if (sniffed.kind === "binary") {
    return {
      ...targetScopeOutput(target),
      path: resolvedTarget.displayPath,
      sizeBytes: stat.size,
      binary: true,
      content: "",
      skippedReason: "binary_file",
      ...(resolvedTarget.kind === "autocorrected"
        ? {
            autocorrectedFrom: resolvedTarget.requestedPath,
            correctionReason: resolvedTarget.correctionReason,
          }
        : {}),
    };
  }
  const content = readTextFile(absolutePath, sniffed.encoding);
  const range = readLineRange(content, args);
  if (range) {
    return {
      ...targetScopeOutput(target),
      path: resolvedTarget.displayPath,
      sizeBytes: stat.size,
      content: range.content,
      offset: range.offset,
      ...(range.limit !== undefined ? { limit: range.limit } : {}),
      returnedLines: range.returnedLines,
      totalLines: range.totalLines,
      truncated: range.truncated,
      ...(resolvedTarget.kind === "autocorrected"
        ? {
            autocorrectedFrom: resolvedTarget.requestedPath,
            correctionReason: resolvedTarget.correctionReason,
          }
        : {}),
    };
  }
  return {
    ...targetScopeOutput(target),
    path: resolvedTarget.displayPath,
    sizeBytes: stat.size,
    content,
    ...(resolvedTarget.kind === "autocorrected"
      ? {
          autocorrectedFrom: resolvedTarget.requestedPath,
          correctionReason: resolvedTarget.correctionReason,
        }
      : {}),
  };
}

async function maybeResolveFileReadClarification(
  target: ResolvedFileToolTarget,
  resolvedTarget: Extract<WorkspaceFileTargetResolution, { kind: "missing" }>,
  context: Pick<RuntimeToolExecutionContext, "clarificationAnswer" | "ensureClarification" | "currentNodeId" | "currentNodeLabel">,
): Promise<{ absolutePath: string; displayPath: string } | undefined> {
  const { ensureClarification, clarificationAnswer } = context;
  if (!target.workspaceRoot || resolvedTarget.candidates.length < 2 || !ensureClarification) {
    return undefined;
  }
  const clarification = fileReadTargetClarification(target, resolvedTarget);
  const answered = clarificationAnswer?.(clarification.key, clarification.id);
  const selectedPath = selectClarifiedCandidate(answered, clarification.options);
  if (selectedPath) {
    return {
      absolutePath: path.join(target.workspaceRoot, selectedPath),
      displayPath: selectedPath,
    };
  }
  const resumed = await ensureClarification({
    ...clarification,
    nodeId: context.currentNodeId ?? "file.read",
    nodeLabel: context.currentNodeLabel ?? "file.read",
  });
  const resumedPath = selectClarifiedCandidate(resumed, clarification.options);
  if (!resumedPath) {
    throw new Error(`file.read clarification answer did not match any candidate for ${resolvedTarget.requestedPath}.`);
  }
  return {
    absolutePath: path.join(target.workspaceRoot, resumedPath),
    displayPath: resumedPath,
  };
}

function fileReadTargetClarification(
  target: ResolvedFileToolTarget,
  resolvedTarget: Extract<WorkspaceFileTargetResolution, { kind: "missing" }>,
): {
  id: string;
  key: string;
  question: string;
  options: Array<{ id: string; label: string; value: string; description?: string }>;
} {
  const requestedPath = resolvedTarget.requestedPath;
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify({
      scope: target.scope,
      requestedPath,
      candidates: resolvedTarget.candidates,
    }))
    .digest("hex")
    .slice(0, 10);
  return {
    id: `clarification:file-read-target:${fingerprint}`,
    key: `file_read_target_${fingerprint}`,
    question: `我找到了多个可能匹配“${requestedPath}”的文件，请选择你要我读取的目标。`,
    options: resolvedTarget.candidates.slice(0, 6).map((candidate, index) => ({
      id: `candidate_${index + 1}`,
      label: candidate,
      value: candidate,
      description: `读取 ${candidate}`,
    })),
  };
}

function selectClarifiedCandidate(
  answer: unknown,
  options: Array<{ id: string; label: string; value: string }>,
): string | undefined {
  if (typeof answer !== "string" || answer.trim().length === 0) {
    return undefined;
  }
  const normalized = answer.trim();
  const matchedOption = options.find((option) =>
    option.id === normalized || option.value === normalized || option.label === normalized
  );
  return matchedOption?.value;
}

type FileReadLineRange = {
  content: string;
  offset: number;
  limit?: number;
  returnedLines: number;
  totalLines: number;
  truncated: boolean;
};

function readLineRange(content: string, args: Record<string, unknown>): FileReadLineRange | undefined {
  const hasOffset = args.offset !== undefined;
  const hasLimit = args.limit !== undefined;
  if (!hasOffset && !hasLimit) {
    return undefined;
  }
  const lines = splitPreservingLineEndings(content);
  const offset = readPositiveIntLike(args.offset, 1);
  const limit = hasLimit ? readPositiveIntLike(args.limit, Math.max(lines.length - offset + 1, 1)) : undefined;
  const start = Math.max(offset - 1, 0);
  const selected = limit === undefined ? lines.slice(start) : lines.slice(start, start + limit);
  return {
    content: selected.join(""),
    offset,
    ...(limit !== undefined ? { limit } : {}),
    returnedLines: selected.length,
    totalLines: lines.length,
    truncated: start > 0 || start + selected.length < lines.length,
  };
}

function splitPreservingLineEndings(content: string): string[] {
  if (!content) {
    return [];
  }
  const lines = content.match(/.*(?:\r\n|\n|\r|$)/g) ?? [];
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function readPositiveIntLike(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function listLocalFiles(target: ResolvedFileToolTarget, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  const absolutePath = target.absolutePath;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolutePath);
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return {
        ...targetScopeOutput(target),
        path: target.displayPath,
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
    .flatMap((entry) => {
      const entryPath = path.join(absolutePath, entry.name);
      let entryStat: fs.Stats;
      try {
        entryStat = fs.statSync(entryPath);
      } catch (error) {
        if (isErrnoCode(error, "ENOENT")) {
          return [];
        }
        throw error;
      }
      return {
        name: entry.name,
        path: displayPathFor(target, entryPath),
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
        sizeBytes: entry.isFile() ? entryStat.size : undefined,
      };
    });
  return {
    ...targetScopeOutput(target),
    path: target.displayPath,
    entries,
  };
}

function isErrnoCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function createSearchMatcher(anchorRootPath: string, basePath: string, rawPattern: string): (filePath: string) => boolean {
  const matcher = globToRegExp(rawPattern);
  if (!shouldCompatMatchScopedBarePattern(anchorRootPath, basePath, rawPattern)) {
    return (filePath) => matcher.test(normalizeSearchPath(relativeWorkspacePath(anchorRootPath, filePath)));
  }
  return (filePath) => {
    const relativePath = normalizeSearchPath(relativeWorkspacePath(anchorRootPath, filePath));
    return matcher.test(relativePath) || matcher.test(path.posix.basename(relativePath));
  };
}

function shouldCompatMatchScopedBarePattern(anchorRootPath: string, basePath: string, rawPattern: string): boolean {
  const relativeBasePath = normalizeSearchPath(relativeWorkspacePath(anchorRootPath, basePath));
  if (relativeBasePath === ".") {
    return false;
  }
  const normalizedPattern = normalizeSearchPath(rawPattern);
  return !normalizedPattern.includes("/");
}

function normalizeSearchPath(value: string): string {
  return value.split(path.sep).join("/");
}

function globLocalFiles(target: ResolvedFileToolTarget, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  const pattern = typeof args.pattern === "string" && args.pattern.trim() ? args.pattern : undefined;
  if (!pattern) {
    throw new Error("file.glob requires a non-empty pattern.");
  }
  const resolvedTarget = resolveWorkspaceFileTarget(target, { allowExtensionVariant: true });
  if (resolvedTarget.kind === "missing") {
    return {
      ...targetScopeOutput(target),
      path: resolvedTarget.requestedPath,
      pattern,
      matches: [],
      skipped: [],
      missing: true,
      candidates: resolvedTarget.candidates,
    };
  }
  const basePath = resolvedTarget.absolutePath;
  const scopePath = resolvedTarget.displayPath;
  const matcher = createSearchMatcher(target.anchorRootPath, basePath, pattern);
  const limit = readPositiveInt(args.limit, limits.fileListMaxEntries, limits.fileListMaxEntries);
  const explicitTarget = hasExplicitSearchTarget(target.anchorRootPath, basePath, pattern, args);
  const skipped: SkippedWorkspaceFile[] = [];
  const matches: string[] = [];
  for (const filePath of walkFiles(target.anchorRootPath, basePath, limits.fileSearchMaxFiles, {
    includeDefaultExcluded: explicitTarget,
    skipped,
    displayPath: (absolutePath) => displayPathFor(target, absolutePath),
  })) {
    const relative = relativeWorkspacePath(target.anchorRootPath, filePath);
    if (!explicitTarget && isDefaultExcludedFile(relative)) {
      skipped.push({ path: displayPathFor(target, filePath), reason: "default_excluded" });
      continue;
    }
    if (matcher(filePath)) {
      matches.push(displayPathFor(target, filePath));
      if (matches.length >= limit) {
        break;
      }
    }
  }
  return {
    ...targetScopeOutput(target),
    path: scopePath,
    pattern,
    matches,
    skipped,
    ...(resolvedTarget.kind === "autocorrected"
      ? {
          autocorrectedFrom: resolvedTarget.requestedPath,
          correctionReason: resolvedTarget.correctionReason,
        }
      : {}),
  };
}

function grepLocalFiles(target: ResolvedFileToolTarget, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  const pattern = typeof args.pattern === "string" && args.pattern.trim() ? args.pattern : undefined;
  if (!pattern) {
    throw new Error("file.grep requires a non-empty pattern.");
  }
  const resolvedTarget = resolveWorkspaceFileTarget(target, { allowExtensionVariant: true });
  if (resolvedTarget.kind === "missing") {
    return {
      ...targetScopeOutput(target),
      path: resolvedTarget.requestedPath,
      pattern,
      matches: [],
      truncated: false,
      skipped: [],
      missing: true,
      candidates: resolvedTarget.candidates,
    };
  }
  const basePath = resolvedTarget.absolutePath;
  const scopePath = resolvedTarget.displayPath;
  const include = typeof args.include === "string" && args.include.trim()
    ? createSearchMatcher(target.anchorRootPath, basePath, args.include)
    : undefined;
  const caseSensitive = args.caseSensitive !== false;
  const needle = caseSensitive ? pattern : pattern.toLowerCase();
  const limit = readPositiveInt(args.limit, limits.fileSearchMaxMatches, limits.fileSearchMaxMatches);
  const explicitTarget = hasExplicitSearchTarget(target.anchorRootPath, basePath, typeof args.include === "string" ? args.include : undefined, args);
  const matches: Array<{ path: string; line: number; text: string }> = [];
  const skipped: SkippedWorkspaceFile[] = [];

  for (const filePath of walkFiles(target.anchorRootPath, basePath, limits.fileSearchMaxFiles, {
    includeDefaultExcluded: explicitTarget,
    skipped,
    displayPath: (absolutePath) => displayPathFor(target, absolutePath),
  })) {
    const relative = relativeWorkspacePath(target.anchorRootPath, filePath);
    if (include && !include(filePath)) {
      continue;
    }
    if (!explicitTarget && isDefaultExcludedFile(relative)) {
      skipped.push({ path: displayPathFor(target, filePath), reason: "default_excluded" });
      continue;
    }
    const stat = fs.statSync(filePath);
    if (stat.size > limits.fileSearchMaxBytes) {
      skipped.push({ path: displayPathFor(target, filePath), reason: "too_large", sizeBytes: stat.size });
      continue;
    }
    const sniffed = sniffTextFile(filePath);
    if (sniffed.kind === "binary") {
      skipped.push({ path: displayPathFor(target, filePath), reason: "binary", sizeBytes: stat.size });
      continue;
    }
    const lines = readTextFile(filePath, sniffed.encoding).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const haystack = caseSensitive ? line : line.toLowerCase();
      if (haystack.includes(needle)) {
        matches.push({ path: displayPathFor(target, filePath), line: index + 1, text: line });
        if (matches.length >= limit) {
          return {
            ...targetScopeOutput(target),
            path: scopePath,
            pattern,
            matches,
            truncated: true,
            skipped,
            ...(resolvedTarget.kind === "autocorrected"
              ? {
                  autocorrectedFrom: resolvedTarget.requestedPath,
                  correctionReason: resolvedTarget.correctionReason,
                }
              : {}),
          };
        }
      }
    }
  }
  return {
    ...targetScopeOutput(target),
    path: scopePath,
    pattern,
    matches,
    truncated: false,
    skipped,
    ...(resolvedTarget.kind === "autocorrected"
      ? {
          autocorrectedFrom: resolvedTarget.requestedPath,
          correctionReason: resolvedTarget.correctionReason,
        }
      : {}),
  };
}

async function writeLocalFile(target: ResolvedFileToolTarget, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  if (typeof args.content !== "string") {
    throw new Error("file.write requires string content.");
  }
  const content = args.content;
  const sizeBytes = Buffer.byteLength(content);
  if (sizeBytes > limits.fileWriteMaxBytes) {
    throw new Error(`file.write content is too large (${sizeBytes} bytes).`);
  }
  const absolutePath = target.absolutePath;
  return withWorkspaceFileMutationQueue(absolutePath, () => {
    const existed = fs.existsSync(absolutePath);
    const beforeContent = existed ? fs.readFileSync(absolutePath, "utf8") : "";
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf8");
    const output = {
      ...targetScopeOutput(target),
      path: target.displayPath,
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

async function patchLocalFile(target: ResolvedFileToolTarget, args: Record<string, unknown>, limits: ResolvedToolLimits) {
  const edits = parsePatchEdits(args);
  const absolutePath = target.absolutePath;
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
    const outputPath = target.displayPath;
    const output = {
      ...targetScopeOutput(target),
      path: outputPath,
      replacements: replacements.length,
      sizeBytes: Buffer.byteLength(next),
      firstChangedLine: firstChangedLine(current, next),
      diff: unifiedDiff(outputPath, current, next),
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

function targetScopeOutput(target: ResolvedFileToolTarget): { scope: ResolvedFileToolTarget["scope"]; grantId?: string } {
  return target.grantId
    ? { scope: target.scope, grantId: target.grantId }
    : { scope: target.scope };
}

function displayPathFor(target: ResolvedFileToolTarget, absolutePath: string): string {
  return target.workspaceRoot
    ? relativeWorkspacePath(target.workspaceRoot, absolutePath)
    : absolutePath;
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
  options: {
    includeDefaultExcluded?: boolean;
    skipped?: SkippedWorkspaceFile[];
    displayPath?: (absolutePath: string) => string;
  } = {},
): string[] {
  const files: string[] = [];
  const visit = (currentPath: string) => {
    if (files.length >= maxFiles) {
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(currentPath);
    } catch (error) {
      if (isErrnoCode(error, "ENOENT")) {
        options.skipped?.push({
          path: options.displayPath?.(currentPath) ?? relativeWorkspacePath(rootPath, currentPath),
          reason: "missing_during_walk",
        });
        return;
      }
      throw error;
    }
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
        path: options.displayPath?.(currentPath) ?? relativeWorkspacePath(rootPath, currentPath),
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

function globToRegExp(pattern: string): RegExp {
  let source = "";
  let inBraceGroup = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    const next = pattern[index + 1];
    const afterNext = pattern[index + 2];
    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      source += "(?:";
      inBraceGroup = true;
    } else if (char === "}" && inBraceGroup) {
      source += ")";
      inBraceGroup = false;
    } else if (char === "," && inBraceGroup) {
      source += "|";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

// ---- result preview helpers ----

interface FileReadOutput {
  path: string;
  scope?: ResolvedFileToolTarget["scope"];
  grantId?: string;
  sizeBytes?: number;
  content?: string;
  binary?: boolean;
  skippedReason?: string;
  offset?: number;
  limit?: number;
  returnedLines?: number;
  totalLines?: number;
  truncated?: boolean;
  missing?: boolean;
  candidates?: string[];
  autocorrectedFrom?: string;
  correctionReason?: FileTargetCorrectionReason;
}

function fileReadResultPreview(output: unknown): RuntimeToolResultPreview {
  const o = output as FileReadOutput | undefined;
  if (!o) {
    return { kind: "file.read", summary: "Read file." };
  }
  const labeledPath = previewPathLabel(o.scope, o.path);
  if (o.missing) {
    const candidateCount = o.candidates?.length ?? 0;
    return {
      kind: "file.read",
      summary: `Path not found: ${labeledPath}${candidateCount > 0 ? ` (${candidateCount} candidates)` : ""}`,
      detail: {
        path: o.path,
        scope: o.scope,
        grantId: o.grantId,
        missing: true,
        candidateCount,
        candidates: o.candidates ?? [],
      },
      preview: (o.candidates ?? []).slice(0, 20),
    };
  }
  if (o.binary) {
    return {
      kind: "file.read",
      summary: `Binary file: ${labeledPath} (${o.sizeBytes ?? 0} bytes)`,
      detail: {
        path: o.path,
        scope: o.scope,
        grantId: o.grantId,
        sizeBytes: o.sizeBytes,
        binary: true,
        autocorrectedFrom: o.autocorrectedFrom,
        correctionReason: o.correctionReason,
      },
    };
  }
  const lines = o.returnedLines ?? splitPreservingLineEndings(o.content ?? "").length;
  const rangeSuffix = o.offset !== undefined
    ? ` (lines ${o.offset}-${Math.max(o.offset + lines - 1, o.offset - 1)}${o.truncated ? ", partial" : ""})`
    : "";
  const correctionPrefix = o.autocorrectedFrom ? `Corrected ${previewPathLabel(o.scope, o.autocorrectedFrom)} -> ` : "";
  return {
    kind: "file.read",
    summary: `${correctionPrefix}${labeledPath} — ${lines} lines, ${o.sizeBytes ?? 0} bytes${rangeSuffix}`,
    detail: {
      path: o.path,
      scope: o.scope,
      grantId: o.grantId,
      sizeBytes: o.sizeBytes,
      lines,
      binary: false,
      offset: o.offset,
      limit: o.limit,
      returnedLines: o.returnedLines,
      totalLines: o.totalLines,
      truncated: o.truncated,
      autocorrectedFrom: o.autocorrectedFrom,
      correctionReason: o.correctionReason,
    },
    preview: (o.content ?? "").slice(0, 2000),
  };
}

interface FileListOutput {
  path: string;
  scope?: ResolvedFileToolTarget["scope"];
  grantId?: string;
  entries?: Array<{ name: string; path: string; kind: string; sizeBytes?: number }>;
  missing?: boolean;
}

function fileListResultPreview(output: unknown): RuntimeToolResultPreview {
  const o = output as FileListOutput | undefined;
  if (o?.missing) {
    return { kind: "file.list", summary: `Path not found: ${previewPathLabel(o.scope, o.path)}`, detail: { path: o.path, scope: o.scope, grantId: o.grantId, missing: true } };
  }
  const entries = o?.entries ?? [];
  return {
    kind: "file.list",
    summary: `${previewPathLabel(o?.scope, o?.path ?? "?")} — ${entries.length} entries`,
    detail: { path: o?.path, scope: o?.scope, grantId: o?.grantId, entryCount: entries.length },
    preview: entries.slice(0, 20),
  };
}

interface FileGlobOutput {
  path?: string;
  scope?: ResolvedFileToolTarget["scope"];
  grantId?: string;
  pattern: string;
  matches?: string[];
  skipped?: unknown[];
  missing?: boolean;
  candidates?: string[];
  autocorrectedFrom?: string;
  correctionReason?: FileTargetCorrectionReason;
}

function fileGlobResultPreview(output: unknown): RuntimeToolResultPreview {
  const o = output as FileGlobOutput | undefined;
  const matches = o?.matches ?? [];
  const skipped = (o?.skipped ?? []).length;
  if (o?.missing) {
    const candidateCount = o.candidates?.length ?? 0;
    return {
      kind: "file.glob",
      summary: `Path not found: ${previewPathLabel(o.scope, o.path ?? "?")}${candidateCount > 0 ? ` (${candidateCount} candidates)` : ""}`,
      detail: {
        path: o.path,
        scope: o.scope,
        grantId: o.grantId,
        pattern: o.pattern,
        missing: true,
        candidateCount,
        candidates: o.candidates ?? [],
      },
      preview: (o.candidates ?? []).slice(0, 20),
    };
  }
  const correctionPrefix = o?.autocorrectedFrom ? `Corrected ${previewPathLabel(o.scope, o.autocorrectedFrom)} -> ` : "";
  return {
    kind: "file.glob",
    summary: `${correctionPrefix}${previewPathLabel(o?.scope, o?.path ?? o?.pattern ?? "?")} — ${matches.length} matches${skipped > 0 ? ` (${skipped} skipped)` : ""}`,
    detail: {
      path: o?.path,
      scope: o?.scope,
      grantId: o?.grantId,
      pattern: o?.pattern,
      matchCount: matches.length,
      skippedCount: skipped,
      autocorrectedFrom: o?.autocorrectedFrom,
      correctionReason: o?.correctionReason,
    },
    preview: matches.slice(0, 20),
  };
}

interface FileGrepOutput {
  path?: string;
  scope?: ResolvedFileToolTarget["scope"];
  grantId?: string;
  pattern: string;
  matches?: Array<{ path: string; line: number; text: string }>;
  truncated?: boolean;
  skipped?: unknown[];
  missing?: boolean;
  candidates?: string[];
  autocorrectedFrom?: string;
  correctionReason?: FileTargetCorrectionReason;
}

function fileGrepResultPreview(output: unknown): RuntimeToolResultPreview {
  const o = output as FileGrepOutput | undefined;
  const matches = o?.matches ?? [];
  const skipped = (o?.skipped ?? []).length;
  if (o?.missing) {
    const candidateCount = o.candidates?.length ?? 0;
    return {
      kind: "file.grep",
      summary: `Path not found: ${previewPathLabel(o.scope, o.path ?? "?")}${candidateCount > 0 ? ` (${candidateCount} candidates)` : ""}`,
      detail: {
        path: o.path,
        scope: o.scope,
        grantId: o.grantId,
        pattern: o.pattern,
        missing: true,
        candidateCount,
        candidates: o.candidates ?? [],
      },
      preview: (o.candidates ?? []).slice(0, 20),
    };
  }
  const correctionPrefix = o?.autocorrectedFrom ? `Corrected ${previewPathLabel(o.scope, o.autocorrectedFrom)} -> ` : "";
  return {
    kind: "file.grep",
    summary: `"${o?.pattern ?? "?"}" in ${correctionPrefix}${previewPathLabel(o?.scope, o?.path ?? "?")} — ${matches.length} matches${o?.truncated ? " (truncated)" : ""}${skipped > 0 ? ` (${skipped} skipped)` : ""}`,
    detail: {
      path: o?.path,
      scope: o?.scope,
      grantId: o?.grantId,
      pattern: o?.pattern,
      matchCount: matches.length,
      truncated: o?.truncated,
      skippedCount: skipped,
      autocorrectedFrom: o?.autocorrectedFrom,
      correctionReason: o?.correctionReason,
    },
    preview: matches.slice(0, 20),
  };
}

function resolveWorkspaceFileTarget(
  target: ResolvedFileToolTarget,
  options: { allowExtensionVariant: boolean },
): WorkspaceFileTargetResolution {
  if (!target.workspaceRoot) {
    return {
      kind: "exact",
      absolutePath: target.absolutePath,
      displayPath: target.displayPath,
    };
  }
  if (fs.existsSync(target.absolutePath)) {
    return {
      kind: "exact",
      absolutePath: target.absolutePath,
      displayPath: target.displayPath,
    };
  }
  const candidates = findWorkspaceFileTargetCandidates(target, options);
  if (candidates.length === 1) {
    return {
      kind: "autocorrected",
      absolutePath: candidates[0]!.absolutePath,
      displayPath: candidates[0]!.displayPath,
      requestedPath: target.displayPath,
      correctionReason: candidates[0]!.correctionReason,
    };
  }
  return {
    kind: "missing",
    requestedPath: target.displayPath,
    candidates: candidates.map((candidate) => candidate.displayPath),
  };
}

function findWorkspaceFileTargetCandidates(
  target: ResolvedFileToolTarget,
  options: { allowExtensionVariant: boolean },
): WorkspaceFileTargetCandidate[] {
  const parentPath = path.dirname(target.absolutePath);
  if (!fs.existsSync(parentPath)) {
    return [];
  }
  let parentStat: fs.Stats;
  try {
    parentStat = fs.statSync(parentPath);
  } catch {
    return [];
  }
  if (!parentStat.isDirectory()) {
    return [];
  }
  const requestedBase = path.basename(target.absolutePath);
  const requestedParsed = path.parse(requestedBase);
  const requestedBaseLower = requestedBase.toLowerCase();
  const requestedNameLower = requestedParsed.name.toLowerCase();
  const requestedExtLower = requestedParsed.ext.toLowerCase();
  const candidates: WorkspaceFileTargetCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of fs.readdirSync(parentPath, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const candidatePath = path.join(parentPath, entry.name);
    const candidateDisplayPath = displayPathFor(target, candidatePath);
    const candidateKey = candidateDisplayPath.toLowerCase();
    if (seen.has(candidateKey)) {
      continue;
    }
    const candidateParsed = path.parse(entry.name);
    if (entry.name.toLowerCase() === requestedBaseLower && entry.name !== requestedBase) {
      candidates.push({
        absolutePath: candidatePath,
        displayPath: candidateDisplayPath,
        correctionReason: "case_mismatch",
      });
      seen.add(candidateKey);
      continue;
    }
    if (
      options.allowExtensionVariant
      && requestedExtLower.length > 0
      && candidateParsed.name.toLowerCase() === requestedNameLower
      && candidateParsed.ext.toLowerCase() !== requestedExtLower
    ) {
      candidates.push({
        absolutePath: candidatePath,
        displayPath: candidateDisplayPath,
        correctionReason: "extension_variant",
      });
      seen.add(candidateKey);
    }
  }
  return candidates.sort((left, right) => {
    if (left.correctionReason !== right.correctionReason) {
      return left.correctionReason === "case_mismatch" ? -1 : 1;
    }
    return left.displayPath.localeCompare(right.displayPath);
  });
}

function fileWriteResultPreview(fileChange: RuntimeFileChangeMetadata | undefined, args: Record<string, unknown>): RuntimeToolResultPreview {
  const path = fileChange?.path ?? (typeof args.path === "string" ? args.path : "file");
  if (!fileChange) {
    return { kind: "file.write", summary: `Wrote ${path}`, detail: { path } };
  }
  return {
    kind: "file.write",
    summary: `${fileChange.metadata.created ? "Created" : "Overwrote"} ${path} — ${fileChange.additions} additions, ${fileChange.deletions} deletions`,
    detail: {
      path: fileChange.path,
      operation: fileChange.operation,
      additions: fileChange.additions,
      deletions: fileChange.deletions,
      sizeBytes: fileChange.metadata.sizeBytes,
      created: fileChange.metadata.created,
    },
    preview: { diff: fileChange.metadata.diff },
  };
}

function filePatchResultPreview(fileChange: RuntimeFileChangeMetadata | undefined, args: Record<string, unknown>): RuntimeToolResultPreview {
  const path = fileChange?.path ?? (typeof args.path === "string" ? args.path : "file");
  if (!fileChange) {
    return { kind: "file.patch", summary: `Patched ${path}`, detail: { path } };
  }
  return {
    kind: "file.patch",
    summary: `Patched ${path} — ${fileChange.additions} additions, ${fileChange.deletions} deletions`,
    detail: {
      path: fileChange.path,
      operation: fileChange.operation,
      additions: fileChange.additions,
      deletions: fileChange.deletions,
      sizeBytes: fileChange.metadata.sizeBytes,
      replacements: fileChange.metadata.replacements,
      firstChangedLine: fileChange.metadata.firstChangedLine,
    },
    preview: { diff: fileChange.metadata.diff },
  };
}

function previewPathLabel(scope: ResolvedFileToolTarget["scope"] | undefined, filePath: string): string {
  if (scope === "host_tmp") {
    return `tmp:${filePath}`;
  }
  if (scope === "host_grant") {
    return `host:${filePath}`;
  }
  return filePath;
}
