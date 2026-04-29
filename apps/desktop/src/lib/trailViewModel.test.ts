import { describe, expect, it } from "vitest";
import {
  buildAgentLanes,
  buildActiveMemorySummary,
  buildEffectiveStrategySummary,
  buildSemanticTimeline,
  buildToolLedger,
  buildTrailDebugSummary,
  collectTrailFindings,
} from "./trailViewModel";
import type { OraStateSnapshot } from "./runtimeClient";

describe("trail debugger view model", () => {
  it("keeps local-only traces as info instead of warning findings", () => {
    const snapshot = baseSnapshot({
      status: "succeeded",
      output: { metadata: { stopReason: "completed" } },
      trace: {
        provider: "ora",
        enabled: true,
        available: true,
        source: "local",
        traceId: "ora-local-run",
        generationRefs: [],
      },
      events: [{
        id: "evt-done",
        runId: "run-test",
        seq: 1,
        type: "run.done",
        createdAt: 2,
        payload: { stopReason: "completed" },
      }],
    });

    const findings = collectTrailFindings(snapshot, undefined, snapshot.trace, []);
    const summary = buildTrailDebugSummary(snapshot, undefined, [], findings);

    expect(findings).toEqual([
      expect.objectContaining({ severity: "info", id: "run.stop-reason" }),
      expect.objectContaining({ severity: "info", id: "trace.local" }),
    ]);
    expect(findings.some((finding) => finding.severity === "warning")).toBe(false);
    expect(summary.statusLabel).toBe("Done");
    expect(summary.currentStage).toBe("completed");
  });

  it("prioritizes failed runs and points developers to flow evidence", () => {
    const snapshot = baseSnapshot({
      status: "failed",
      events: [{
        id: "evt-failed",
        runId: "run-test",
        seq: 2,
        type: "run.failed",
        createdAt: 3,
        payload: { error: "Verifier response did not contain a parseable pass/fail verdict." },
      }],
    });

    const findings = collectTrailFindings(snapshot, undefined, undefined, []);
    const summary = buildTrailDebugSummary(snapshot, undefined, [], findings);

    expect(findings[0]).toMatchObject({
      severity: "error",
      message: "Run failed: Verifier response did not contain a parseable pass/fail verdict.",
      suggestedTab: "flow",
    });
    expect(summary.statusLabel).toBe("Failed");
    expect(summary.recommendedTab).toBe("flow");
  });

  it("builds semantic flow without high-frequency message deltas", () => {
    const snapshot = baseSnapshot({
      events: [
        {
          id: "evt-message",
          runId: "run-test",
          seq: 1,
          type: "message.delta",
          createdAt: 2,
          agentId: "team_lead",
          payload: { content: "streaming token" },
        },
        {
          id: "evt-tool",
          runId: "run-test",
          seq: 2,
          type: "tool.called",
          createdAt: 3,
          agentId: "builder",
          payload: { toolId: "web.search", status: "succeeded", args: { query: "Ora" } },
        },
        {
          id: "evt-checkpoint",
          runId: "run-test",
          seq: 3,
          type: "checkpoint.created",
          createdAt: 4,
          checkpointId: "checkpoint-1",
          payload: { label: "Pattern checkpoint" },
        },
      ],
    });

    const timeline = buildSemanticTimeline(snapshot);

    expect(timeline.map((item) => item.id)).toEqual(["evt-tool", "evt-checkpoint"]);
    expect(timeline[0]).toMatchObject({ kind: "tool", agentLabel: "Builder" });
    expect(timeline[1]).toMatchObject({ kind: "checkpoint", detail: "Pattern checkpoint" });
  });

  it("groups agent messages and tool counts by agent lane", () => {
    const snapshot = baseSnapshot({
      pattern: "agent_teams",
      activeAgents: ["builder"],
      agentMessages: [{
        id: "agent-message-1",
        runId: "run-test",
        createdAt: 3,
        fromAgentId: "team_lead",
        toAgentIds: ["builder"],
        threadId: "thread-1",
        kind: "mention",
        status: "done",
        content: "@builder build this.",
        artifactIds: [],
      }],
      toolCalls: [{
        id: "tool-1",
        runId: "run-test",
        toolId: "web.search",
        agentId: "builder",
        args: { query: "Ora" },
        source: "provider_native",
        status: "succeeded",
        requestedAt: 3,
        updatedAt: 4,
        result: { status: "succeeded", output: "ok", createdAt: 4, updatedAt: 4 },
      }],
    });

    const lanes = buildAgentLanes(snapshot, [], undefined, []);

    expect(lanes.find((lane) => lane.id === "team_lead")?.messages).toHaveLength(1);
    expect(lanes.find((lane) => lane.id === "builder")).toMatchObject({
      label: "Builder",
      status: "active",
      toolCount: 1,
    });
  });

  it("summarizes tool ledger status, latency, args, and result", () => {
    const snapshot = baseSnapshot({
      toolCalls: [{
        id: "tool-1",
        runId: "run-test",
        toolId: "skills.create",
        agentId: "builder",
        nodeId: "build",
        args: { name: "think" },
        source: "manual_repair",
        status: "repaired",
        requestedAt: 1000,
        updatedAt: 1500,
        repairReason: "missing_provider_tool_result",
        result: { status: "interrupted", error: "interrupted", createdAt: 1500, updatedAt: 1500 },
      }],
    });

    expect(buildToolLedger(snapshot)[0]).toMatchObject({
      toolId: "skills.create",
      statusTone: "warning",
      source: "manual repair",
      agentLabel: "Builder",
      nodeLabel: "Build",
      latency: "500ms",
      argsPreview: "{\"name\":\"think\"}",
      resultPreview: "interrupted",
    });
  });

  it("surfaces active continuation frames as flow findings", () => {
    const snapshot = baseSnapshot({
      continuation: {
        activeFrameId: "run-test:continuation:0",
        frames: [{
          id: "run-test:continuation:0",
          runId: "run-test",
          status: "paused",
          reason: "approval_required",
          conversationCursor: 2,
          pendingActionIds: ["run-test:action:tool-1"],
          pendingToolCallIds: ["run-test:tool-call-1"],
          pendingClarificationIds: [],
          approvedActionIds: [],
          resolvedClarificationIds: [],
          createdAt: 3,
          updatedAt: 4,
        }],
      },
    });

    expect(collectTrailFindings(snapshot, undefined, undefined, [])).toContainEqual(
      expect.objectContaining({
        id: "continuation.paused:run-test:continuation:0",
        severity: "info",
        suggestedTab: "flow",
      }),
    );
  });

  it("summarizes degraded effective runtime strategy", () => {
    const snapshot = baseSnapshot({
      config: {
        ...baseSnapshot().config,
        effectiveStrategy: {
          sourceModeId: "agent_teams",
          sourceModeSelection: "manual",
          thinking: "deep",
          reasoningEffort: "high",
          budgetProfile: "deep",
          budget: { maxTokens: 24000, maxToolCalls: 64, maxRuntimeMs: 600000, maxCostUsd: 5 },
          planning: "explicit",
          planningEnabled: true,
          delegation: "preferred",
          delegationEnabled: true,
          providerThinkingEnabled: false,
          providerPolicyStatus: "degraded",
          notes: ["Provider 'local-smoke' does not advertise reasoning support."],
        },
      },
    });

    expect(buildEffectiveStrategySummary(snapshot)).toMatchObject({
      title: "Deep thinking",
      statusLabel: "Degraded",
      statusTone: "warning",
    });
    expect(collectTrailFindings(snapshot, undefined, undefined, [])).toContainEqual(
      expect.objectContaining({
        id: "strategy.provider-degraded",
        severity: "warning",
      }),
    );
  });

  it("summarizes active-memory run metadata", () => {
    const snapshot = baseSnapshot({
      config: {
        ...baseSnapshot().config,
        metadata: {
          activeMemory: {
            decision: {
              status: "USE",
              mode: "deterministic",
              reason: "Selected one relevant memory card.",
              candidateIds: ["fact_1", "fact_2"],
              selectedIds: ["fact_1"],
              rejectedIds: ["fact_2"],
              budget: { maxCandidates: 12, maxChars: 1800, renderedChars: 320 },
              warnings: [],
            },
            cards: [{ id: "fact_1" }],
          },
        },
      },
    });

    expect(buildActiveMemorySummary(snapshot)).toMatchObject({
      statusLabel: "USE",
      statusTone: "success",
      mode: "deterministic",
      candidateCount: 2,
      selectedIds: ["fact_1"],
      rejectedCount: 1,
      renderedChars: 320,
    });
  });
});

