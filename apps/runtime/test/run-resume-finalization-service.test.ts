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
