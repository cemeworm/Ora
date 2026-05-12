import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getModePreset, SINGLE_AGENT_MODE_ID, type StateSnapshot } from "@cemeworm/shared";
import { LocalRunStore } from "./run-store.js";

function snapshot(runId: string): StateSnapshot {
  return {
    runId,
    turnIndex: 1,
    status: "running",
    pattern: "orchestrator_subagent",
    coordinationKind: "orchestrator_subagent",
    input: { prompt: "Cancel this.", createdAt: 1_714_000_000_000, context: {} },
    config: {
      pattern: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: [],
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      permissionMode: "default",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "run-store-cancel-test",
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
    queueSummary: { mode: "dag", pending: 0, inProgress: 1, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: 1_714_000_000_001,
  } as unknown as StateSnapshot;
}

function storeWithRun(runId: string) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-run-store-cancel-"));
  const store = new LocalRunStore({ dataDir, autoStartChannels: false });
  (store as any).cacheRun(snapshot(runId), true);
  return store;
}

function storeWithSnapshot(source: StateSnapshot) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-run-store-recovery-"));
  const store = new LocalRunStore({ dataDir, autoStartChannels: false });
  (store as any).cacheRun(source, true);
  return store;
}

describe("run store cancellation", () => {
  it("aborts an active streaming controller before persisting cancellation", () => {
    const store = storeWithRun("run-cancel");
    const controller = (store as any).runStreamingService.createAbortController("run-cancel") as AbortController;

    const cancelled = store.cancelRun({ runId: "run-cancel", reason: "stop" });

    expect(controller.signal.aborted).toBe(true);
    expect(cancelled.status).toBe("cancelled");
  });

  it("aborts active streaming work when a run is manually interrupted", () => {
    const store = storeWithRun("run-interrupt");
    const controller = (store as any).runStreamingService.createAbortController("run-interrupt") as AbortController;

    const interrupted = store.interruptRun({ runId: "run-interrupt", reason: "pause" });

    expect(controller.signal.aborted).toBe(true);
    expect(interrupted.status).toBe("interrupted");
  });

  it("preserves pending continuation work when forking from a recovery checkpoint", async () => {
    const base = snapshot("run-recovery");
    const source: StateSnapshot = {
      ...base,
      status: "interrupted",
      checkpoints: [{
        id: "run-recovery:checkpoint-gate",
        runId: "run-recovery",
        label: "Gate checkpoint",
        createdAt: 1_714_000_000_003,
        eventSeq: 1,
      }],
      events: [{
        id: "run-recovery:evt-0",
        runId: "run-recovery",
        seq: 0,
        type: "approval.required",
        createdAt: 1_714_000_000_002,
        pattern: "orchestrator_subagent",
        payload: { actionId: "action-approve" },
      }],
      actions: [{
        id: "action-approve",
        runId: "run-recovery",
        type: "file.write",
        riskLevel: "medium",
        status: "approval_required",
        input: { path: "README.md" },
        artifactIds: [],
      }],
      pendingApprovals: ["action-approve"],
      continuation: {
        activeFrameId: "run-recovery:continuation:0",
        frames: [{
          id: "run-recovery:continuation:0",
          runId: "run-recovery",
          status: "paused",
          reason: "approval_required",
          conversationCursor: 0,
          pendingActionIds: ["action-approve"],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
          approvedActionIds: [],
          resolvedClarificationIds: [],
          nodeCheckpoint: {
            eventSeq: 1,
            conversationCursor: 0,
            bag: {},
          },
          createdAt: 1_714_000_000_003,
          updatedAt: 1_714_000_000_003,
        }],
      },
    };
    const store = storeWithSnapshot(source);

    const fork = await store.forkRun({ runId: source.runId, checkpointId: source.checkpoints[0]!.id });
    const forked = store.getRunState({ runId: fork.runId });
    const frame = forked.continuation.frames[0];

    expect(frame?.resumedFromFrameId).toBe("run-recovery:continuation:0");
    expect(frame?.pendingActionIds).toEqual(["action-approve"]);
    expect(frame?.status).toBe("paused");
  });

  it("forks and resumes from a recovery checkpoint through one runtime API", async () => {
    const base = snapshot("run-fork-resume");
    const source: StateSnapshot = {
      ...base,
      status: "interrupted",
      modeId: SINGLE_AGENT_MODE_ID,
      modeSpec: getModePreset(SINGLE_AGENT_MODE_ID),
      checkpoints: [{
        id: "run-fork-resume:checkpoint-gate",
        runId: "run-fork-resume",
        label: "Gate checkpoint",
        createdAt: 1_714_000_000_003,
        eventSeq: 1,
      }],
      actions: [{
        id: "action-approve",
        runId: "run-fork-resume",
        type: "file.write",
        riskLevel: "medium",
        status: "approval_required",
        input: { path: "README.md" },
        artifactIds: [],
      }],
      pendingApprovals: ["action-approve"],
      attention: {
        kind: "needs_approval",
        pendingActionIds: ["action-approve"],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
        reason: "approval_required",
        blocking: true,
      },
      continuation: {
        activeFrameId: "run-fork-resume:continuation:0",
        frames: [{
          id: "run-fork-resume:continuation:0",
          runId: "run-fork-resume",
          status: "paused",
          reason: "approval_required",
          conversationCursor: 0,
          pendingActionIds: ["action-approve"],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
          approvedActionIds: [],
          resolvedClarificationIds: [],
          nodeCheckpoint: {
            eventSeq: 1,
            conversationCursor: 0,
            bag: {},
          },
          createdAt: 1_714_000_000_003,
          updatedAt: 1_714_000_000_003,
        }],
      },
    };
    const store = storeWithSnapshot(source);

    const streams: Array<{ runId: string; eventCount: number }> = [];
    const handle = await store.forkAndResumeRun({
      runId: source.runId,
      checkpointId: source.checkpoints[0]!.id,
      resume: { reason: "recover" },
    }, {
      onStream: (stream) => streams.push({ runId: stream.runId, eventCount: stream.events.length }),
    });
    const resumed = store.getRunState({ runId: handle.runId });

    expect(resumed.runId).not.toBe(source.runId);
    expect(resumed.pendingApprovals).not.toContain("action-approve");
    expect(resumed.events.some((event) => event.type === "approval.resolved")).toBe(true);
    expect(streams.some((stream) => stream.runId === resumed.runId)).toBe(true);
  });
});
