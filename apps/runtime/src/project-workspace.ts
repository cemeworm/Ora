import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ProjectFileReadResult,
  ProjectFileReadResultSchema,
  ProjectFilesResult,
  ProjectFilesResultSchema,
  ProjectSummary
} from "@ora/shared";
import { OraRuntimeError } from "./runtime-errors.js";

const PROJECT_WORKSPACE_MAX_FILES = 20_000;
const PROJECT_WORKSPACE_SAMPLE_LIMIT = 120;
const PROJECT_FILE_PREVIEW_MAX_BYTES = 1024 * 1024;
const PROJECT_WORKSPACE_SKIPPED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

export function normalizeProjectRootPath(rootPath: string): string {
  return path.resolve(rootPath.trim());
}

export function listProjectFilesForProject(project: ProjectSummary): ProjectFilesResult {
  const rootPath = requireProjectRootDirectory(project);
  const files: ProjectFilesResult["files"] = [];
  let totalFiles = 0;
  let truncated = false;

  const visit = (directory: string) => {
    if (truncated) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort(compareProjectDirectoryEntries);
    for (const entry of entries) {
      if (truncated) {
        return;
      }

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!PROJECT_WORKSPACE_SKIPPED_DIRS.has(entry.name)) {
          visit(absolutePath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      totalFiles += 1;
      try {
        const stat = fs.statSync(absolutePath);
        files.push({
          path: relativeProjectFilePath(rootPath, absolutePath),
          name: entry.name,
          sizeBytes: stat.size,
          modifiedAt: Math.max(0, Math.floor(stat.mtimeMs)),
          mimeType: mimeTypeForPath(absolutePath),
        });
      } catch {
        // Ignore files that disappear or become unreadable during the scan.
      }
      if (totalFiles >= PROJECT_WORKSPACE_MAX_FILES) {
        truncated = true;
      }
    }
  };

  visit(rootPath);

  return ProjectFilesResultSchema.parse({
    projectId: project.projectId,
    rootPath,
    totalFiles,
    files: files.sort((left, right) => compareProjectPathNames(left.path, right.path)),
    truncated,
    skippedDirs: [...PROJECT_WORKSPACE_SKIPPED_DIRS].sort(),
  });
}

export function readProjectFileForProject(project: ProjectSummary, requestedPath: string): ProjectFileReadResult {
  const rootPath = requireProjectRootDirectory(project);
  const absolutePath = resolveProjectFilePath(rootPath, requestedPath);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    throw new OraRuntimeError("Project file preview target must be a file.", -32004, { path: requestedPath });
  }

  const mimeType = mimeTypeForPath(absolutePath);
  const previewKind = projectFilePreviewKind(mimeType);
  const payload = previewKind === "text" && stat.size <= PROJECT_FILE_PREVIEW_MAX_BYTES
    ? fs.readFileSync(absolutePath, "utf8")
    : previewKind === "json" && stat.size <= PROJECT_FILE_PREVIEW_MAX_BYTES
      ? readJsonPreviewPayload(absolutePath)
      : undefined;

  return ProjectFileReadResultSchema.parse({
    projectId: project.projectId,
    rootPath,
    path: relativeProjectFilePath(rootPath, absolutePath),
    label: path.basename(absolutePath),
    mimeType,
    previewKind,
    sizeBytes: stat.size,
    modifiedAt: Math.max(0, Math.floor(stat.mtimeMs)),
    uri: previewKind === "image" ? pathToFileURL(absolutePath).toString() : undefined,
    payload,
  });
}

export function projectWorkspaceContext(project: ProjectSummary): Record<string, unknown> {
  const extensionCounts: Record<string, number> = {};
  const samplePaths: string[] = [];
  let totalFiles = 0;
  let markdownFiles = 0;
  let truncated = false;

  const visit = (directory: string) => {
    if (truncated) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (truncated) {
        return;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!PROJECT_WORKSPACE_SKIPPED_DIRS.has(entry.name)) {
          visit(absolutePath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      totalFiles += 1;
      const extension = path.extname(entry.name).toLowerCase() || "[no extension]";
      extensionCounts[extension] = (extensionCounts[extension] ?? 0) + 1;
      if (extension === ".md") {
        markdownFiles += 1;
      }
      if (samplePaths.length < PROJECT_WORKSPACE_SAMPLE_LIMIT) {
        samplePaths.push(path.relative(project.rootPath, absolutePath));
      }
      if (totalFiles >= PROJECT_WORKSPACE_MAX_FILES) {
        truncated = true;
      }
    }
  };

  visit(project.rootPath);

  return {
    projectId: project.projectId,
    label: project.label,
    rootPath: project.rootPath,
    totalFiles,
    markdownFiles,
    extensionCounts,
    samplePaths,
    truncated,
  };
}

function requireProjectRootDirectory(project: ProjectSummary): string {
  const rootPath = path.resolve(project.rootPath);
  const stat = fs.statSync(rootPath);
  if (!stat.isDirectory()) {
    throw new OraRuntimeError("Project root path must be a directory.", -32004, { projectId: project.projectId });
  }
  return rootPath;
}

function resolveProjectFilePath(rootPath: string, requestedPath: string): string {
  const absolutePath = path.resolve(rootPath, requestedPath);
  const relative = path.relative(rootPath, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new OraRuntimeError("Project file path must stay inside the project root.", -32602, { path: requestedPath });
  }
  return absolutePath;
}

function relativeProjectFilePath(rootPath: string, absolutePath: string): string {
  return path.relative(rootPath, absolutePath) || ".";
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".css":
      return "text/css";
    case ".csv":
      return "text/csv";
    case ".gif":
      return "image/gif";
    case ".htm":
    case ".html":
      return "text/html";
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "text/javascript";
    case ".json":
    case ".jsonc":
      return "application/json";
    case ".md":
    case ".mdx":
      return "text/markdown";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".rs":
      return "text/rust";
    case ".svg":
      return "image/svg+xml";
    case ".toml":
      return "text/toml";
    case ".ts":
    case ".tsx":
      return "text/typescript";
    case ".txt":
      return "text/plain";
    case ".webp":
      return "image/webp";
    case ".yaml":
    case ".yml":
      return "text/yaml";
    default:
      return "application/octet-stream";
  }
}

function projectFilePreviewKind(mimeType: string): ProjectFileReadResult["previewKind"] {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.includes("json")) {
    return "json";
  }
  if (mimeType.startsWith("text/")) {
    return "text";
  }
  return "binary";
}

function readJsonPreviewPayload(filePath: string): unknown {
  const text = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function compareProjectDirectoryEntries(left: fs.Dirent, right: fs.Dirent): number {
  return compareProjectPathNames(left.name, right.name);
}

function compareProjectPathNames(left: string, right: string): number {
  const leftParts = left.split(path.sep).join("/").split("/");
  const rightParts = right.split(path.sep).join("/").split("/");
  const length = Math.min(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? "";
    const rightPart = rightParts[index] ?? "";
    const leftHidden = leftPart.startsWith(".");
    const rightHidden = rightPart.startsWith(".");
    if (leftHidden !== rightHidden) {
      return leftHidden ? 1 : -1;
    }
    const nameOrder = leftPart.localeCompare(rightPart);
    if (nameOrder !== 0) {
      return nameOrder;
    }
  }

  return leftParts.length - rightParts.length;
}
