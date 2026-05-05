import { describe, expect, it } from "vitest";
import {
  RuntimeSessionLedgerSchema,
  deriveRunSnapshot,
  deriveSessionProjection,
  runtimeSessionEntryPath,
  runtimeSessionProjectionToDetail,
  type RuntimeSessionEntry,
  type RuntimeSessionLedger,
} from "../src/index.js";

const BASE_TIME = 1_714_000_000_000;

function entry(patch: Partial<RuntimeSessionEntry> & Pick<RuntimeSessionEntry, "id" | "seq" | "type">): RuntimeSessionEntry {
  return {
    sessionId: "session-ledger",
    turnIndex: 0,
    createdAt: BASE_TIME + patch.seq,
    payload: {},
    ...patch,
  };
}

function runConfig(metadata: Record<string, unknown> = {}) {
  return {
    pattern: "orchestrator_subagent" as const,
    modeId: "single_agent",
    modeSelection: "manual" as const,
    profileIds: [],
    modelRef: "local/smoke-model",
    approvalMode: "high_risk_only" as const,
    permissionMode: "default" as const,
    patternOptions: {},
    metadata,
    deterministicSeed: "runtime-ledger-test",
    skillIds: [],
    toolIds: [],
  };
}

function baseLedger(extraEntries: RuntimeSessionEntry[] = []): RuntimeSessionLedger {
  return RuntimeSessionLedgerSchema.parse({
    sessionId: "session-ledger",
    leafEntryId: extraEntries.at(-1)?.id,
    entries: [
      entry({
        id: "e-session",
        seq: 0,
        type: "session.created",
        payload: { title: "Ledger Session", projectId: "project-1" },
      }),
      ...extraEntries,
    ],
  });
}

