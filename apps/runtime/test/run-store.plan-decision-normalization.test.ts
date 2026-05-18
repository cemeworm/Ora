import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SINGLE_AGENT_MODE_ID,
  StateSnapshotSchema,
  getModePreset,
  modeSpecToPatternDefinition,
  type StateSnapshot,
} from "@cemeworm/shared";
import { LocalRunStore } from "../src/index.js";
import { createRunningRunSnapshot } from "../src/run-snapshots.js";

const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
const definition = modeSpecToPatternDefinition(modeSpec);

function freshStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-plan-normalization-"));
}

function declinedPlanSnapshot(): StateSnapshot {
  const base = createRunningRunSnapshot({
    runId: "run-plan-normalization",
    sessionId: "session-plan-normalization",
    turnIndex: 1,
    input: { prompt: "Return a proposed plan.", createdAt: 1_000, context: {} },
    config: {
      pattern: definition.coordinationKind,
      modeId: SINGLE_AGENT_MODE_ID,
      modeSelection: "manual",
      profileIds: ["solo_agent"],
      skillIds: [],
      toolIds: [],
      providerId: "local-smoke",
      modelRef: "local/test-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: { taskIntent: "plan" },
    },
    modeSpec,
    definition,
    clock: () => 2_000,
  });

  return StateSnapshotSchema.parse({
    ...base,
    status: "succeeded",
    output: {
      text: [
        "<proposed_plan>",
        "## Revised runtime status plan",
        "1. Rework the shared attention projection.",
        "2. Re-open the plan decision gate in the same run.",
        "</proposed_plan>",
      ].join("\n"),
    },
    planDecisions: [{
      id: "decision-old",
      runId: base.runId,
      sessionId: base.sessionId,
      status: "declined",
      planContent: "Old plan",
      createdAt: 1_500,
      resolvedAt: 1_900,
    }],
    updatedAt: 2_000,
  });
}

describe("LocalRunStore plan decision normalization", () => {
  it("adds a fresh pending plan decision when a declined plan produces a new proposed plan in the same run", () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock: () => 2_000 });
    const normalize = (store as unknown as {
      normalizeSnapshotForPersistence: (snapshot: StateSnapshot) => StateSnapshot;
    }).normalizeSnapshotForPersistence.bind(store);

    const normalized = StateSnapshotSchema.parse(normalize(declinedPlanSnapshot()));
    const pendingDecision = normalized.planDecisions.find((decision) => decision.status === "pending");

    expect(normalized.planDecisions.find((decision) => decision.id === "decision-old")?.status).toBe("declined");
    expect(pendingDecision).toMatchObject({
      id: `${normalized.runId}:plan-decision:${normalized.updatedAt}`,
      runId: normalized.runId,
      sessionId: normalized.sessionId,
      status: "pending",
    });
    expect(normalized.attention?.kind).toBe("needs_plan_decision");
    expect(normalized.attention?.planDecisionId).toBe(pendingDecision?.id);
  });
});
