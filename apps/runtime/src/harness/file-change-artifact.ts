import { ArtifactRefSchema } from "@ora/shared";
import type { ArtifactRef } from "@ora/shared";
import type { RuntimeFileChangeMetadata } from "./runtime-tool-executor.js";

export function fileChangeArtifact(params: {
  runId: string;
  artifactIndex: number;
  fileChange: RuntimeFileChangeMetadata;
  createdAt: number;
}): ArtifactRef {
  return ArtifactRefSchema.parse({
    id: `${params.runId}:file-change:${params.artifactIndex}`,
    runId: params.runId,
    kind: "file",
    label: params.fileChange.path,
    mimeType: mimeTypeForPath(params.fileChange.path),
    createdAt: params.createdAt,
    sizeBytes: params.fileChange.metadata.sizeBytes,
    payload: params.fileChange,
  });
}

function mimeTypeForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) {
    return "text/markdown";
  }
  if (lower.endsWith(".json")) {
    return "application/json";
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "text/html";
  }
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".css") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml")
  ) {
    return "text/plain";
  }
  return "text/plain";
}
