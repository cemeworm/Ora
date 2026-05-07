import { describe, expect, it } from "vitest";
import {
  getModePreset,
  modeSpecToPatternDefinition,
  OraEventEnvelopeSchema,
  SINGLE_AGENT_MODE_ID,
  StateSnapshotSchema,
  type OraEventEnvelope,
  type StateSnapshot,
} from "@cemeworm/shared";
import { createRunningRunSnapshot } from "../src/run-snapshots.js";
import {
  RunResumeService,
  classifyRunResumeStrategy,
  executeNonKernelResumeStrategy,
} from "../src/run-resume-service.js";

const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
const definition = modeSpecToPatternDefinition(modeSpec);

function baseSnapshot(): StateSnapshot {
  return createRunningRunSnapshot({
    runId: "run-resume-strategy",
    sessionId: "session-resume-strategy",
    turnIndex: 1,
    input: { prompt: "Resume this run.", createdAt: 1_000, context: {} },
    config: {
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      modeSelection: "manual",
      profileIds: ["solo_agent"],
      skillIds: [],
      toolIds: ["file.write"],
      modelRef: "local/test-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
    },
    modeSpec,
    definition,
    clock: () => 1_000,
  });
}

function withClarification(snapshot = baseSnapshot()): StateSnapshot {
  return StateSnapshotSchema.parse({
    ...snapshot,
    status: "interrupted",
    pendingClarifications: [{
      id: "clarify-scope",
      key: "scope",
      nodeId: "solo_agent",
      nodeLabel: "Solo Agent",
      question: "What scope?",
      options: [],
      requestedAt: 1_100,
    }],
    attention: {
      kind: "needs_clarification",
      blocking: true,
      sourceRunId: snapshot.runId,
      reason: "clarification_required",
      pendingClarificationIds: ["clarify-scope"],
      pendingActionIds: [],
      pendingToolCallIds: [],
    },
  });
}

function withApprovedTool(snapshot = baseSnapshot()): StateSnapshot {
  const actionId = "action-write";
  const toolCallId = "tool-write";
  return StateSnapshotSchema.parse({
    ...snapshot,
    status: "interrupted",
    actions: [{
      id: actionId,
      runId: snapshot.runId,
      agentId: "solo_agent",
      type: "file.write",
      riskLevel: "high",
      status: "approval_required",
      input: { path: "notes.md", content: "approved\n" },
      artifactIds: [],
    }],
    toolCalls: [{
      id: toolCallId,
      runId: snapshot.runId,
      actionId,
      agentId: "solo_agent",
      nodeId: "solo_agent",
      toolId: "file.write",
      args: { path: "notes.md", content: "approved\n" },
      source: "provider_native",
      status: "approval_required",
      requestedAt: 1_100,
      updatedAt: 1_100,
    }],
    continuation: {
      activeFrameId: `${snapshot.runId}:continuation:0`,
      frames: [{
        id: `${snapshot.runId}:continuation:0`,
        runId: snapshot.runId,
        status: "paused",
        reason: "approval_required",
        conversationCursor: 0,
        pendingActionIds: [actionId],
        pendingToolCallIds: [toolCallId],
        pendingClarificationIds: [],
        approvedActionIds: [],
        resolvedClarificationIds: [],
        createdAt: 1_100,
        updatedAt: 1_100,
      }],
    },
    pendingApprovals: [actionId],
    attention: {
      kind: "needs_approval",
      blocking: true,
      sourceRunId: snapshot.runId,
      reason: "approval_required",
      pendingActionIds: [actionId],
      pendingToolCallIds: [toolCallId],
      pendingClarificationIds: [],
    },
  });
}

