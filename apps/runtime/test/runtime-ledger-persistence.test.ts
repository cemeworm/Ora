import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  RuntimeSessionLedgerSchema,
  deriveSessionProjection,
  type RuntimeSessionEntry,
} from "@cemeworm/shared";
import { JsonFileRuntimePersistenceBackend } from "../src/persistence/json-file-backend.js";
import { SqliteRuntimePersistence } from "../src/persistence/sqlite-backend.js";
import type { RuntimePersistenceBackend } from "../src/persistence/types.js";

const BASE_TIME = 1_714_000_000_000;

function freshDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function entry(patch: Partial<RuntimeSessionEntry> & Pick<RuntimeSessionEntry, "id" | "seq" | "type">): RuntimeSessionEntry {
  return {
    sessionId: "session-ledger",
    turnIndex: 0,
    createdAt: BASE_TIME + patch.seq,
    payload: {},
    ...patch,
  };
}

function runConfig() {
  return {
    pattern: "orchestrator_subagent" as const,
    modeId: "single_agent",
    modeSelection: "manual" as const,
    profileIds: [],
    modelRef: "local/smoke-model",
    approvalMode: "high_risk_only" as const,
    permissionMode: "default" as const,
    patternOptions: {},
    metadata: {},
    deterministicSeed: "runtime-ledger-persistence-test",
    skillIds: [],
    toolIds: [],
  };
}

function ledgerEntries(): RuntimeSessionEntry[] {
  return [
    entry({
      id: "e-session",
      seq: 0,
      type: "session.created",
      payload: { title: "Persisted Ledger" },
    }),
    entry({
      id: "e-user",
      parentId: "e-session",
      seq: 1,
      type: "user.message",
      runId: "run-1",
      turnIndex: 1,
      payload: { content: "Persist this session." },
    }),
    entry({
      id: "e-run",
      parentId: "e-user",
      seq: 2,
      type: "run.started",
      runId: "run-1",
      turnIndex: 1,
      payload: {
        input: { prompt: "Persist this session.", createdAt: BASE_TIME, context: {} },
        config: runConfig(),
      },
    }),
    entry({
      id: "e-assistant",
      parentId: "e-run",
      seq: 3,
      type: "assistant.message",
      runId: "run-1",
      turnIndex: 1,
      payload: { content: "Persisted.", status: "succeeded" },
    }),
  ];
}

function expectLedgerRoundTrip(backend: RuntimePersistenceBackend) {
  const entries = ledgerEntries();

  const written = backend.appendSessionEntries("session-ledger", entries.slice(0, 3), "e-run");
  expect(written.leafEntryId).toBe("e-run");

  const completed = backend.appendSessionEntries("session-ledger", [entries[2]!, entries[3]!], "e-assistant");
  expect(completed.entries.map((candidate) => candidate.id)).toEqual([
    "e-session",
    "e-user",
    "e-run",
    "e-assistant",
  ]);
  expect(completed.leafEntryId).toBe("e-assistant");

  const loaded = RuntimeSessionLedgerSchema.parse(backend.getSessionLedger("session-ledger"));
  const projection = deriveSessionProjection(loaded);
  expect(projection.session).toMatchObject({
    sessionId: "session-ledger",
    title: "Persisted Ledger",
    latestRunId: "run-1",
    status: "succeeded",
  });
  expect(backend.listSessionLedgers().map((ledger) => ledger.sessionId)).toEqual(["session-ledger"]);
  const loadedState = backend.load();
  expect(loadedState.sessions).toHaveLength(1);
  expect(loadedState.sessions[0]).toMatchObject({
    sessionId: "session-ledger",
    latestRunId: "run-1",
    status: "succeeded",
  });
  expect(loadedState.runs).toHaveLength(1);
  expect(loadedState.runs[0]).toMatchObject({
    runId: "run-1",
    sessionId: "session-ledger",
    status: "succeeded",
  });
}

