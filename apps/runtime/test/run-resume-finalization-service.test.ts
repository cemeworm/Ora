import { describe, expect, it } from "vitest";
import {
  getModePreset,
  modeSpecToPatternDefinition,
  OraEventEnvelopeSchema,
  StateSnapshotSchema,
  SINGLE_AGENT_MODE_ID,
  type OraEventEnvelope,
  type StateSnapshot,
} from "@cemeworm/shared";
import { createRunningRunSnapshot } from "../src/run-snapshots.js";
import { RunResumeFinalizationService } from "../src/run-resume-finalization-service.js";

const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
const definition = modeSpecToPatternDefinition(modeSpec);

function baseSnapshot(): StateSnapshot {
  return createRunningRunSnapshot({
    runId: "run-resume-finalization",
    sessionId: "session-resume-finalization",
    turnIndex: 1,
    input: { prompt: "Finish resume.", createdAt: 1_000, context: {} },
    config: {
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      modeSelection: "manual",
      profileIds: ["solo_agent"],
      skillIds: [],
      toolIds: [],
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

describe("RunResumeFinalizationService", () => {
  it("owns streaming terminal resume ledger, persistence, and publish sequencing", async () => {
    const calls: string[] = [];
    const original = baseSnapshot();
    const completed = StateSnapshotSchema.parse({ ...original, status: "succeeded", updatedAt: 2_000 });
    const projected = StateSnapshotSchema.parse({ ...completed, updatedAt: 2_001 });
    const service = new RunResumeFinalizationService({
      withResumeResolutionEvents: (snapshot, source, clarificationPatch, approvedActionIds) => {
        calls.push(`resolve:${source.runId}:${Object.keys(clarificationPatch).join(",")}:${approvedActionIds.join(",")}`);
        return snapshot;
      },
      normalizeSnapshotForPersistence: (snapshot) => {
        calls.push(`normalize:${snapshot.updatedAt}`);
        return snapshot;
      },
      appendRunSnapshotUpdateToLedger: (snapshot) => {
        calls.push(`ledger:${snapshot.updatedAt}`);
        return projected;
      },
      persistRun: () => {
        calls.push("persistRun");
      },
      persistRunWithGeneratedTitle: async (snapshot) => {
        calls.push(`persistTitle:${snapshot.updatedAt}`);
      },
    });

    const stream = {
      replaceSnapshot: (snapshot: StateSnapshot) => {
        calls.push(`replace:${snapshot.updatedAt}`);
        return snapshot;
      },
      markLedgerSynced: () => {
        calls.push("markLedgerSynced");
      },
      publish: (events: OraEventEnvelope[], snapshot: StateSnapshot) => {
        calls.push(`publish:${events.length}:${snapshot.updatedAt}`);
      },
    };

    await expect(service.persistStreamingTerminal({
      snapshot: completed,
      original,
      clarificationPatch: { scope: "narrow" },
      approvedActionIds: ["action-write"],
      stream,
      markLedgerSynced: true,
    })).resolves.toBe(projected);

    expect(calls).toEqual([
      "resolve:run-resume-finalization:scope:action-write",
      "normalize:2000",
      "ledger:2000",
      "persistTitle:2001",
      "replace:2001",
      "markLedgerSynced",
      "publish:0:2001",
    ]);
  });

  it("materializes resolved clarification continuation state before terminal assertion", async () => {
    const original = StateSnapshotSchema.parse({
      ...baseSnapshot(),
      status: "interrupted",
      pendingClarifications: [{
        id: "clarification:scope",
        key: "scope",
        nodeId: "ora",
        nodeLabel: "Ora",
        question: "Which scope?",
        options: [],
        requestedAt: 1_100,
      }],
      continuation: {
        activeFrameId: "run-resume-finalization:continuation:0",
        frames: [{
          id: "run-resume-finalization:continuation:0",
          runId: "run-resume-finalization",
          status: "paused",
          reason: "clarification_required",
          conversationCursor: 0,
          pendingActionIds: [],
          pendingToolCallIds: [],
          pendingClarificationIds: ["clarification:scope"],
          approvedActionIds: [],
          resolvedClarificationIds: [],
          createdAt: 1_100,
          updatedAt: 1_100,
        }],
      },
      updatedAt: 1_100,
    });
    const terminal = StateSnapshotSchema.parse({
      ...original,
      status: "succeeded",
      pendingClarifications: [],
      updatedAt: 2_100,
    });
    const service = new RunResumeFinalizationService({
      withResumeResolutionEvents: (snapshot) => StateSnapshotSchema.parse({
        ...snapshot,
        continuation: {
          activeFrameId: undefined,
          frames: [{
            ...snapshot.continuation.frames[0]!,
            status: "completed",
            pendingClarificationIds: [],
            resolvedClarificationIds: ["clarification:scope"],
            updatedAt: snapshot.updatedAt,
          }],
        },
      }),
      normalizeSnapshotForPersistence: (snapshot) => snapshot,
      appendRunSnapshotUpdateToLedger: (snapshot) => snapshot,
      persistRun: () => {},
      persistRunWithGeneratedTitle: async () => {},
    });

    const persisted = await service.persistTerminal({
      snapshot: terminal,
      original,
      clarificationPatch: { scope: "staging" },
      approvedActionIds: [],
    });

    expect(persisted.status).toBe("succeeded");
    expect(persisted.error).toBeUndefined();
    expect(persisted.continuation.activeFrameId).toBeUndefined();
    expect(persisted.continuation.frames[0]).toMatchObject({
      status: "completed",
      pendingClarificationIds: [],
      resolvedClarificationIds: ["clarification:scope"],
    });
  });

  it("keeps clarification frame provenance through streaming terminal persistence", async () => {
    const calls: string[] = [];
    const original = StateSnapshotSchema.parse({
      ...baseSnapshot(),
      status: "interrupted",
      pendingClarifications: [{
        id: "clarification:scope",
        key: "scope",
        nodeId: "ora",
        nodeLabel: "Ora",
        question: "Which scope?",
        options: [],
        requestedAt: 1_100,
      }],
      continuation: {
        activeFrameId: "run-resume-finalization:continuation:0",
        frames: [{
          id: "run-resume-finalization:continuation:0",
          runId: "run-resume-finalization",
          status: "paused",
          reason: "clarification_required",
          conversationCursor: 0,
          pendingActionIds: ["action-read"],
          pendingToolCallIds: ["tool-read"],
          pendingClarificationIds: ["clarification:scope"],
          approvedActionIds: [],
          resolvedClarificationIds: [],
          createdAt: 1_100,
          updatedAt: 1_100,
        }],
      },
      updatedAt: 1_100,
    });
    const terminal = StateSnapshotSchema.parse({
      ...original,
      status: "succeeded",
      pendingClarifications: [],
      updatedAt: 2_100,
    });
    let ledgerInput: StateSnapshot | undefined;
    const service = new RunResumeFinalizationService({
      withResumeResolutionEvents: (snapshot) => StateSnapshotSchema.parse({
        ...snapshot,
        continuation: {
          activeFrameId: undefined,
          frames: [{
            ...snapshot.continuation.frames[0]!,
            status: "completed",
            pendingActionIds: [],
            pendingToolCallIds: [],
            pendingClarificationIds: [],
            resolvedClarificationIds: ["clarification:scope"],
            updatedAt: snapshot.updatedAt,
          }],
        },
      }),
      normalizeSnapshotForPersistence: (snapshot) => snapshot,
      appendRunSnapshotUpdateToLedger: (snapshot) => {
        ledgerInput = snapshot;
        calls.push(`ledger:${snapshot.continuation.frames[0]?.reason}:${snapshot.continuation.frames[0]?.resolvedClarificationIds.join(",")}`);
        return snapshot;
      },
      persistRun: () => {},
      persistRunWithGeneratedTitle: async () => {
        calls.push("persistTitle");
      },
    });

    const stream = {
      replaceSnapshot: (snapshot: StateSnapshot) => {
        calls.push(`replace:${snapshot.continuation.frames[0]?.reason}:${snapshot.continuation.frames[0]?.resolvedClarificationIds.join(",")}`);
        return snapshot;
      },
      markLedgerSynced: () => {
        calls.push("markLedgerSynced");
      },
      publish: (_events: OraEventEnvelope[], snapshot: StateSnapshot) => {
        calls.push(`publish:${snapshot.continuation.frames[0]?.reason}:${snapshot.continuation.frames[0]?.resolvedClarificationIds.join(",")}`);
      },
    };

    const persisted = await service.persistStreamingTerminal({
      snapshot: terminal,
      original,
      clarificationPatch: { scope: "staging" },
      approvedActionIds: [],
      stream,
      markLedgerSynced: true,
    });

    expect(ledgerInput?.continuation.activeFrameId).toBeUndefined();
    expect(ledgerInput?.continuation.frames[0]).toMatchObject({
      status: "completed",
      reason: "clarification_required",
      resolvedClarificationIds: ["clarification:scope"],
    });
    expect(persisted.continuation.frames[0]).toMatchObject({
      status: "completed",
      reason: "clarification_required",
      resolvedClarificationIds: ["clarification:scope"],
    });
    expect(calls).toEqual([
      "ledger:clarification_required:clarification:scope",
      "persistTitle",
      "replace:clarification_required:clarification:scope",
      "markLedgerSynced",
      "publish:clarification_required:clarification:scope",
    ]);
  });

  it("downgrades terminal resume output with DSML protocol text to failed", async () => {
    const original = baseSnapshot();
    const terminal = StateSnapshotSchema.parse({
      ...original,
      status: "succeeded",
      events: [
        ...original.events,
        OraEventEnvelopeSchema.parse({
          id: "run-resume-finalization:done",
          runId: original.runId,
          seq: original.events.length,
          type: "run.done",
          createdAt: 2_150,
          pattern: original.pattern,
          payload: {
            status: "succeeded",
            output: { text: "污染前的成功终态。" },
          },
        }),
      ],
      output: {
        text: [
          "这是一个会被污染的终态回复。",
          "",
          "<｜｜DSML｜｜tool_calls>",
          '<｜｜DSML｜｜invoke name="file__read">',
          "</｜｜DSML｜｜invoke>",
          "</｜｜DSML｜｜tool_calls>",
        ].join("\n"),
      },
      updatedAt: 2_200,
    });
    const service = new RunResumeFinalizationService({
      withResumeResolutionEvents: (snapshot) => snapshot,
      normalizeSnapshotForPersistence: (snapshot) => snapshot,
      appendRunSnapshotUpdateToLedger: (snapshot) => snapshot,
      persistRun: () => {},
      persistRunWithGeneratedTitle: async () => {},
    });

    const persisted = await service.persistTerminal({
      snapshot: terminal,
      original,
      clarificationPatch: {},
      approvedActionIds: [],
    });

    expect(persisted.status).toBe("failed");
    expect(persisted.error).toBe("Terminal resume output contained internal protocol text.");
    expect(persisted.events.at(-1)).toMatchObject({
      type: "run.failed",
      payload: expect.objectContaining({
        status: "failed",
        error: "Terminal resume output contained internal protocol text.",
      }),
    });
    expect(persisted.output).toMatchObject({
      text: "Terminal resume output contained internal protocol text.",
      visibleText: "这是一个会被污染的终态回复。",
    });
  });

  it("owns streaming failure ledger, persistence, and publish sequencing", async () => {
    const calls: string[] = [];
    const failed = StateSnapshotSchema.parse({ ...baseSnapshot(), status: "failed", updatedAt: 3_000 });
    const projected = StateSnapshotSchema.parse({ ...failed, updatedAt: 3_001 });
    const event = OraEventEnvelopeSchema.parse({
      id: "run-resume-finalization:failed",
      runId: failed.runId,
      seq: failed.events.length,
      type: "run.failed",
      createdAt: 3_000,
      pattern: failed.pattern,
      payload: { error: "boom" },
    });
    const service = new RunResumeFinalizationService({
      withResumeResolutionEvents: (snapshot) => snapshot,
      normalizeSnapshotForPersistence: (snapshot) => {
        calls.push(`normalize:${snapshot.updatedAt}`);
        return snapshot;
      },
      appendRunSnapshotUpdateToLedger: (snapshot) => {
        calls.push(`ledger:${snapshot.updatedAt}`);
        return projected;
      },
      persistRun: () => {
        calls.push("persistRun");
      },
      persistRunWithGeneratedTitle: async (snapshot) => {
        calls.push(`persistTitle:${snapshot.updatedAt}`);
      },
    });

    const stream = {
      replaceSnapshot: (snapshot: StateSnapshot) => {
        calls.push(`replace:${snapshot.updatedAt}`);
        return snapshot;
      },
      markLedgerSynced: () => {
        calls.push("markLedgerSynced");
      },
      publish: (events: OraEventEnvelope[], snapshot: StateSnapshot) => {
        calls.push(`publish:${events.length}:${snapshot.updatedAt}`);
      },
    };

    await expect(service.persistStreamingFailure({
      snapshot: failed,
      events: [event],
      stream,
    })).resolves.toBe(projected);

    expect(calls).toEqual([
      "normalize:3000",
      "ledger:3000",
      "persistTitle:3001",
      "replace:3001",
      "publish:1:3001",
    ]);
  });
});
