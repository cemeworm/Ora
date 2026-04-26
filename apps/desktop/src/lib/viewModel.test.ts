import { describe, expect, it } from "vitest";
import { MVP_MODES, MVP_PATTERNS, SINGLE_AGENT_MODE_ID } from "@ora/shared";
import { buildWorkbenchViewModel, isSessionProcessing } from "./viewModel";
import type { OraSessionDetail, OraSessionSummary, OraStateSnapshot } from "./runtimeClient";

describe("desktop session view model", () => {
  it("does not treat a newly-created empty session preview as running", () => {
    const createdAt = 1_714_000_000_000;
    const session: OraSessionSummary = {
      sessionId: "session-empty",
      title: "New Chat",
      turnCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const detail: OraSessionDetail = {
      session,
      turns: [],
      transcript: [],
    };

    const viewModel = buildWorkbenchViewModel(
      MVP_PATTERNS,
      MVP_MODES,
      [session],
      detail,
      undefined,
      "generator_verifier",
      SINGLE_AGENT_MODE_ID,
    );
    const selectedSession = viewModel.sessions[0];

    expect(selectedSession?.status).toBe("done");
    expect(isSessionProcessing(selectedSession, undefined)).toBe(false);
  });

  it("carries natural approval copy into action records", () => {
    const createdAt = 1_714_000_000_000;
    const session: OraSessionSummary = {
      sessionId: "session-approval",
      title: "Install skill",
      turnCount: 1,
      createdAt,
      updatedAt: createdAt,
      latestRunId: "run-approval",
    };
    const snapshot = {
      runId: "run-approval",
      sessionId: session.sessionId,
      turnIndex: 1,
      status: "interrupted",
      pattern: "orchestrator_subagent",
      modeId: SINGLE_AGENT_MODE_ID,
      input: { prompt: "请帮我安装 Waza 的 think skill。", createdAt, context: {} },
      config: {
        modeId: SINGLE_AGENT_MODE_ID,
        pattern: "orchestrator_subagent",
        modeSelection: "manual",
        profileIds: ["solo_agent"],
        providerId: "local-smoke",
        modelRef: "local/smoke-model",
        approvalMode: "high_risk_only",
        patternOptions: {},
        metadata: {},
        deterministicSeed: "view-model-test",
        skillIds: [],
        toolIds: ["skills.create"],
      },
      topology: { nodes: [], edges: [] },
      profiles: [],
      memory: [],
      plan: [],
      todos: [],
      actions: [{
        id: "run-approval:action:solo_agent-tool-1",
        runId: "run-approval",
        type: "skills.create",
        riskLevel: "high",
        status: "approval_required",
        input: { name: "waza-think" },
        approvalRequest: {
          title: "需要你确认安装技能",
          summary: "我准备把 Waza 的 think 技能安装到 Ora 的本地技能库。",
          whatWillChange: "会新增一个本地技能条目。",
          whyNeeded: "这是完成你要求安装技能的必要步骤。",
          riskNote: "确认 GitHub 来源可信后再继续。",
          confirmLabel: "批准并继续",
        },
        artifactIds: [],
      }],
      toolCalls: [],
      policyDecisions: [],
      checkpoints: [],
      events: [],
      artifacts: [],
      activeAgents: [],
      queueSummary: { mode: "dag", pending: 0, inProgress: 0, completed: 0, topics: [] },
      sharedStateSummary: { enabled: false, storeKind: "none", version: 0, entries: [] },
      busStats: { enabled: false, publishedCount: 0, routedCount: 0, topicCounts: {} },
      pendingClarifications: [],
      pendingApprovals: ["run-approval:action:solo_agent-tool-1"],
      updatedAt: createdAt,
    } as unknown as OraStateSnapshot;
    const detail: OraSessionDetail = {
      session,
      turns: [],
      transcript: [],
      latestSnapshot: snapshot,
    };

    const viewModel = buildWorkbenchViewModel(
      MVP_PATTERNS,
      MVP_MODES,
      [session],
      detail,
      undefined,
      "orchestrator_subagent",
      SINGLE_AGENT_MODE_ID,
    );

    expect(viewModel.actions[0]?.approvalRequest?.title).toBe("需要你确认安装技能");
    expect(viewModel.actions[0]?.approvalRequest?.summary).not.toContain("skills.create");
    expect(viewModel.actions[0]?.approvalRequest?.summary).not.toContain("High-risk");
  });
});