function mutationDeps() {
  return {
    appendEvent: (
      snapshot: StateSnapshot,
      type: OraEventEnvelope["type"],
      payload: unknown,
      extra?: Partial<OraEventEnvelope>,
    ) => {
      const event = OraEventEnvelopeSchema.parse({
        id: `${snapshot.runId}:evt-${snapshot.events.length}`,
        runId: snapshot.runId,
        seq: snapshot.events.length,
        type,
        createdAt: 2_000,
        pattern: snapshot.pattern,
        payload,
        ...extra,
      });
      return StateSnapshotSchema.parse({
        ...snapshot,
        events: [...snapshot.events, event],
        updatedAt: 2_000,
      });
    },
    now: () => 2_000,
    syncTodos: (snapshot: StateSnapshot) => snapshot,
  };
}

describe("RunResumeService", () => {
  it("classifies approved-tool continuation without taking execution authority", () => {
    const strategy = classifyRunResumeStrategy({
      snapshot: withApprovedTool(),
      approvedActionIds: ["action-write"],
    });

    expect(strategy).toEqual({
      kind: "approved_tool_continuation",
      approvedActionIds: ["action-write"],
      continuationActionIds: ["action-write"],
      continueKernelAfterTool: true,
    });
  });

  it("classifies kernel resume work separately from approved-tool continuation", () => {
    expect(classifyRunResumeStrategy({
      snapshot: withClarification(),
      approvedActionIds: [],
    })).toEqual({
      kind: "kernel",
      approvedActionIds: [],
    });
  });

  it("classifies non-kernel resume work when no kernel mode is resumable", () => {
    const nonKernelSnapshot = StateSnapshotSchema.parse({
      ...withClarification(),
      modeSpec: undefined,
    });

    expect(classifyRunResumeStrategy({
      snapshot: nonKernelSnapshot,
      approvedActionIds: [],
    })).toEqual({
      kind: "non_kernel",
      approvedActionIds: [],
    });
  });

  it("returns the strategy from preparation beside existing resume inputs", () => {
    const snapshot = withApprovedTool();
    const service = new RunResumeService({
      getRunOrThrow: (runId) => {
        expect(runId).toBe(snapshot.runId);
        return snapshot;
      },
    });

    const preparation = service.prepare({
      runId: snapshot.runId,
      reason: "Approved.",
      patch: { approvedActionIds: ["action-write"] },
    });

    expect(preparation.approvedActionIds).toEqual(["action-write"]);
    expect(preparation.hasKernelWork).toBe(true);
    expect(preparation.strategy.kind).toBe("approved_tool_continuation");
    expect(preparation.strategy.approvedActionIds).toEqual(preparation.approvedActionIds);
  });

  it("executes non-kernel resume mutation without taking ledger or persistence authority", () => {
    const nonKernelSnapshot = StateSnapshotSchema.parse({
      ...withClarification(),
      modeSpec: undefined,
    });

    const result = executeNonKernelResumeStrategy({
      snapshot: nonKernelSnapshot,
      reason: "Answered.",
      patch: { clarifications: { scope: "Only docs." } },
      clarificationPatch: { scope: "Only docs." },
      deps: mutationDeps(),
    });

    expect(result.kind).toBe("completed");
    expect(result.snapshot.status).toBe("succeeded");
    expect(result.snapshot.pendingClarifications).toEqual([]);
    expect(result.snapshot.events.map((event) => event.type)).toContain("run.resumed");
    expect(result.snapshot.events.map((event) => event.type)).toContain("clarification.resolved");
    expect(result.snapshot.events.map((event) => event.type)).toContain("run.done");
  });

  it("returns a non-kernel needs-input result when gates remain unresolved", () => {
    const nonKernelSnapshot = StateSnapshotSchema.parse({
      ...withClarification(),
      modeSpec: undefined,
    });

    const result = executeNonKernelResumeStrategy({
      snapshot: nonKernelSnapshot,
      reason: "Still missing.",
      patch: {},
      clarificationPatch: {},
      deps: mutationDeps(),
    });

    expect(result.kind).toBe("needs_input");
    expect(result.snapshot.status).toBe("interrupted");
    expect(result.snapshot.pendingClarifications).toHaveLength(1);
    expect(result.snapshot.events.map((event) => event.type)).toContain("run.resumed");
    expect(result.snapshot.events.map((event) => event.type)).not.toContain("run.done");
  });
});
