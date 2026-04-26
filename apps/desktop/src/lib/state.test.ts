import { describe, expect, it } from "vitest";
import { SINGLE_AGENT_MODE_ID } from "@ora/shared";
import { mergeRunStreamSnapshot } from "./state";
import type { OraRunEventStream, OraStateSnapshot } from "./runtimeClient";

describe("desktop workbench state", () => {
  it("merges streamed approval action updates back into the active snapshot", () => {
    const createdAt = 1_714_000_000_000;
    const approvedActionId = "run-approval:action:solo_agent-tool-1";
    const nextActionId = "run-approval:action:solo_agent-tool-2";
    const snapshot = {
      runId: "run-approval",
      sessionId: "session-approval",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "Install Waza skills.", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "state-approval-test",
        skillIds: [],
        toolIds: ["skills.create"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [{
        id: approvedActionId,
        runId: "run-approval",
        type: "skills.create",
        riskLevel: "high",
        status: "approved",
        input: { name: "waza-think" },
        artifactIds: [],
      }],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: [],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;
    const approvalAction = {
      id: nextActionId,
      runId: "run-approval",
      type: "skills.create",
      riskLevel: "high",
      status: "approval_required",
      input: { name: "waza-design" },
      artifactIds: [],
    };
    const stream = {
      runId: "run-approval",
      status: "interrupted",
      fromSeq: 1,
      nextSeq: 3,
      events: [{
        id: "run-approval:event:2",
        runId: "run-approval",
        seq: 2,
        type: "action.updated",
        createdAt: createdAt + 1,
        payload: {
          actionId: nextActionId,
          status: "approval_required",
          record: approvalAction,
        },
      }],
    } as unknown as OraRunEventStream;

    const merged = mergeRunStreamSnapshot(snapshot, stream);

    expect(merged?.status).toBe("interrupted");
    expect(merged?.pendingApprovals).toEqual([nextActionId]);
    expect(merged?.actions.find((action) => action.id === nextActionId)).toMatchObject({
      type: "skills.create",
      status: "approval_required",
      input: { name: "waza-design" },
    });
  });
});
