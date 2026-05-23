import { ORA_ROOT_AGENT_ID } from "@cemeworm/shared";

export interface CommentaryDeltaDescriptor {
  fingerprint: string;
  payload: {
    role: "assistant";
    messageId: string;
    content: string;
    phase: "commentary";
    surface: "chat_progress";
  };
  extra: {
    agentId: string;
    nodeId: string;
  };
}

export function buildCommentaryDelta(params: {
  runId: string;
  summary: string;
  agentId?: string;
  nodeId?: string;
  basedOnSeq?: number;
  trigger?: string;
}): CommentaryDeltaDescriptor | undefined {
  const content = params.summary.trim();
  if (!content) {
    return undefined;
  }

  const agentId = normalizeSegment(params.agentId) ?? ORA_ROOT_AGENT_ID;
  const nodeId = normalizeSegment(params.nodeId) ?? agentId;
  const trigger = normalizeSegment(params.trigger) ?? "progress";
  const seq = typeof params.basedOnSeq === "number" && Number.isFinite(params.basedOnSeq)
    ? Math.max(0, Math.trunc(params.basedOnSeq))
    : 0;

  return {
    fingerprint: `${agentId}:${nodeId}:${collapseWhitespace(content).toLowerCase()}`,
    payload: {
      role: "assistant",
      messageId: `${params.runId}:assistant:${agentId}:${nodeId}:commentary:${seq}:${trigger}`,
      content,
      phase: "commentary",
      surface: "chat_progress",
    },
    extra: { agentId, nodeId },
  };
}

function normalizeSegment(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
