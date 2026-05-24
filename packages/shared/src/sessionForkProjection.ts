import type { ActionRecord, OraToolCallEnvelope } from "./actions.js";
import type { StateSnapshot, AgentConversationMessage } from "./runtime.js";
import { projectAssistantTextFromSnapshot } from "./assistantTextProjection.js";

function settledActionStatus(status: ActionRecord["status"]): ActionRecord["status"] {
  switch (status) {
    case "proposed":
    case "approval_required":
    case "approved":
    case "running":
      return "succeeded";
    default:
      return status;
  }
}

function settledToolCallStatus(status: OraToolCallEnvelope["status"]): OraToolCallEnvelope["status"] {
  switch (status) {
    case "proposed":
    case "approval_required":
    case "approved":
    case "running":
      return "succeeded";
    default:
      return status;
  }
}

function settledAgentMessageStatus(
  status: AgentConversationMessage["status"],
): AgentConversationMessage["status"] {
  return status === "running" ? "done" : status;
}

export function projectForkVisibleAssistantText(
  snapshot: Pick<StateSnapshot, "output" | "childSessions" | "events"> & {
    agentMessages?: StateSnapshot["agentMessages"];
  },
): string {
  const transcriptOwnedFinal = [...(snapshot.agentMessages ?? [])]
    .reverse()
    .find((message) =>
      Boolean(message.transcript?.layout?.ownsFinalAnswer) &&
      message.transcript?.layout?.supplementalBody === "never" &&
      message.content.trim().length > 0,
    );
  if (transcriptOwnedFinal?.content.trim()) {
    return transcriptOwnedFinal.content.trim();
  }
  return projectAssistantTextFromSnapshot(snapshot);
}

export function projectForkSettledSnapshot<T extends StateSnapshot>(
  snapshot: T,
  assistantText: string,
): T {
  return {
    ...snapshot,
    status: "succeeded",
    attention: undefined,
    topology: {
      ...snapshot.topology,
      nodes: snapshot.topology.nodes.map((node) => ({
        ...node,
        status:
          node.status === "failed"
            ? "failed"
            : "done",
      })),
    },
    actions: snapshot.actions.map((action) => ({
      ...action,
      status: settledActionStatus(action.status),
      approvalRequest: undefined,
      error:
        action.status === "approval_required" ||
        action.status === "approved" ||
        action.status === "proposed" ||
        action.status === "running"
          ? undefined
          : action.error,
    })),
    toolCalls: snapshot.toolCalls.map((toolCall) => {
      const status = settledToolCallStatus(toolCall.status);
      return {
        ...toolCall,
        status,
        error:
          toolCall.status === "approval_required" ||
          toolCall.status === "approved" ||
          toolCall.status === "proposed" ||
          toolCall.status === "running"
            ? undefined
            : toolCall.error,
        result: toolCall.result
          ? {
              ...toolCall.result,
              status,
              error:
                toolCall.status === "approval_required" ||
                toolCall.status === "approved" ||
                toolCall.status === "proposed" ||
                toolCall.status === "running"
                  ? undefined
                  : toolCall.result.error,
            }
          : undefined,
      };
    }),
    agentMessages: snapshot.agentMessages.map((message) => ({
      ...message,
      status: settledAgentMessageStatus(message.status),
      transcript: message.transcript
        ? {
            ...message.transcript,
            status: settledAgentMessageStatus(message.transcript.status),
          }
        : undefined,
    })),
    continuation: { frames: [] },
    planDecisions: [],
    childSessions: [],
    parentCoordination: undefined,
    activeAgents: [],
    queueSummary: {
      ...snapshot.queueSummary,
      pending: 0,
      inProgress: 0,
      completed: Math.max(snapshot.queueSummary.completed, snapshot.plan.length),
      topics: [],
    },
    sharedStateSummary: {
      ...snapshot.sharedStateSummary,
      enabled: false,
      storeKind: "none",
      version: 0,
      entries: [],
      stopReason: undefined,
    },
    busStats: {
      ...snapshot.busStats,
      enabled: false,
      publishedCount: 0,
      routedCount: 0,
      topicCounts: {},
    },
    pendingClarifications: [],
    pendingApprovals: [],
    contextState: undefined,
    output: assistantText.trim()
      ? { text: assistantText.trim() }
      : snapshot.output,
  };
}
