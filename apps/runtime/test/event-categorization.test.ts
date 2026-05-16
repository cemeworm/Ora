import { describe, expect, it } from "vitest";
import type { OraEventEnvelope } from "@cemeworm/shared";
import {
  isPassiveAccumulationEvent,
  isPureDeltaEvent,
  noProjectionEventTypes,
} from "../src/run-streaming.js";

function event(type: string): OraEventEnvelope {
  return {
    runId: "test-run",
    sessionId: "test-session",
    seq: 0,
    createdAt: 0,
    type,
    payload: {},
  } as unknown as OraEventEnvelope;
}

describe("isPureDeltaEvent", () => {
  it("returns true for message.delta", () => {
    expect(isPureDeltaEvent(event("message.delta"))).toBe(true);
  });

  it("returns true for token.delta", () => {
    expect(isPureDeltaEvent(event("token.delta"))).toBe(true);
  });

  it("returns false for node.updated", () => {
    expect(isPureDeltaEvent(event("node.updated"))).toBe(false);
  });

  it("returns false for agent.message", () => {
    expect(isPureDeltaEvent(event("agent.message"))).toBe(false);
  });
});

describe("isPassiveAccumulationEvent", () => {
  it("returns true for node.updated", () => {
    expect(isPassiveAccumulationEvent(event("node.updated"))).toBe(true);
  });

  it("returns true for context.usage.updated", () => {
    expect(isPassiveAccumulationEvent(event("context.usage.updated"))).toBe(true);
  });

  it("returns true for agent.message", () => {
    expect(isPassiveAccumulationEvent(event("agent.message"))).toBe(true);
  });

  it("returns false for message.delta", () => {
    expect(isPassiveAccumulationEvent(event("message.delta"))).toBe(false);
  });

  it("returns false for action.updated", () => {
    expect(isPassiveAccumulationEvent(event("action.updated"))).toBe(false);
  });
});

describe("noProjectionEventTypes", () => {
  it("contains completion.updated", () => {
    expect(noProjectionEventTypes.has("completion.updated")).toBe(true);
  });

  it("contains all task.* event types", () => {
    for (const t of ["task.started", "task.progress", "task.completed", "task.failed"]) {
      expect(noProjectionEventTypes.has(t)).toBe(true);
    }
  });

  it("contains all recovery.* event types", () => {
    for (const t of ["recovery.detected", "recovery.retry_scheduled", "recovery.applied", "recovery.exhausted"]) {
      expect(noProjectionEventTypes.has(t)).toBe(true);
    }
  });

  it("contains tool.repaired", () => {
    expect(noProjectionEventTypes.has("tool.repaired")).toBe(true);
  });

  it("contains node.skipped", () => {
    expect(noProjectionEventTypes.has("node.skipped")).toBe(true);
  });

  it("contains memory.* event types", () => {
    for (const t of ["memory.updated", "memory.queued", "memory.flushed"]) {
      expect(noProjectionEventTypes.has(t)).toBe(true);
    }
  });

  it("contains message.published and message.routed", () => {
    expect(noProjectionEventTypes.has("message.published")).toBe(true);
    expect(noProjectionEventTypes.has("message.routed")).toBe(true);
  });

  it("contains worker.* event types", () => {
    expect(noProjectionEventTypes.has("worker.claimed")).toBe(true);
    expect(noProjectionEventTypes.has("worker.released")).toBe(true);
  });

  it("contains agent.started and agent.completed", () => {
    expect(noProjectionEventTypes.has("agent.started")).toBe(true);
    expect(noProjectionEventTypes.has("agent.completed")).toBe(true);
  });

  it("contains profile.updated", () => {
    expect(noProjectionEventTypes.has("profile.updated")).toBe(true);
  });

  it("contains context.compaction.* event types", () => {
    expect(noProjectionEventTypes.has("context.compaction.completed")).toBe(true);
    expect(noProjectionEventTypes.has("context.compaction.skipped")).toBe(true);
  });

  it("has exactly 23 entries", () => {
    expect(noProjectionEventTypes.size).toBe(23);
  });
});

describe("event tier exclusivity", () => {
  it("pure delta events are not in passive accumulation", () => {
    const pureDeltaTypes = ["message.delta", "token.delta"];
    for (const t of pureDeltaTypes) {
      expect(isPassiveAccumulationEvent(event(t))).toBe(false);
    }
  });

  it("noProjectionEventTypes do not overlap with pure delta", () => {
    for (const t of noProjectionEventTypes) {
      expect(isPureDeltaEvent(event(t))).toBe(false);
    }
  });

  it("noProjectionEventTypes do not overlap with passive accumulation", () => {
    for (const t of noProjectionEventTypes) {
      expect(isPassiveAccumulationEvent(event(t))).toBe(false);
    }
  });
});
