import type { OraRunEventStream } from "./runtimeClient";

export interface BatchedStream {
  stream: OraRunEventStream;
  receivedAt: number;
}

export function isLiveDeltaOnlyStream(stream: OraRunEventStream): boolean {
  return (
    !stream.snapshot &&
    stream.events.length > 0 &&
    stream.events.every(
      (event) => event.type === "message.delta" || event.type === "token.delta",
    )
  );
}

export function coalesceLiveDeltaStreams(
  entries: BatchedStream[],
): BatchedStream[] {
  const result: BatchedStream[] = [];
  const liveDeltaByRun = new Map<string, BatchedStream[]>();

  for (const entry of entries) {
    if (isLiveDeltaOnlyStream(entry.stream)) {
      const group = liveDeltaByRun.get(entry.stream.runId);
      if (group) {
        group.push(entry);
      } else {
        liveDeltaByRun.set(entry.stream.runId, [entry]);
      }
    } else {
      result.push(entry);
    }
  }

  for (const [, deltas] of liveDeltaByRun) {
    if (deltas.length === 1) {
      result.push(deltas[0]!);
    } else {
      result.push(mergeLiveDeltaBatch(deltas));
    }
  }

  return result;
}

function mergeLiveDeltaBatch(entries: BatchedStream[]): BatchedStream {
  const first = entries[0]!;
  const allEvents = entries.flatMap((e) => e.stream.events);
  const seenSeqs = new Set<number>();
  const mergedEvents = allEvents
    .filter((e) => {
      if (seenSeqs.has(e.seq)) return false;
      seenSeqs.add(e.seq);
      return true;
    })
    .sort((a, b) => a.seq - b.seq);

  return {
    stream: {
      runId: first.stream.runId,
      sessionId: first.stream.sessionId,
      prompt: first.stream.prompt,
      fromSeq: Math.min(...entries.map((e) => e.stream.fromSeq)),
      nextSeq: Math.max(...entries.map((e) => e.stream.nextSeq)),
      events: mergedEvents,
      status: entries.at(-1)!.stream.status,
    },
    receivedAt: first.receivedAt,
  };
}
