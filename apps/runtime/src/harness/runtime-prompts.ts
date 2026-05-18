import type { ModeSpec, StateSnapshot, UserTaskInput } from "@cemeworm/shared";
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
  void userPrompt;
  return [
    "User-facing output language:",
    "- User-facing output follows current user message language.",
    "- If the current user message explicitly asks for a response language, obey that explicit request.",
    "- Keep code, commands, paths, logs, identifiers, quoted text, and proper nouns in their original language unless the user asks to translate them.",
  ].filter(Boolean).join("\n");
}

export function turnLocalMetadataGuidancePrompt(): string {
  return [
    "Turn-local metadata protocol:",
    "- Current-turn volatile context is delivered in a <turn_local_metadata> block prepended to the latest user message.",
    "- Treat that block as high-priority context for the current turn, not as a durable system instruction.",
    "- If exact current time, date, or timezone matters, prefer a runtime time tool over assumptions.",
    "- For freshness-sensitive questions, verify with tools and cite exact dates in the answer.",
  ].join("\n");
}

export function turnLocalMetadataPrompt(params: {
  createdAt?: number;
  context?: UserTaskInput["context"];
  now?: () => number;
}): string | undefined {
  const lines: string[] = [];
  const timestamp = Number.isFinite(params.createdAt)
    ? params.createdAt
    : params.now
      ? params.now()
      : undefined;

  if (timestamp !== undefined) {
    const timezone = resolvePromptTimezone(params.context);
    const locale = resolvePromptLocale(params.context);
    lines.push(`Current local date: ${formatZonedDate(timestamp, timezone)}`);
    lines.push(`Current local time: ${formatZonedDateTime(timestamp, timezone)}`);
    lines.push(`Timezone: ${timezone}`);
    if (locale) {
      lines.push(`Locale: ${locale}`);
    }
    lines.push(`Current UTC time: ${new Date(timestamp).toISOString()}`);
  }

  const clarifications = turnLocalClarifications(params.context);
  if (clarifications.length > 0) {
    lines.push("Clarifications:");
    lines.push(...clarifications.map((entry) => `- ${entry}`));
  }

  const attachedProjectFiles = attachedProjectFilesTurnMetadata(params.context?.attachedProjectFiles);
  if (attachedProjectFiles.length > 0) {
    lines.push("Attached project files:");
    lines.push(...attachedProjectFiles.map((entry) => `- ${entry}`));
  }

  const attachedLocalFiles = attachedLocalFilesTurnMetadata(params.context?.attachedLocalFiles);
  if (attachedLocalFiles.length > 0) {
    lines.push("Attached local files:");
    lines.push(...attachedLocalFiles.map((entry) => `- ${entry}`));
  }

  const attachedImages = attachedImagesTurnMetadata(params.context?.attachedImages);
  if (attachedImages.length > 0) {
    lines.push("Attached images:");
    lines.push(...attachedImages.map((entry) => `- ${entry}`));
  }

  if (lines.length === 0) {
    return undefined;
  }

  return [
    "<turn_local_metadata>",
    ...lines,
    "</turn_local_metadata>",
  ].join("\n");
}

