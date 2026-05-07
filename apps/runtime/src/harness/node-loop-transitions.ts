import type { OraEventEnvelope } from "@cemeworm/shared";
import type { NodeRuntimeLoopState } from "./node-runtime-loop.js";

export interface NodeRuntimeTransition {
  from: NodeRuntimeLoopState;
  to: NodeRuntimeLoopState;
}

export type NodeLoopTransitionResultKind =
  | "model_request"
  | "model_response"
  | "tool_request"
  | "gate_required"
  | "tool_result"
  | "recovery_decision"
  | "boundary_failure"
  | "forced_final"
  | "complete"
  | "fail";

export type NodeLoopTransitionResult =
  | {
    kind: NodeLoopTransitionResultKind;
    transition: NodeRuntimeTransition;
    valid: true;
  }
  | {
    kind: NodeLoopTransitionResultKind;
    transition: NodeRuntimeTransition;
    valid: false;
    reason: "unknown_transition" | "mismatched_kind";
  };

export interface NodeLoopTransitionDiagnostic extends NodeRuntimeTransition {
  severity?: string;
  title?: string;
  actionId?: string;
  toolId?: string;
  iteration?: number;
}

export const CORE_NODE_RUNTIME_TRANSITIONS: readonly NodeRuntimeTransition[] = [
  { from: "pending", to: "running_model" },
  { from: "pending", to: "finalizing" },
  { from: "running_model", to: "running_model" },
  { from: "running_model", to: "tool_requested" },
  { from: "running_model", to: "completed" },
  { from: "tool_requested", to: "tool_running" },
  { from: "tool_requested", to: "finalizing" },
  { from: "tool_requested", to: "failed" },
  { from: "tool_requested", to: "interrupted" },
  { from: "tool_running", to: "tool_result_observed" },
  { from: "tool_running", to: "degraded" },
  { from: "tool_running", to: "interrupted" },
  { from: "tool_result_observed", to: "running_model" },
  { from: "tool_result_observed", to: "finalizing" },
  { from: "degraded", to: "pending" },
  { from: "degraded", to: "tool_requested" },
  { from: "degraded", to: "repairing" },
  { from: "repairing", to: "running_model" },
  { from: "repairing", to: "completed" },
  { from: "finalizing", to: "completed" },
  { from: "finalizing", to: "failed" },
  { from: "failed", to: "pending" },
  { from: "failed", to: "degraded" },
  { from: "failed", to: "finalizing" },
  { from: "failed", to: "failed" },
  { from: "interrupted", to: "interrupted" },
];

const NODE_LOOP_TRANSITION_KIND_PATHS: Record<NodeLoopTransitionResultKind, readonly NodeRuntimeTransition[]> = {
  model_request: [
    { from: "pending", to: "running_model" },
    { from: "running_model", to: "running_model" },
    { from: "tool_result_observed", to: "running_model" },
    { from: "repairing", to: "running_model" },
  ],
  model_response: [
    { from: "running_model", to: "running_model" },
    { from: "running_model", to: "tool_requested" },
    { from: "running_model", to: "completed" },
  ],
  tool_request: [
    { from: "tool_requested", to: "tool_running" },
  ],
  gate_required: [
    { from: "tool_requested", to: "finalizing" },
    { from: "tool_requested", to: "interrupted" },
    { from: "tool_running", to: "interrupted" },
    { from: "interrupted", to: "interrupted" },
  ],
  tool_result: [
    { from: "tool_running", to: "tool_result_observed" },
  ],
  recovery_decision: [
    { from: "tool_requested", to: "failed" },
    { from: "tool_running", to: "degraded" },
    { from: "degraded", to: "pending" },
    { from: "degraded", to: "tool_requested" },
    { from: "degraded", to: "repairing" },
    { from: "repairing", to: "running_model" },
    { from: "repairing", to: "completed" },
    { from: "failed", to: "pending" },
    { from: "failed", to: "degraded" },
    { from: "failed", to: "finalizing" },
    { from: "failed", to: "failed" },
  ],
  boundary_failure: [
    { from: "tool_requested", to: "finalizing" },
    { from: "tool_requested", to: "failed" },
  ],
  forced_final: [
    { from: "pending", to: "finalizing" },
    { from: "tool_requested", to: "finalizing" },
    { from: "tool_result_observed", to: "finalizing" },
    { from: "failed", to: "finalizing" },
  ],
  complete: [
    { from: "running_model", to: "completed" },
    { from: "repairing", to: "completed" },
    { from: "finalizing", to: "completed" },
  ],
  fail: [
    { from: "finalizing", to: "failed" },
  ],
};

