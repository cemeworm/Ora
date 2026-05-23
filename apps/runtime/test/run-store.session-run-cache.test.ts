import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildVisibleLedger,
  createModeSpecFromPattern,
  MVP_PATTERNS,
  type OraEventEnvelope,
  type RuntimeSessionLedger,
} from "@cemeworm/shared";
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

  it("reuses session projection cache per ledger mode and keeps visible snapshots lightweight", () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock: () => Date.parse("2026-05-21T03:00:00.000Z") });
    const internal = store as unknown as {
      sessionProjectionForLedger: (
        sessionId: string,
        ledger: RuntimeSessionLedger,
        leafEntryId: string | undefined,
        mode: "visible" | "full",
      ) => {
        projection: { latestSnapshot?: ReturnType<typeof createRunningRunSnapshot> };
        snapshotsByRunId: ReadonlyMap<string, ReturnType<typeof createRunningRunSnapshot>>;
      };
      applyLedgerToStore: (
        sessionId: string,
        ledger: RuntimeSessionLedger,
        leafEntryId: string | undefined,
        mode?: "visible" | "full",
      ) => unknown;
      storeRunProjection: (snapshot: ReturnType<typeof createRunningRunSnapshot>) => void;
      runs: Map<string, ReturnType<typeof createRunningRunSnapshot>>;
    };
    const snapshot = {
      ...runningSnapshot("session-cache", "run-cache", 1, Date.parse("2026-05-21T03:00:00.000Z")),
      status: "running" as const,
      output: { text: "Full answer" },
      updatedAt: Date.parse("2026-05-21T03:01:00.000Z"),
    };
    const ledger: RuntimeSessionLedger = {
      sessionId: "session-cache",
      leafEntryId: "run-cache:events",
      entries: [
        {
          id: "session-cache:created",
          sessionId: "session-cache",
          turnIndex: 0,
          seq: 0,
          type: "session.created",
          createdAt: Date.parse("2026-05-21T03:00:00.000Z"),
          payload: { title: "Cache session" },
        },
        {
          id: "run-cache:user",
          parentId: "session-cache:created",
          sessionId: "session-cache",
          runId: "run-cache",
          turnIndex: 1,
          seq: 1,
          type: "user.message",
          createdAt: Date.parse("2026-05-21T03:00:01.000Z"),
          payload: { content: "Prompt for run-cache" },
        },
        {
          id: "run-cache:started",
          parentId: "run-cache:user",
          sessionId: "session-cache",
          runId: "run-cache",
          turnIndex: 1,
          seq: 2,
          type: "run.started",
          createdAt: Date.parse("2026-05-21T03:00:02.000Z"),
          payload: {
            input: snapshot.input,
            config: snapshot.config,
            status: "running",
          },
        },
        {
          id: "run-cache:events",
          parentId: "run-cache:started",
          sessionId: "session-cache",
          runId: "run-cache",
          turnIndex: 1,
          seq: 3,
          type: "runtime.event_batch",
          createdAt: Date.parse("2026-05-21T03:00:30.000Z"),
          payload: {
            events: [{
              id: "run-cache:event-1",
              runId: "run-cache",
              seq: 0,
              type: "agent.message",
              createdAt: Date.parse("2026-05-21T03:00:30.000Z"),
              pattern: "orchestrator_subagent",
              agentId: "solo_agent",
              nodeId: "solo_agent",
              payload: { content: "intermediate" },
            }],
            eventCount: 1,
            status: "running",
            output: { text: "intermediate" },
          },
        },
        {
          id: "run-cache:assistant",
          parentId: "run-cache:events",
          sessionId: "session-cache",
          runId: "run-cache",
          turnIndex: 1,
          seq: 4,
          type: "assistant.message",
          createdAt: snapshot.updatedAt,
          payload: {
            content: "Full answer",
            status: "succeeded",
            output: { text: "Full answer" },
            snapshot: {
              ...snapshot,
              status: "succeeded" as const,
            },
          },
        },
      ],
    };

    const visibleFirst = internal.sessionProjectionForLedger("session-cache", ledger, ledger.leafEntryId, "visible");
    const visibleSecond = internal.sessionProjectionForLedger("session-cache", ledger, ledger.leafEntryId, "visible");
    const fullProjection = internal.sessionProjectionForLedger("session-cache", ledger, ledger.leafEntryId, "full");
    const visibleLedger = buildVisibleLedger(ledger);
    const visibleAssistantEntry = visibleLedger.entries.find((entry) => entry.id === "run-cache:assistant");
    const visibleEventBatchEntry = visibleLedger.entries.find((entry) => entry.id === "run-cache:events");
    expect(visibleSecond).toBe(visibleFirst);
    expect(fullProjection).not.toBe(visibleFirst);
    expect(visibleAssistantEntry?.payload).toEqual({
      content: "Full answer",
      status: "succeeded",
      error: undefined,
    });
    expect(visibleEventBatchEntry?.payload).toEqual({
      events: [],
      eventCount: 1,
      status: "running",
      error: undefined,
    });
    internal.storeRunProjection({
      ...snapshot,
      events: [{
        id: "run-cache:event-1",
        runId: "run-cache",
        seq: 0,
        type: "agent.message",
        createdAt: Date.parse("2026-05-21T03:00:30.000Z"),
        pattern: "orchestrator_subagent",
        agentId: "solo_agent",
        nodeId: "solo_agent",
        payload: { content: "intermediate" },
      }] as ReturnType<typeof createRunningRunSnapshot>["events"],
      checkpoints: [] as ReturnType<typeof createRunningRunSnapshot>["checkpoints"],
      toolResults: [] as ReturnType<typeof createRunningRunSnapshot>["toolResults"],
    });
    internal.applyLedgerToStore("session-cache", ledger, ledger.leafEntryId, "visible");

    const visibleAfterApply = internal.sessionProjectionForLedger(
      "session-cache",
      ledger,
      ledger.leafEntryId,
      "visible",
    ).snapshotsByRunId.get("run-cache");
    expect(visibleAfterApply?.events).toEqual([]);
    expect(visibleAfterApply?.checkpoints).toEqual([]);
    expect(visibleAfterApply?.toolResults).toEqual([]);
    expect(internal.runs.get("run-cache")?.events).toEqual([]);
  });

  it("keeps session detail latestSnapshot on the visible path after a cold reload", () => {
    const dataDir = freshStoreDir();
    const clock = () => Date.parse("2026-05-21T03:20:00.000Z");
    const store = new LocalRunStore({ dataDir, clock });
    const session = store.createSession({});
    const createdAt = Date.parse("2026-05-21T03:20:00.000Z");
    const terminalSnapshot = {
      ...runningSnapshot(session.sessionId, "run-visible-latest", 1, createdAt),
      modeId: "code_development",
      config: {
        ...baseConfig(),
        modeId: "code_development",
      },
      status: "succeeded" as const,
      updatedAt: Date.parse("2026-05-21T03:21:00.000Z"),
      output: { text: "Visible latest snapshot" },
      events: [{
        id: "run-visible-latest:event-1",
        runId: "run-visible-latest",
        seq: 0,
        type: "agent.message",
        createdAt: Date.parse("2026-05-21T03:20:30.000Z"),
        pattern: "orchestrator_subagent",
        agentId: "solo_agent",
        nodeId: "solo_agent",
        payload: { content: "intermediate" },
      }] satisfies OraEventEnvelope[],
    };

    store.persistExternalSnapshot(terminalSnapshot);

    const reloaded = new LocalRunStore({ dataDir, clock });
    const internal = reloaded as unknown as {
      runs: Map<string, typeof terminalSnapshot>;
    };

    const detail = reloaded.getSession({ sessionId: session.sessionId });

    expect(detail.latestSnapshot?.runId).toBe("run-visible-latest");
    expect(detail.latestSnapshot?.status).toBe("succeeded");
    expect(detail.latestSnapshot?.events).toEqual([]);
    expect(internal.runs.get("run-visible-latest")?.events).toEqual([]);
  });
});
