import type { RuntimeToolCall } from "./runtime-tool-executor.js";

export type RuntimeSearchSuppressionScope = "run" | "node";

export const RUNTIME_SEARCH_SUPPRESSION_THRESHOLDS = {
  node: 3,
  run: 5,
} as const;

export interface RuntimeSearchSuppressionState {
  readonly runId: string;
  readonly nodeFailures: Map<string, number>;
  readonly runFailures: Map<string, number>;
  readonly suppressedQueries: Set<string>;
}

export interface RuntimeSearchSuppressionSnapshot {
  readonly runId: string;
  readonly nodeFailures: Array<[string, number]>;
  readonly runFailures: Array<[string, number]>;
  readonly suppressedQueries: string[];
}

export function createRuntimeSearchSuppressionState(runId: string): RuntimeSearchSuppressionState {
  return {
    runId,
    nodeFailures: new Map(),
    runFailures: new Map(),
    suppressedQueries: new Set(),
  };
}

export function serializeRuntimeSearchSuppressionState(state: RuntimeSearchSuppressionState): RuntimeSearchSuppressionSnapshot {
  return {
    runId: state.runId,
    nodeFailures: [...state.nodeFailures.entries()],
    runFailures: [...state.runFailures.entries()],
    suppressedQueries: [...state.suppressedQueries.values()],
  };
}

export function restoreRuntimeSearchSuppressionState(
  state: RuntimeSearchSuppressionState,
  snapshot: unknown,
): boolean {
  const parsed = parseRuntimeSearchSuppressionSnapshot(snapshot);
  if (!parsed || parsed.runId !== state.runId) {
    return false;
  }
  state.nodeFailures.clear();
  state.runFailures.clear();
  state.suppressedQueries.clear();
  for (const [fingerprint, count] of parsed.nodeFailures) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      state.nodeFailures.set(fingerprint, Math.floor(count));
    }
  }
  for (const [fingerprint, count] of parsed.runFailures) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      state.runFailures.set(fingerprint, Math.floor(count));
    }
  }
  for (const fingerprint of parsed.suppressedQueries) {
    if (typeof fingerprint === "string" && fingerprint.length > 0) {
      state.suppressedQueries.add(fingerprint);
    }
  }
  return true;
}

export function normalizeRuntimeSearchFingerprint(call: Pick<RuntimeToolCall, "args">): string | undefined {
  const query = typeof call.args.query === "string" ? call.args.query.trim().replace(/\s+/g, " ").toLowerCase() : "";
  const limit = normalizePositiveInt(call.args.limit);
  return query ? `web.search:${query}:${limit ?? "default"}` : undefined;
}

export function recordRuntimeSearchFailure(state: RuntimeSearchSuppressionState, fingerprint: string, scope: RuntimeSearchSuppressionScope): number {
  const target = scope === "node" ? state.nodeFailures : state.runFailures;
  const next = (target.get(fingerprint) ?? 0) + 1;
  target.set(fingerprint, next);
  if (shouldSuppressRuntimeSearchFailure(scope, next)) {
    state.suppressedQueries.add(fingerprint);
  }
  return next;
}

export function isRuntimeSearchSuppressed(state: RuntimeSearchSuppressionState, fingerprint: string): boolean {
  return state.suppressedQueries.has(fingerprint);
}

export function runtimeSearchSuppressionBlockReason(
  state: RuntimeSearchSuppressionState | undefined,
  call: Pick<RuntimeToolCall, "args">,
): string | undefined {
  if (!state) {
    return undefined;
  }
  const fingerprint = normalizeRuntimeSearchFingerprint(call);
  if (!fingerprint || !isRuntimeSearchSuppressed(state, fingerprint)) {
    return undefined;
  }
  return "web.search is temporarily suppressed after repeated remote search failures.";
}

function normalizePositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function shouldSuppressRuntimeSearchFailure(scope: RuntimeSearchSuppressionScope, count: number): boolean {
  return count >= RUNTIME_SEARCH_SUPPRESSION_THRESHOLDS[scope];
}

function parseRuntimeSearchSuppressionSnapshot(snapshot: unknown): RuntimeSearchSuppressionSnapshot | undefined {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return undefined;
  }
  const raw = snapshot as Partial<RuntimeSearchSuppressionSnapshot>;
  if (typeof raw.runId !== "string" || raw.runId.length === 0) {
    return undefined;
  }
  const nodeFailures = Array.isArray(raw.nodeFailures)
    ? raw.nodeFailures.filter((entry): entry is [string, number] =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "number"
    )
    : [];
  const runFailures = Array.isArray(raw.runFailures)
    ? raw.runFailures.filter((entry): entry is [string, number] =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "number"
    )
    : [];
  const suppressedQueries = Array.isArray(raw.suppressedQueries)
    ? raw.suppressedQueries.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
  return {
    runId: raw.runId,
    nodeFailures,
    runFailures,
    suppressedQueries,
  };
}
