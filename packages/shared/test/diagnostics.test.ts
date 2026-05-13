import { describe, expect, it } from "vitest";
import { deriveRunDiagnostics, type StateSnapshot } from "../src/index.js";

function snapshot(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  const base: StateSnapshot = {
    runId: "run-diagnostics",
    turnIndex: 1,
    status: "succeeded",
    pattern: "orchestrator_subagent",
    coordinationKind: "orchestrator_subagent",
    input: { prompt: "Debug this run.", createdAt: 1_714_000_000_000, context: {} },
    config: {
      pattern: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: [],
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      permissionMode: "default",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "diagnostics-test",
      skillIds: [],
      toolIds: [],
    },
    topology: { nodes: [], edges: [] },
    profiles: [],
    memory: [],
    plan: [],
    planList: [],
    todos: [],
    actions: [],
    toolCalls: [],
    continuation: { frames: [] },
    planDecisions: [],
    conversation: [],
    contextState: {
      activeTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: "estimate" },
      compactedHistory: [],
      compactedThroughTurnIndex: 0,
      compactionCount: 0,
    },
    toolResults: [],
    policyDecisions: [],
    checkpoints: [],
    events: [],
    agentMessages: [],
    artifacts: [],
    activeAgents: [],
    queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
    sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
    busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
    pendingClarifications: [],
    pendingApprovals: [],
    updatedAt: 1_714_000_000_001,
  };
  return { ...base, ...overrides };
}

describe("deriveRunDiagnostics", () => {
  it("detects provider or tool failures with trace refs", () => {
    const summary = deriveRunDiagnostics(snapshot({
      status: "failed",
      toolCalls: [{
        id: "tool-1",
        runId: "run-diagnostics",
        toolId: "shell",
        args: { cmd: "pnpm test" },
        source: "provider_native",
        status: "failed",
        requestedAt: 1,
        updatedAt: 2,
        error: "exit 1",
      }],
      events: [{ id: "evt-1", runId: "run-diagnostics", seq: 1, type: "run.failed", createdAt: 2, payload: { error: "exit 1" } }],
    }));

    expect(summary.primaryFinding?.kind).toBe("provider_or_tool_failure");
    expect(summary.traceRefs).toContainEqual({ type: "tool_call", id: "tool-1" });
  });

  it("detects repeated tool calls", () => {
    const toolCalls = [0, 1, 2].map((index) => ({
      id: `tool-${index}`,
      runId: "run-diagnostics",
      toolId: "read_file",
      args: { path: "src/app.ts" },
      source: "provider_native" as const,
      status: "succeeded" as const,
      requestedAt: index,
      updatedAt: index + 1,
    }));

    const summary = deriveRunDiagnostics(snapshot({ toolCalls }));

    expect(summary.signals.some((signal) => signal.kind === "repeated_tool_call")).toBe(true);
  });

  it("detects cost or event blowup from configured tool budget", () => {
    const toolCalls = [0, 1, 2].map((index) => ({
      id: `tool-${index}`,
      runId: "run-diagnostics",
      toolId: "shell",
      args: { index },
      source: "provider_native" as const,
      status: "succeeded" as const,
      requestedAt: index,
      updatedAt: index + 1,
    }));

    const summary = deriveRunDiagnostics(snapshot({
      config: {
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: [],
        modelRef: "local/smoke-model",
        budget: { maxTokens: 1000, maxToolCalls: 2, maxRuntimeMs: 10000 },
        approvalMode: "high_risk_only",
        permissionMode: "default",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "diagnostics-test",
        skillIds: [],
        toolIds: [],
      },
      toolCalls,
    }));

    expect(summary.signals.some((signal) => signal.kind === "cost_or_event_blowup")).toBe(true);
  });

  it("detects blocking gates and suggests resume when a paused frame exists", () => {
    const summary = deriveRunDiagnostics(snapshot({
      status: "interrupted",
      pendingApprovals: ["action-1"],
      continuation: {
        activeFrameId: "frame-1",
        frames: [{
          id: "frame-1",
          runId: "run-diagnostics",
          status: "paused",
          reason: "approval_required",
          conversationCursor: 0,
          pendingActionIds: ["action-1"],
          pendingToolCallIds: [],
          pendingClarificationIds: [],
          approvedActionIds: [],
          resolvedClarificationIds: [],
          createdAt: 1,
          updatedAt: 1,
        }],
      },
    }));

    expect(summary.signals.some((signal) => signal.kind === "blocking_gate")).toBe(true);
    expect(summary.suggestedActions.some((action) => action.kind === "resume")).toBe(true);
  });

  it("does not promote approval-interrupt snapshots to provider failure when an approval gate is active", () => {
    const summary = deriveRunDiagnostics(snapshot({
      status: "failed",
      error: "Waiting for your approval before continuing.",
      pendingApprovals: ["action-1"],
      actions: [{
        id: "action-1",
        runId: "run-diagnostics",
        type: "shell.execute",
        riskLevel: "high",
        status: "approval_required",
        input: {},
        artifactIds: [],
      }],
      attention: {
        kind: "needs_approval",
        blocking: true,
        pendingActionIds: ["action-1"],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
        sourceRunId: "run-diagnostics",
      },
      events: [{
        id: "evt-interrupted",
        runId: "run-diagnostics",
        seq: 1,
        type: "run.interrupted",
        createdAt: 2,
        payload: { reason: "approval_required", actionId: "action-1" },
      }],
    }));

    expect(summary.primaryFinding?.kind).toBe("blocking_gate");
    expect(summary.signals.some((signal) => signal.kind === "provider_or_tool_failure")).toBe(false);
  });

  it("detects mode mismatch from degraded provider policy", () => {
    const summary = deriveRunDiagnostics(snapshot({
      config: {
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: [],
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        permissionMode: "default",
        effectiveStrategy: {
          requestedModeId: "recoverable_long_task",
          resolvedModeId: "single_agent",
          providerPolicyStatus: "degraded",
          notes: ["Provider cannot satisfy required thinking policy."],
          policy: { thinking: "standard", reasoningEffort: "medium", budgetProfile: "balanced", planning: "light", delegation: "none", providerThinking: "auto" },
          budget: { maxTokens: 1000, maxToolCalls: 10, maxRuntimeMs: 10000 },
        },
        patternOptions: {},
        metadata: {},
        deterministicSeed: "diagnostics-test",
        skillIds: [],
        toolIds: [],
      },
    }));

    expect(summary.signals.some((signal) => signal.kind === "mode_mismatch")).toBe(true);
  });
});
