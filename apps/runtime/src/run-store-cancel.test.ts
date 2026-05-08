import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StateSnapshot } from "@cemeworm/shared";
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
});
