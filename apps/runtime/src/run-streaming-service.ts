import type {
  OraEventEnvelope,
  RunEventStream,
  StateSnapshot,
} from "@cemeworm/shared";
import {
  applyStreamingRunEvent,
  publishRunStream,
  shouldFlushStreamingEvent,
} from "./run-streaming.js";

const MAX_UNLEDGERED_DELTA_EVENTS = 256;

export interface RunStreamingServiceDeps {
  cacheRun: (snapshot: StateSnapshot, flush: boolean) => void;
  appendRuntimeEventBatchToLedger: (
    snapshot: StateSnapshot,
    events: OraEventEnvelope[],
    status?: StateSnapshot["status"],
  ) => StateSnapshot;
  cacheRunDelta?: (snapshot: StateSnapshot) => void;
}

export interface RunStreamingSessionParams {
  runId: string;
  liveSnapshot: StateSnapshot;
  ledgeredEventCount: number;
  onStream?: (stream: RunEventStream) => void;
  applyEvent?: (snapshot: StateSnapshot, event: OraEventEnvelope) => StateSnapshot;
  shouldIgnoreEvent?: () => boolean;
  /** Low-intrusion latency probe: called with timing records when enabled. */
  debugLatency?: (record: { label: string; elapsedMs: number }) => void;
}

export class RunStreamingService {
  private readonly activeAbortControllers = new Map<string, AbortController>();

  constructor(private readonly deps: RunStreamingServiceDeps) {}

  createSession(params: RunStreamingSessionParams): RunStreamingSession {
    return new RunStreamingSession(params, this.deps);
  }

  createAbortController(runId: string): AbortController {
    const abortController = new AbortController();
    this.activeAbortControllers.set(runId, abortController);
    return abortController;
  }

  deleteAbortController(runId: string): void {
    this.activeAbortControllers.delete(runId);
  }

  abort(runId: string, reason?: string): void {
    this.activeAbortControllers.get(runId)?.abort(reason);
    this.activeAbortControllers.delete(runId);
  }
}

export class RunStreamingSession {
  private liveSnapshotValue: StateSnapshot;
  private ledgeredEventCount: number;

  constructor(
    private readonly params: RunStreamingSessionParams,
    private readonly deps: RunStreamingServiceDeps,
  ) {
    this.liveSnapshotValue = params.liveSnapshot;
    this.ledgeredEventCount = params.ledgeredEventCount;
  }

  get liveSnapshot(): StateSnapshot {
    return this.liveSnapshotValue;
  }

  replaceSnapshot(snapshot: StateSnapshot): StateSnapshot {
    this.liveSnapshotValue = snapshot;
    return this.liveSnapshotValue;
  }

  publish(events: OraEventEnvelope[], snapshot?: StateSnapshot): void {
    publishRunStream({
      onStream: this.params.onStream,
      runId: this.params.runId,
      events,
      liveSnapshot: this.liveSnapshotValue,
      snapshot,
    });
  }

  flushLedgerEvents(status = this.liveSnapshotValue.status): StateSnapshot {
    const nextEvents = this.liveSnapshotValue.events.slice(this.ledgeredEventCount);
    if (nextEvents.length === 0) {
      return this.liveSnapshotValue;
    }
    this.liveSnapshotValue = this.deps.appendRuntimeEventBatchToLedger(
      this.liveSnapshotValue,
      nextEvents,
      status,
    );
    this.ledgeredEventCount = this.liveSnapshotValue.events.length;
    return this.liveSnapshotValue;
  }

  markLedgerSynced(): void {
    this.ledgeredEventCount = this.liveSnapshotValue.events.length;
  }

  applyLiveEvent(event: OraEventEnvelope): StateSnapshot | undefined {
    if (this.params.shouldIgnoreEvent?.()) {
      return undefined;
    }
    const applyEvent = this.params.applyEvent ?? applyStreamingRunEvent;
    this.liveSnapshotValue = applyEvent(this.liveSnapshotValue, event);
    this.publishAndMaybeFlush(event);
    return this.liveSnapshotValue;
  }

  acceptSnapshotForEvent(event: OraEventEnvelope, snapshot: StateSnapshot): StateSnapshot | undefined {
    if (this.params.shouldIgnoreEvent?.()) {
      return undefined;
    }
    this.liveSnapshotValue = snapshot;
    this.publishAndMaybeFlush(event);
    return this.liveSnapshotValue;
  }

  private publishAndMaybeFlush(event: OraEventEnvelope): void {
    const shouldFlush = shouldFlushStreamingEvent(event);
    const debugLatency = this.params.debugLatency;
    if (isPureDeltaEvent(event)) {
      // Pure delta: publish first so visible stream does not wait for cache/flush.
      const publishStart = debugLatency ? Date.now() : 0;
      this.publish([event]);
      if (debugLatency) {
        debugLatency({ label: "publish", elapsedMs: Date.now() - publishStart });
      }
      if (!shouldFlush && this.deps.cacheRunDelta) {
        this.deps.cacheRunDelta(this.liveSnapshotValue);
      } else {
        this.deps.cacheRun(this.liveSnapshotValue, shouldFlush);
      }
      if (
        shouldFlush ||
        this.liveSnapshotValue.events.length - this.ledgeredEventCount >= MAX_UNLEDGERED_DELTA_EVENTS
      ) {
        const flushStart = debugLatency ? Date.now() : 0;
        this.flushLedgerEvents();
        if (debugLatency) {
          debugLatency({ label: "flush", elapsedMs: Date.now() - flushStart });
        }
      }
    } else if (isPassiveAccumulationEvent(event)) {
      // Passive accumulation (node.updated, context.usage.updated):
      // publish immediately, lightweight cache, defer ledger flush.
      const publishStart = debugLatency ? Date.now() : 0;
      this.publish([event]);
      if (debugLatency) {
        debugLatency({ label: "publish", elapsedMs: Date.now() - publishStart });
      }
      this.deps.cacheRunDelta?.(this.liveSnapshotValue)
        ?? this.deps.cacheRun(this.liveSnapshotValue, false);
      if (this.liveSnapshotValue.events.length - this.ledgeredEventCount >= 64) {
        const flushStart = debugLatency ? Date.now() : 0;
        this.flushLedgerEvents();
        if (debugLatency) {
          debugLatency({ label: "flush", elapsedMs: Date.now() - flushStart });
        }
      }
    } else {
      // Durable projection: cache and flush before publish so UI sees consistent snapshot.
      this.deps.cacheRun(this.liveSnapshotValue, shouldFlush);
      if (shouldFlush) {
        const flushStart = debugLatency ? Date.now() : 0;
        this.flushLedgerEvents();
        if (debugLatency) {
          debugLatency({ label: "flush", elapsedMs: Date.now() - flushStart });
        }
      }
      const publishStart = debugLatency ? Date.now() : 0;
      this.publish([event]);
      if (debugLatency) {
        debugLatency({ label: "publish", elapsedMs: Date.now() - publishStart });
      }
    }
  }
}

function isPureDeltaEvent(event: OraEventEnvelope): boolean {
  return event.type === "message.delta" || event.type === "token.delta";
}

function isPassiveAccumulationEvent(event: OraEventEnvelope): boolean {
  return event.type === "node.updated" || event.type === "context.usage.updated" || event.type === "agent.message";
}