export function promptWithTurnLocalMetadata(prompt: string, turnLocalMetadata: string | undefined): string {
  const trimmedPrompt = prompt.trim();
  if (!turnLocalMetadata?.trim()) {
    return trimmedPrompt;
  }
  if (!trimmedPrompt) {
    return turnLocalMetadata.trim();
  }
  return `${turnLocalMetadata.trim()}\n${trimmedPrompt}`;
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

const PROJECT_INSTRUCTIONS_MAX_CHARS = 8000;

export function projectInstructionsSystemPrompt(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return trimmed;
  const truncated = trimmed.length > PROJECT_INSTRUCTIONS_MAX_CHARS
    ? trimmed.slice(0, PROJECT_INSTRUCTIONS_MAX_CHARS).replace(/\s+\S*$/, "")
      + "\n\n[AGENTS.md was truncated to fit the system prompt budget.]"
    : trimmed;
  return [
    "<project_instructions>",
    "The following instructions are from the project's AGENTS.md file.",
    "Follow these guidelines when working in this project.",
    "",
    truncated,
    "</project_instructions>",
  ].join("\n");
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

export function attachedProjectFilesTurnMetadata(attachedFiles: unknown): string[] {
  if (!Array.isArray(attachedFiles)) {
    return [];
  }
  return attachedFiles
    .map(readAttachedProjectFile)
    .filter((file): file is AttachedProjectFilePromptEntry => Boolean(file))
    .slice(0, 12)
    .map((file) => `${file.name} (${file.mimeType}, ${file.sizeBytes} bytes) at ${file.path}`);
}

export function attachedImagesSystemPrompt(attachedImages: unknown): string | undefined {
  if (!Array.isArray(attachedImages) || attachedImages.length === 0) {
    return undefined;
  }

  const images = attachedImages
    .map(readAttachedImage)
    .filter((img): img is AttachedImagePromptEntry => Boolean(img))
    .slice(0, 20);
  if (images.length === 0) {
    return undefined;
  }

  return [
    "<attached_images>",
    "The user attached these images to this message:",
    "",
    ...images.flatMap((img) => [
      `- Image (${img.mimeType}, ${img.sizeBytes} bytes)`,
    ]),
    "",
    "Use the `understand_image` tool to analyze these images when their content is relevant to the request.",
    "These images are already available in the current message; do not ask the user to upload them again.",
    "</attached_images>",
  ].join("\n");
}

export function attachedImagesTurnMetadata(attachedImages: unknown): string[] {
  if (!Array.isArray(attachedImages)) {
    return [];
  }
  return attachedImages
    .map(readAttachedImage)
    .filter((img): img is AttachedImagePromptEntry => Boolean(img))
    .slice(0, 12)
    .map((img) => `Image (${img.mimeType}, ${img.sizeBytes} bytes)`);
}

interface AttachedImagePromptEntry {
  mimeType: string;
  sizeBytes: number;
}

function readAttachedImage(value: unknown): AttachedImagePromptEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const mimeType = typeof record.mimeType === "string" && record.mimeType.trim()
    ? record.mimeType.trim()
    : "image/png";
  const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl : "";
  const sizeBytes = dataUrl
    ? Math.ceil(dataUrl.length * 0.75)
    : (typeof record.sizeBytes === "number" && Number.isFinite(record.sizeBytes) && record.sizeBytes >= 0
      ? Math.floor(record.sizeBytes)
      : 0);
  return { mimeType, sizeBytes };
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

export function attachedLocalFilesTurnMetadata(attachedFiles: unknown): string[] {
  if (!Array.isArray(attachedFiles)) {
    return [];
  }
  return attachedFiles
    .map(readAttachedLocalFile)
    .filter((file): file is AttachedLocalFilePromptEntry => Boolean(file))
    .slice(0, 12)
    .map((file) => `${file.name} (${file.mimeType}, ${file.sizeBytes} bytes) at ${file.path}`);
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

function turnLocalClarifications(context: UserTaskInput["context"] | undefined): string[] {
  const clarifications = context?.clarifications;
  if (!clarifications || typeof clarifications !== "object" || clarifications === null) {
    return [];
  }
  return Object.entries(clarifications as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim().length > 0)
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${String(value).trim().slice(0, 1000)}`);
}

function resolvePromptTimezone(context: UserTaskInput["context"] | undefined): string {
  const candidates = [
    readNestedString(context, ["userTemporalContext", "timezone"]),
    readString(context?.timezone),
    readString(context?.timeZone),
  ];
  for (const candidate of candidates) {
    if (candidate && isValidTimezone(candidate)) {
      return candidate;
    }
  }
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimezone(localTimezone) ? localTimezone : "UTC";
}

function resolvePromptLocale(context: UserTaskInput["context"] | undefined): string | undefined {
  return (
    readNestedString(context, ["userTemporalContext", "locale"])
    ?? readString(context?.locale)
    ?? readString(context?.language)
  );
}

function formatZonedDate(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  return `${partValue(parts, "year")}-${partValue(parts, "month")}-${partValue(parts, "day")}`;
}

function formatZonedDateTime(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  return [
    `${partValue(parts, "year")}-${partValue(parts, "month")}-${partValue(parts, "day")}`,
    `${partValue(parts, "hour")}:${partValue(parts, "minute")}:${partValue(parts, "second")}`,
  ].join(" ");
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function isValidTimezone(value: string | undefined): value is string {
  if (!value?.trim()) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function readNestedString(value: unknown, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return readString(current);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function indentAttachedFileContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
