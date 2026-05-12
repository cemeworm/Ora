import {
  RuntimeSessionEntrySchema,
  RuntimeMaintenanceParamsSchema,
  RuntimeMaintenanceResultSchema,
  StateSnapshotSchema,
  deriveRunSnapshot,
  deriveSessionProjection,
  type OraEventEnvelope,
  type RuntimeMaintenanceParams,
  type RuntimeMaintenanceResult,
  type StateSnapshot,
} from "@cemeworm/shared";
import type { RuntimePersistenceBackend } from "./persistence/types.js";

export interface RuntimeMaintenanceDeps {
  runs: Map<string, StateSnapshot>;
  backend: RuntimePersistenceBackend;
  now: () => number;
}

export function compactStreamingDeltaPayloads(
  snapshot: StateSnapshot,
): {
  snapshot: StateSnapshot;
  changed: boolean;
  messageDeltaEventsCompacted: number;
  rawPayloadsRemoved: number;
  bytesBefore: number;
  bytesAfter: number;
} {
  let changed = false;
  let messageDeltaEventsCompacted = 0;
  let rawPayloadsRemoved = 0;
  const bytesBefore = Buffer.byteLength(JSON.stringify(snapshot));
  const events = snapshot.events.map((event) => {
    if (
      event.type !== "message.delta" &&
      event.type !== "token.delta"
    ) {
      return event;
    }
    if (!isRecord(event.payload)) {
      return event;
    }

    const payload = { ...event.payload };
    if ("raw" in payload) {
      delete payload.raw;
      rawPayloadsRemoved += 1;
      changed = true;
    }

    if (
      event.type === "message.delta" &&
      typeof payload.delta === "string" &&
      typeof payload.content === "string" &&
      payload.content !== payload.delta
    ) {
      payload.content = payload.delta;
      messageDeltaEventsCompacted += 1;
      changed = true;
    }

    return changedEvent(event, payload);
  });

  if (!changed) {
    return {
      snapshot,
      changed: false,
      messageDeltaEventsCompacted,
      rawPayloadsRemoved,
      bytesBefore,
      bytesAfter: bytesBefore,
    };
  }

  const compacted = StateSnapshotSchema.parse({
    ...snapshot,
    events,
  });
  const bytesAfter = Buffer.byteLength(JSON.stringify(compacted));
  return {
    snapshot: compacted,
    changed: true,
    messageDeltaEventsCompacted,
    rawPayloadsRemoved,
    bytesBefore,
    bytesAfter,
  };
}

export function runRuntimeMaintenance(
  params: unknown,
  deps: RuntimeMaintenanceDeps,
): RuntimeMaintenanceResult {
  const parsed: RuntimeMaintenanceParams = RuntimeMaintenanceParamsSchema.parse(params ?? {});
  let runsScanned = 0;
  let runsCompacted = 0;
  let staleRunsFailed = 0;
  let sessionsArchived = 0;
  let messageDeltaEventsCompacted = 0;
  let rawPayloadsRemoved = 0;
  let estimatedSnapshotBytesBefore = 0;
  let estimatedSnapshotBytesAfter = 0;

  if (parsed.compactStreamingEvents) {
    for (const [runId, snapshot] of deps.runs.entries()) {
      runsScanned += 1;
      const compacted = compactStreamingDeltaPayloads(snapshot);
      if (!compacted.changed) {
        continue;
      }
      runsCompacted += 1;
      messageDeltaEventsCompacted += compacted.messageDeltaEventsCompacted;
      rawPayloadsRemoved += compacted.rawPayloadsRemoved;
      estimatedSnapshotBytesBefore += compacted.bytesBefore;
      estimatedSnapshotBytesAfter += compacted.bytesAfter;
      deps.runs.set(runId, compacted.snapshot);
    }
  }

  if (parsed.staleRunningMs > 0) {
    const failedRunIds = new Set<string>();
    for (const ledger of deps.backend.listSessionLedgers()) {
      let currentLedger = ledger;
      const projection = deriveSessionProjection(currentLedger);
      for (const run of projection.runs) {
        if (run.status !== "queued" && run.status !== "running") {
          continue;
        }
        const now = deps.now();
        if (now - run.updatedAt < parsed.staleRunningMs) {
          continue;
        }
        const nextEventSeq = run.events.reduce((max, event) => Math.max(max, event.seq), -1) + 1;
        const nextEntrySeq = currentLedger.entries.reduce((max, entry) => Math.max(max, entry.seq), -1) + 1;
        const error = `Run marked failed by runtime maintenance after ${parsed.staleRunningMs}ms without progress.`;
        const event = {
          id: `${run.runId}:evt-${nextEventSeq}`,
          runId: run.runId,
          seq: nextEventSeq,
          type: "run.failed" as const,
          createdAt: now,
          pattern: run.pattern,
          payload: { status: "failed", error },
        };
        const entry = RuntimeSessionEntrySchema.parse({
          id: `${run.runId}:stale-failed-${now}`,
          sessionId: currentLedger.sessionId,
          parentId: currentLedger.leafEntryId,
          runId: run.runId,
          turnIndex: run.turnIndex,
          seq: nextEntrySeq,
          type: "runtime.event_batch",
          createdAt: now,
          payload: {
            events: [event],
            eventCount: 1,
            status: "failed",
            error,
          },
        });
        const nextLedger = deps.backend.appendSessionEntries(currentLedger.sessionId, [entry], entry.id);
        currentLedger = nextLedger;
        const nextSnapshot = deriveRunSnapshot(nextLedger, run.runId);
        if (nextSnapshot) {
          deps.runs.set(run.runId, nextSnapshot);
        }
        failedRunIds.add(run.runId);
      }
    }
    staleRunsFailed = failedRunIds.size;
  }

  if (parsed.autoArchiveThresholdMs > 0) {
    for (const ledger of deps.backend.listSessionLedgers()) {
      const projection = deriveSessionProjection(ledger);
      const session = projection.session;
      if (session.archivedAt) continue;
      if (deps.now() - session.updatedAt < parsed.autoArchiveThresholdMs) continue;
      const now = deps.now();
      const entry = RuntimeSessionEntrySchema.parse({
        id: `${session.sessionId}:archive-${now}`,
        sessionId: session.sessionId,
        parentId: ledger.leafEntryId,
        turnIndex: 0,
        seq: (ledger.entries.at(-1)?.seq ?? -1) + 1,
        type: "session.info",
        createdAt: now,
        payload: {
          title: session.title,
          projectId: session.projectId,
          archivedAt: now,
        },
      });
      deps.backend.appendSessionEntries(session.sessionId, [entry], entry.id);
      sessionsArchived += 1;
    }
  }

  const storage = parsed.vacuum ? deps.backend.optimizeStorage() : undefined;
  return RuntimeMaintenanceResultSchema.parse({
    compactStreamingEvents: parsed.compactStreamingEvents,
    vacuum: parsed.vacuum,
    staleRunningMs: parsed.staleRunningMs,
    autoArchiveThresholdMs: parsed.autoArchiveThresholdMs,
    runsScanned,
    runsCompacted,
    staleRunsFailed,
    sessionsArchived,
    messageDeltaEventsCompacted,
    rawPayloadsRemoved,
    estimatedSnapshotBytesBefore,
    estimatedSnapshotBytesAfter,
    storage,
  });
}

function changedEvent(event: OraEventEnvelope, payload: Record<string, unknown>): OraEventEnvelope {
  return {
    ...event,
    payload,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
