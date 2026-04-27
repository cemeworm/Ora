import type { StateSnapshot } from "@ora/shared";

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

export function summarizeNarratorProgressPayload(eventType: string, payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;

  if (
    record.kind === "chat_progress" &&
    record.source === "progress_narrator" &&
    typeof record.summary === "string" &&
    record.summary.trim()
  ) {
    return { summary: record.summary.trim() };
  }

  const summary: Record<string, unknown> = {};
  if (typeof record.status === "string") {
    summary.status = record.status;
  }
  if (typeof record.phase === "string") {
    summary.phase = record.phase;
  }

  const toolId = typeof record.toolId === "string" ? record.toolId : undefined;
  if (toolId) {
    summary.toolId = toolId;
    const input = record.input && typeof record.input === "object" && !Array.isArray(record.input)
      ? record.input as Record<string, unknown>
      : {};
    const output = record.output && typeof record.output === "object" && !Array.isArray(record.output)
      ? record.output as Record<string, unknown>
      : {};
    const query = typeof output.query === "string" ? output.query : typeof input.query === "string" ? input.query : undefined;
    const path = typeof output.path === "string" ? output.path : typeof input.path === "string" ? input.path : undefined;
    const url = typeof output.url === "string" ? output.url : typeof input.url === "string" ? input.url : undefined;
    if (query) summary.query = query;
    if (path) summary.path = path;
    if (url) summary.url = url;
  }

  if (eventType === "approval.required" || eventType === "clarification.required") {
    if (typeof record.reason === "string") {
      summary.reason = record.reason;
    }
  }

  if (typeof record.error === "string") {
    summary.error = record.error;
  }

  return Object.keys(summary).length > 0 ? summary : undefined;
}

export function normalizeProgressNarration(text: string): string | undefined {
  const summary = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "");
  if (!summary || summary.startsWith("{") || summary.includes("\"tool\"")) {
    return undefined;
  }
  return summary.length > 240 ? `${summary.slice(0, 237).trimEnd()}...` : summary;
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
