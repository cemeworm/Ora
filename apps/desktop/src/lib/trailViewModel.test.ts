import { describe, expect, it } from "vitest";
import {
  buildAgentLanes,
  buildActiveMemorySummary,
  buildCausalDecisionSummary,
  buildEffectiveStrategySummary,
  buildSemanticTimeline,
  buildToolLedger,
  buildTrailDebugSummary,
  buildPendingApprovalItems,
  buildLatencyDiagnostics,
  collectTrailFindings,
  deriveFirstTextEvidence,
  eventKindLabel,
  severityLabel,
  snapshotPendingClarifications,
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
    expect(summary.statusLabel).toBe("已完成");
    expect(summary.currentStage).toBe("已完成");
  });

  it("adds turn, event, phase, and assistant reply context to causal decisions", () => {
    const snapshot = baseSnapshot({
      turnIndex: 3,
      output: { text: "已记住，QC。你在本对话中我将直接称呼你 QC。" },
      topology: {
        nodes: [
          { id: "agent-1", label: "Ora", kind: "agent", agentId: "agent-1", status: "done", metadata: {} },
        ],
        edges: [],
      },
      profiles: [
        {
          id: "agent-1",
          label: "Ora",
          role: "Assistant",
          modelRef: "local/smoke-model",
          toolPolicyId: "policy",
          toolIds: [],
          skillIds: [],
          memoryNamespaces: ["session"],
          budget: { maxTokens: 1000, maxToolCalls: 2, maxRuntimeMs: 1000 },
        },
      ],
      events: [{
        id: "evt-causal-1",
        runId: "run-test",
        seq: 12,
        type: "causal.decision.recorded",
        createdAt: 1000,
        agentId: "agent-1",
        nodeId: "agent-1",
        payload: {
          taskState: { surfaceRequest: "叫我 QC" },
          policyDecision: {
            goalUncertainty: 0.7,
            factUncertainty: 0.2,
            contextUncertainty: 0.3,
            actionRisk: 0.1,
            userCost: 0.3,
            reversibility: "high",
            recommendedAction: "use_tool",
            reason: "use_tool: low uncertainty, safe to proceed",
            wouldChangeOutcomeIfWrong: false,
          },
          chosenIntervention: "use_tool",
          alternativeInterventions: [],
          recordedAt: 1000,
          decisionContext: {
            phase: "tool_request",
            turnIndex: 3,
            replyMessageId: "run-test:assistant",
            toolId: "file.read",
            iteration: 2,
            agentId: "agent-1",
            nodeId: "agent-1",
          },
        },
      }],
      toolCalls: [{
        id: "run-test:tool-call-0",
        runId: "run-test",
        toolId: "file.read",
        agentId: "agent-1",
        nodeId: "agent-1",
        args: {},
        source: "provider_native",
        status: "succeeded",
        requestedAt: 1000,
        updatedAt: 1001,
      }],
    });

    const summary = buildCausalDecisionSummary(snapshot);

    expect(summary.totalDecisions).toBe(1);
    expect(summary.decisions[0]).toMatchObject({
      eventId: "evt-causal-1",
      eventSeq: 12,
      runId: "run-test",
      turnIndex: 3,
      replyMessageId: "run-test:assistant",
      replyLabel: "#assistant",
      phase: "tool_request",
      phaseLabel: "工具请求 · file.read #2",
      agentLabel: "Ora",
      nodeLabel: "Ora",
      assistantPreview: "当前未找到与该干预直接绑定的回复片段。",
    });
  });

  it("falls back to snapshot turn and event id for legacy causal decisions", () => {
    const snapshot = baseSnapshot({
      turnIndex: 2,
      events: [{
        id: "evt-legacy-causal",
        runId: "run-test",
        seq: 7,
        type: "causal.decision.recorded",
        createdAt: 1000,
        payload: {
          taskState: { surfaceRequest: "叫我 QC" },
          policyDecision: {
            goalUncertainty: 0.7,
            factUncertainty: 0.2,
            contextUncertainty: 0.3,
            actionRisk: 0.1,
            userCost: 0.3,
            reversibility: "high",
            recommendedAction: "use_tool",
            reason: "use_tool: low uncertainty, safe to proceed",
            wouldChangeOutcomeIfWrong: false,
          },
          chosenIntervention: "use_tool",
          alternativeInterventions: [],
          recordedAt: 1000,
          decisionContext: {
            phase: "tool_request",
            toolId: "file.read",
          },
        },
      }],
      toolCalls: [{
        id: "run-test:tool-call-legacy",
        runId: "run-test",
        toolId: "file.read",
        args: {},
        source: "provider_native",
        status: "succeeded",
        requestedAt: 1000,
        updatedAt: 1001,
      }],
    });

    const decision = buildCausalDecisionSummary(snapshot).decisions[0];

    expect(decision).toMatchObject({
      eventId: "evt-legacy-causal",
      eventSeq: 7,
      turnIndex: 2,
      replyMessageId: "run-test:assistant",
      replyLabel: "#assistant",
      phaseLabel: "工具请求 · file.read",
    });
  });

  it("keeps effective runtime follow-up gate episodes visible by default", () => {
    const snapshot = baseSnapshot({
      status: "interrupted",
      events: [
        {
          id: "evt-primary",
          runId: "run-test",
          seq: 3,
          type: "causal.decision.recorded",
          createdAt: 1000,
          payload: {
            source: "router_primary",
            taskState: { surfaceRequest: "读取 README" },
            policyDecision: {
              goalUncertainty: 0.3,
              factUncertainty: 0.2,
              contextUncertainty: 0.2,
              actionRisk: 0.1,
              userCost: 0.05,
              reversibility: "high",
              recommendedAction: "use_tool",
              reason: "use_tool: low uncertainty, safe to proceed",
              wouldChangeOutcomeIfWrong: false,
            },
            chosenIntervention: "use_tool",
            alternativeInterventions: [],
            recordedAt: 1000,
            decisionContext: { phase: "tool_request", toolId: "file.read" },
          },
        },
        {
          id: "evt-followup",
          runId: "run-test",
          seq: 4,
          type: "causal.decision.recorded",
          createdAt: 1001,
          payload: {
            source: "runtime_followup",
            decisionKind: "approval_triggered",
            taskState: { surfaceRequest: "读取 README" },
            policyDecision: {
              goalUncertainty: 0.3,
              factUncertainty: 0.2,
              contextUncertainty: 0.2,
              actionRisk: 0.8,
              userCost: 0.5,
              reversibility: "low",
              recommendedAction: "request_approval",
              reason: "request_approval: approval gate triggered at runtime",
              wouldChangeOutcomeIfWrong: true,
            },
            chosenIntervention: "request_approval",
            alternativeInterventions: [],
            recordedAt: 1001,
            decisionContext: { phase: "approval_triggered", toolId: "file.read", toolCallId: "run-test:tool-call-1b" },
          },
        },
      ],
      toolCalls: [
        {
          id: "run-test:tool-call-0",
          runId: "run-test",
          toolId: "file.read",
          args: {},
          source: "provider_native",
          status: "succeeded",
          requestedAt: 1000,
          updatedAt: 1001,
        },
        {
          id: "run-test:tool-call-1b",
          runId: "run-test",
          toolId: "file.read",
          args: {},
          source: "provider_native",
          status: "approval_required",
          requestedAt: 1001,
          updatedAt: 1002,
        },
      ],
    });

    const summary = buildCausalDecisionSummary(snapshot);

    expect(summary.totalDecisions).toBe(2);
    expect(summary.hiddenDecisionCount).toBe(0);
    expect(summary.decisions[0]).toMatchObject({
      eventId: "evt-primary",
      intervention: "use_tool",
      outcomeSummary: "已执行 file.read，并产出成功结果。",
    });
    expect(summary.decisions[1]).toMatchObject({
      eventId: "evt-followup",
      intervention: "request_approval",
      status: "pending",
      outcomeSummary: "已进入审批关卡，等待用户确认后继续。",
    });
  });

  it("binds assistant previews to each episode instead of reusing the latest assistant text", () => {
    const snapshot = baseSnapshot({
      events: [
        {
          id: "evt-first",
          runId: "run-test",
          seq: 10,
          type: "causal.decision.recorded",
          createdAt: 1000,
          agentId: "agent-1",
          nodeId: "agent-1",
          payload: {
            source: "router_primary",
            taskState: { surfaceRequest: "先解释现状，再给方案" },
            policyDecision: {
              goalUncertainty: 0.2,
              factUncertainty: 0.2,
              contextUncertainty: 0.2,
              actionRisk: 0.1,
              userCost: 0.05,
              reversibility: "high",
              recommendedAction: "answer_directly",
              reason: "answer_directly: low uncertainty, safe to proceed",
              wouldChangeOutcomeIfWrong: false,
            },
            chosenIntervention: "answer_directly",
            alternativeInterventions: [],
            recordedAt: 1000,
            decisionContext: { phase: "completion", replyMessageId: "msg-1", agentId: "agent-1", nodeId: "agent-1" },
          },
        },
        {
          id: "evt-msg-1",
          runId: "run-test",
          seq: 11,
          type: "message.delta",
          createdAt: 1010,
          agentId: "agent-1",
          nodeId: "agent-1",
          payload: { role: "assistant", messageId: "msg-1", content: "第一段解释。", delta: "第一段解释。", streaming: true },
        },
        {
          id: "evt-second",
          runId: "run-test",
          seq: 20,
          type: "causal.decision.recorded",
          createdAt: 2000,
          agentId: "agent-1",
          nodeId: "agent-1",
          payload: {
            source: "router_primary",
            taskState: { surfaceRequest: "给方案" },
            policyDecision: {
              goalUncertainty: 0.2,
              factUncertainty: 0.2,
              contextUncertainty: 0.2,
              actionRisk: 0.1,
              userCost: 0.05,
              reversibility: "high",
              recommendedAction: "answer_directly",
              reason: "answer_directly: low uncertainty, safe to proceed",
              wouldChangeOutcomeIfWrong: false,
            },
            chosenIntervention: "answer_directly",
            alternativeInterventions: [],
            recordedAt: 2000,
            decisionContext: { phase: "completion", replyMessageId: "msg-2", agentId: "agent-1", nodeId: "agent-1" },
          },
        },
        {
          id: "evt-msg-2",
          runId: "run-test",
          seq: 21,
          type: "message.delta",
          createdAt: 2010,
          agentId: "agent-1",
          nodeId: "agent-1",
          payload: { role: "assistant", messageId: "msg-2", content: "第二段方案。", delta: "第二段方案。", streaming: true },
        },
      ],
      output: { text: "第二段方案。" },
      topology: {
        nodes: [{ id: "agent-1", label: "Ora", kind: "agent", agentId: "agent-1", status: "done", metadata: {} }],
        edges: [],
      },
      profiles: [{
        id: "agent-1",
        label: "Ora",
        role: "Assistant",
        modelRef: "local/smoke-model",
        toolPolicyId: "policy",
        toolIds: [],
        skillIds: [],
        memoryNamespaces: ["session"],
        budget: { maxTokens: 1000, maxToolCalls: 2, maxRuntimeMs: 1000 },
      }],
    });

    const summary = buildCausalDecisionSummary(snapshot);

    expect(summary.decisions).toHaveLength(2);
    expect(summary.decisions[0]?.assistantPreview).toBe("第一段解释。");
    expect(summary.decisions[1]?.assistantPreview).toBe("第二段方案。");
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
      message: "运行失败：Verifier response did not contain a parseable pass/fail verdict.",
      suggestedTab: "flow",
    });
    expect(summary.statusLabel).toBe("失败");
    expect(summary.recommendedTab).toBe("flow");
  });

  it("uses canonical attention before stale raw pending gates in trail summaries", () => {
    const snapshot = baseSnapshot({
      status: "running",
      attention: {
        kind: "running",
        blocking: false,
        sourceRunId: "run-test",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
      pendingClarifications: [{
        id: "clarification-stale",
        key: "scope",
        nodeId: "team_lead",
        nodeLabel: "Team Lead",
        question: "Stale question?",
        options: [],
        requestedAt: 2,
      }],
      pendingApprovals: ["action-stale"],
      actions: [{
        id: "action-stale",
        runId: "run-test",
        type: "file.write",
        riskLevel: "high",
        status: "approval_required",
        input: {},
        artifactIds: [],
      }],
      activeAgents: ["builder"],
    });

    const summary = buildTrailDebugSummary(snapshot, undefined, [], []);
    const findings = collectTrailFindings(snapshot, undefined, undefined, []);

    expect(summary.currentStage).toBe("进行中：builder");
    expect(summary.blockingGate).toBe("无");
    expect(buildPendingApprovalItems(snapshot)).toEqual([]);
    expect(snapshotPendingClarifications(snapshot)).toEqual([]);
    expect(findings.some((finding) => finding.id === "approval.pending")).toBe(false);
    expect(findings.some((finding) => finding.id.startsWith("clarification.pending"))).toBe(false);
  });

  it("does not synthesize trail gates from raw pending fields without projection attention", () => {
    const snapshot = baseSnapshot({
      status: "interrupted",
      pendingClarifications: [{
        id: "clarification-raw",
        key: "scope",
        nodeId: "team_lead",
        nodeLabel: "Team Lead",
        question: "Raw question?",
        options: [],
        requestedAt: 2,
      }],
      pendingApprovals: ["action-raw"],
      actions: [{
        id: "action-raw",
        runId: "run-test",
        type: "file.write",
        riskLevel: "high",
        status: "approval_required",
        input: {},
        artifactIds: [],
      }],
    });

    const summary = buildTrailDebugSummary(snapshot, undefined, [], []);
    const findings = collectTrailFindings(snapshot, undefined, undefined, []);

    expect(summary.currentStage).toBe("运行时已初始化");
    expect(summary.blockingGate).toBe("无");
    expect(buildPendingApprovalItems(snapshot)).toEqual([]);
    expect(snapshotPendingClarifications(snapshot)).toEqual([]);
    expect(findings.some((finding) => finding.id === "approval.pending")).toBe(false);
    expect(findings.some((finding) => finding.id.startsWith("clarification.pending"))).toBe(false);
  });

  it("keeps current attention-backed gates visible in trail lists and findings", () => {
    const snapshot = baseSnapshot({
      status: "interrupted",
      attention: {
        kind: "needs_approval",
        blocking: true,
        sourceRunId: "run-test",
        reason: "approval_required",
        pendingActionIds: ["action-live"],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
      actions: [{
        id: "action-live",
        runId: "run-test",
        type: "file.write",
        riskLevel: "high",
        status: "approval_required",
        input: {},
        artifactIds: [],
      }],
    });

    const summary = buildTrailDebugSummary(snapshot, undefined, [], []);
    const findings = collectTrailFindings(snapshot, undefined, undefined, []);

    expect(summary.currentStage).toBe("等待用户输入");
    expect(summary.blockingGate).toBe("确认 · file write");
    expect(buildPendingApprovalItems(snapshot).map((item) => item.actionId)).toEqual(["action-live"]);
    expect(findings.some((finding) => finding.id === "approval.pending")).toBe(true);
  });

  it("shows pending plan decisions as blocking interaction instead of completed terminal state", () => {
    const snapshot = baseSnapshot({
      status: "succeeded",
      planDecisions: [{
        id: "run-test:plan-decision",
        runId: "run-test",
        sessionId: "session-test",
        status: "pending",
        createdAt: 5,
      }],
      attention: {
        kind: "needs_plan_decision",
        blocking: true,
        sourceRunId: "run-test",
        reason: "plan_decision_required",
        planDecisionId: "run-test:plan-decision",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
    });

    const summary = buildTrailDebugSummary(snapshot, undefined, [], []);

    expect(summary.statusLabel).toBe("需要决策");
    expect(summary.statusTone).toBe("warning");
    expect(summary.currentStage).toBe("等待用户输入");
    expect(summary.blockingGate).toBe("决策 · 计划确认");
  });

  it("shows pending plan decisions as blocking even when attention drifted to idle", () => {
    const snapshot = baseSnapshot({
      status: "succeeded",
      planDecisions: [{
        id: "run-test:plan-decision",
        runId: "run-test",
        sessionId: "session-test",
        status: "pending",
        createdAt: 5,
      }],
      attention: {
        kind: "idle",
        blocking: false,
        sourceRunId: "run-test",
        pendingActionIds: [],
        pendingToolCallIds: [],
        pendingClarificationIds: [],
      },
    });

    const summary = buildTrailDebugSummary(snapshot, undefined, [], []);

    expect(summary.statusLabel).toBe("需要决策");
    expect(summary.statusTone).toBe("warning");
    expect(summary.currentStage).toBe("等待用户输入");
    expect(summary.blockingGate).toBe("决策 · 计划确认");
  });

  it("treats approval-interrupt failure text as waiting-for-approval instead of failure", () => {
    const snapshot = baseSnapshot({
      status: "failed",
      error: "Waiting for your approval before continuing.",
      attention: {
        kind: "needs_approval",
        blocking: true,
        sourceRunId: "run-test",
        reason: "approval_required",
        pendingActionIds: ["action-live"],
        pendingToolCallIds: ["tool-live"],
        pendingClarificationIds: [],
      },
      pendingApprovals: ["action-live"],
      actions: [{
        id: "action-live",
        runId: "run-test",
        type: "shell.execute",
        riskLevel: "high",
        status: "approval_required",
        input: {},
        artifactIds: [],
      }],
      toolCalls: [{
        id: "tool-live",
        runId: "run-test",
        toolId: "shell.execute",
        args: { command: "pwd" },
        source: "provider_native",
        status: "failed",
        actionId: "action-live",
        requestedAt: 1,
        updatedAt: 2,
        error: "Waiting for your approval before continuing.",
      }],
    });

    const findings = collectTrailFindings(snapshot, undefined, undefined, []);
    const summary = buildTrailDebugSummary(snapshot, undefined, [], findings);

    expect(summary.statusLabel).toBe("等待确认");
    expect(summary.statusTone).toBe("warning");
    expect(summary.currentStage).toBe("等待用户输入");
    expect(findings.some((finding) => finding.id === "run.failed")).toBe(false);
    expect(findings.some((finding) => finding.id === "approval.pending")).toBe(true);
    expect(findings.some((finding) => finding.id === "tool.failed:tool-live")).toBe(false);
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
        {
          id: "evt-worker",
          runId: "run-test",
          seq: 4,
          type: "worker.claimed",
          createdAt: 5,
          payload: { workerId: "worker-1" },
        },
      ],
    });

    const timeline = buildSemanticTimeline(snapshot);

    expect(timeline.map((item) => item.id)).toEqual(["evt-tool", "evt-checkpoint"]);
    expect(timeline[0]).toMatchObject({ kind: "tool", agentLabel: "Builder" });
    expect(timeline[0]).toMatchObject({ kind: "tool", label: "工具调用", detail: "搜索网页：已完成。", agentLabel: "Builder" });
    expect(timeline[1]).toMatchObject({ kind: "checkpoint", detail: "Pattern checkpoint" });
    expect(buildSemanticTimeline(snapshot, { includeInternalEvents: true }).map((item) => item.id)).toContain("evt-worker");
  });

  it("provides Chinese labels for timeline filters and severities", () => {
    expect(eventKindLabel("tool")).toBe("工具");
    expect(eventKindLabel("all")).toBe("全部");
    expect(severityLabel("warning")).toBe("警告");
    expect(severityLabel("all")).toBe("全部");
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
          budget: { maxTokens: 24000, maxToolCalls: 256, maxRuntimeMs: 600000, maxCostUsd: 5 },
          planning: "explicit",
          planningEnabled: true,
          delegation: "preferred",
          delegationEnabled: true,
          collaborationRequirement: "none",
          collaborationRequirementSource: "mode_default",
          delegationRequestedByUser: false,
          providerThinkingEnabled: false,
          providerPolicyStatus: "degraded",
          notes: ["Provider 'local-smoke' does not advertise reasoning support."],
        },
      },
    });

    expect(buildEffectiveStrategySummary(snapshot)).toMatchObject({
      title: "deep 思考策略",
      statusLabel: "已降级",
      statusTone: "warning",
    });
    expect(collectTrailFindings(snapshot, undefined, undefined, [])).toContainEqual(
      expect.objectContaining({
        id: "strategy.provider-degraded",
        severity: "warning",
      }),
    );
  });

  it("builds latency diagnostics from snapshot marks", () => {
    const snapshot = baseSnapshot({
      latency: {
        marks: [
          { source: "runtime", name: "startStreamingRun.enter", at: 100, detail: {} },
          { source: "runtime", name: "modeSelection.done", at: 130, detail: { modeSelection: "auto" } },
          { source: "runtime", name: "conversationMessages.done", at: 140, detail: { messageCount: 4 } },
          { source: "runtime", name: "snapshotPersisted", at: 145, detail: {} },
          { source: "desktop", name: "handleReceivedAt", at: 180, detail: { runId: "run-1" } },
          { source: "runtime", name: "kernelScheduled", at: 150, detail: {} },
          { source: "runtime", name: "firstApplyLiveEvent", at: 200, detail: { eventType: "run.started" } },
          { source: "runtime", name: "providerCallStarted", at: 320, detail: {} },
          { source: "provider", name: "firstProviderStreamFrame", at: 520, detail: { streamMode: "sse" } },
          { source: "runtime", name: "firstTextDelta", at: 560, detail: {} },
          { source: "runtime", name: "streamStdoutWriteAt", at: 575, detail: { transport: "stdio" } },
          { source: "bridge", name: "tauriRunEventReceivedAt", at: 590, detail: { transport: "stdio_bridge" } },
          { source: "bridge", name: "tauriRunEventEmittedAt", at: 600, detail: { transport: "tauri_event" } },
          { source: "desktop", name: "firstRunStreamReceivedAt", at: 620, detail: {} },
          { source: "desktop", name: "firstRunStreamBatchFlushedAt", at: 650, detail: {} },
          { source: "runtime", name: "firstUserReadableAssistantTextProduced", at: 560, detail: {} },
          { source: "runtime", name: "firstProgressNarration", at: 700, detail: {} },
        ],
      },
    });

    const diagnostics = buildLatencyDiagnostics(snapshot);

    expect(diagnostics.summary).toMatchObject({
      statusLabel: "链路正常",
      statusTone: "success",
      firstText: "460ms",
      firstReadableText: "460ms",
      providerMode: "sse",
    });
    expect(diagnostics.segments.find((segment) => segment.id === "runtime-enter-to-conversation")).toMatchObject({
      duration: "40ms",
      status: "ok",
    });
    expect(diagnostics.segments.find((segment) => segment.id === "conversation-to-snapshot")).toMatchObject({
      duration: "5ms",
      status: "ok",
    });
    expect(diagnostics.segments.find((segment) => segment.id === "snapshot-to-handle")).toMatchObject({
      duration: "35ms",
      status: "ok",
    });
    expect(diagnostics.segments.find((segment) => segment.id === "first-text-to-stdout")).toMatchObject({
      duration: "15ms",
      status: "ok",
    });
    expect(diagnostics.segments.find((segment) => segment.id === "stdout-to-bridge-read")).toMatchObject({
      duration: "15ms",
      status: "ok",
    });
    expect(diagnostics.segments.find((segment) => segment.id === "bridge-read-to-emit")).toMatchObject({
      duration: "10ms",
      status: "ok",
    });
    expect(diagnostics.segments.find((segment) => segment.id === "bridge-emit-to-listener")).toMatchObject({
      duration: "20ms",
      status: "ok",
    });
    expect(diagnostics.segments.find((segment) => segment.id === "listener-to-batch-flush")).toMatchObject({
      duration: "30ms",
      status: "ok",
    });
    expect(diagnostics.segments.find((segment) => segment.id === "first-text-to-progress")).toMatchObject({
      duration: "140ms",
      status: "ok",
    });
  });

  it("flags progress narration that happens before first text", () => {
    const snapshot = baseSnapshot({
      latency: {
        marks: [
          { source: "runtime", name: "startStreamingRun.enter", at: 100, detail: {} },
          { source: "runtime", name: "firstProgressNarration", at: 250, detail: {} },
          { source: "runtime", name: "firstTextDelta", at: 300, detail: {} },
        ],
      },
    });

    const diagnostics = buildLatencyDiagnostics(snapshot);

    expect(diagnostics.summary.statusLabel).toBe("进度早于回答");
    expect(diagnostics.summary.statusTone).toBe("error");
    expect(diagnostics.summary.recommendation).toContain("进度叙述早于首个回答");
  });

  it("separates visible assistant output from missing first-text marks", () => {
    const snapshot = baseSnapshot({
      output: { text: "你好！" },
      latency: {
        marks: [
          { source: "runtime", name: "startStreamingRun.enter", at: 100, detail: {} },
          { source: "runtime", name: "firstApplyLiveEvent", at: 160, detail: { eventType: "run.started" } },
        ],
      },
    });

    const diagnostics = buildLatencyDiagnostics(snapshot);

    expect(diagnostics.summary).toMatchObject({
      statusLabel: "文本打点缺失",
      statusTone: "warning",
      firstText: "未记录",
      firstReadableText: "已渲染 / 未打点",
    });
    expect(diagnostics.summary.recommendation).toContain("界面已有可读回答");
  });

  // ---- deriveFirstTextEvidence ----

  it("first-text marks present → measured", () => {
    const snapshot = baseSnapshot({
      latency: {
        marks: [
          { source: "runtime", name: "firstTextDelta", at: 200, detail: {} },
        ],
      },
    });

    expect(deriveFirstTextEvidence(snapshot)).toMatchObject({
      observed: false,
      measured: true,
      firstMeasuredTextAt: 200,
      status: "measured",
      observedSources: ["runtime_mark"],
    });
  });

  it("progress narration before first observed text → text still measured", () => {
    const snapshot = baseSnapshot({
      latency: {
        marks: [
          { source: "runtime", name: "firstTextDelta", at: 300, detail: {} },
          { source: "runtime", name: "firstProgressNarration", at: 250, detail: {} },
        ],
      },
    });

    expect(deriveFirstTextEvidence(snapshot).status).toBe("measured");
  });

  it("visible snapshot.output.text but no marks → observed_unmeasured", () => {
    const snapshot = baseSnapshot({
      output: { text: "你好！这是回复。" },
    });

    const evidence = deriveFirstTextEvidence(snapshot);

    expect(evidence).toMatchObject({
      observed: true,
      measured: false,
      status: "observed_unmeasured",
    });
    expect(evidence.observedSources).toContain("snapshot_output");
  });

  it("visible message.delta content but no marks → observed_unmeasured", () => {
    const snapshot = baseSnapshot({
      events: [{
        id: "evt-1",
        runId: "run-test",
        seq: 1,
        type: "message.delta",
        createdAt: 200,
        payload: { content: "Hello from delta" },
      }],
    });

    const evidence = deriveFirstTextEvidence(snapshot);

    expect(evidence).toMatchObject({
      observed: true,
      measured: false,
      status: "observed_unmeasured",
    });
    expect(evidence.observedSources).toContain("message_delta");
  });

  it("no marks and no readable output → missing", () => {
    const snapshot = baseSnapshot({});

    expect(deriveFirstTextEvidence(snapshot)).toMatchObject({
      observed: false,
      measured: false,
      status: "missing",
      observedSources: [],
    });
  });

  it("desktop mark alone is measured", () => {
    const snapshot = baseSnapshot({
      latency: {
        marks: [
          { source: "desktop", name: "firstMessageDeltaAt", at: 150, detail: {} },
        ],
      },
    });

    expect(deriveFirstTextEvidence(snapshot)).toMatchObject({
      measured: true,
      firstMeasuredTextAt: 150,
      observedSources: ["desktop_mark"],
    });
  });

  it("both marks and visible output → measured with all observed sources", () => {
    const snapshot = baseSnapshot({
      output: "Direct output text.",
      latency: {
        marks: [
          { source: "runtime", name: "firstTextDelta", at: 200, detail: {} },
          { source: "desktop", name: "firstMessageDeltaAt", at: 150, detail: {} },
        ],
      },
    });

    const evidence = deriveFirstTextEvidence(snapshot);

    expect(evidence).toMatchObject({
      observed: true,
      measured: true,
      status: "measured",
      firstMeasuredTextAt: 200,
    });
    expect(evidence.observedSources).toContain("runtime_mark");
    expect(evidence.observedSources).toContain("snapshot_output");
  });

  it("readable text from snapshot.output string counts as observed", () => {
    const snapshot = baseSnapshot({
      output: "Plain text output.",
    });

    const evidence = deriveFirstTextEvidence(snapshot);
    expect(evidence.observed).toBe(true);
    expect(evidence.observedSources).toContain("snapshot_output");
  });

  it("prefers runtime mark at for firstMeasuredTextAt", () => {
    const snapshot = baseSnapshot({
      latency: {
        marks: [
          { source: "desktop", name: "firstMessageDeltaAt", at: 150, detail: {} },
          { source: "runtime", name: "firstTextDelta", at: 200, detail: {} },
        ],
      },
    });

    expect(deriveFirstTextEvidence(snapshot).firstMeasuredTextAt).toBe(200);
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
          activeMemorySummary: {
            summaryLine: "Deterministic: 1 selected, 1 rejected",
          },
          memoryHealthSnapshot: {
            trace: {
              fullyTraceable: 3,
              partiallyTraceable: 1,
              untraceable: 0,
              totalItems: 4,
            },
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
      traceSummaryLine: "Deterministic: 1 selected, 1 rejected",
      traceCoverageLine: "溯源覆盖：3 条全链路，1 条部分链路，共 4 条",
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
