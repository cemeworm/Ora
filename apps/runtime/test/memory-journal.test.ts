import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ShortTermSignalTypeSchema } from "@cemeworm/shared";
import { ShortTermMemoryJournal } from "../src/memory-journal.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("ShortTermMemoryJournal", () => {
  let dir: string;
  let journal: ShortTermMemoryJournal;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-journal-test-"));
    journal = new ShortTermMemoryJournal(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("appends signals and reads them back", () => {
    journal.append({
      runId: "run_1",
      type: "memory_intent",
      content: "User asked Ora to remember pnpm preference.",
      confidence: 0.85,
    });

    expect(journal.count()).toBe(1);

    const signals = journal.readRecent();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.runId).toBe("run_1");
    expect(signals[0]?.type).toBe("memory_intent");
    expect(signals[0]?.content).toContain("pnpm");
  });

  it("is idempotent per run and event type with same content", () => {
    journal.append({
      runId: "run_1",
      type: "correction",
      content: "Use pnpm not npm.",
    });

    journal.append({
      runId: "run_1",
      type: "correction",
      content: "Use pnpm not npm.",
    });

    expect(journal.count()).toBe(1);
  });

  it("filters signals by run", () => {
    journal.append({ runId: "run_a", type: "memory_intent", content: "Signal A." });
    journal.append({ runId: "run_b", type: "correction", content: "Signal B." });

    expect(journal.readByRun("run_a")).toHaveLength(1);
    expect(journal.readByRun("run_b")).toHaveLength(1);
    expect(journal.readByRun("run_c")).toHaveLength(0);
  });

  it("filters signals by session", () => {
    journal.append({ runId: "r1", sessionId: "s1", type: "memory_intent", content: "A." });
    journal.append({ runId: "r2", sessionId: "s2", type: "memory_intent", content: "B." });

    expect(journal.readBySession("s1")).toHaveLength(1);
    expect(journal.readBySession("s3")).toHaveLength(0);
  });

  it("filters signals by type", () => {
    journal.append({ runId: "r1", type: "memory_intent", content: "Intent." });
    journal.append({ runId: "r2", type: "correction", content: "Correction." });
    journal.append({ runId: "r3", type: "correction", content: "Another correction." });

    expect(journal.readByType("correction")).toHaveLength(2);
    expect(journal.readByType("memory_intent")).toHaveLength(1);
    expect(journal.readByType("recall_hit")).toHaveLength(0);
  });

  it("clears all signals", () => {
    journal.append({ runId: "r1", type: "memory_intent", content: "Test." });
    expect(journal.count()).toBe(1);

    journal.clear();
    expect(journal.count()).toBe(0);
  });

  it("redacts credentials in signal content", () => {
    journal.append({
      runId: "r1",
      type: "session_excerpt",
      content: "User said: api_key=sk-abc123secret and password=myPass123 is my config.",
    });

    const signals = journal.readRecent();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.redacted).toBe(true);
    expect(signals[0]?.content).not.toContain("sk-abc123secret");
    expect(signals[0]?.content).toContain("[REDACTED]");
  });

  it("redacts uploaded file tags", () => {
    journal.append({
      runId: "r1",
      type: "session_excerpt",
      content: "Context: <uploaded_files>secret-file.pdf content here</uploaded_files> more text.",
    });

    const signals = journal.readRecent();
    expect(signals[0]?.redacted).toBe(true);
    expect(signals[0]?.content).toContain("[REDACTED]");
  });

  it("supports project-scoped journal", () => {
    const projectJournal = new ShortTermMemoryJournal(dir, "project-abc");
    projectJournal.append({ runId: "r1", type: "memory_intent", content: "Project signal." });

    expect(projectJournal.count()).toBe(1);
    expect(journal.count()).toBe(0); // Global journal unaffected
  });

  it("stores metadata alongside signal", () => {
    journal.append({
      runId: "r1",
      type: "selected_card",
      content: "Card fact_ts was selected.",
      metadata: { cardId: "fact_ts", score: 0.92 },
      sourcePointers: ["fact_ts"],
    });

    const signals = journal.readRecent();
    expect(signals[0]?.metadata).toEqual({ cardId: "fact_ts", score: 0.92 });
    expect(signals[0]?.sourcePointers).toEqual(["fact_ts"]);
  });
});
