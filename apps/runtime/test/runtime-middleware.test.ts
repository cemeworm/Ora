import { describe, expect, it } from "vitest";
import type { OraEventEnvelope, RunConfig } from "@cemeworm/shared";
import type { ModelRequest, ModelResponse } from "../src/providers/index.js";
import {
  composeRuntimeModelResponse,
  composeRuntimeModelCall,
  composeRuntimeToolExecution,
  createBatchClarificationResponseMiddleware,
  createClarificationToolMiddleware,
  createContextCompactionMiddleware,
  createDanglingToolCallRepairMiddleware,
  createToolRecoveryMiddleware,
  repairDanglingProviderToolCalls,
  type RuntimeMiddleware,
  type RuntimeMiddlewareContext,
  type RuntimeModelResponseContext,
} from "../src/harness/runtime-middleware.js";

function response(text = "done"): ModelResponse {
  return {
    providerId: "test-provider",
    providerType: "local_smoke",
    modelId: "test-model",
    text,
    raw: {},
  };
}

function context(overrides: Partial<RuntimeMiddlewareContext> = {}): RuntimeMiddlewareContext {
  const events: OraEventEnvelope[] = [];
  return {
    config: {
      providerId: "local-smoke",
      providerConfig: {
        id: "local-smoke",
        type: "local_smoke",
        label: "Smoke",
        modelId: "smoke-model",
        capabilities: ["chat"],
        headers: {},
      },
      metadata: {},
    } as RunConfig,
    agentId: "agent-1",
    nodeId: "node-1",
    title: "Agent",
    now: () => 123,
    appendToolCall: (params) => ({ id: "tool-call-1", runId: "run-1", createdAt: 123, updatedAt: 123, ...params }) as never,
    emit: (type, payload, extra = {}) => {
      const event = {
        id: `event-${events.length}`,
        runId: "run-1",
        seq: events.length,
        type,
        createdAt: 123,
        pattern: "orchestrator_subagent",
        payload,
        ...extra,
      } as OraEventEnvelope;
      events.push(event);
      return event;
    },
    ...overrides,
  };
}

function responseContext(overrides: Partial<RuntimeModelResponseContext> = {}): RuntimeModelResponseContext {
  const emitted: OraEventEnvelope[] = [];
  const actions = new Map<string, any>();
  const toolCalls: unknown[] = [];
  const base = context({
    appendToolCall: (params) => {
      const record = { id: `tool-call-${toolCalls.length}`, runId: "run-1", createdAt: 123, updatedAt: 123, ...params } as never;
      toolCalls.push(record);
      return record;
    },
    emit: (type, payload, extra = {}) => {
      const event = {
        id: `event-${emitted.length}`,
        runId: "run-1",
        seq: emitted.length,
        type,
        createdAt: 123,
        pattern: "orchestrator_subagent",
        payload,
        ...extra,
      } as OraEventEnvelope;
      emitted.push(event);
      return event;
    },
  });
  return {
    ...base,
    system: "system",
    actionDeps: () => ({
      actionLedger: {
        propose: (record: any) => {
          const action = { runId: "run-1", status: "proposed", artifactIds: [], ...record };
          actions.set(action.id, action);
          return action;
        },
        transition: (id: string, status: string, patch?: Record<string, unknown>) => {
          const previous = actions.get(id) ?? { id, runId: "run-1", type: "user.clarify", riskLevel: "low", input: {}, agentId: "agent-1", artifactIds: [] };
          const next = { ...previous, ...patch, status };
          actions.set(id, next);
          return next;
        },
      },
      emit: base.emit,
      appendToolCall: base.appendToolCall,
    }) as never,
    emitNodeRuntimeState: () => {},
    emitToolRequested: () => {},
    emitToolRunning: () => {},
    emitToolResultObserved: () => {},
    emitModelRequest: () => {},
    emitForcedFinal: () => {},
    emitGateRequired: () => {},
    eventsLength: () => emitted.length,
    clarificationAnswer: () => undefined,
    ensureClarification: async () => undefined,
    ensureClarifications: async () => [],
    completion: {
      markToolResultObserved: () => {},
      forcedFinalIsActive: () => false,
      stopReasonForScope: () => undefined,
    } as never,
    runForcedFinalProviderCall: async () => response("forced-final"),
    invokeFollowUpModel: async (request) => response(String(request.messages?.length ?? 0)),
    ...overrides,
  };
}

