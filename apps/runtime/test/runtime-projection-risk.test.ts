import { describe, expect, it } from "vitest";
import type { StateSnapshot } from "@cemeworm/shared";
import { currentPendingApprovalActionIds } from "../src/feedback-loop-store.js";
import { hasCurrentSafetyGate } from "../src/evaluation-store.js";
import {
  approvedActionsForResume,
  currentPendingClarifications,
  hasKernelResumeWork,
} from "../src/run-orchestration.js";
import { approvedToolContinuationActions } from "../src/approved-file-write-resume.js";
import { nonKernelResumeNeedsInput } from "../src/run-resume-mutation.js";

const BASE_TIME = 1_714_000_000_000;

function snapshot(patch: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    runId: "run-projection-risk",
    turnIndex: 1,
    status: "running",
    pattern: "orchestrator_subagent",
    coordinationKind: "orchestrator_subagent",
    modeId: "single_agent",
    input: { prompt: "Check projection risk.", createdAt: BASE_TIME, context: {} },
    config: {
      pattern: "orchestrator_subagent",
      modeId: "single_agent",
      modeSelection: "manual",
      profileIds: [],
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      permissionMode: "default",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "runtime-projection-risk-test",
      skillIds: [],
      toolIds: [],
    },
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    planList: [],
    todos: [],
    actions: [],
    toolCalls: [],
    continuation: { frames: [] },
    conversation: [],
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: BASE_TIME,
    ...patch,
  } as StateSnapshot;
}

describe("runtime projection risk helpers", () => {
  it("uses canonical attention before raw pending approvals for diagnostics", () => {
    const run = snapshot({
      attention: {
        kind: "running",
        blocking: false,
        sourceRunId: "run-projection-risk",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
      pendingApprovals: ["action-stale"],
      actions: [{
        id: "action-stale",
        runId: "run-projection-risk",
        type: "file.write",
        riskLevel: "high",
        status: "succeeded",
        input: {},
        artifactIds: [],
      }],
    });

    expect(currentPendingApprovalActionIds(run)).toEqual([]);
    expect(hasCurrentSafetyGate(run)).toBe(false);
    expect(hasKernelResumeWork({ ...run, modeSpec: { id: "single_agent" } } as StateSnapshot)).toBe(false);
    expect(nonKernelResumeNeedsInput(run)).toBe(false);
    expect(approvedActionsForResume(run, ["action-stale"])).toEqual([]);
    expect(approvedToolContinuationActions(run, ["action-stale"])).toEqual([]);
  });

  it("uses canonical attention before raw pending clarifications for resume helpers", () => {
    const run = snapshot({
      attention: {
        kind: "running",
        blocking: false,
        sourceRunId: "run-projection-risk",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
      pendingClarifications: [{
        id: "clarification-stale",
        key: "scope",
        nodeId: "router",
        nodeLabel: "Router",
        question: "Stale question?",
        requestedAt: BASE_TIME,
      }],
    });

    expect(currentPendingClarifications(run)).toEqual([]);
    expect(hasKernelResumeWork({ ...run, modeSpec: { id: "single_agent" } } as StateSnapshot)).toBe(false);
    expect(nonKernelResumeNeedsInput(run)).toBe(false);
  });

  it("keeps real approval attention visible to diagnostics", () => {
    const run = snapshot({
      attention: {
        kind: "needs_approval",
        blocking: true,
        sourceRunId: "run-projection-risk",
        reason: "approval_required",
        pendingActionIds: ["action-live"],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
      actions: [{
        id: "action-live",
        runId: "run-projection-risk",
        type: "file.write",
        riskLevel: "high",
        status: "approval_required",
        input: {},
        artifactIds: [],
      }],
    });

    expect(currentPendingApprovalActionIds(run)).toEqual(["action-live"]);
    expect(hasCurrentSafetyGate(run)).toBe(true);
    expect(hasKernelResumeWork({ ...run, modeSpec: { id: "single_agent" } } as StateSnapshot)).toBe(true);
    expect(nonKernelResumeNeedsInput(run)).toBe(true);
    expect(approvedActionsForResume(run, ["action-live"])).toEqual([{
      type: "file.write",
      riskLevel: "high",
      input: {},
      agentId: undefined,
    }]);
  });
});