const CORE_NODE_RUNTIME_TRANSITION_KEYS = new Set(
  CORE_NODE_RUNTIME_TRANSITIONS.map((transition) => transitionKey(transition)),
);

const NODE_LOOP_TRANSITION_KIND_KEYS = Object.fromEntries(
  Object.entries(NODE_LOOP_TRANSITION_KIND_PATHS).map(([kind, transitions]) => [
    kind,
    new Set(transitions.map((transition) => transitionKey(transition))),
  ]),
) as Record<NodeLoopTransitionResultKind, Set<string>>;

export function nodeLoopTransitionResult(
  kind: NodeLoopTransitionResultKind,
  transition: NodeRuntimeTransition,
): NodeLoopTransitionResult {
  const key = transitionKey(transition);
  if (!CORE_NODE_RUNTIME_TRANSITION_KEYS.has(key)) {
    return {
      kind,
      transition,
      valid: false,
      reason: "unknown_transition",
    };
  }
  if (!NODE_LOOP_TRANSITION_KIND_KEYS[kind].has(key)) {
    return {
      kind,
      transition,
      valid: false,
      reason: "mismatched_kind",
    };
  }
  return {
    kind,
    transition,
    valid: true,
  };
}

export function assertNodeLoopTransitionResult(
  kind: NodeLoopTransitionResultKind,
  transition: NodeRuntimeTransition,
): NodeLoopTransitionResult {
  const result = nodeLoopTransitionResult(kind, transition);
  if (!result.valid) {
    throw new Error(
      `Invalid node loop transition result (${kind}): ${transition.from} -> ${transition.to} (${result.reason})`,
    );
  }
  return result;
}

export interface NodeLoopStateEmitParams {
  agentId: string;
  title?: string;
  actionId?: string;
  reason?: string;
  detail?: string;
  toolId?: string;
  iteration?: number;
}

export type NodeLoopStateEmitter = (
  state: NodeRuntimeLoopState,
  params: NodeLoopStateEmitParams,
) => void;

export interface NodeLoopReduction {
  previousState?: NodeRuntimeLoopState;
  state: NodeRuntimeLoopState;
  transition?: NodeRuntimeTransition;
  invalidTransition?: NodeRuntimeTransition;
}

export type NodeLoopToolRequestedIntent =
  | "model_response"
  | "recovery_decision";

export interface NodeLoopToolRequestedDecision {
  state: Extract<NodeRuntimeLoopState, "tool_requested">;
  intent?: NodeLoopToolRequestedIntent;
}

export interface NodeLoopForcedFinalDecision {
  state: Extract<NodeRuntimeLoopState, "finalizing">;
  intent?: Extract<NodeLoopTransitionResultKind, "forced_final">;
}

export interface NodeLoopGateRequiredDecision {
  state: Extract<NodeRuntimeLoopState, "interrupted">;
  intent?: Extract<NodeLoopTransitionResultKind, "gate_required">;
}

export type NodeLoopRecoveryState = Extract<
  NodeRuntimeLoopState,
  "degraded" | "tool_requested" | "repairing"
>;

export interface NodeLoopRecoveryDecision {
  state: NodeLoopRecoveryState;
  intent?: Extract<NodeLoopTransitionResultKind, "recovery_decision">;
}

export type NodeLoopForcedFinalProviderState = Extract<NodeRuntimeLoopState, "completed" | "failed">;

export class NodeLoopReducer {
  private currentState?: NodeRuntimeLoopState;
  private readonly transitionsValue: NodeRuntimeTransition[] = [];
  private readonly invalidTransitionsValue: NodeRuntimeTransition[] = [];

  constructor(private readonly deps: {
    allowedTransitions?: readonly NodeRuntimeTransition[];
  } = {}) {
    const allowedTransitions = deps.allowedTransitions ?? CORE_NODE_RUNTIME_TRANSITIONS;
    this.allowedTransitionKeys = allowedTransitions
      ? new Set(allowedTransitions.map((transition) => transitionKey(transition)))
      : undefined;
  }

  private readonly allowedTransitionKeys?: Set<string>;

  get state(): NodeRuntimeLoopState | undefined {
    return this.currentState;
  }

  get transitions(): readonly NodeRuntimeTransition[] {
    return this.transitionsValue;
  }

  get invalidTransitions(): readonly NodeRuntimeTransition[] {
    return this.invalidTransitionsValue;
  }

  reduce(state: NodeRuntimeLoopState): NodeLoopReduction {
    const previousState = this.currentState;
    const transition = previousState ? { from: previousState, to: state } : undefined;
    const invalidTransition =
      transition && this.allowedTransitionKeys && !this.allowedTransitionKeys.has(transitionKey(transition))
        ? transition
        : undefined;
    return {
      previousState,
      state,
      transition,
      invalidTransition,
    };
  }