describe("runtime middleware chain", () => {
  it("runs model wrappers in priority order and passes mutated requests forward", async () => {
    const seen: string[] = [];
    const middlewares: RuntimeMiddleware[] = [
      {
        name: "second",
        priority: 20,
        async wrapModelCall(request, _context, next) {
          seen.push(`enter:${request.system}`);
          const result = await next({ ...request, system: `${request.system}:second` });
          seen.push(`exit:${result.text}`);
          return { ...result, text: `${result.text}:second` };
        },
      },
      {
        name: "first",
        priority: 10,
        async wrapModelCall(request, _context, next) {
          seen.push(`enter:${request.system}`);
          const result = await next({ ...request, system: `${request.system}:first` });
          seen.push(`exit:${result.text}`);
          return { ...result, text: `${result.text}:first` };
        },
      },
    ];
    const handler = composeRuntimeModelCall(
      middlewares,
      context(),
      async (request: ModelRequest) => {
        seen.push(`terminal:${request.system}`);
        return response("terminal");
      },
    );

    const result = await handler({ system: "base" });

    expect(result.text).toBe("terminal:second:first");
    expect(seen).toEqual([
      "enter:base",
      "enter:base:first",
      "terminal:base:first:second",
      "exit:terminal",
      "exit:terminal:second",
    ]);
  });

  it("allows a middleware to short-circuit a model call", async () => {
    const handler = composeRuntimeModelCall(
      [{
        name: "short",
        async wrapModelCall() {
          return response("short-circuited");
        },
      }],
      context(),
      async () => {
        throw new Error("terminal should not run");
      },
    );

    await expect(handler({ system: "base" })).resolves.toMatchObject({
      text: "short-circuited",
    });
  });

  it("repairs dangling provider tool calls and records repair evidence", async () => {
    const toolCalls: unknown[] = [];
    const emitted: OraEventEnvelope[] = [];
    let replaced: readonly unknown[] | undefined;
    const ctx = context({
      appendToolCall: (params) => {
        toolCalls.push(params);
        return { id: "tool-call-1", runId: "run-1", createdAt: 123, updatedAt: 123, ...params } as never;
      },
      emit: (type, payload, extra = {}) => {
        const event = {
          id: `event-${emitted.length}`,
          runId: "run-1",
          seq: emitted.length,
          type,
          createdAt: 123,
          pattern: "orchestrator_subagent",
          payload,
          ...extra,
        } as OraEventEnvelope;
        emitted.push(event);
        return event;
      },
      replaceMessages: (messages) => {
        replaced = messages;
      },
    });

    const repaired = repairDanglingProviderToolCalls([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "dangling-call", toolId: "web.search", args: { query: "Ora" } }],
      },
    ], ctx);

    expect(repaired).toHaveLength(2);
    expect(replaced).toHaveLength(2);
    expect(toolCalls).toEqual([
      expect.objectContaining({
        providerCallId: "dangling-call",
        toolId: "web.search",
        source: "manual_repair",
        status: "repaired",
        repairReason: "missing_provider_tool_result",
      }),
    ]);
    expect(emitted).toEqual([
      expect.objectContaining({
        type: "tool.repaired",
        payload: expect.objectContaining({
          providerCallId: "dangling-call",
          repairReason: "missing_provider_tool_result",
        }),
      }),
    ]);
    expect(repaired?.[1]).toMatchObject({
      role: "tool",
      toolCallId: "dangling-call",
      toolName: "web.search",
    });
  });

  it("applies dangling tool repair as a model-call wrapper", async () => {
    const ctx = context();
    const middleware = createDanglingToolCallRepairMiddleware();
    const result = await middleware.wrapModelCall!(
      {
        messages: [{
          role: "assistant",
          content: "",
          toolCalls: [{ id: "dangling-call", toolId: "file.read", args: { path: "README.md" } }],
        }],
      },
      ctx,
      async (request) => response(String(request.messages?.length ?? 0)),
    );

    expect(result.text).toBe("2");
  });

  it("skips mid-turn compaction rewrites to preserve provider cache prefixes", async () => {
    const emitted: OraEventEnvelope[] = [];
    let replaced: readonly unknown[] | undefined;
    const ctx = context({
      config: {
        providerId: "local-smoke",
        providerConfig: {
          id: "local-smoke",
          type: "local_smoke",
          label: "Smoke",
          modelId: "smoke-model",
          autoCompactTokenLimit: 1,
          capabilities: ["chat"],
          headers: {},
        },
        metadata: {},
      } as RunConfig,
      modelNodeId: "plan-node-1",
      emit: (type, payload, extra = {}) => {
        const event = {
          id: `event-${emitted.length}`,
          runId: "run-1",
          seq: emitted.length,
          type,
          createdAt: 123,
          pattern: "orchestrator_subagent",
          payload,
          ...extra,
        } as OraEventEnvelope;
        emitted.push(event);
        return event;
      },
      replaceMessages: (messages) => {
        replaced = messages;
      },
    });
    const middleware = createContextCompactionMiddleware();
    const result = await middleware.wrapModelCall!(
      {
        messages: [{ role: "user", content: "large context ".repeat(20) }],
        system: "system",
      },
      ctx,
      async (request) => response(request.messages?.[0]?.content ?? ""),
      {
        compaction: {
          latestResponse: response("previous response"),
          reason: "tool_follow_up",
        },
      },
    );

    expect(result.text).toContain("large context");
    expect(replaced).toBeUndefined();
    expect(emitted.map((event) => event.type)).toEqual([
      "context.usage.updated",
      "context.compaction.skipped",
    ]);
    expect(emitted[0]).toMatchObject({
      agentId: "agent-1",
      nodeId: "plan-node-1",
      payload: expect.objectContaining({ reason: "tool_follow_up", limit: 1 }),
    });
  });

  it("lets tool middleware short-circuit user clarification execution with an answered clarification", async () => {
    const middleware = createClarificationToolMiddleware();
    const handler = composeRuntimeToolExecution(
      [middleware],
      {
        ...context(),
        actionDeps: () => ({}) as never,
        emitNodeRuntimeState: () => {},
        eventsLength: () => 7,
        clarificationAnswer: () => "staging",
        ensureClarification: async () => "staging",
      },
      async () => {
        throw new Error("terminal should not execute clarification tools");
      },
    );

    const result = await handler({
      action: { id: "action-1", type: "user.clarify", riskLevel: "low", status: "running", input: {}, agentId: "agent-1" } as never,
      toolCall: {
        tool: "user.clarify",
        args: {
          question: "Target environment?",
          key: "target_environment",
          options: [{ id: "staging", label: "Staging" }],
        },
        source: "provider_native",
        providerCallId: "tool-call-1",
      },
      toolCallRecord: { id: "tool-record-1" } as never,
      allowRisky: false,
      iteration: 2,
    });

    expect(result.output).toEqual({
      status: "clarification_answered",
      question: "Target environment?",
      answer: "staging",
    });
  });

  it("routes tool failures through recovery middleware", async () => {
    const middleware = createToolRecoveryMiddleware();
    const error = new Error("boom");
    const result = await middleware.wrapToolFailure!(
      {
        error,
        action: { id: "action-1", type: "file.read", riskLevel: "low", status: "running", input: {}, agentId: "agent-1" } as never,
        toolCall: { tool: "file.read", args: { path: "README.md" } },
        toolCallRecord: { id: "tool-record-1" } as never,
        allowRisky: false,
        iteration: 0,
        response: response("previous"),
      },
      {
        ...context(),
        actionDeps: () => ({}) as never,
        emitNodeRuntimeState: () => {},
        eventsLength: () => 0,
        clarificationAnswer: () => undefined,
        ensureClarification: async () => undefined,
        recoverToolFailure: async (request) => ({
          kind: "throw",
          error: request.error,
        }),
      },
      async () => ({ kind: "retry" }),
    );

    expect(result).toEqual({ kind: "throw", error });
  });

  it("leaves non-batch clarification responses unhandled", async () => {
    const handler = composeRuntimeModelResponse(
      [createBatchClarificationResponseMiddleware()],
      responseContext(),
      async () => ({ kind: "unhandled" }),
    );

    const result = await handler({
      response: response("needs one answer"),
      iteration: 0,
      messages: [],
      selectedToolCall: {
        tool: "user.clarify",
        args: { key: "target_environment", question: "Target environment?" },
        source: "provider_native",
        providerCallId: "call-1",
      },
      allNativeToolCalls: [{
        tool: "user.clarify",
        args: { key: "target_environment", question: "Target environment?" },
        source: "provider_native",
        providerCallId: "call-1",
      }],
      nativeTools: [],
    });

    expect(result).toEqual({ kind: "unhandled" });
  });

  it("interrupts for unanswered batch native clarifications", async () => {
    const middleware = createBatchClarificationResponseMiddleware();
    const ensured: unknown[] = [];

    await expect(middleware.wrapModelResponse!(
      {
        response: response("needs answers"),
        iteration: 1,
        messages: [],
        selectedToolCall: {
          tool: "user.clarify",
          args: { key: "target_environment", question: "Target environment?" },
          source: "provider_native",
          providerCallId: "call-env",
        },
        allNativeToolCalls: [
          {
            tool: "user.clarify",
            args: { key: "target_environment", question: "Target environment?" },
            source: "provider_native",
            providerCallId: "call-env",
          },
          {
            tool: "user.clarify",
            args: { key: "time_window", question: "Time window?" },
            source: "provider_native",
            providerCallId: "call-window",
          },
        ],
        nativeTools: [],
      },
      responseContext({
        ensureClarifications: async (requests) => {
          ensured.push(...requests);
          throw new Error("clarification interrupt");
        },
      }),
      async () => ({ kind: "unhandled" }),
    )).rejects.toThrow("clarification interrupt");

    expect(ensured).toHaveLength(2);
    expect(ensured).toEqual([
      expect.objectContaining({ key: "target_environment", question: "Target environment?" }),
      expect.objectContaining({ key: "time_window", question: "Time window?" }),
    ]);
  });

  it("continues after answered batch native clarifications with tool result messages", async () => {
    let replaced: readonly unknown[] | undefined;
    let followUpMessages: readonly unknown[] | undefined;
    const middleware = createBatchClarificationResponseMiddleware();
    const result = await middleware.wrapModelResponse!(
      {
        response: {
          ...response("needs answers"),
          toolCalls: [
            { id: "call-env", toolId: "user.clarify", args: { key: "target_environment", question: "Target environment?" } },
            { id: "call-window", toolId: "user.clarify", args: { key: "time_window", question: "Time window?" } },
          ],
        },
        iteration: 1,
        messages: [{ role: "user", content: "Plan deployment." }],
        selectedToolCall: {
          tool: "user.clarify",
          args: { key: "target_environment", question: "Target environment?" },
          source: "provider_native",
          providerCallId: "call-env",
        },
        allNativeToolCalls: [
          {
            tool: "user.clarify",
            args: { key: "target_environment", question: "Target environment?" },
            source: "provider_native",
            providerCallId: "call-env",
          },
          {
            tool: "user.clarify",
            args: { key: "time_window", question: "Time window?" },
            source: "provider_native",
            providerCallId: "call-window",
          },
        ],
        nativeTools: [],
      },
      responseContext({
        replaceMessages: (messages) => {
          replaced = messages;
        },
        clarificationAnswer: () => "answered",
        ensureClarification: async ({ key }) => key === "target_environment" ? "staging" : "last_30_days",
        invokeFollowUpModel: async (request) => {
          followUpMessages = request.messages;
          return response("continued");
        },
      }),
      async () => ({ kind: "unhandled" }),
    );

    expect(result).toEqual({ kind: "handled_continue", response: expect.objectContaining({ text: "continued" }) });
    expect(replaced).toHaveLength(4);
    expect(followUpMessages).toHaveLength(4);
    expect(followUpMessages?.slice(1)).toEqual([
      expect.objectContaining({
        role: "assistant",
        toolCalls: [
          expect.objectContaining({ id: "call-env" }),
          expect.objectContaining({ id: "call-window" }),
        ],
      }),
      expect.objectContaining({ role: "tool", toolCallId: "call-env", content: expect.stringContaining("staging") }),
      expect.objectContaining({ role: "tool", toolCallId: "call-window", content: expect.stringContaining("last_30_days") }),
    ]);
  });
});
