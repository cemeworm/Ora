import {
  RuntimeMaintenanceParamsSchema,
  RuntimeMaintenanceResultSchema,
  StateSnapshotSchema,
  type OraEventEnvelope,
  type RuntimeMaintenanceParams,
  type RuntimeMaintenanceResult,
  type StateSnapshot,
} from "@cemeworm/shared";
import type { RuntimePersistenceBackend } from "./persistence/types.js";

export interface RuntimeMaintenanceDeps {
  runs: Map<string, StateSnapshot>;
  backend: RuntimePersistenceBackend;
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
      deps.backend.saveRun(compacted.snapshot);
    }
  }

  const storage = parsed.vacuum ? deps.backend.optimizeStorage() : undefined;
  return RuntimeMaintenanceResultSchema.parse({
    compactStreamingEvents: parsed.compactStreamingEvents,
    vacuum: parsed.vacuum,
    runsScanned,
    runsCompacted,
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