  decideToolRequested(): NodeLoopToolRequestedDecision {
    if (this.currentState === "running_model") {
      return {
        state: "tool_requested",
        intent: "model_response",
      };
    }
    if (this.currentState === "degraded") {
      return {
        state: "tool_requested",
        intent: "recovery_decision",
      };
    }
    return {
      state: "tool_requested",
    };
  }

  decideForcedFinal(): NodeLoopForcedFinalDecision {
    if (
      this.currentState === "pending" ||
      this.currentState === "tool_requested" ||
      this.currentState === "tool_result_observed" ||
      this.currentState === "failed"
    ) {
      return {
        state: "finalizing",
        intent: "forced_final",
      };
    }
    return {
      state: "finalizing",
    };
  }

  decideGateRequired(): NodeLoopGateRequiredDecision {
    if (
      this.currentState === "tool_requested" ||
      this.currentState === "tool_running" ||
      this.currentState === "interrupted"
    ) {
      return {
        state: "interrupted",
        intent: "gate_required",
      };
    }
    return {
      state: "interrupted",
    };
  }

  decideRecoveryState(state: NodeLoopRecoveryState): NodeLoopRecoveryDecision {
    if (
      state === "degraded" ||
      state === "repairing" ||
      (state === "tool_requested" && this.currentState === "degraded")
    ) {
      return {
        state,
        intent: "recovery_decision",
      };
    }
    return {
      state,
    };
  }

  commit(reduction: NodeLoopReduction): void {
    if (reduction.transition) {
      this.transitionsValue.push(reduction.transition);
    }
    if (reduction.invalidTransition) {
      this.invalidTransitionsValue.push(reduction.invalidTransition);
    }
    this.currentState = reduction.state;
  }
}

export class NodeLoopController {
  private readonly reducer: NodeLoopReducer;

  constructor(private readonly deps: {
    emit: NodeLoopStateEmitter;
    allowedTransitions?: readonly NodeRuntimeTransition[];
    onInvalidTransition?: "record" | "throw";
    onInvalidTransitionRecorded?: (
      transition: NodeRuntimeTransition,
      params: NodeLoopStateEmitParams,
    ) => void;
  }) {
    this.reducer = new NodeLoopReducer({
      allowedTransitions: deps.allowedTransitions,
    });
  }

  get state(): NodeRuntimeLoopState | undefined {
    return this.reducer.state;
  }

  get transitions(): readonly NodeRuntimeTransition[] {
    return this.reducer.transitions;
  }

  get invalidTransitions(): readonly NodeRuntimeTransition[] {
    return this.reducer.invalidTransitions;
  }

  emit = (
    state: NodeRuntimeLoopState,
    params: NodeLoopStateEmitParams,
  ): void => {
    const reduction = this.reducer.reduce(state);
    if (reduction.invalidTransition) {
      this.deps.onInvalidTransitionRecorded?.(reduction.invalidTransition, params);
      if (this.deps.onInvalidTransition === "throw") {
        throw new Error(
          `Invalid node runtime transition: ${reduction.invalidTransition.from} -> ${reduction.invalidTransition.to}`,
        );
      }
    }
    this.reducer.commit(reduction);
    this.deps.emit(state, params);
  };

  emitPending = (
    params: NodeLoopStateEmitParams,
  ): void => {
    this.emit("pending", params);
  };

  emitTransitionResult = (
    kind: NodeLoopTransitionResultKind,
    state: NodeRuntimeLoopState,
    params: NodeLoopStateEmitParams,
  ): void => {
    if (this.reducer.state) {
      assertNodeLoopTransitionResult(kind, {
        from: this.reducer.state,
        to: state,
      });
    }
    this.emit(state, params);
  };

  emitToolRequested = (
    params: NodeLoopStateEmitParams,
  ): void => {
    const decision = this.reducer.decideToolRequested();
    if (decision.intent) {
      this.emitTransitionResult(decision.intent, decision.state, params);
      return;
    }
    this.emit(decision.state, params);
  };

  emitToolRunning = (
    params: NodeLoopStateEmitParams,
  ): void => {
    this.emitTransitionResult("tool_request", "tool_running", params);
  };

  emitToolResultObserved = (
    params: NodeLoopStateEmitParams,
  ): void => {
    this.emitTransitionResult("tool_result", "tool_result_observed", params);
  };

  emitModelRequest = (
    params: NodeLoopStateEmitParams,
  ): void => {
    this.emitTransitionResult("model_request", "running_model", params);
  };