describe("runtime session ledger projection", () => {
  it("derives session summary, turns, transcript, and final snapshot from ledger entries", () => {
    const ledger = baseLedger([
      entry({
        id: "e-user",
        parentId: "e-session",
        seq: 1,
        type: "user.message",
        runId: "run-1",
        turnIndex: 1,
        payload: { content: "Build the ledger." },
      }),
      entry({
        id: "e-run",
        parentId: "e-user",
        seq: 2,
        type: "run.started",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          input: { prompt: "Build the ledger.", createdAt: BASE_TIME, context: {} },
          config: runConfig(),
        },
      }),
      entry({
        id: "e-events",
        parentId: "e-run",
        seq: 3,
        type: "runtime.event_batch",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          status: "succeeded",
          events: [
            {
              id: "evt-1",
              runId: "run-1",
              seq: 0,
              type: "message.delta",
              createdAt: BASE_TIME + 3,
              pattern: "orchestrator_subagent",
              payload: { content: "Done." },
            },
          ],
        },
      }),
      entry({
        id: "e-assistant",
        parentId: "e-events",
        seq: 4,
        type: "assistant.message",
        runId: "run-1",
        turnIndex: 1,
        payload: { content: "Done.", status: "succeeded" },
      }),
    ]);

    const projection = deriveSessionProjection(ledger);
    const detail = runtimeSessionProjectionToDetail(projection);
    const snapshot = deriveRunSnapshot(ledger, "run-1");

    expect(projection.session).toMatchObject({
      sessionId: "session-ledger",
      title: "Ledger Session",
      latestRunId: "run-1",
      status: "succeeded",
      turnCount: 1,
    });
    expect(projection.session.attention).toEqual(projection.turns[0]?.attention);
    expect(projection.latestSnapshot?.attention).toEqual(projection.session.attention);
    expect(detail.transcript.map((message) => [message.role, message.content])).toEqual([
      ["user", "Build the ledger."],
      ["assistant", "Done."],
    ]);
    expect(snapshot?.events).toHaveLength(1);
    expect(snapshot?.status).toBe("succeeded");
  });

  it("uses gate entries as the only attention authority and ignores resolved stale raw events", () => {
    const ledger = baseLedger([
      entry({
        id: "e-run",
        parentId: "e-session",
        seq: 1,
        type: "run.started",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          input: { prompt: "Need approval.", createdAt: BASE_TIME, context: {} },
          config: runConfig(),
        },
      }),
      entry({
        id: "e-approval-open",
        parentId: "e-run",
        seq: 2,
        type: "gate.opened",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          gateId: "gate-approval",
          kind: "approval",
          pendingActionIds: ["action-1"],
        },
      }),
      entry({
        id: "e-clarification-open",
        parentId: "e-approval-open",
        seq: 3,
        type: "gate.opened",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          gateId: "gate-clarification",
          kind: "clarification",
          pendingClarificationIds: ["clarification-1"],
        },
      }),
      entry({
        id: "e-clarification-resolved",
        parentId: "e-clarification-open",
        seq: 4,
        type: "gate.resolved",
        runId: "run-1",
        turnIndex: 1,
        payload: { gateId: "gate-clarification" },
      }),
      entry({
        id: "e-raw-stale",
        parentId: "e-clarification-resolved",
        seq: 5,
        type: "runtime.event_batch",
        runId: "run-1",
        turnIndex: 1,
        payload: {
          events: [{
            id: "evt-stale",
            runId: "run-1",
            seq: 0,
            type: "clarification.required",
            createdAt: BASE_TIME + 5,
            payload: { clarificationId: "clarification-1" },
          }],
        },
      }),
    ]);

    const projection = deriveSessionProjection(ledger);

    expect(projection.session.attention).toMatchObject({
      kind: "needs_approval",
      pendingActionIds: ["action-1"],
    });
    expect(projection.latestSnapshot?.pendingClarifications).toEqual([]);
    expect(projection.gates.find((gate) => gate.gateId === "gate-clarification")?.status).toBe("resolved");
  });

  it("projects plan acceptance handoff and compaction context as ledger facts", () => {
    const ledger = baseLedger([
      entry({
        id: "e-plan-run",
        parentId: "e-session",
        seq: 1,
        type: "run.started",
        runId: "run-plan",
        turnIndex: 1,
        payload: {
          input: { prompt: "Plan.", createdAt: BASE_TIME, context: {} },
          config: runConfig({ taskIntent: "plan" }),
        },
      }),
      entry({
        id: "e-plan-gate",
        parentId: "e-plan-run",
        seq: 2,
        type: "gate.opened",
        runId: "run-plan",
        turnIndex: 1,
        payload: {
          gateId: "decision-1",
          kind: "plan_decision",
          planDecision: {
            id: "decision-1",
            runId: "run-plan",
            sessionId: "session-ledger",
            status: "pending",
            planContent: "Ship the ledger.",
            planSourceRunId: "run-plan",
            createdAt: BASE_TIME + 2,
          },
        },
      }),
      entry({
        id: "e-plan-resolved",
        parentId: "e-plan-gate",
        seq: 3,
        type: "gate.resolved",
        runId: "run-plan",
        turnIndex: 1,
        payload: { gateId: "decision-1", status: "accepted" },
      }),
      entry({
        id: "e-handoff",
        parentId: "e-plan-resolved",
        seq: 4,
        type: "handoff.accepted_plan",
        payload: {
          decisionId: "decision-1",
          sourceRunId: "run-plan",
          planContent: "Ship the ledger.",
          acceptedAt: BASE_TIME + 4,
        },
      }),
      entry({
        id: "e-plan-assistant",
        parentId: "e-handoff",
        seq: 5,
        type: "assistant.message",
        runId: "run-plan",
        turnIndex: 1,
        payload: { content: "Plan accepted.", status: "succeeded" },
      }),
      entry({
        id: "e-compaction",
        parentId: "e-plan-assistant",
        seq: 6,
        type: "compaction.summary",
        payload: {
          contextState: {
            compactedHistory: [{ role: "system", content: "Summary", createdAt: BASE_TIME + 6 }],
            compactedThroughTurnIndex: 1,
            activeTokenUsage: { totalTokens: 10 },
            contextWindow: 100,
            autoCompactTokenLimit: 80,
            updatedAt: BASE_TIME + 6,
          },
        },
      }),
    ]);

    const projection = deriveSessionProjection(ledger);

    expect(projection.session.attention?.kind).toBe("idle");
    expect(projection.runs[0]?.planDecisions[0]?.status).toBe("accepted");
    expect(projection.acceptedPlanHandoffs).toEqual([{
      decisionId: "decision-1",
      sourceRunId: "run-plan",
      planContent: "Ship the ledger.",
      acceptedAt: BASE_TIME + 4,
    }]);
    expect(projection.contextState?.compactedHistory[0]?.content).toBe("Summary");
  });

  it("walks the selected branch leaf path without rewriting sibling entries", () => {
    const ledger = RuntimeSessionLedgerSchema.parse({
      sessionId: "session-ledger",
      leafEntryId: "e-main-assistant",
      entries: [
        entry({ id: "e-session", seq: 0, type: "session.created", payload: { title: "Branching" } }),
        entry({
          id: "e-main-run",
          parentId: "e-session",
          seq: 1,
          type: "run.started",
          runId: "run-main",
          turnIndex: 1,
          payload: { input: { prompt: "Main.", createdAt: BASE_TIME, context: {} }, config: runConfig() },
        }),
        entry({
          id: "e-main-assistant",
          parentId: "e-main-run",
          seq: 2,
          type: "assistant.message",
          runId: "run-main",
          turnIndex: 1,
          payload: { content: "Main output.", status: "succeeded" },
        }),
        entry({
          id: "e-candidate-run",
          parentId: "e-session",
          seq: 3,
          type: "run.started",
          runId: "run-candidate",
          turnIndex: 1,
          payload: { input: { prompt: "Candidate.", createdAt: BASE_TIME, context: {} }, config: runConfig() },
        }),
        entry({
          id: "e-candidate-assistant",
          parentId: "e-candidate-run",
          seq: 4,
          type: "assistant.message",
          runId: "run-candidate",
          turnIndex: 1,
          payload: { content: "Candidate output.", status: "succeeded" },
        }),
      ],
    });

    expect(runtimeSessionEntryPath(ledger).map((candidate) => candidate.id)).toEqual([
      "e-session",
      "e-main-run",
      "e-main-assistant",
    ]);
    expect(deriveSessionProjection(ledger).session.latestRunId).toBe("run-main");
    expect(deriveSessionProjection(ledger, "e-candidate-assistant").session.latestRunId).toBe("run-candidate");
  });

  it("hides replaced run transcript entries from the adopted mainline projection", () => {
    const ledger = baseLedger([
      entry({
        id: "e-old-user",
        parentId: "e-session",
        seq: 1,
        type: "user.message",
        runId: "run-old",
        turnIndex: 1,
        payload: { content: "Old prompt." },
      }),
      entry({
        id: "e-old-run",
        parentId: "e-old-user",
        seq: 2,
        type: "run.started",
        runId: "run-old",
        turnIndex: 1,
        payload: { input: { prompt: "Old prompt.", createdAt: BASE_TIME, context: {} }, config: runConfig() },
      }),
      entry({
        id: "e-old-assistant",
        parentId: "e-old-run",
        seq: 3,
        type: "assistant.message",
        runId: "run-old",
        turnIndex: 1,
        payload: { content: "Old output.", status: "succeeded" },
      }),
      entry({
        id: "e-adopted-user",
        parentId: "e-old-assistant",
        seq: 4,
        type: "user.message",
        runId: "run-adopted",
        turnIndex: 1,
        payload: { content: "Replacement prompt." },
      }),
      entry({
        id: "e-adopted-run",
        parentId: "e-adopted-user",
        seq: 5,
        type: "run.started",
        runId: "run-adopted",
        turnIndex: 1,
        payload: {
          input: { prompt: "Replacement prompt.", createdAt: BASE_TIME, context: {} },
          config: runConfig({
            branchRole: "adopted",
            branchTarget: "replace_latest",
            branchReplaceRunId: "run-old",
          }),
        },
      }),
      entry({
        id: "e-adopted-assistant",
        parentId: "e-adopted-run",
        seq: 6,
        type: "assistant.message",
        runId: "run-adopted",
        turnIndex: 1,
        payload: { content: "Replacement output.", status: "succeeded" },
      }),
      entry({
        id: "e-branch-adopted",
        parentId: "e-adopted-assistant",
        seq: 7,
        type: "branch.adopted",
        payload: {
          branchGroupId: "branch-1",
          sessionId: "session-ledger",
          target: "replace_latest",
          replaceRunId: "run-old",
          baseTurnIndex: 1,
          prompt: "Replacement prompt.",
          status: "adopted",
          candidateRunIds: ["run-adopted"],
          candidates: [],
          adoptedRunId: "run-adopted",
          createdAt: BASE_TIME + 7,
          updatedAt: BASE_TIME + 7,
        },
      }),
    ]);

    const projection = deriveSessionProjection(ledger);

    expect(projection.turns.map((turn) => turn.runId)).toEqual(["run-adopted"]);
    expect(projection.transcript.map((message) => message.content)).toEqual([
      "Replacement prompt.",
      "Replacement output.",
    ]);
  });
});
