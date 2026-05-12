import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_DEVELOPMENT_MODE_ID, MVP_MODES, ORA_ROOT_AGENT_ID, SINGLE_AGENT_MODE_ID, StateSnapshotSchema } from "@cemeworm/shared";
import { LocalRunStore, createRuntimeMethodHandler } from "../src/index.js";
import { RecoveryCoordinator } from "../src/harness/recovery-policy.js";
import { RuntimeToolRecoveryService } from "../src/harness/runtime-tool-recovery-service.js";
import {
  containsStateSubsequence,
  CORE_NODE_RUNTIME_TRANSITIONS,
  NodeLoopController,
  NodeLoopReducer,
  assertNodeLoopTransitionResult,
  nodeLoopTransitionDiagnostics,
  nodeLoopTransitionResult,
  nodeRuntimeStateSequence,
  transitionPairs,
} from "../src/harness/node-loop-transitions.js";
import { shouldEmitProviderStreamEvent as shouldEmitNodeRuntimeProviderStreamEvent } from "../src/harness/node-runtime-loop.js";

function createTempStore() {
  return new LocalRunStore({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ora-node-loop-transitions-")),
  });
}

function readRuntimeSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", relativePath), "utf8");
}

function expectCoreTransitions(states: ReturnType<typeof nodeRuntimeStateSequence>) {
  const allowed = new Set(CORE_NODE_RUNTIME_TRANSITIONS.map((transition) => `${transition.from}->${transition.to}`));
  for (const transition of transitionPairs(states)) {
    expect(allowed.has(`${transition.from}->${transition.to}`), `${transition.from}->${transition.to}`).toBe(true);
  }
}

function expectNoTransitionDiagnostics(events: Parameters<typeof nodeLoopTransitionDiagnostics>[0]) {
  expect(nodeLoopTransitionDiagnostics(events)).toEqual([]);
}