  emitForcedFinal = (
    params: NodeLoopStateEmitParams,
  ): void => {
    const decision = this.reducer.decideForcedFinal();
    if (decision.intent) {
      this.emitTransitionResult(decision.intent, decision.state, params);
      return;
    }
    this.emit(decision.state, params);
  };

  emitGateRequired = (
    params: NodeLoopStateEmitParams,
  ): void => {
    const decision = this.reducer.decideGateRequired();
    if (decision.intent) {
      this.emitTransitionResult(decision.intent, decision.state, params);
      return;
    }
    this.emit(decision.state, params);
  };

  emitRecoveryState = (
    state: NodeLoopRecoveryState,
    params: NodeLoopStateEmitParams,
  ): void => {
    const decision = this.reducer.decideRecoveryState(state);
    if (decision.intent) {
      this.emitTransitionResult(decision.intent, decision.state, params);
      return;
    }
    this.emit(decision.state, params);
  };

  emitForcedFinalProviderState = (
    state: NodeLoopForcedFinalProviderState,
    params: NodeLoopStateEmitParams,
  ): void => {
    if (state === "completed") {
      this.emitTransitionResult("complete", state, params);
      return;
    }
    this.emitTransitionResult("fail", state, params);
  };
}

function transitionKey(transition: NodeRuntimeTransition): string {
  return `${transition.from}->${transition.to}`;
}

const NODE_RUNTIME_STATES = new Set<NodeRuntimeLoopState>([
  "pending",
  "running_model",
  "tool_requested",
  "tool_running",
  "tool_result_observed",
  "repairing",
  "finalizing",
  "completed",
  "degraded",
  "interrupted",
  "failed",
]);

export function nodeRuntimeStateSequence(
  events: readonly OraEventEnvelope[],
  options: { agentId?: string; nodeId?: string; includeProviderStream?: boolean } = {},
): NodeRuntimeLoopState[] {
  return events
    .filter((event) => event.type === "node.updated")
    .filter((event) => options.agentId === undefined || event.agentId === options.agentId)
    .filter((event) => options.nodeId === undefined || event.nodeId === options.nodeId)
    .map((event) => {
      const payload = event.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return undefined;
      }
      if (!options.includeProviderStream && (payload as { providerStream?: unknown }).providerStream === true) {
        return undefined;
      }
      const state = (payload as { state?: unknown }).state;
      return typeof state === "string" && NODE_RUNTIME_STATES.has(state as NodeRuntimeLoopState)
        ? state as NodeRuntimeLoopState
        : undefined;
    })
    .filter((state): state is NodeRuntimeLoopState => state !== undefined);
}

export function nodeLoopTransitionDiagnostics(
  events: readonly OraEventEnvelope[],
): NodeLoopTransitionDiagnostic[] {
  const diagnostics: NodeLoopTransitionDiagnostic[] = [];
  for (const event of events) {
    if (event.type !== "task.progress") {
      continue;
    }
    const payload = event.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      continue;
    }
    const candidate = payload as Record<string, unknown>;
    if (candidate.kind !== "runtime_diagnostic" || candidate.source !== "node_loop_transition") {
      continue;
    }
    if (!isNodeRuntimeState(candidate.from) || !isNodeRuntimeState(candidate.to)) {
      continue;
    }
    diagnostics.push({
      from: candidate.from,
      to: candidate.to,
      severity: typeof candidate.severity === "string" ? candidate.severity : undefined,
      title: typeof candidate.title === "string" ? candidate.title : undefined,
      actionId: typeof candidate.actionId === "string" ? candidate.actionId : undefined,
      toolId: typeof candidate.toolId === "string" ? candidate.toolId : undefined,
      iteration: typeof candidate.iteration === "number" ? candidate.iteration : undefined,
    });
  }
  return diagnostics;
}

export function transitionPairs(states: readonly NodeRuntimeLoopState[]): NodeRuntimeTransition[] {
  const pairs: NodeRuntimeTransition[] = [];
  for (let index = 1; index < states.length; index += 1) {
    pairs.push({ from: states[index - 1], to: states[index] });
  }
  return pairs;
}

function isNodeRuntimeState(value: unknown): value is NodeRuntimeLoopState {
  return typeof value === "string" && NODE_RUNTIME_STATES.has(value as NodeRuntimeLoopState);
}

export function containsStateSubsequence(
  states: readonly NodeRuntimeLoopState[],
  expected: readonly NodeRuntimeLoopState[],
): boolean {
  let cursor = 0;
  for (const state of states) {
    if (state === expected[cursor]) {
      cursor += 1;
    }
    if (cursor === expected.length) {
      return true;
    }
  }
  return expected.length === 0;
}
