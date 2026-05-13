import { describe, expect, it } from "vitest";
import { coalesceLiveDeltaStreams } from "./streamCoalesce";
import type { OraRunEventStream, OraStateSnapshot } from "./runtimeClient";

function makeLiveDelta(
  runId: string,
  seq: number,
  content: string,
): { stream: OraRunEventStream; receivedAt: number } {
  return {
    stream: {
      runId,
      sessionId: "session-1",
      prompt: "test",
      fromSeq: seq,
      nextSeq: seq + 1,
      events: [
        {
          id: `evt-${seq}`,
          runId,
          seq,
          type: "message.delta" as const,
          createdAt: 1000 + seq,
          pattern: "orchestrator_subagent" as const,
          payload: { role: "assistant", messageId: "msg-1", content, delta: content, streaming: true },
        },
      ],
      status: "running",
      snapshot: undefined,
    },
    receivedAt: 1000 + seq,
  };
}

function makeNonDelta(
  runId: string,
  seq: number,
): { stream: OraRunEventStream; receivedAt: number } {
  return {
    stream: {
      runId,
      sessionId: "session-1",
      fromSeq: seq,
      nextSeq: seq + 1,
      events: [
        {
          id: `evt-${seq}`,
          runId,
          seq,
          type: "plan.updated" as const,
          createdAt: 1000 + seq,
          pattern: "orchestrator_subagent" as const,
          payload: { items: [] },
        },
      ],
      status: "running",
      snapshot: undefined,
    },
    receivedAt: 1000 + seq,
  };
}

describe("coalesceLiveDeltaStreams", () => {
  it("coalesces same-run live deltas into one entry", () => {
    const entries = [
      makeLiveDelta("run-A", 1, "hello"),
      makeLiveDelta("run-A", 2, "world"),
    ];
    const result = coalesceLiveDeltaStreams(entries);
    expect(result).toHaveLength(1);
    expect(result[0]!.stream.events).toHaveLength(2);
    expect(result[0]!.stream.fromSeq).toBe(1);
    expect(result[0]!.stream.nextSeq).toBe(3);
  });

  it("does not merge deltas from different runs", () => {
    const entries = [
      makeLiveDelta("run-A", 1, "a"),
      makeLiveDelta("run-B", 2, "b"),
    ];
    const result = coalesceLiveDeltaStreams(entries);
    expect(result).toHaveLength(2);
  });

  it("does not merge non-delta streams", () => {
    const entries = [
      makeNonDelta("run-A", 1),
      makeNonDelta("run-A", 2),
    ];
    const result = coalesceLiveDeltaStreams(entries);
    expect(result).toHaveLength(2);
  });

  it("deduplicates by seq", () => {
    const entries = [
      makeLiveDelta("run-A", 1, "hello"),
      makeLiveDelta("run-A", 1, "hello"),
      makeLiveDelta("run-A", 2, "world"),
    ];
    const result = coalesceLiveDeltaStreams(entries);
    expect(result).toHaveLength(1);
    expect(result[0]!.stream.events).toHaveLength(2);
  });

  it("keeps seq order after merge", () => {
    const entries = [
      makeLiveDelta("run-A", 3, "c"),
      makeLiveDelta("run-A", 1, "a"),
      makeLiveDelta("run-A", 2, "b"),
    ];
    const result = coalesceLiveDeltaStreams(entries);
    expect(result).toHaveLength(1);
    const seqs = result[0]!.stream.events.map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it("mixes delta and non-delta correctly", () => {
    const entries = [
      makeLiveDelta("run-A", 1, "a"),
      makeLiveDelta("run-A", 2, "b"),
      makeNonDelta("run-A", 3),
      makeLiveDelta("run-A", 4, "c"),
    ];
    const result = coalesceLiveDeltaStreams(entries);
    // 1 non-delta + (3 deltas merged) = 2
    expect(result).toHaveLength(2);
    const deltaEntry = result.find((e) => e.stream.events[0]?.type === "message.delta");
    expect(deltaEntry?.stream.events).toHaveLength(3);
  });

  it("returns empty for empty input", () => {
    expect(coalesceLiveDeltaStreams([])).toEqual([]);
  });

  it("merges status from last entry in batch", () => {
    const entries = [
      makeLiveDelta("run-A", 1, "a"),
      makeLiveDelta("run-A", 2, "b"),
    ];
    (entries[1]!.stream as any).status = "succeeded";
    const result = coalesceLiveDeltaStreams(entries);
    expect(result[0]!.stream.status).toBe("succeeded");
  });
});
