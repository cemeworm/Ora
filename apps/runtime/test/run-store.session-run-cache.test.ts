import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createModeSpecFromPattern, MVP_PATTERNS } from "@cemeworm/shared";
import type { RunConfig } from "@cemeworm/shared";
import { describe, expect, it } from "vitest";
import { LocalRunStore } from "../src/index.js";
import { createRunningRunSnapshot } from "../src/run-snapshots.js";

function freshStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-session-run-cache-"));
}

function baseConfig(): RunConfig {
  return {
    pattern: "orchestrator_subagent",
    modeId: "orchestrator_subagent",
    modeSelection: "manual",
    profileIds: ["solo_agent"],
    skillIds: [],
    toolIds: [],
    providerId: "local-smoke",
    modelRef: "local/test-model",
    approvalMode: "high_risk_only",
    patternOptions: {},
    metadata: {},
  };
}

function runningSnapshot(sessionId: string, runId: string, turnIndex: number, createdAt: number) {
  const definition = MVP_PATTERNS.find((pattern) => pattern.id === "orchestrator_subagent");
  if (!definition) {
    throw new Error("orchestrator_subagent pattern not found");
  }
  return createRunningRunSnapshot({
    runId,
    sessionId,
    turnIndex,
    input: { prompt: `Prompt for ${runId}`, createdAt, context: {} },
    config: baseConfig(),
    modeSpec: createModeSpecFromPattern("orchestrator_subagent"),
    definition,
    clock: () => createdAt,
  });
}

describe("LocalRunStore session run caches", () => {
  it("reuses cached session run arrays until a new run for that session is stored", () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock: () => Date.parse("2026-05-21T02:30:00.000Z") });
    const session = store.createSession({});
    const internal = store as unknown as {
      cacheRun: (snapshot: ReturnType<typeof createRunningRunSnapshot>, flush: boolean) => void;
      allRunsForSession: (sessionId: string) => ReturnType<typeof createRunningRunSnapshot>[];
      runsForSession: (sessionId: string) => ReturnType<typeof createRunningRunSnapshot>[];
    };

    internal.cacheRun(runningSnapshot(session.sessionId, "run-1", 1, Date.parse("2026-05-21T02:30:00.000Z")), false);

    const allRunsFirst = internal.allRunsForSession(session.sessionId);
    const allRunsSecond = internal.allRunsForSession(session.sessionId);
    const visibleRunsFirst = internal.runsForSession(session.sessionId);
    const visibleRunsSecond = internal.runsForSession(session.sessionId);

    expect(allRunsSecond).toBe(allRunsFirst);
    expect(visibleRunsSecond).toBe(visibleRunsFirst);
    expect(allRunsFirst.map((run) => run.runId)).toEqual(["run-1"]);

    internal.cacheRun(runningSnapshot(session.sessionId, "run-2", 2, Date.parse("2026-05-21T02:31:00.000Z")), false);

    const allRunsAfterInsert = internal.allRunsForSession(session.sessionId);
    const visibleRunsAfterInsert = internal.runsForSession(session.sessionId);

    expect(allRunsAfterInsert).not.toBe(allRunsFirst);
    expect(visibleRunsAfterInsert).not.toBe(visibleRunsFirst);
    expect(allRunsAfterInsert.map((run) => run.runId)).toEqual(["run-1", "run-2"]);
    expect(visibleRunsAfterInsert.map((run) => run.runId)).toEqual(["run-1", "run-2"]);
  });

  it("does not increment turnCount when a cached run is updated in place", () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock: () => Date.parse("2026-05-21T02:40:00.000Z") });
    const session = store.createSession({});
    const internal = store as unknown as {
      cacheRun: (snapshot: ReturnType<typeof createRunningRunSnapshot>, flush: boolean) => void;
    };

    const firstSnapshot = runningSnapshot(session.sessionId, "run-stable", 1, Date.parse("2026-05-21T02:40:00.000Z"));
    internal.cacheRun(firstSnapshot, false);
    const firstSession = store.getSession({ sessionId: session.sessionId });

    const updatedSnapshot = {
      ...firstSnapshot,
      updatedAt: Date.parse("2026-05-21T02:41:00.000Z"),
      input: {
        ...firstSnapshot.input,
        prompt: "Prompt for run-stable (updated)",
      },
    };
    internal.cacheRun(updatedSnapshot, false);
    const updatedSession = store.getSession({ sessionId: session.sessionId });

    expect(firstSession.session.turnCount).toBe(1);
    expect(updatedSession.session.turnCount).toBe(1);
    expect(updatedSession.turns.map((turn) => turn.runId)).toEqual(["run-stable"]);
  });
});