function baseSnapshot(patch: Partial<OraStateSnapshot> = {}): OraStateSnapshot {
  return {
    runId: "run-test",
    sessionId: "session-test",
    turnIndex: 1,
    status: "running",
    pattern: "orchestrator_subagent",
    input: { prompt: "debug this", createdAt: 1, context: {} },
    config: {
      pattern: "orchestrator_subagent",
      modeSelection: "manual",
      profileIds: ["team_lead", "builder"],
      modelRef: "local/smoke-model",
      approvalMode: "high_risk_only",
      patternOptions: {},
      metadata: {},
      deterministicSeed: "trail-view-model-test",
      skillIds: [],
      toolIds: [],
    },
    topology: {
      nodes: [
        { id: "team_lead", label: "Team Lead", kind: "agent", role: "Lead", agentId: "team_lead", status: "idle", x: 0, y: 0 },
        { id: "build", label: "Build", kind: "agent", role: "Builder", agentId: "builder", status: "active", x: 0, y: 0 },
      ],
      edges: [],
    },
    profiles: [
      {
        id: "team_lead",
        label: "Team Lead",
        role: "Coordinate workers.",
        modelRef: "local/smoke-model",
        toolPolicyId: "policy",
        memoryNamespaces: ["session"],
        budget: { maxTokens: 1000, maxToolCalls: 2, maxRuntimeMs: 1000 },
      },
      {
        id: "builder",
        label: "Builder",
        role: "Build assigned work.",
        modelRef: "local/smoke-model",
        toolPolicyId: "policy",
        memoryNamespaces: ["session"],
        budget: { maxTokens: 1000, maxToolCalls: 2, maxRuntimeMs: 1000 },
      },
    ],
    memory: [],
    plan: [],
    todos: [],
    actions: [],
    toolCalls: [],
    continuation: { frames: [] },
    conversation: [],
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
    updatedAt: 5,
    ...patch,
  } as OraStateSnapshot;
}