describe("runtime session ledger persistence", () => {
  it("round-trips append-only ledgers in the JSON backend", () => {
    expectLedgerRoundTrip(new JsonFileRuntimePersistenceBackend(freshDir("ora-json-ledger-")));
  });

  it("round-trips append-only ledgers in the SQLite backend", () => {
    const dir = freshDir("ora-sqlite-ledger-");
    expectLedgerRoundTrip(new SqliteRuntimePersistence(path.join(dir, "runtime.db")));
  });

  it("repairs a missing JSON leaf pointer from the last durable entry", () => {
    const dir = freshDir("ora-json-ledger-repair-");
    const backend = new JsonFileRuntimePersistenceBackend(dir);
    const entries = ledgerEntries();
    backend.appendSessionEntries("session-ledger", entries, "e-assistant");

    fs.unlinkSync(path.join(dir, "sessions-ledger", "session-ledger.meta.json"));

    const reloaded = new JsonFileRuntimePersistenceBackend(dir);
    expect(reloaded.getSessionLedger("session-ledger")?.leafEntryId).toBe("e-assistant");
  });

  it("recovers JSON ledgers when the last appended line is incomplete", () => {
    const dir = freshDir("ora-json-ledger-partial-");
    const backend = new JsonFileRuntimePersistenceBackend(dir);
    const entries = ledgerEntries();
    backend.appendSessionEntries("session-ledger", entries, "e-assistant");

    fs.appendFileSync(path.join(dir, "sessions-ledger", "session-ledger.jsonl"), "{\"id\":", "utf8");

    const reloaded = new JsonFileRuntimePersistenceBackend(dir);
    const ledger = reloaded.getSessionLedger("session-ledger");

    expect(ledger?.entries.map((candidate) => candidate.id)).toEqual(entries.map((candidate) => candidate.id));
    expect(ledger?.leafEntryId).toBe("e-assistant");
  });

  it("ignores legacy JSON run/session files during clean ledger cutover load", () => {
    const dir = freshDir("ora-json-ledger-clean-cutover-");
    const backend = new JsonFileRuntimePersistenceBackend(dir);
    backend.appendSessionEntries("session-ledger", ledgerEntries(), "e-assistant");
    fs.mkdirSync(path.join(dir, "runs"), { recursive: true });
    fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(dir, "runs", "run-legacy.json"), "{ invalid run json", "utf8");
    fs.writeFileSync(path.join(dir, "sessions", "session-legacy.json"), "{ invalid session json", "utf8");

    const loaded = new JsonFileRuntimePersistenceBackend(dir).load();

    expect(loaded.runs.map((run) => run.runId)).toEqual(["run-1"]);
    expect(loaded.sessions.map((session) => session.sessionId)).toEqual(["session-ledger"]);
  });

  it("ignores legacy SQLite run/session tables during clean ledger cutover load", () => {
    const dir = freshDir("ora-sqlite-ledger-clean-cutover-");
    const dbPath = path.join(dir, "runtime.db");
    const backend = new SqliteRuntimePersistence(dbPath);
    backend.appendSessionEntries("session-ledger", ledgerEntries(), "e-assistant");
    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS runs (
          runId TEXT PRIMARY KEY,
          sessionId TEXT,
          turnIndex INTEGER,
          status TEXT NOT NULL,
          pattern TEXT NOT NULL,
          data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          sessionId TEXT PRIMARY KEY,
          updatedAt INTEGER NOT NULL,
          data TEXT NOT NULL
        );
        INSERT OR REPLACE INTO runs (runId, sessionId, turnIndex, status, pattern, data)
          VALUES ('run-legacy', 'session-legacy', 1, 'succeeded', 'orchestrator_subagent', '{ invalid run json');
        INSERT OR REPLACE INTO sessions (sessionId, updatedAt, data)
          VALUES ('session-legacy', 1714000000000, '{ invalid session json');
      `);
    } finally {
      db.close();
    }

    const loaded = new SqliteRuntimePersistence(dbPath).load();

    expect(loaded.runs.map((run) => run.runId)).toEqual(["run-1"]);
    expect(loaded.sessions.map((session) => session.sessionId)).toEqual(["session-ledger"]);
  });
});
