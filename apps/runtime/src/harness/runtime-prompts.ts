import type { ModeSpec, StateSnapshot } from "@cemeworm/shared";
import { fetchLangfusePrompt } from "../telemetry/langfuse.js";

export async function resolveModeSystemPrompt(mode: ModeSpec): Promise<string | undefined> {
  const ref = mode.langfusePromptRef;
  if (!ref) {
    return undefined;
  }
  const result = await fetchLangfusePrompt(ref.name, ref.version, ref.label);
  if (result.error) {
    process.stderr.write(`Failed to fetch Langfuse prompt "${ref.name}": ${result.error}\n`);
    return undefined;
  }
  return result.text;
}

export function checkpointLabelForStatus(status: StateSnapshot["status"]): string {
  switch (status) {
    case "succeeded":
      return "Pattern checkpoint";
    case "interrupted":
      return "Interrupted checkpoint";
    case "failed":
      return "Failed checkpoint";
    case "cancelled":
      return "Cancelled checkpoint";
    case "queued":
    case "running":
      return "Runtime checkpoint";
  }
}

export function summarizeProgressPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ["summary", "title", "detail", "status", "phase", "toolId", "actionId", "error", "reason"]) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      summary[key] = value;
    }
  }
  if (record.record && typeof record.record === "object" && !Array.isArray(record.record)) {
    const action = record.record as Record<string, unknown>;
    summary.record = {
      type: typeof action.type === "string" ? action.type : undefined,
      status: typeof action.status === "string" ? action.status : undefined,
      error: typeof action.error === "string" ? action.error : undefined,
    };
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

export function userFacingLanguagePrompt(userPrompt: string): string {
  const excerpt = userPrompt.trim().replace(/\s+/g, " ").slice(0, 400);
  return [
    "User-facing output language:",
    "- User-facing output follows current user message language.",
    "- If the current user message explicitly asks for a response language, obey that explicit request.",
    "- Keep code, commands, paths, logs, identifiers, quoted text, and proper nouns in their original language unless the user asks to translate them.",
    excerpt ? `- Current user message excerpt: ${JSON.stringify(excerpt)}` : undefined,
  ].filter(Boolean).join("\n");
}

export function workspaceSystemPrompt(workspace: unknown): string | undefined {
  if (!workspace || typeof workspace !== "object" || workspace === null) {
    return undefined;
  }

  const record = workspace as Record<string, unknown>;
  const rootPath = typeof record.rootPath === "string" ? record.rootPath : undefined;
  if (!rootPath) {
    return undefined;
  }

  const label = typeof record.label === "string" ? record.label : "Project";
  const totalFiles = typeof record.totalFiles === "number" ? record.totalFiles : undefined;
  const markdownFiles = typeof record.markdownFiles === "number" ? record.markdownFiles : undefined;
  const truncated = record.truncated === true;
  const extensionCounts = record.extensionCounts && typeof record.extensionCounts === "object" && record.extensionCounts !== null
    ? Object.entries(record.extensionCounts as Record<string, unknown>)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .sort((left, right) => right[1] - left[1])
      .slice(0, 12)
      .map(([extension, count]) => `${extension}: ${count}`)
      .join(", ")
    : "";
  const samplePaths = Array.isArray(record.samplePaths)
    ? record.samplePaths
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .slice(0, 40)
    : [];

  return [
    "Ora project workspace context:",
    `- Project: ${label}`,
    `- Root path: ${rootPath}`,
    totalFiles === undefined ? undefined : `- Indexed files: ${totalFiles}${truncated ? " (truncated)" : ""}`,
    markdownFiles === undefined ? undefined : `- Markdown files: ${markdownFiles}${truncated ? " (count may be partial)" : ""}`,
    extensionCounts ? `- Extension counts: ${extensionCounts}` : undefined,
    samplePaths.length > 0 ? `- Sample paths:\n${samplePaths.map((item) => `  - ${item}`).join("\n")}` : undefined,
    "Use this workspace context when answering questions about the local project folder. If the question asks for information not present in the context, say the project index is available but file contents or commands still need a runtime tool.",
  ].filter(Boolean).join("\n");
}

export function channelProjectGuidancePrompt(context: Record<string, unknown> | undefined, workspace: unknown): string | undefined {
  if (!context || context.source !== "channel") {
    return undefined;
  }
  if (workspace && typeof workspace === "object" && workspace !== null && typeof (workspace as Record<string, unknown>).rootPath === "string") {
    return undefined;
  }
  return [
    "你正在通过消息通道回复用户。要操作本地文件，用户需要先设置项目文件夹。",
    '请引导用户使用 /project <项目路径> 命令设置项目文件夹，例如 /project /Users/me/my-project。',
    "设置后，用户需要发送一条新消息来触发新的项目上下文。",
  ].join("\n");
}

export function attachedProjectFilesSystemPrompt(attachedFiles: unknown): string | undefined {
  if (!Array.isArray(attachedFiles)) {
    return undefined;
  }

  const files = attachedFiles
    .map(readAttachedProjectFile)
    .filter((file): file is AttachedProjectFilePromptEntry => Boolean(file))
    .slice(0, 20);
  if (files.length === 0) {
    return undefined;
  }

  return [
    "<attached_project_files>",
    "The user attached these project files to this message:",
    "",
    ...files.flatMap((file) => [
      `- ${file.name} (${file.mimeType}, ${file.sizeBytes} bytes)`,
      `  Path: ${file.path}`,
    ]),
    "",
    "Use the `file.read` tool with the shown project-relative paths before answering questions about file contents.",
    "These files are already inside the selected Ora project workspace; do not ask the user to upload them again.",
    "</attached_project_files>",
  ].join("\n");
}

export function attachedLocalFilesSystemPrompt(attachedFiles: unknown): string | undefined {
  if (!Array.isArray(attachedFiles)) {
    return undefined;
  }

  const files = attachedFiles
    .map(readAttachedLocalFile)
    .filter((file): file is AttachedLocalFilePromptEntry => Boolean(file))
    .slice(0, 20);
  if (files.length === 0) {
    return undefined;
  }

  return [
    "<attached_local_files>",
    "The user attached these local files to this message:",
    "",
    ...files.flatMap((file) => {
      const lines = [
        `- ${file.name} (${file.mimeType}, ${file.sizeBytes} bytes)`,
        `  Path: ${file.path}`,
      ];
      if (file.content) {
        lines.push("  Content:");
        lines.push("  ```");
        lines.push(indentAttachedFileContent(file.content));
        lines.push("  ```");
        if (file.truncated) {
          lines.push("  Note: content was truncated by the desktop attachment preview limit.");
        }
      } else {
        lines.push("  Content preview unavailable; ask the user for a text version if exact contents are required.");
      }
      return lines;
    }),
    "",
    "Use the embedded content above when answering questions about these files.",
    "</attached_local_files>",
  ].join("\n");
}

interface AttachedProjectFilePromptEntry {
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

interface AttachedLocalFilePromptEntry extends AttachedProjectFilePromptEntry {
  content?: string;
  truncated: boolean;
}

function readAttachedProjectFile(value: unknown): AttachedProjectFilePromptEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path.trim() : "";
  if (
    !path ||
    path.startsWith("/") ||
    path.split("/").includes("..") ||
    typeof record.name !== "string" ||
    !record.name.trim() ||
    typeof record.mimeType !== "string" ||
    !record.mimeType.trim() ||
    typeof record.sizeBytes !== "number" ||
    !Number.isFinite(record.sizeBytes) ||
    record.sizeBytes < 0
  ) {
    return undefined;
  }
  return {
    path,
    name: record.name.trim(),
    mimeType: record.mimeType.trim(),
    sizeBytes: Math.floor(record.sizeBytes),
  };
}

function readAttachedLocalFile(value: unknown): AttachedLocalFilePromptEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path.trim() : "";
  if (
    !path ||
    typeof record.name !== "string" ||
    !record.name.trim() ||
    typeof record.mimeType !== "string" ||
    !record.mimeType.trim() ||
    typeof record.sizeBytes !== "number" ||
    !Number.isFinite(record.sizeBytes) ||
    record.sizeBytes < 0
  ) {
    return undefined;
  }
  const content = typeof record.content === "string" && record.content.trim()
    ? record.content
    : undefined;
  return {
    path,
    name: record.name.trim(),
    mimeType: record.mimeType.trim(),
    sizeBytes: Math.floor(record.sizeBytes),
    content,
    truncated: record.truncated === true,
  };
}

function indentAttachedFileContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
