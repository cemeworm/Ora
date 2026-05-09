import type {
  OraSessionTranscriptMessage,
  OraStateSnapshot,
} from "./runtimeClient";

export function buildChatMessagesCacheKey({
  transcript,
  turnSnapshots,
}: {
  transcript: readonly OraSessionTranscriptMessage[];
  turnSnapshots: Record<string, OraStateSnapshot | undefined>;
}): string {
  const lastMessage = transcript.length > 0
    ? transcript[transcript.length - 1]
    : undefined;
  const transcriptKey = lastMessage
    ? `${transcript.length}:${lastMessage.id}:${lastMessage.content.length}`
    : "0";
  const snapshotKey = Object.keys(turnSnapshots)
    .sort()
    .map((runId) => snapshotCacheFingerprint(runId, turnSnapshots[runId]))
    .join(",");
  return `${transcriptKey}:${snapshotKey}`;
}

function snapshotCacheFingerprint(
  runId: string,
  snapshot: OraStateSnapshot | undefined,
): string {
  if (!snapshot) {
    return `${runId}:missing`;
  }
  const latestEvent = snapshot.events.at(-1);
  const outputLength = snapshotOutputLength(snapshot.output);
  return [
    runId,
    snapshot.status,
    snapshot.updatedAt,
    snapshot.events.length,
    latestEvent?.seq ?? "none",
    latestEvent?.type ?? "none",
    latestEventPayloadTextLength(latestEvent?.payload),
    outputLength,
  ].join(":");
}

function snapshotOutputLength(output: unknown): number {
  if (typeof output === "string") {
    return output.length;
  }
  if (
    output &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    typeof (output as { text?: unknown }).text === "string"
  ) {
    return (output as { text: string }).text.length;
  }
  return 0;
}

function latestEventPayloadTextLength(payload: unknown): number {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return 0;
  }
  const record = payload as Record<string, unknown>;
  return ["content", "delta", "text", "message", "summary"].reduce(
    (total, key) => total + (typeof record[key] === "string" ? record[key].length : 0),
    0,
  );
}
