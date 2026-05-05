import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalRunStore } from "../src/run-store.js";
import { previewAutomationSchedule } from "../src/automation-schedule.js";
import { AutomationService } from "../src/automation-service.js";

let tempDir: string;
let now = 1_700_000_000_000;

beforeEach(() => {
  now = 1_700_000_000_000;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-automations-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function createStore(): LocalRunStore {
  return new LocalRunStore({ dataDir: tempDir, clock: () => now });
}

describe("automation scheduling", () => {
  it("previews RRULE schedules for supported presets", () => {
    const start = new Date("2026-05-05T08:55:00").getTime();
    const occurrences = previewAutomationSchedule({
      kind: "rrule",
      rrule: "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0",
      timezone: "UTC",
    }, start, 2);

    expect(occurrences.map((item) => new Date(item).getHours())).toEqual([9, 9]);
    expect(occurrences).toHaveLength(2);
  });

  it("creates, runs, and persists a dedicated automation session", async () => {
    const store = createStore();
    const automation = store.createAutomation({
      title: "Daily review",
      prompt: "Summarize project status.",
      schedule: {
        kind: "rrule",
        rrule: "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0",
        timezone: "UTC",
      },
      status: "active",
      modeSelection: "manual",
      taskIntent: "plan",
      skillIds: [],
      toolIds: [],
      runConfig: {},
    });

    const record = await store.runAutomationNow({ id: automation.id });
    expect(record.status).toBe("succeeded");
    expect(record.sessionId).toMatch(/^session-/);

    const updated = store.getAutomation({ id: automation.id });
    expect(updated.state.dedicatedSessionId).toBe(record.sessionId);
    expect(updated.state.lastRunStatus).toBe("succeeded");
    expect(updated.state.runHistory).toHaveLength(1);

    const reloaded = createStore();
    expect(reloaded.getAutomation({ id: automation.id }).state.dedicatedSessionId).toBe(record.sessionId);
  });

  it("rejects duplicate run and delete requests while an automation is running", async () => {
    const service = new AutomationService({
      rootDir: path.join(tempDir, "automation-service"),
      clock: () => now,
      runTimeoutMs: 10,
      createSession: () => ({
        sessionId: "session-test",
        title: "Automation test",
        turnCount: 0,
        createdAt: now,
        updatedAt: now,
      }),
      startStreamingRun: async () => ({
        runId: "run-test",
        sessionId: "session-test",
        status: "running",
        pattern: "single-agent",
        startedAt: now,
      }),
      listProjects: () => [],
      agentExists: () => true,
    });
    const automation = service.create({
      title: "Slow automation",
      prompt: "Wait for a long-running task.",
      schedule: {
        kind: "rrule",
        rrule: "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0",
        timezone: "UTC",
      },
      status: "active",
      modeSelection: "manual",
      taskIntent: "implement",
      skillIds: [],
      toolIds: [],
      runConfig: {},
    });

    const pendingRun = service.runNow({ id: automation.id });

    await expect(service.runNow({ id: automation.id })).rejects.toThrow("already running");
    expect(() => service.delete({ id: automation.id })).toThrow("currently running");
    await expect(pendingRun).resolves.toMatchObject({ status: "failed" });
  });
});