describe("node runtime loop transition contract", () => {
  it("does not treat provider stream frames as node loop states by default", () => {
    const events = [
      {
        type: "node.updated",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        payload: { state: "pending" },
      },
      {
        type: "node.updated",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        payload: {
          state: "running_model",
          providerStream: true,
          streamMode: "sse",
        },
      },
      {
        type: "node.updated",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        payload: { state: "running_model" },
      },
      {
        type: "node.updated",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        payload: {
          state: "completed",
          providerStream: true,
          streamMode: "sse",
        },
      },
      {
        type: "node.updated",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        payload: { state: "completed" },
      },
    ];

    const eventStream = events as Parameters<typeof nodeRuntimeStateSequence>[0];

    expect(nodeRuntimeStateSequence(eventStream)).toEqual([
      "pending",
      "running_model",
      "completed",
    ]);
    expect(nodeRuntimeStateSequence(eventStream, { includeProviderStream: true })).toEqual([
      "pending",
      "running_model",
      "running_model",
      "completed",
      "completed",
    ]);
  });

  it("emits only the first provider sse frame per model invocation", () => {
    expect(shouldEmitNodeRuntimeProviderStreamEvent({ kind: "sse_frame" }, false)).toBe(true);
    expect(shouldEmitNodeRuntimeProviderStreamEvent({ kind: "sse_frame" }, true)).toBe(false);
    expect(shouldEmitNodeRuntimeProviderStreamEvent({ kind: "fallback_started" }, true)).toBe(true);
    expect(shouldEmitNodeRuntimeProviderStreamEvent({ kind: "fallback_response" }, true)).toBe(true);
    expect(shouldEmitNodeRuntimeProviderStreamEvent({ kind: "local_stream_started" }, true)).toBe(true);
  });

  it("routes production node state emissions through a transition controller", () => {
    const emitted: Array<{ state: string; params: unknown }> = [];
    const controller = new NodeLoopController({
      emit: (state, params) => {
        emitted.push({ state, params });
      },
    });

    controller.emit("pending", { agentId: ORA_ROOT_AGENT_ID, title: "Respond" });
    controller.emit("running_model", { agentId: ORA_ROOT_AGENT_ID, title: "Respond", iteration: 0 });
    controller.emit("completed", { agentId: ORA_ROOT_AGENT_ID, title: "Respond", iteration: 0 });

    expect(emitted).toEqual([
      { state: "pending", params: { agentId: ORA_ROOT_AGENT_ID, title: "Respond" } },
      { state: "running_model", params: { agentId: ORA_ROOT_AGENT_ID, title: "Respond", iteration: 0 } },
      { state: "completed", params: { agentId: ORA_ROOT_AGENT_ID, title: "Respond", iteration: 0 } },
    ]);
    expect(controller.state).toBe("completed");
    expect(controller.transitions).toEqual([
      { from: "pending", to: "running_model" },
      { from: "running_model", to: "completed" },
    ]);
  });

  it("applies transition-result intents without changing controller emissions", () => {
    const emitted: Array<{ state: string; params: unknown }> = [];
    const controller = new NodeLoopController({
      emit: (state, params) => {
        emitted.push({ state, params });
      },
      onInvalidTransition: "throw",
    });

    controller.emit("pending", { agentId: ORA_ROOT_AGENT_ID, title: "Respond" });
    controller.emitTransitionResult("model_request", "running_model", {
      agentId: ORA_ROOT_AGENT_ID,
      title: "Respond",
      iteration: 0,
    });
    controller.emitTransitionResult("model_response", "completed", {
      agentId: ORA_ROOT_AGENT_ID,
      title: "Respond",
      iteration: 0,
    });

    expect(emitted).toEqual([
      { state: "pending", params: { agentId: ORA_ROOT_AGENT_ID, title: "Respond" } },
      { state: "running_model", params: { agentId: ORA_ROOT_AGENT_ID, title: "Respond", iteration: 0 } },
      { state: "completed", params: { agentId: ORA_ROOT_AGENT_ID, title: "Respond", iteration: 0 } },
    ]);
    expect(controller.transitions).toEqual([
      { from: "pending", to: "running_model" },
      { from: "running_model", to: "completed" },
    ]);
    expect(() =>
      controller.emitTransitionResult("tool_request", "completed", { agentId: ORA_ROOT_AGENT_ID })
    ).toThrow("Invalid node loop transition result (tool_request): completed -> completed (unknown_transition)");
    expect(controller.state).toBe("completed");
  });

  it("lets the reducer own tool-requested intent decisions", () => {
    const emitted: Array<{ state: string; params: unknown }> = [];
    const modelController = new NodeLoopController({
      emit: (state, params) => emitted.push({ state, params }),
      onInvalidTransition: "throw",
    });

    modelController.emit("pending", { agentId: ORA_ROOT_AGENT_ID });
    modelController.emitTransitionResult("model_request", "running_model", { agentId: ORA_ROOT_AGENT_ID });
    modelController.emitToolRequested({
      agentId: ORA_ROOT_AGENT_ID,
      title: "Respond",
      toolId: "file.read",
      iteration: 0,
    });

    expect(modelController.transitions).toEqual([
      { from: "pending", to: "running_model" },
      { from: "running_model", to: "tool_requested" },
    ]);
    expect(emitted.at(-1)).toEqual({
      state: "tool_requested",
      params: {
        agentId: ORA_ROOT_AGENT_ID,
        title: "Respond",
        toolId: "file.read",
        iteration: 0,
      },
    });

    const recoveryController = new NodeLoopController({
      emit: () => undefined,
      onInvalidTransition: "throw",
    });
    recoveryController.emit("tool_running", { agentId: ORA_ROOT_AGENT_ID });
    recoveryController.emitRecoveryState("degraded", { agentId: ORA_ROOT_AGENT_ID });
    recoveryController.emitToolRequested({ agentId: ORA_ROOT_AGENT_ID, toolId: "file.read" });
    expect(recoveryController.transitions).toEqual([
      { from: "tool_running", to: "degraded" },
      { from: "degraded", to: "tool_requested" },
    ]);
  });

  it("lets the reducer own forced-final and gate-required decisions", () => {
    const controller = new NodeLoopController({
      emit: () => undefined,
      onInvalidTransition: "throw",
    });

    controller.emit("pending", { agentId: ORA_ROOT_AGENT_ID });
    controller.emitTransitionResult("model_request", "running_model", { agentId: ORA_ROOT_AGENT_ID });
    controller.emitToolRequested({ agentId: ORA_ROOT_AGENT_ID, toolId: "file.write" });
    controller.emitGateRequired({
      agentId: ORA_ROOT_AGENT_ID,
      actionId: "action-write",
      toolId: "file.write",
    });

    expect(controller.transitions).toEqual([
      { from: "pending", to: "running_model" },
      { from: "running_model", to: "tool_requested" },
      { from: "tool_requested", to: "interrupted" },
    ]);

    const forcedFinalController = new NodeLoopController({
      emit: () => undefined,
      onInvalidTransition: "throw",
    });
    forcedFinalController.emit("tool_requested", { agentId: ORA_ROOT_AGENT_ID });
    forcedFinalController.emitForcedFinal({
      agentId: ORA_ROOT_AGENT_ID,
      reason: "tool_budget_exhausted",
    });
    expect(forcedFinalController.transitions).toEqual([
      { from: "tool_requested", to: "finalizing" },
    ]);
  });

  it("lets the reducer own recovery state decisions", () => {
    const alternateController = new NodeLoopController({
      emit: () => undefined,
      onInvalidTransition: "throw",
    });
    alternateController.emit("tool_running", { agentId: ORA_ROOT_AGENT_ID });
    alternateController.emitRecoveryState("degraded", { agentId: ORA_ROOT_AGENT_ID });
    alternateController.emitRecoveryState("tool_requested", {
      agentId: ORA_ROOT_AGENT_ID,
      toolId: "file.read",
    });
    alternateController.emitToolRunning({
      agentId: ORA_ROOT_AGENT_ID,
      toolId: "file.read",
    });

    expect(alternateController.transitions).toEqual([
      { from: "tool_running", to: "degraded" },
      { from: "degraded", to: "tool_requested" },
      { from: "tool_requested", to: "tool_running" },
    ]);

    const fallbackController = new NodeLoopController({
      emit: () => undefined,
      onInvalidTransition: "throw",
    });
    fallbackController.emit("tool_running", { agentId: ORA_ROOT_AGENT_ID });
    fallbackController.emitRecoveryState("degraded", { agentId: ORA_ROOT_AGENT_ID });
    fallbackController.emitRecoveryState("repairing", {
      agentId: ORA_ROOT_AGENT_ID,
      toolId: "file.read",
    });
    fallbackController.emitModelRequest({ agentId: ORA_ROOT_AGENT_ID });

    expect(fallbackController.transitions).toEqual([
      { from: "tool_running", to: "degraded" },
      { from: "degraded", to: "repairing" },
      { from: "repairing", to: "running_model" },
    ]);
  });

  it("diagnoses misrouted tool recovery without degrading from running_model", async () => {
    const emitted: Array<{ type: string; payload: any; extra?: any; agentId?: string; nodeId?: string }> = [];
    const nodeLoopController = new NodeLoopController({
      emit: (state, params) => {
        emitted.push({
          type: "node.updated",
          agentId: params.agentId,
          nodeId: params.agentId,
          payload: { state, ...params },
        });
      },
      onInvalidTransition: "throw",
    });
    nodeLoopController.emitPending({ agentId: ORA_ROOT_AGENT_ID, title: "Root" });
    nodeLoopController.emitModelRequest({ agentId: ORA_ROOT_AGENT_ID, title: "Root" });
    const modeSpec = MVP_MODES.find((mode) => mode.id === SINGLE_AGENT_MODE_ID)!;
    const error = new Error("fetch failed");
    const service = new RuntimeToolRecoveryService({
      agentId: ORA_ROOT_AGENT_ID,
      nodeId: ORA_ROOT_AGENT_ID,
      title: "Root",
      inputPrompt: "List files",
      system: "system",
      config: {} as never,
      modeSpec,
      nativeTools: [],
      invokeProvider: async () => {
        throw new Error("provider should not be invoked");
      },
      completion: {} as never,
      completionScope: { agentId: ORA_ROOT_AGENT_ID, nodeId: ORA_ROOT_AGENT_ID },
      recoveryCoordinator: new RecoveryCoordinator(modeSpec, []),
      nodeLoopController,
      runtimeToolExecutor: {} as never,
      actionDeps: () => ({
        actionLedger: {} as never,
        emit: () => undefined,
        appendToolCall: () => undefined as never,
      }),
      actionLedger: {} as never,
      now: () => 123,
      eventsLength: () => emitted.length,
      getMessages: () => [],
      replaceMessages: () => undefined,
      emit: (type, payload, extra = {}) => {
        emitted.push({ type, payload, extra, agentId: extra.agentId, nodeId: extra.nodeId });
        return { type, payload, ...extra } as never;
      },
      emitProgressNarration: async () => undefined,
      emitRecoveryDecision: () => undefined,
      runForcedFinalProviderCall: async () => {
        throw new Error("forced final should not run");
      },
      emitForcedFinalProviderState: () => undefined,
      invokeFollowUpModel: async () => {
        throw new Error("follow-up should not run");
      },
      publishRecoveryArtifact: () => ({ id: "artifact-1" }),
      publishFileChangeArtifact: () => ({ id: "file-artifact-1" }) as never,
      sleep: async () => undefined,
    });

    const result = await service.recoverToolFailure({
      error,
      action: { id: "action-file-list", type: "file.list", riskLevel: "low", status: "running", input: {}, agentId: ORA_ROOT_AGENT_ID } as never,
      toolCall: { tool: "file.list", args: { path: "apps/runtime/src" } },
      toolCallRecord: { id: "tool-record-1" } as never,
      allowRisky: false,
      iteration: 0,
      response: {
        providerId: "provider",
        providerType: "openai_compatible",
        modelId: "model",
        text: "",
        raw: {},
      },
      surface: "transport",
    });
    const states = nodeRuntimeStateSequence(emitted as never, { agentId: ORA_ROOT_AGENT_ID });
    const diagnostic = emitted.find((event) =>
      event.type === "task.progress" &&
      event.payload?.source === "tool_recovery_boundary"
    );

    expect(result).toEqual({ kind: "throw", error });
    expect(transitionPairs(states)).not.toContainEqual({
      from: "running_model",
      to: "degraded",
    });
    expect(nodeLoopController.state).toBe("running_model");
    expect(diagnostic?.payload).toEqual(expect.objectContaining({
      kind: "runtime_diagnostic",
      source: "tool_recovery_boundary",
      surface: "transport",
      currentState: "running_model",
      actionId: "action-file-list",
      toolId: "file.list",
      ownerActionId: "action-file-list",
      ownerToolId: "file.list",
      error: "fetch failed",
    }));
  });

  it("routes recovery and boundary-failure state emits through typed intents", () => {
    const source = readRuntimeSource("src/harness/node-runtime-loop.ts");
    const middlewareSource = readRuntimeSource("src/harness/runtime-middleware.ts");
    const toolActionProposalSource = readRuntimeSource("src/harness/runtime-tool-action-proposal.ts");
    const toolAttemptSource = readRuntimeSource("src/harness/runtime-tool-attempt.ts");
    const toolBoundarySource = readRuntimeSource("src/harness/runtime-tool-boundary.ts");
    const toolCallSource = readRuntimeSource("src/harness/runtime-tool-call-service.ts");
    const toolRecoverySource = readRuntimeSource("src/harness/runtime-tool-recovery-service.ts");

    expect(source).not.toContain("const emitRawRecoveryNodeRuntimeState =");
    expect(source).not.toContain("const emitRawAlternateToolNodeRuntimeState =");
    expect(source).not.toContain("const emitRawBoundaryFailureNodeRuntimeState =");
    expect(source).not.toContain('nodeLoopController.state === "running_model"');
    expect(source).toContain("new RuntimeToolRecoveryService({");
    expect(source).toContain("toolRecoveryService.recoverToolFailure(failure)");
    expect(source).not.toContain('recoveryDecision.action === "alternate_tool"');
    expect(source).not.toContain('recoveryDecision.action === "fallback_artifact"');
    expect(source).toContain("classifyRecoveryError(");
    expect(source).toContain("invokeProviderWithRecovery");
    expect(source).toContain("new RuntimeToolCallService({");
    expect(source).toContain("toolCallService.runToolTurn({");
    expect(source).not.toContain("proposeRuntimeToolAction({");
    expect(source).not.toContain("resolveRuntimeActionApproval({");
    expect(source).not.toContain("recordRuntimeToolActionSucceeded({");
    expect(toolRecoverySource).toContain('nodeLoopController.emitRecoveryState("degraded"');
    expect(toolRecoverySource).toContain('nodeLoopController.emitRecoveryState("repairing"');
    expect(toolRecoverySource).toContain('nodeLoopController.emitRecoveryState("tool_requested"');
    expect(source).not.toContain('nodeLoopController.emitTransitionResult("recovery_decision"');
    expect(source).not.toContain('emitNodeRuntimeState("finalizing"');
    expect(toolCallSource).toContain('nodeLoopController.emitTransitionResult("tool_request", "tool_running"');
    expect(toolCallSource).toContain('nodeLoopController.emitTransitionResult("tool_result", "tool_result_observed"');
    expect(source).toContain('nodeLoopController.emitTransitionResult("boundary_failure", "finalizing"');
    expect(source).toContain('nodeLoopController.emitTransitionResult("boundary_failure", "failed"');
    expect(source).toContain("nodeLoopController.emitToolRequested(toolRequestedParams)");
    expect(source).toContain("nodeLoopController.emitPending({");
    expect(source).toContain("nodeLoopController.emitForcedFinal({");
    expect(source).toContain("nodeLoopController.emitForcedFinalProviderState(state, emitParams)");
    expect(toolCallSource).toContain("nodeLoopController.emitGateRequired({");
    expect(toolCallSource).toContain("proposeRuntimeToolAction({");
    expect(toolRecoverySource).toContain("proposeRuntimeRecoveryToolAction({");
    expect(source).toContain("registerRuntimeToolAttempt({");
    expect(toolRecoverySource).toContain("registerRuntimeToolAttempt({");
    expect(source).not.toContain("completion.registerToolAttempt(");
    expect(source).not.toContain("const riskLevel = runtimeToolExecutor.riskLevel(toolCall)");
    expect(source).not.toContain("const alternateRiskLevel =");
    expect(source).not.toContain("id: `${params.agentId}-tool-${events.length}`");
    expect(source).not.toContain("id: `${params.agentId}-tool-recovery-${events.length}`");
    expect(toolActionProposalSource).toContain("params.runtimeToolExecutor.riskLevel(params.toolCall)");
    expect(toolActionProposalSource).toContain("params.runtimeToolExecutor.approvalRequest(params.toolCall, params.inputPrompt)");
    expect(toolAttemptSource).toContain("registerRuntimeToolAttempt");
    expect(toolAttemptSource).toContain("params.completion.registerToolAttempt(params.toolCall, params.scope)");
    expect(source).toContain("codeDevelopmentToolBoundaryError({");
    expect(source).not.toContain("CODE_DEVELOPMENT_ORCHESTRATOR_BLOCKED_TOOLS");
    expect(toolBoundarySource).toContain("CODE_DEVELOPMENT_ORCHESTRATOR_BLOCKED_TOOLS");
    expect(source).not.toContain('emitNodeRuntimeState("pending"');
    expect(source).not.toContain('nodeLoopController.emitTransitionResult("forced_final"');
    expect(middlewareSource).toContain("context.emitToolRequested({");
    expect(middlewareSource).toContain("context.emitToolRunning({");
    expect(middlewareSource).toContain("context.emitToolResultObserved({");
    expect(middlewareSource).toContain("context.emitGateRequired({");
    expect(middlewareSource).toContain("context.emitForcedFinal({");
    expect(middlewareSource).toContain("context.emitModelRequest({");
    expect(middlewareSource).not.toContain('context.emitNodeRuntimeState("interrupted"');
    expect(middlewareSource).not.toContain('context.emitNodeRuntimeState("finalizing"');
  });

  it("reduces node loop transitions before controller emission", () => {
    const reducer = new NodeLoopReducer();

    const first = reducer.reduce("pending");
    reducer.commit(first);
    const second = reducer.reduce("running_model");
    reducer.commit(second);
    const invalid = reducer.reduce("tool_running");

    expect(first).toEqual({
      previousState: undefined,
      state: "pending",
      transition: undefined,
      invalidTransition: undefined,
    });
    expect(second).toEqual({
      previousState: "pending",
      state: "running_model",
      transition: { from: "pending", to: "running_model" },
      invalidTransition: undefined,
    });
    expect(invalid).toEqual({
      previousState: "running_model",
      state: "tool_running",
      transition: { from: "running_model", to: "tool_running" },
      invalidTransition: { from: "running_model", to: "tool_running" },
    });
    expect(reducer.state).toBe("running_model");
    expect(reducer.transitions).toEqual([
      { from: "pending", to: "running_model" },
    ]);
    expect(reducer.invalidTransitions).toEqual([]);
  });

  it("classifies explicit node loop transition results by intent", () => {
    expect(nodeLoopTransitionResult("model_request", {
      from: "pending",
      to: "running_model",
    })).toEqual({
      kind: "model_request",
      transition: { from: "pending", to: "running_model" },
      valid: true,
    });

    expect(nodeLoopTransitionResult("tool_request", {
      from: "tool_requested",
      to: "tool_running",
    })).toEqual({
      kind: "tool_request",
      transition: { from: "tool_requested", to: "tool_running" },
      valid: true,
    });

    expect(nodeLoopTransitionResult("forced_final", {
      from: "tool_result_observed",
      to: "finalizing",
    })).toEqual({
      kind: "forced_final",
      transition: { from: "tool_result_observed", to: "finalizing" },
      valid: true,
    });

    expect(nodeLoopTransitionResult("boundary_failure", {
      from: "tool_requested",
      to: "failed",
    })).toEqual({
      kind: "boundary_failure",
      transition: { from: "tool_requested", to: "failed" },
      valid: true,
    });

    expect(nodeLoopTransitionResult("boundary_failure", {
      from: "tool_requested",
      to: "finalizing",
    })).toEqual({
      kind: "boundary_failure",
      transition: { from: "tool_requested", to: "finalizing" },
      valid: true,
    });
  });

  it("rejects mismatched or unknown explicit node loop transition results", () => {
    expect(nodeLoopTransitionResult("tool_result", {
      from: "tool_requested",
      to: "tool_running",
    })).toEqual({
      kind: "tool_result",
      transition: { from: "tool_requested", to: "tool_running" },
      valid: false,
      reason: "mismatched_kind",
    });

    expect(nodeLoopTransitionResult("model_request", {
      from: "completed",
      to: "tool_running",
    })).toEqual({
      kind: "model_request",
      transition: { from: "completed", to: "tool_running" },
      valid: false,
      reason: "unknown_transition",
    });

    expect(() =>
      assertNodeLoopTransitionResult("complete", {
        from: "tool_requested",
        to: "tool_running",
      })
    ).toThrow("Invalid node loop transition result (complete): tool_requested -> tool_running (mismatched_kind)");
  });

  it("can guard invalid node state transitions without changing payloads", () => {
    const emitted: Array<{ state: string; params: unknown }> = [];
    const diagnostics: Array<{ from: string; to: string; toolId?: string }> = [];
    const recordingController = new NodeLoopController({
      emit: (state, params) => {
        emitted.push({ state, params });
      },
      onInvalidTransitionRecorded: (transition, params) => {
        diagnostics.push({ ...transition, toolId: params.toolId });
      },
    });

    recordingController.emit("completed", { agentId: ORA_ROOT_AGENT_ID, title: "Respond" });
    recordingController.emit("tool_running", {
      agentId: ORA_ROOT_AGENT_ID,
      title: "Respond",
      actionId: "action",
      toolId: "file.read",
    });

    expect(emitted).toEqual([
      { state: "completed", params: { agentId: ORA_ROOT_AGENT_ID, title: "Respond" } },
      {
        state: "tool_running",
        params: {
          agentId: ORA_ROOT_AGENT_ID,
          title: "Respond",
          actionId: "action",
          toolId: "file.read",
        },
      },
    ]);
    expect(recordingController.invalidTransitions).toEqual([
      { from: "completed", to: "tool_running" },
    ]);
    expect(diagnostics).toEqual([
      { from: "completed", to: "tool_running", toolId: "file.read" },
    ]);

    const throwingController = new NodeLoopController({
      onInvalidTransition: "throw",
      emit: () => undefined,
    });
    throwingController.emit("completed", { agentId: ORA_ROOT_AGENT_ID });
    expect(() =>
      throwingController.emit("tool_running", { agentId: ORA_ROOT_AGENT_ID })
    ).toThrow("Invalid node runtime transition: completed -> tool_running");
    expect(throwingController.state).toBe("completed");
    expect(throwingController.transitions).toEqual([]);
  });

  it("keeps simple and forced-final provider states behind controller helpers", () => {
    const emitted: Array<{ state: string; title?: string }> = [];
    const controller = new NodeLoopController({
      onInvalidTransition: "throw",
      emit: (state, params) => {
        emitted.push({ state, title: params.title });
      },
    });

    controller.emitPending({ agentId: ORA_ROOT_AGENT_ID, title: "Respond" });
    controller.emitForcedFinal({ agentId: ORA_ROOT_AGENT_ID, title: "Respond" });
    controller.emitForcedFinalProviderState("completed", { agentId: ORA_ROOT_AGENT_ID, title: "Respond" });

    expect(controller.transitions).toEqual([
      { from: "pending", to: "finalizing" },
      { from: "finalizing", to: "completed" },
    ]);
    expect(emitted).toEqual([
      { state: "pending", title: "Respond" },
      { state: "finalizing", title: "Respond" },
      { state: "completed", title: "Respond" },
    ]);
  });

  it("documents the no-tool completion path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());

    const run = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Answer directly." },
        config: {
          modeId: SINGLE_AGENT_MODE_ID,
          modelRef: "local/smoke-model",
          toolIds: [],
        },
      },
    }) as { runId: string; status: string };

    const state = StateSnapshotSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.state",
      params: { runId: run.runId },
    }));
    const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });
    const completedNodeEvent = state.events.find((event) =>
      event.type === "node.updated" &&
      event.agentId === ORA_ROOT_AGENT_ID &&
      (event.payload as { state?: unknown }).state === "completed"
    );

    expect(run.status).toBe("succeeded");
    expect(states).toEqual(["pending", "running_model", "completed"]);
    expect(completedNodeEvent?.payload).toMatchObject({
      state: "completed",
      title: "Respond",
      iteration: 0,
      toolAttempts: 0,
    });
    expectCoreTransitions(states);
    expectNoTransitionDiagnostics(state.events);
  });

  it("documents the native tool success path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-node-loop-tool-"));
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "Native transition result\n", "utf8");
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_TOOL_KEY;
    process.env.NODE_LOOP_TOOL_KEY = "test";
    let providerCalls = 0;

    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role?: string; tool_call_id?: string; content?: string }>;
      };
      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: "call-readme",
                type: "function",
                function: {
                  name: "file__read",
                  arguments: "{\"path\":\"README.md\"}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      expect(body.messages?.some((message) =>
        message.role === "tool" &&
        message.tool_call_id === "call-readme" &&
        String(message.content ?? "").includes("Native transition result")
      )).toBe(true);
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Read README through the transition tool path." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Read the README.",
            context: {
              projectWorkspace: { label: "Node Loop Tool Workspace", rootPath: workspaceRoot },
            },
          },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-tool",
            modelRef: "node-loop-tool-model",
            providerConfig: {
              id: "node-loop-tool",
              label: "Node Loop Tool",
              type: "openai_compatible",
              modelId: "node-loop-tool-model",
              baseUrl: "https://node-loop-tool.test/v1",
              apiKeyEnv: "NODE_LOOP_TOOL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["file.read"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(2);
      expect(containsStateSubsequence(states, [
        "pending",
        "running_model",
        "tool_requested",
        "tool_running",
        "tool_result_observed",
        "running_model",
        "completed",
      ])).toBe(true);
      expectCoreTransitions(states);
      expectNoTransitionDiagnostics(state.events);
      expect(state.toolCalls).toEqual([
        expect.objectContaining({
          providerCallId: "call-readme",
          toolId: "file.read",
          source: "provider_native",
          status: "succeeded",
        }),
      ]);
    } finally {
      globalThis.fetch = previousFetch;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_TOOL_KEY;
      } else {
        process.env.NODE_LOOP_TOOL_KEY = previousKey;
      }
    }
  });

  it("continues OpenAI Responses follow-ups with an append-only delta payload", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-node-loop-responses-cache-"));
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "Responses continuation result\n", "utf8");
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_RESPONSES_CACHE_KEY;
    process.env.NODE_LOOP_RESPONSES_CACHE_KEY = "test";
    const providerBodies: Array<{
      input?: Array<Record<string, unknown>>;
      previous_response_id?: string;
    }> = [];

    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input?: Array<Record<string, unknown>>;
        previous_response_id?: string;
        tools?: Array<{ name?: string }>;
      };
      const isRuntimeToolCall = body.tools?.some((tool) => tool.name === "file__read") ?? false;
      if (!isRuntimeToolCall) {
        return new Response(JSON.stringify({
          id: "resp_auxiliary",
          status: "completed",
          output_text: "Auxiliary response.",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      providerBodies.push(body);
      if (providerBodies.length === 1) {
        expect(body.previous_response_id).toBeUndefined();
        expect(JSON.stringify(body.input)).toContain("Read the README with Responses.");
        return new Response(JSON.stringify({
          id: "resp_initial",
          status: "completed",
          output: [{
            type: "function_call",
            call_id: "call-readme",
            name: "file__read",
            arguments: "{\"path\":\"README.md\"}",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        id: "resp_final",
        status: "completed",
        output_text: "Read README through Responses continuation.",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Read the README with Responses.",
            context: {
              projectWorkspace: { label: "Responses Cache Workspace", rootPath: workspaceRoot },
            },
          },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-responses-cache",
            modelRef: "node-loop-responses-cache-model",
            providerConfig: {
              id: "node-loop-responses-cache",
              label: "Node Loop Responses Cache",
              type: "openai_compatible",
              protocol: "responses",
              modelId: "node-loop-responses-cache-model",
              baseUrl: "https://node-loop-responses-cache.test/v1",
              apiKeyEnv: "NODE_LOOP_RESPONSES_CACHE_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["file.read"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const runtimeBodies = providerBodies.filter((body) =>
        JSON.stringify(body).includes("file__read")
      );

      const continuationBody = runtimeBodies.find((body) => body.previous_response_id === "resp_initial");

      expect(run.status).toBe("succeeded");
      expect(runtimeBodies.length).toBeGreaterThanOrEqual(2);
      expect(continuationBody).toBeTruthy();
      expect(JSON.stringify(continuationBody?.input)).not.toContain("Read the README with Responses.");
      expect(JSON.stringify(continuationBody?.input)).toContain("call-readme");
      expect(JSON.stringify(continuationBody?.input)).toContain("Responses continuation result");
      expect(state.toolCalls).toEqual([
        expect.objectContaining({
          providerCallId: "call-readme",
          toolId: "file.read",
          source: "provider_native",
          status: "succeeded",
        }),
      ]);
    } finally {
      globalThis.fetch = previousFetch;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_RESPONSES_CACHE_KEY;
      } else {
        process.env.NODE_LOOP_RESPONSES_CACHE_KEY = previousKey;
      }
    }
  });

  it("documents the JSON fallback tool success path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-node-loop-json-tool-"));
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "JSON fallback transition result\n", "utf8");
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_JSON_TOOL_KEY;
    process.env.NODE_LOOP_JSON_TOOL_KEY = "test";
    let providerCalls = 0;

    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ tool: "file.read", args: { path: "README.md" } }) } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      expect(body.messages?.some((message) =>
        message.role === "user" &&
        String(message.content ?? "").includes("Workspace tool result for file.read") &&
        String(message.content ?? "").includes("JSON fallback transition result")
      )).toBe(true);
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Read README through the JSON fallback path." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Read the README.",
            context: {
              projectWorkspace: { label: "Node Loop JSON Workspace", rootPath: workspaceRoot },
            },
          },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-json-tool",
            modelRef: "node-loop-json-tool-model",
            providerConfig: {
              id: "node-loop-json-tool",
              label: "Node Loop JSON Tool",
              type: "openai_compatible",
              modelId: "node-loop-json-tool-model",
              baseUrl: "https://node-loop-json-tool.test/v1",
              apiKeyEnv: "NODE_LOOP_JSON_TOOL_KEY",
              capabilities: ["chat"],
              headers: {},
            },
            toolIds: ["file.read"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(2);
      expect(containsStateSubsequence(states, [
        "pending",
        "running_model",
        "tool_requested",
        "tool_running",
        "tool_result_observed",
        "running_model",
        "completed",
      ])).toBe(true);
      expectCoreTransitions(states);
      expectNoTransitionDiagnostics(state.events);
      expect(state.toolCalls).toEqual([
        expect.objectContaining({
          toolId: "file.read",
          source: "json_fallback",
          status: "succeeded",
        }),
      ]);
    } finally {
      globalThis.fetch = previousFetch;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_JSON_TOOL_KEY;
      } else {
        process.env.NODE_LOOP_JSON_TOOL_KEY = previousKey;
      }
    }
  });

  it("documents the approval interrupt and resume path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-node-loop-approval-"));
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_APPROVAL_KEY;
    process.env.NODE_LOOP_APPROVAL_KEY = "test";
    let providerCalls = 0;

    globalThis.fetch = (async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: "call-write",
                type: "function",
                function: {
                  name: "file__write",
                  arguments: "{\"path\":\"notes/approval.md\",\"content\":\"approved\\n\"}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Approved write completed." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Write the approved note.",
            context: {
              projectWorkspace: { label: "Node Loop Approval Workspace", rootPath: workspaceRoot },
            },
          },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-approval",
            modelRef: "node-loop-approval-model",
            providerConfig: {
              id: "node-loop-approval",
              label: "Node Loop Approval",
              type: "openai_compatible",
              modelId: "node-loop-approval-model",
              baseUrl: "https://node-loop-approval.test/v1",
              apiKeyEnv: "NODE_LOOP_APPROVAL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            approvalMode: "high_risk_only",
            toolIds: ["file.write"],
          },
        },
      }) as { runId: string; status: string };

      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const blockedStates = nodeRuntimeStateSequence(blocked.events, { agentId: ORA_ROOT_AGENT_ID });
      const approvedActionId = blocked.pendingApprovals[0]!;

      expect(run.status).toBe("interrupted");
      expect(containsStateSubsequence(blockedStates, ["pending", "running_model", "tool_requested"])).toBe(true);
      expectCoreTransitions(blockedStates);
      expectNoTransitionDiagnostics(blocked.events);
      expect(blocked.events.map((event) => event.type)).toContain("approval.required");
      expect(blocked.actions.find((action) => action.id === approvedActionId)).toMatchObject({
        type: "file.write",
        status: "approval_required",
      });
      expect(blocked.toolCalls.find((call) => call.toolId === "file.write")).toMatchObject({
        providerCallId: "call-write",
        status: "approval_required",
      });

      const resumed = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: { approvedActionIds: [approvedActionId] },
        },
      }));

      expect(resumed.status).toBe("succeeded");
      expect(resumed.pendingApprovals).toEqual([]);
      expectNoTransitionDiagnostics(resumed.events);
      expect(resumed.events.map((event) => event.type)).toContain("approval.resolved");
      expect(resumed.actions.some((action) => action.status === "approval_required")).toBe(false);
      expect(resumed.toolCalls.filter((call) => call.providerCallId === "call-write")).toEqual([
        expect.objectContaining({ toolId: "file.write", status: "succeeded" }),
      ]);
      expect(fs.readFileSync(path.join(workspaceRoot, "notes/approval.md"), "utf8")).toBe("approved\n");
    } finally {
      globalThis.fetch = previousFetch;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_APPROVAL_KEY;
      } else {
        process.env.NODE_LOOP_APPROVAL_KEY = previousKey;
      }
    }
  });

  it("documents the clarification interrupt and resume path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_CLARIFICATION_KEY;
    process.env.NODE_LOOP_CLARIFICATION_KEY = "test";
    const providerBodies: string[] = [];
    let clarificationIssued = false;

    globalThis.fetch = (async (_input, init) => {
      const body = String(init?.body ?? "");
      providerBodies.push(body);
      if (!clarificationIssued && body.includes("user__clarify")) {
        clarificationIssued = true;
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: "call-clarify",
                type: "function",
                function: {
                  name: "user__clarify",
                  arguments: JSON.stringify({
                    key: "target_environment",
                    question: "Which environment should I use?",
                    options: [
                      { id: "staging", label: "Staging", value: "staging" },
                      { id: "production", label: "Production", value: "production" },
                    ],
                  }),
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Continuing with staging." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Confirm the target environment before continuing." },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-clarification",
            modelRef: "node-loop-clarification-model",
            providerConfig: {
              id: "node-loop-clarification",
              label: "Node Loop Clarification",
              type: "openai_compatible",
              modelId: "node-loop-clarification-model",
              baseUrl: "https://node-loop-clarification.test/v1",
              apiKeyEnv: "NODE_LOOP_CLARIFICATION_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["user.clarify"],
          },
        },
      }) as { runId: string; status: string };

      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const blockedStates = nodeRuntimeStateSequence(blocked.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("interrupted");
      expect(containsStateSubsequence(blockedStates, [
        "pending",
        "running_model",
        "tool_requested",
        "tool_running",
      ])).toBe(true);
      expectCoreTransitions(blockedStates);
      expectNoTransitionDiagnostics(blocked.events);
      expect(blocked.events.map((event) => event.type)).toContain("clarification.required");
      expect(blocked.pendingClarifications).toEqual([
        expect.objectContaining({ key: "target_environment", question: "Which environment should I use?" }),
      ]);
      expect(blocked.toolCalls.find((call) => call.toolId === "user.clarify")).toMatchObject({
        providerCallId: "call-clarify",
        status: "succeeded",
      });

      const resumed = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.resume",
        params: {
          runId: run.runId,
          patch: { clarifications: { target_environment: "staging" } },
        },
      }));
      const resumedStates = nodeRuntimeStateSequence(resumed.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(resumed.status).toBe("succeeded");
      expect(resumed.pendingClarifications).toEqual([]);
      expect(
        containsStateSubsequence(resumedStates, ["pending", "running_model", "completed"]) ||
          containsStateSubsequence(resumedStates, ["pending", "running_model", "tool_requested", "tool_running", "interrupted"]),
        resumedStates.join(" -> "),
      ).toBe(true);
      expectCoreTransitions(resumedStates);
      expectNoTransitionDiagnostics(resumed.events);
      expect(resumed.events.map((event) => event.type)).toContain("clarification.resolved");
      expect(providerBodies.some((body) =>
        body.includes("User-supplied clarification context") &&
        body.includes("target_environment") &&
        body.includes("staging")
      )).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_CLARIFICATION_KEY;
      } else {
        process.env.NODE_LOOP_CLARIFICATION_KEY = previousKey;
      }
    }
  });

  it("documents the batch clarification transition path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_BATCH_CLARIFICATION_KEY;
    process.env.NODE_LOOP_BATCH_CLARIFICATION_KEY = "test";
    let clarificationIssued = false;

    globalThis.fetch = (async (_input, init) => {
      const body = String(init?.body ?? "");
      if (!clarificationIssued && body.includes("user__clarify")) {
        clarificationIssued = true;
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call-clarify-env",
                  type: "function",
                  function: {
                    name: "user__clarify",
                    arguments: JSON.stringify({
                      key: "target_environment",
                      question: "Which environment should I use?",
                    }),
                  },
                },
                {
                  id: "call-clarify-region",
                  type: "function",
                  function: {
                    name: "user__clarify",
                    arguments: JSON.stringify({
                      key: "target_region",
                      question: "Which region should I deploy to?",
                    }),
                  },
                },
              ],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Continuing after batch clarifications." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Ask all required deployment clarifications together." },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-batch-clarification",
            modelRef: "node-loop-batch-clarification-model",
            providerConfig: {
              id: "node-loop-batch-clarification",
              label: "Node Loop Batch Clarification",
              type: "openai_compatible",
              modelId: "node-loop-batch-clarification-model",
              baseUrl: "https://node-loop-batch-clarification.test/v1",
              apiKeyEnv: "NODE_LOOP_BATCH_CLARIFICATION_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["user.clarify"],
          },
        },
      }) as { runId: string; status: string };

      const blocked = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(blocked.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("interrupted");
      expect(states).toEqual(["pending", "running_model", "tool_requested", "tool_running", "interrupted", "interrupted"]);
      expectCoreTransitions(states);
      expect(blocked.pendingClarifications).toHaveLength(2);
      expect(blocked.events.filter((event) => event.type === "clarification.required")).toHaveLength(2);
      expectNoTransitionDiagnostics(blocked.events);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_BATCH_CLARIFICATION_KEY;
      } else {
        process.env.NODE_LOOP_BATCH_CLARIFICATION_KEY = previousKey;
      }
    }
  });

  it("documents the recovery path after a tool failure", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_RECOVERY_KEY;
    process.env.NODE_LOOP_RECOVERY_KEY = "test";
    const providerBodies: string[] = [];
    let providerCalls = 0;
    let recoveredFetchCalls = 0;

    globalThis.fetch = (async (input, init) => {
      if (String(input) === "https://example.com/node-loop-degraded") {
        throw new Error("fetch failed for transition test");
      }
      if (String(input) === "https://example.com/node-loop-recovered") {
        recoveredFetchCalls += 1;
        return new Response("Recovered fetch content", { status: 200, headers: { "content-type": "text/plain" } });
      }

      providerCalls += 1;
      const body = String(init?.body ?? "");
      providerBodies.push(body);
      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: "call-degraded",
                type: "function",
                function: {
                  name: "web__fetch",
                  arguments: "{\"url\":\"https://example.com/node-loop-degraded\"}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (providerCalls === 2) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: "call-recovered",
                type: "function",
                function: {
                  name: "web__fetch",
                  arguments: "{\"url\":\"https://example.com/node-loop-recovered\"}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Recovered from degraded fetch and then fetched follow-up content." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Fetch the source and recover if it fails." },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-recovery",
            modelRef: "node-loop-recovery-model",
            providerConfig: {
              id: "node-loop-recovery",
              label: "Node Loop Recovery",
              type: "openai_compatible",
              modelId: "node-loop-recovery-model",
              baseUrl: "https://node-loop-recovery.test/v1",
              apiKeyEnv: "NODE_LOOP_RECOVERY_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["web.fetch"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("succeeded");
      expect(containsStateSubsequence(states, [
        "pending",
        "running_model",
        "tool_requested",
        "tool_running",
        "degraded",
        "repairing",
        "running_model",
        "tool_requested",
        "tool_running",
        "tool_result_observed",
        "running_model",
        "completed",
      ]), states.join(" -> ")).toBe(true);
      expectCoreTransitions(states);
      expectNoTransitionDiagnostics(state.events);
      expect(state.events.map((event) => event.type)).toEqual(expect.arrayContaining([
        "recovery.detected",
        "recovery.applied",
      ]));
      expect(state.events.find((event) => event.type === "recovery.detected")?.payload).toEqual(
        expect.objectContaining({
          incident: expect.objectContaining({
            surface: "tool",
            currentState: "tool_running",
            ownerToolId: "web.fetch",
            ownerActionId: expect.any(String),
          }),
        }),
      );
      expect(state.events.map((event) => event.type)).not.toContain("run.failed");
      expect(recoveredFetchCalls).toBe(1);
      expect(state.toolCalls).toEqual([
        expect.objectContaining({
          providerCallId: "call-degraded",
          toolId: "web.fetch",
          source: "provider_native",
          status: "failed",
          error: "fetch failed for transition test",
        }),
        expect.objectContaining({
          providerCallId: "call-recovered",
          toolId: "web.fetch",
          source: "provider_native",
          status: "succeeded",
        }),
      ]);
      expect(providerBodies.some((body) => body.includes("Workspace tool degraded for web.fetch"))).toBe(true);
      expect(state.output?.text).toContain("Recovered from degraded fetch and then fetched follow-up content.");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_RECOVERY_KEY;
      } else {
        process.env.NODE_LOOP_RECOVERY_KEY = previousKey;
      }
    }
  });

  it("documents the retry recovery transition path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_RETRY_RECOVERY_KEY;
    process.env.NODE_LOOP_RETRY_RECOVERY_KEY = "test";
    let providerCalls = 0;
    let webFetchCalls = 0;

    globalThis.fetch = (async (input, init) => {
      if (String(input) === "https://example.com/node-loop-retry") {
        webFetchCalls += 1;
        if (webFetchCalls === 1) {
          throw new Error("retryable fetch failure");
        }
        return new Response("Retry recovery content", { status: 200, headers: { "content-type": "text/plain" } });
      }

      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        tool_choice?: string;
        messages?: Array<{ role?: string; tool_call_id?: string; content?: string }>;
      };
      if (body.tool_choice === "none") {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Recovered after retrying the fetch." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (body.messages?.some((message) =>
        message.role === "tool" &&
        message.tool_call_id === "call-retry" &&
        String(message.content ?? "").includes("Retry recovery content")
      )) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Recovered after retrying the fetch." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "call-retry",
              type: "function",
              function: {
                name: "web__fetch",
                arguments: "{\"url\":\"https://example.com/node-loop-retry\"}",
              },
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const cloned = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "modes.cloneFromPreset",
        params: {
          sourceModeId: SINGLE_AGENT_MODE_ID,
          modeId: "node-loop-retry-recovery",
          label: "Node Loop Retry Recovery",
        },
      }) as any;

      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "modes.update",
        params: {
          modeId: cloned.id,
          spec: {
            ...cloned,
            recoveryPolicy: {
              version: 1,
              defaults: {
                ...cloned.recoveryPolicy.defaults,
                backoffMs: 0,
                capDelayMs: 0,
                fallbackArtifact: false,
              },
              rules: [{
                id: "tool-error-retry-once",
                label: "Tool error retry once",
                enabled: true,
                errorTypes: ["tool_error"],
                toolIds: ["web.fetch"],
                action: "retry",
                maxAttempts: 2,
              }],
            },
          },
        },
      });

      const run = await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.start",
        params: {
          input: { prompt: "Fetch and retry once if the fetch fails." },
          config: {
            modeId: cloned.id,
            providerId: "node-loop-retry-recovery",
            modelRef: "node-loop-retry-recovery-model",
            providerConfig: {
              id: "node-loop-retry-recovery",
              label: "Node Loop Retry Recovery",
              type: "openai_compatible",
              modelId: "node-loop-retry-recovery-model",
              baseUrl: "https://node-loop-retry-recovery.test/v1",
              apiKeyEnv: "NODE_LOOP_RETRY_RECOVERY_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["web.fetch"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(2);
      expect(webFetchCalls).toBe(2);
      expect(containsStateSubsequence(states, [
        "pending",
        "running_model",
        "tool_requested",
        "tool_running",
        "degraded",
        "tool_requested",
        "tool_running",
        "tool_result_observed",
        "running_model",
        "completed",
      ]), states.join(" -> ")).toBe(true);
      expectCoreTransitions(states);
      expect(state.events.filter((event) => event.type === "recovery.retry_scheduled")).toHaveLength(1);
      expect(state.events.map((event) => event.type)).not.toContain("recovery.applied");
      expect(state.events.map((event) => event.type)).not.toContain("run.failed");
      expectNoTransitionDiagnostics(state.events);
      expect(state.events.some((event) =>
        event.type === "action.updated" &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        (event.payload as Record<string, unknown>).status === "failed"
      )).toBe(true);
      expect(state.toolCalls.filter((call) => call.providerCallId === "call-retry")).toEqual([
        expect.objectContaining({ toolId: "web.fetch", status: "succeeded" }),
      ]);
      expect(state.output?.text).toContain("Recovered after retrying the fetch.");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_RETRY_RECOVERY_KEY;
      } else {
        process.env.NODE_LOOP_RETRY_RECOVERY_KEY = previousKey;
      }
    }
  });

  it("retries a transient follow-up provider failure without re-running the successful tool", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_FOLLOWUP_RETRY_KEY;
    process.env.NODE_LOOP_FOLLOWUP_RETRY_KEY = "test";
    let providerCalls = 0;
    let followUpProviderCalls = 0;
    let webFetchCalls = 0;

    globalThis.fetch = (async (input, init) => {
      if (String(input) === "https://example.com/node-loop-followup-retry") {
        webFetchCalls += 1;
        return new Response("Follow-up retry content", { status: 200, headers: { "content-type": "text/plain" } });
      }

      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        tool_choice?: string;
        messages?: Array<{ role?: string; tool_call_id?: string; content?: string }>;
      };
      if (body.tool_choice === "none") {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Recovered after retrying the follow-up provider call." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const hasToolResult = body.messages?.some((message) =>
        message.role === "tool" &&
        message.tool_call_id === "call-followup-retry" &&
        String(message.content ?? "").includes("Follow-up retry content")
      ) ?? false;
      if (hasToolResult) {
        followUpProviderCalls += 1;
        if (followUpProviderCalls === 1) {
          return new Response("temporary provider outage", {
            status: 503,
            headers: { "content-type": "text/plain" },
          });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Recovered after retrying the follow-up provider call." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "call-followup-retry",
              type: "function",
              function: {
                name: "web__fetch",
                arguments: "{\"url\":\"https://example.com/node-loop-followup-retry\"}",
              },
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const cloned = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "modes.cloneFromPreset",
        params: {
          sourceModeId: SINGLE_AGENT_MODE_ID,
          modeId: "node-loop-followup-retry",
          label: "Node Loop Follow-up Retry",
        },
      }) as any;

      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "modes.update",
        params: {
          modeId: cloned.id,
          spec: {
            ...cloned,
            recoveryPolicy: {
              ...cloned.recoveryPolicy,
              defaults: {
                ...cloned.recoveryPolicy.defaults,
                backoffMs: 0,
                capDelayMs: 0,
              },
            },
          },
        },
      });

      const run = await handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runs.start",
        params: {
          input: { prompt: "Fetch once, then recover if the follow-up provider call is transiently unavailable." },
          config: {
            modeId: cloned.id,
            providerId: "node-loop-followup-retry",
            modelRef: "node-loop-followup-retry-model",
            providerConfig: {
              id: "node-loop-followup-retry",
              label: "Node Loop Follow-up Retry",
              type: "openai_compatible",
              modelId: "node-loop-followup-retry-model",
              baseUrl: "https://node-loop-followup-retry.test/v1",
              apiKeyEnv: "NODE_LOOP_FOLLOWUP_RETRY_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["web.fetch"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(3);
      expect(followUpProviderCalls).toBe(2);
      expect(webFetchCalls).toBe(1);
      expect(containsStateSubsequence(states, [
        "pending",
        "running_model",
        "tool_requested",
        "tool_running",
        "tool_result_observed",
        "running_model",
        "running_model",
        "completed",
      ]), states.join(" -> ")).toBe(true);
      expect(transitionPairs(states)).not.toContainEqual({ from: "running_model", to: "degraded" });
      expectCoreTransitions(states);
      expectNoTransitionDiagnostics(state.events);
      expect(state.events.filter((event) => event.type === "recovery.detected")).toHaveLength(1);
      expect(state.events.filter((event) => event.type === "recovery.retry_scheduled")).toHaveLength(1);
      const providerIncident = (state.events.find((event) => event.type === "recovery.detected")?.payload as { incident?: Record<string, unknown> }).incident;
      expect(providerIncident).toEqual(expect.objectContaining({ surface: "provider" }));
      expect(providerIncident?.toolId).not.toBe("file.list");
      expect(providerIncident?.currentState).toBeUndefined();
      expect(state.events.map((event) => event.type)).not.toContain("run.failed");
      expect(state.toolCalls.filter((call) => call.providerCallId === "call-followup-retry")).toEqual([
        expect.objectContaining({ toolId: "web.fetch", status: "succeeded" }),
      ]);
      expect(state.output?.text).toContain("Recovered after retrying the follow-up provider call.");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_FOLLOWUP_RETRY_KEY;
      } else {
        process.env.NODE_LOOP_FOLLOWUP_RETRY_KEY = previousKey;
      }
    }
  });

  it("documents the code-development boundary failure transition path", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-node-loop-boundary-"));
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_BOUNDARY_KEY;
    process.env.NODE_LOOP_BOUNDARY_KEY = "test";
    let providerCalls = 0;

    globalThis.fetch = (async () => {
      providerCalls += 1;
      if (providerCalls > 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Continue normally after boundary degradation." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          tool: "shell.execute",
          args: { command: "rm -rf build" },
        }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Try the unsafe shell command.",
            context: {
              projectWorkspace: { label: "Node Loop Boundary Workspace", rootPath: workspaceRoot },
            },
          },
          config: {
            pattern: "agent_teams",
            modeId: CODE_DEVELOPMENT_MODE_ID,
            providerId: "node-loop-boundary",
            modelRef: "node-loop-boundary-model",
            providerConfig: {
              id: "node-loop-boundary",
              label: "Node Loop Boundary",
              type: "openai_compatible",
              modelId: "node-loop-boundary-model",
              baseUrl: "https://node-loop-boundary.test/v1",
              apiKeyEnv: "NODE_LOOP_BOUNDARY_KEY",
              capabilities: ["chat"],
              headers: {},
            },
            toolIds: ["shell.execute"],
            approvalMode: "auto",
            metadata: { taskIntent: "implement" },
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: "orchestrator" });

      expect(run.status).toBe("succeeded");
      expect(state.status).toBe("succeeded");
      expect(containsStateSubsequence(states, [
        "pending",
        "running_model",
        "tool_requested",
        "failed",
        "degraded",
      ]), states.join(" -> ")).toBe(true);
      expectCoreTransitions(states);
      expect(state.events.map((event) => event.type)).toEqual(expect.arrayContaining([
        "recovery.detected",
        "recovery.applied",
      ]));
      expect(state.events.map((event) => event.type)).not.toContain("run.failed");
      expect(state.actions.some((action) => action.type === "shell.execute")).toBe(false);
      expect(state.actions.some((action) =>
        action.type === "agent.orchestrator.invoke" &&
        action.agentId === "orchestrator" &&
        action.status === "failed"
      )).toBe(true);
      expect(state.toolCalls).toEqual([]);
      expectNoTransitionDiagnostics(state.events);
    } finally {
      globalThis.fetch = previousFetch;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_BOUNDARY_KEY;
      } else {
        process.env.NODE_LOOP_BOUNDARY_KEY = previousKey;
      }
    }
  });

  it("documents the forced-final path after tool budget exhaustion", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_FORCED_FINAL_KEY;
    process.env.NODE_LOOP_FORCED_FINAL_KEY = "test";
    let webFetchCalls = 0;

    globalThis.fetch = (async (input, init) => {
      if (String(input) === "https://example.com/node-loop-budget") {
        webFetchCalls += 1;
        return new Response("Budget transition content", { status: 200, headers: { "content-type": "text/plain" } });
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as { tool_choice?: string };
      if (body.tool_choice === "none") {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Final answer from the budgeted tool result." } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "call-budget",
              type: "function",
              function: {
                name: "web__fetch",
                arguments: "{\"url\":\"https://example.com/node-loop-budget\"}",
              },
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Use exactly one fetch before finalizing." },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-forced-final",
            modelRef: "node-loop-forced-final-model",
            providerConfig: {
              id: "node-loop-forced-final",
              label: "Node Loop Forced Final",
              type: "openai_compatible",
              modelId: "node-loop-forced-final-model",
              baseUrl: "https://node-loop-forced-final.test/v1",
              apiKeyEnv: "NODE_LOOP_FORCED_FINAL_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["web.fetch"],
            budget: {
              maxTokens: 1024,
              maxToolCalls: 1,
              maxRuntimeMs: 60_000,
            },
            completionPolicy: {
              preset: "balanced",
              maxRepeatedToolCalls: 2,
              forceFinalOnBudgetExhausted: true,
              forceFinalOnRepeatedTool: true,
              allowToolCallsAfterUsefulResult: true,
            },
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("succeeded");
      expect(webFetchCalls).toBe(1);
      expect(containsStateSubsequence(states, [
        "pending",
        "running_model",
        "tool_requested",
        "tool_running",
        "tool_result_observed",
        "finalizing",
        "completed",
      ])).toBe(true);
      expectCoreTransitions(states);
      expectNoTransitionDiagnostics(state.events);
      expect(state.toolCalls.filter((call) => call.toolId === "web.fetch")).toHaveLength(1);
      expect(state.output).toMatchObject({
        text: expect.stringContaining("Final answer from the budgeted tool result"),
        metadata: { completion: expect.objectContaining({ forcedFinal: true, stopReason: "tool_budget_exhausted" }) },
      });
      expect(state.events.some((event) =>
        event.type === "completion.updated" &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        (event.payload as Record<string, unknown>).state === "force_final" &&
        (event.payload as Record<string, unknown>).reason === "tool_budget_exhausted"
      )).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_FORCED_FINAL_KEY;
      } else {
        process.env.NODE_LOOP_FORCED_FINAL_KEY = previousKey;
      }
    }
  });

  it("documents forced-final provider fallback recovery", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.NODE_LOOP_FORCED_FINAL_FAILURE_KEY;
    process.env.NODE_LOOP_FORCED_FINAL_FAILURE_KEY = "test";
    let providerCalls = 0;

    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { tool_choice?: string };
      if (body.tool_choice === "none") {
        throw new Error("forced final provider unavailable");
      }
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "call-budget-final-provider-fails",
              type: "function",
              function: {
                name: "web__fetch",
                arguments: "{\"url\":\"https://example.com/should-not-run\"}",
              },
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Use one fetch, then fail during finalization." },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "node-loop-forced-final-failure",
            modelRef: "node-loop-forced-final-failure-model",
            providerConfig: {
              id: "node-loop-forced-final-failure",
              label: "Node Loop Forced Final Failure",
              type: "openai_compatible",
              modelId: "node-loop-forced-final-failure-model",
              baseUrl: "https://node-loop-forced-final-failure.test/v1",
              apiKeyEnv: "NODE_LOOP_FORCED_FINAL_FAILURE_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["web.fetch"],
            budget: {
              maxTokens: 1024,
              maxToolCalls: 0,
              maxRuntimeMs: 60_000,
            },
            completionPolicy: {
              preset: "balanced",
              maxRepeatedToolCalls: 2,
              forceFinalOnBudgetExhausted: true,
              forceFinalOnRepeatedTool: true,
              allowToolCallsAfterUsefulResult: true,
            },
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));
      const states = nodeRuntimeStateSequence(state.events, { agentId: ORA_ROOT_AGENT_ID });

      expect(run.status).toBe("succeeded");
      expect(state.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(4);
      expect(containsStateSubsequence(states, ["pending", "finalizing", "failed"])).toBe(true);
      expectCoreTransitions(states);
      expect(states).not.toContain("completed");
      expect(state.events.filter((event) => event.type === "recovery.retry_scheduled")).toHaveLength(2);
      expect(state.events.filter((event) => event.type === "recovery.applied")).toHaveLength(1);
      expect(state.events.map((event) => event.type)).not.toContain("run.failed");
      expect(state.events.map((event) => event.type)).toContain("run.done");
      expect(state.toolCalls.filter((call) => call.toolId === "web.fetch")).toHaveLength(0);
      expect(state.output?.text).toContain("continued with limited context after forced-final provider recovery");
      expect(state.artifacts.some((artifact) => artifact.kind === "log" && artifact.label.includes("Recovery"))).toBe(true);
      expect(state.events.some((event) =>
        event.type === "recovery.applied" &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        ((event.payload as Record<string, unknown>).decision as { action?: unknown } | undefined)?.action === "fallback_artifact"
      )).toBe(true);
      expect(state.events.some((event) =>
        event.type === "completion.updated" &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        (event.payload as Record<string, unknown>).state === "force_final" &&
        (event.payload as Record<string, unknown>).reason === "tool_budget_exhausted"
      )).toBe(true);
      expectNoTransitionDiagnostics(state.events);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.NODE_LOOP_FORCED_FINAL_FAILURE_KEY;
      } else {
        process.env.NODE_LOOP_FORCED_FINAL_FAILURE_KEY = previousKey;
      }
    }
  });
});
