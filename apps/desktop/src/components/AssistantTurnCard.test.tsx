import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AssistantTurnCard,
  processSummary,
} from "./AssistantTurnCard";
import type { AssistantTurnAttachment, TurnAgentConversationMessage, TurnArtifactAttachment, TurnProcessStep } from "../types";

function agentMessage(
  id: string,
  kind: TurnAgentConversationMessage["kind"],
  content: string,
  extra: Partial<TurnAgentConversationMessage> = {},
): TurnAgentConversationMessage {
  return {
    id,
    fromAgentId: extra.fromAgentId ?? "router",
    fromAgentLabel: extra.fromAgentLabel ?? "Router",
    toAgentIds: extra.toAgentIds ?? ["investigator"],
    toAgentLabels: extra.toAgentLabels ?? ["Investigator"],
    replyToId: extra.replyToId,
    threadId: extra.threadId ?? "thread-1",
    nodeId: extra.nodeId,
    planItemId: extra.planItemId,
    kind,
    status: extra.status ?? "done",
    content,
    topic: extra.topic,
    correlationId: extra.correlationId,
    artifactIds: extra.artifactIds ?? [],
    transcript: extra.transcript,
    timestamp: extra.timestamp ?? "13:39",
  };
}

function processStep(
  id: string,
  status: TurnProcessStep["status"],
  detail: string,
  extra: Partial<TurnProcessStep> = {},
): TurnProcessStep {
  return {
    id,
    eventType: extra.eventType ?? "task.progress",
    label: extra.label ?? "进度",
    detail,
    timestamp: "00:05",
    status,
    tone: extra.tone ?? "neutral",
    agentId: extra.agentId,
    contextLabel: extra.contextLabel,
  };
}

function artifact(
  id: string,
  label: string,
  extra: Partial<TurnArtifactAttachment> = {},
): TurnArtifactAttachment {
  return {
    id,
    label,
    kind: extra.kind ?? "log",
    mimeType: extra.mimeType ?? "application/json",
    createdAt: extra.createdAt ?? "13:40",
    uri: extra.uri,
    sizeBytes: extra.sizeBytes,
    payload: extra.payload,
    previewable: extra.previewable ?? false,
  };
}

describe("assistant turn display helpers", () => {
  it("renders the current agent label as the first line of an assistant turn", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "done",
      pattern: "agent_teams",
      currentAgentLabel: "Team Lead",
      sources: [],
      processSteps: [],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
      activeLoadingTarget: { kind: "thinking" },
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="正文内容。" turn={turn} />,
    );

    expect(html.indexOf("Team Lead")).toBeLessThan(html.indexOf("正文内容"));
  });

  it("does not render the legacy runtime todos panel", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-todos",
      turnIndex: 1,
      status: "running",
      pattern: "agent_teams",
      sources: [],
      processSteps: [],
      agentMessages: [],
      artifacts: [],
      todos: [{
        id: "run-todos:triage:todo",
        label: "Plan development task",
        status: "queued",
      }],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="Working" turn={turn} />,
    );

    expect(html).not.toContain("To-dos");
    expect(html).not.toContain("Plan development task");
  });

  it("renders clarification exchanges inside the assistant turn", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-clarification",
      turnIndex: 2,
      status: "done",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      clarificationExchanges: [{
        id: "clarification:scope",
        question: "Which scope should I use?",
        answer: "Use the current session only.",
        requestedAt: "13:40",
        answeredAt: "13:41",
        status: "resolved",
      }],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
      activeLoadingTarget: { kind: "timeline", itemId: "status-1" },
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="Continued after clarification" turn={turn} />,
    );

    expect(html).toContain("Which scope should I use?");
    expect(html).toContain("Use the current session only.");
    expect(html.indexOf("Which scope should I use?")).toBeLessThan(html.indexOf("Continued after clarification"));
  });

  it("does not duplicate a pending clarification question as assistant body text", () => {
    const question = "Which scope should I use?";
    const turn: AssistantTurnAttachment = {
      runId: "run-pending-clarification",
      turnIndex: 1,
      status: "clarification_required",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      clarificationExchanges: [{
        id: "clarification:scope",
        question,
        requestedAt: "13:40",
        status: "pending",
      }],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 1,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content={question} turn={turn} />,
    );

    expect(html.split(question).length - 1).toBe(1);
    expect(html).toContain("等待补充信息");
  });

  it("keeps the turn label on the primary agent while subagent content renders in the timeline", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      currentAgentLabel: "Orchestrator",
      sources: [],
      processSteps: [],
      timelineItems: [{
        id: "run-1:timeline:assistant:2",
        kind: "assistant_text",
        content: "Researcher 正在读取相关文件。",
        timestamp: "+1s",
      }],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
      activeLoadingTarget: { kind: "timeline", itemId: "status-1" },
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="" turn={turn} />,
    );

    expect(html.indexOf("Orchestrator")).toBeLessThan(html.indexOf("Researcher 正在读取相关文件。"));
    expect(html).toContain("Researcher 正在读取相关文件。");
  });

  it("renders multiple main-agent timeline messages without requiring the transcript view", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "agent_teams",
      currentAgentLabel: "Orchestrator",
      sources: [],
      processSteps: [],
      timelineItems: [
        {
          id: "msg-triage",
          kind: "agent_message",
          messageKind: "mention",
          fromAgentLabel: "Orchestrator",
          toAgentLabels: ["Builder"],
          content: "接下来交给 Builder。\n\nOrchestrator 已完成任务拆解。",
          timestamp: "+0s",
        },
        {
          id: "msg-build",
          kind: "agent_message",
          messageKind: "reply",
          fromAgentLabel: "Builder",
          toAgentLabels: ["Reviewer"],
          content: "接下来交给 Reviewer。\n\nBuilder 已完成代码修改。",
          timestamp: "+1s",
        },
        {
          id: "msg-review",
          kind: "agent_message",
          messageKind: "reply",
          fromAgentLabel: "Reviewer",
          toAgentLabels: ["Debugger"],
          content: "接下来交给 Debugger。\n\nReviewer 发现需要复核失败测试。",
          timestamp: "+2s",
        },
      ],
      agentMessages: [agentMessage("transcript-1", "reply", "Transcript only", {
        fromAgentLabel: "Transcript Speaker",
        transcript: {
          kind: "stage_transcript",
          groupId: "code-development",
          groupLabel: "Code Development",
          stageId: "transcript-stage",
          stageLabel: "Transcript Stage",
          speakerId: "transcript-speaker",
          speakerLabel: "Transcript Speaker",
          stance: "speaker",
          status: "done",
          sequence: 0,
        },
      })],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="" turn={turn} />,
    );

    expect(html).toContain("Orchestrator 已完成任务拆解。");
    expect(html).toContain("Builder 已完成代码修改。");
    expect(html).toContain("Reviewer 发现需要复核失败测试。");
    expect(html.indexOf("Orchestrator 已完成任务拆解。")).toBeLessThan(html.indexOf("Builder 已完成代码修改。"));
    expect(html.indexOf("Builder 已完成代码修改。")).toBeLessThan(html.indexOf("Reviewer 发现需要复核失败测试。"));
    expect(html).toContain("接下来交给 Builder。");
    expect(html).toContain("接下来交给 Reviewer。");
    expect(html).toContain("接下来交给 Debugger。");
    expect(html).toContain("Transcript Speaker");
  });

  it("does not render the global owner label before agent-message timeline content", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      currentAgentLabel: "Orchestrator",
      sources: [],
      processSteps: [],
      timelineItems: [{
        id: "msg-handoff",
        kind: "agent_message",
        messageKind: "handoff",
        fromAgentLabel: "Ora",
        toAgentLabels: ["Orchestrator"],
        content: "接下来交给 Orchestrator。",
        timestamp: "+0s",
      }],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="" turn={turn} />,
    );

    expect(html.indexOf("Ora")).toBeLessThan(html.indexOf("接下来交给 Orchestrator。"));
    expect(html.indexOf("Orchestrator")).toBeGreaterThan(html.indexOf("Ora"));
    expect(html.match(/接下来交给 Orchestrator/g)).toHaveLength(1);
  });

  it("shows a thinking indicator after running assistant text without timeline progress", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "agent_teams",
      currentAgentLabel: "Team Lead",
      sources: [],
      processSteps: [],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
      activeLoadingTarget: { kind: "thinking" },
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="正在处理。" turn={turn} />,
    );

    expect(html).toContain("Team Lead");
    expect(html).toContain("正在思考");
    expect(html).toContain("animate-spin");
  });

  it("does not repeat the latest running process action in the progress header", () => {
    expect(processSummary([
      processStep("step-1", "complete", "已完成资料收集。"),
      processStep("step-2", "active", "正在综合专家观点。"),
    ], "running")).toBeUndefined();
  });

  it("shows only the latest process step before the user expands progress", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "agent_teams",
      sources: [],
      processSteps: [
        processStep("step-1", "complete", "已完成资料收集。"),
        processStep("step-2", "active", "正在综合专家观点。", { contextLabel: "analysis/report.md" }),
      ],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="正文" turn={turn} />,
    );

    expect(html).toContain("正在综合专家观点。");
    expect(html).toContain("对象：analysis/report.md");
    expect(html).not.toContain("正在：正在综合专家观点。");
    expect(html).not.toContain("已完成资料收集。");
  });

  it("hides trailing completed progress after a finished assistant reply", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "done",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [{
        id: "progress-done",
        kind: "status_group",
        summary: "已完成",
        timestamp: "00:42",
        status: "complete",
        steps: [
          processStep("done", "complete", "已完成", { label: "已完成" }),
        ],
      }],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="这是最终回复。" turn={turn} />,
    );

    expect(html).toContain("这是最终回复。");
    expect(html).not.toContain("已完成");
  });

  it("keeps completed progress when it precedes later timeline content", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "done",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [
        {
          id: "progress-search",
          kind: "status_group",
          summary: "已搜索 2 个文件",
          timestamp: "00:01",
          status: "complete",
          steps: [
            processStep("search", "complete", "已搜索相关文件。", { label: "搜索文件" }),
          ],
        },
        {
          id: "artifact-1",
          kind: "artifact",
          summary: "已生成变更摘要",
          timestamp: "00:02",
        },
      ],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="这是最终回复。" turn={turn} />,
    );

    expect(html).toContain("已搜索 2 个文件");
    expect(html).toContain("已生成变更摘要");
    expect(html).toContain("这是最终回复。");
  });

  it("hides placeholder live runtime status after assistant text starts", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      liveProgressText: "正在努力",
      sources: [],
      processSteps: [],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
      activeLoadingTarget: { kind: "thinking" },
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="我会先读取这些 skill。" turn={turn} />,
    );

    expect(html).not.toContain("运行进度");
    expect(html).not.toContain("当前状态");
    expect(html).not.toContain("正在努力");
    expect(html).toContain("我会先读取这些 skill。");
  });

  it("shows live progress text in content area without a separate progress card when no process steps exist", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      liveProgressText: "已选择单智能体模式，我准备好了",
      sources: [],
      processSteps: [],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
      activeLoadingTarget: { kind: "thinking" },
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="我会先读取这些 skill。" turn={turn} />,
    );

    // No separate progress card when there are no process steps
    expect(html).not.toContain("运行进度");
    expect(html).not.toContain("当前状态");
    // Live progress text appears in the assistant content
    expect(html).toContain("我会先读取这些 skill。");
    expect(html).toContain("正在思考");
  });

  it("renders turn timeline paragraphs and collapsed aggregated status without the old progress card", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [
        {
          id: "text-1",
          kind: "assistant_text",
          content: "我会先追踪本地运行记录。",
          timestamp: "00:00",
        },
        {
          id: "status-1",
          kind: "status_group",
          summary: "已探索 1 个文件，已运行 1 条命令",
          timestamp: "00:01",
          status: "active",
          steps: [
            processStep("step-1", "complete", "已读取 .ora/runtime.db。", { label: "读取文件" }),
            processStep("step-2", "active", "正在运行 sqlite3 查询。", { label: "运行命令" }),
          ],
        },
        {
          id: "text-2",
          kind: "assistant_text",
          content: "现在我会把 trace 的消息拼起来。",
          timestamp: "00:04",
        },
      ],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="现在我会把 trace 的消息拼起来。" turn={turn} />,
    );

    expect(html).toContain("我会先追踪本地运行记录。");
    expect(html).toContain("已探索 1 个文件，已运行 1 条命令");
    expect(html).toContain("现在我会把 trace 的消息拼起来。");
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("正在思考");
    expect(html).not.toContain("已读取 .ora/runtime.db。");
    expect(html).not.toContain("正在运行 sqlite3 查询。");
    expect(html).not.toContain("运行进度");
  });

  it("does not repeat the thinking indicator after the latest active progress group", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [
        {
          id: "text-1",
          kind: "assistant_text",
          content: "我会先追踪本地运行记录。",
          timestamp: "00:00",
        },
        {
          id: "status-1",
          kind: "status_group",
          summary: "正在搜索文件",
          timestamp: "00:01",
          status: "active",
          steps: [
            processStep("step-1", "active", "正在运行 rg。", { label: "搜索文件" }),
          ],
        },
      ],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="我会先追踪本地运行记录。" turn={turn} />,
    );

    expect(html).toContain("正在搜索文件");
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("正在思考");
  });

  it("renders completed progress groups without completion icons or accent colors", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "done",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [
        {
          id: "status-1",
          kind: "status_group",
          summary: "已探索 3 个文件",
          timestamp: "00:01",
          status: "complete",
          steps: [
            processStep("step-1", "complete", "已读取文件。", {
              label: "读取文件",
              tone: "accent",
            }),
          ],
        },
      ],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="完成。" turn={turn} />,
    );

    expect(html).toContain("已探索 3 个文件");
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain("text-emerald");
    expect(html).not.toContain("text-amber");
  });

  it("keeps blocked progress groups in neutral colors without warning icons", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "failed",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [
        {
          id: "status-1",
          kind: "status_group",
          summary: "等待审批",
          timestamp: "00:01",
          status: "blocked",
          steps: [
            processStep("step-1", "blocked", "需要用户确认。", {
              label: "权限确认",
              tone: "warning",
            }),
          ],
        },
      ],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="等待确认。" turn={turn} />,
    );

    expect(html).toContain("等待审批");
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain("text-amber");
    expect(html).not.toContain("text-emerald");
  });

  it("hides recovery artifacts from the assistant content stream", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "done",
      pattern: "agent_teams",
      sources: [],
      processSteps: [],
      agentMessages: [],
      artifacts: [
        artifact("run-1:recovery:0", "Recovery artifact"),
        artifact("run-1:report-0", "Smoke run report", { kind: "report" }),
      ],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="正文" turn={turn} />,
    );

    expect(html).not.toContain("Recovery artifact");
    expect(html).toContain("Smoke run report");
  });

  it("renders file-change artifacts before the collapsed diff panel", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "done",
      pattern: "agent_teams",
      sources: [],
      processSteps: [],
      agentMessages: [],
      artifacts: [
        artifact("run-1:file-change:0", "apps/desktop/src/lib/viewModel.ts", {
          kind: "file",
          mimeType: "text/plain",
        }),
      ],
      fileChanges: [{
        artifactId: "run-1:file-change:0",
        path: "apps/desktop/src/lib/viewModel.ts",
        operation: "patch",
        beforeContent: "const oldValue = true;\n",
        afterContent: "const newValue = true;\n",
        additions: 1,
        deletions: 1,
        sizeBytes: 24,
        replacements: 1,
        created: false,
      }],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="正文" turn={turn} />,
    );
    const artifactIndex = html.indexOf("apps/desktop/src/lib/viewModel.ts");
    const diffIndex = html.indexOf("1 个文件已更改");

    expect(artifactIndex).toBeGreaterThanOrEqual(0);
    expect(diffIndex).toBeGreaterThan(artifactIndex);
    expect(html).toContain("+1");
    expect(html).toContain("-1");
    expect(html).not.toContain("const oldValue = true;");
    expect(html).not.toContain("const newValue = true;");
  });

  it("summarizes completed and blocked process steps without log wording", () => {
    expect(processSummary([
      processStep("step-1", "complete", "已完成资料收集。"),
      processStep("step-2", "complete", "已完成综合。"),
    ], "done")).toBe("2 条记录");

    expect(processSummary([
      processStep("step-1", "blocked", "等待审批。"),
    ], "failed")).toBe("1 个需处理");
  });

  it("renders handoff progress summaries without accent colors", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "done",
      pattern: "agent_teams",
      sources: [],
      processSteps: [
        processStep("step-1", "complete", "正在收集信息。"),
        processStep("step-2", "complete", "正在生成回答。"),
        processStep("handoff-1", "complete", "请完成最终回答。", {
          eventType: "agent.handoff",
          label: "接下来交给 Builder。",
          tone: "accent",
        }),
      ],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="最终回答" turn={turn} />,
    );

    expect(html).toContain("接下来交给 Builder。");
    expect(html).toContain("请完成最终回答。");
    expect(html).toContain("交接");
    expect(html).not.toContain("text-emerald");
    expect(html).not.toContain("text-amber");
    expect(html).not.toContain("协作轨迹");
  });

  it("does not render the collaboration timeline section", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "agent_teams",
      sources: [],
      processSteps: [processStep("step-1", "active", "正在规划回答。")],
      agentMessages: [
        agentMessage("message-1", "route", "@builder 请补充背景。", {
          fromAgentId: "team_lead",
          fromAgentLabel: "Team Lead",
          toAgentIds: ["builder"],
          toAgentLabels: ["Builder"],
          status: "running",
        }),
      ],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="正文内容。" turn={turn} />,
    );

    expect(html).toContain("正在规划回答。");
    expect(html).not.toContain("运行进度");
    expect(html).not.toContain("协作轨迹");
  });

  it("renders stage transcript in the main turn without collaboration section", () => {
    const transcriptMessage = agentMessage("message-1", "reply", "正方开篇内容", {
      fromAgentId: "debate_agent",
      fromAgentLabel: "Debate Agent",
      toAgentIds: ["moderator"],
      toAgentLabels: ["Moderator"],
      transcript: {
        kind: "stage_transcript",
        groupId: "debate",
        groupLabel: "结构化辩论",
        stageId: "affirmative-lead-opening",
        stageLabel: "开篇立论",
        sequence: 0,
        speakerLabel: "正方主辩",
        speakerId: "affirmative_lead",
        stance: "affirmative",
        status: "done",
      },
    });
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "done",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      agentMessages: [transcriptMessage],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="主持人总结" turn={turn} />,
    );

    expect(html).toContain("结构化辩论");
    expect(html).toContain("正方主辩");
    expect(html).toContain("正方开篇内容");
    expect(html).not.toContain("协作轨迹");
  });

  it("renders a custom two-sided staged transcript from layout metadata", () => {
    const layout = {
      style: "two_sided_duel",
      groupId: "red-blue",
      groupLabel: "Red/Blue Review",
      stanceLabels: {
        red_team: "Red Team",
        blue_team: "Blue Team",
      },
      stanceTones: {
        red_team: "red",
        blue_team: "blue",
      },
      sideByStance: {
        red_team: "left" as const,
        blue_team: "right" as const,
      },
    };
    const messages = [
      agentMessage("message-red", "reply", "Attack the riskiest assumption.", {
        transcript: {
          kind: "stage_transcript",
          groupId: "red-blue",
          groupLabel: "Red/Blue Review",
          stageId: "red-team-pressure",
          stageLabel: "Pressure test",
          sequence: 0,
          speakerLabel: "Red Team",
          speakerId: "reviewer",
          stance: "red_team",
          status: "done",
          layout,
        },
      }),
      agentMessage("message-blue", "reply", "Defend the launch plan.", {
        transcript: {
          kind: "stage_transcript",
          groupId: "red-blue",
          groupLabel: "Red/Blue Review",
          stageId: "blue-team-defense",
          stageLabel: "Defense",
          sequence: 1,
          speakerLabel: "Blue Team",
          speakerId: "reviewer",
          stance: "blue_team",
          status: "done",
          layout,
        },
      }),
    ];
    const html = renderToStaticMarkup(
      <AssistantTurnCard
        content="Final recommendation"
        turn={{
          runId: "run-1",
          turnIndex: 1,
          status: "done",
          pattern: "orchestrator_subagent",
          sources: [],
          processSteps: [],
          agentMessages: messages,
          planList: [],
          artifacts: [],
          todos: [],
          approvalCount: 0,
          clarificationCount: 0,
      hasProposedPlan: false,
        }}
      />,
    );

    expect(html).toContain("Red/Blue Review");
    expect(html).toContain("Red Team");
    expect(html).toContain("Blue Team");
    expect(html).toContain("Attack the riskiest assumption.");
    expect(html).toContain("Defend the launch plan.");
  });

  // ── P1 renderer tests ─────────────────────────────────────────────

  it("renders rubric_matrix layout as a table with criteria rows and stance columns", () => {
    const layout = {
      style: "rubric_matrix",
      groupId: "code-review",
      groupLabel: "Code Review Rubric",
      stanceLabels: { correctness: "正确性", readability: "可读性" },
      stanceTones: { correctness: "green", readability: "blue" },
    };
    const messages = [
      agentMessage("m1", "reply", "All tests pass.", {
        transcript: {
          kind: "stage_transcript",
          groupId: "code-review",
          groupLabel: "Code Review Rubric",
          stageId: "criteria-1",
          stageLabel: "逻辑正确",
          sequence: 0,
          speakerLabel: "Reviewer",
          stance: "correctness",
          status: "done",
          layout,
        },
      }),
      agentMessage("m2", "reply", "Variable names are clear.", {
        transcript: {
          kind: "stage_transcript",
          groupId: "code-review",
          groupLabel: "Code Review Rubric",
          stageId: "criteria-1",
          stageLabel: "逻辑正确",
          sequence: 1,
          speakerLabel: "Reviewer",
          stance: "readability",
          status: "done",
          layout,
        },
      }),
    ];
    const html = renderToStaticMarkup(
      <AssistantTurnCard content="Review done" turn={{
        runId: "run-1", turnIndex: 1, status: "done", pattern: "orchestrator_subagent", sources: [],
        processSteps: [], agentMessages: messages, planList: [], artifacts: [], todos: [], approvalCount: 0, clarificationCount: 0,
      hasProposedPlan: false,
      }} />,
    );
    expect(html).toContain("Code Review Rubric");
    expect(html).toContain("逻辑正确");
    expect(html).toContain("All tests pass.");
    expect(html).toContain("Variable names are clear.");
  });

  it("renders judge_panel layout with verdict section for summary stances", () => {
    const layout = {
      style: "judge_panel",
      groupId: "safety-gate",
      groupLabel: "Safety Gate",
      summaryStances: ["verdict"],
      stanceLabels: { judge_1: "Judge 1", verdict: "Verdict" },
      stanceTones: { judge_1: "blue", verdict: "violet" },
    };
    const messages = [
      agentMessage("m1", "reply", "No critical issues found.", {
        transcript: {
          kind: "stage_transcript", groupId: "safety-gate", groupLabel: "Safety Gate",
          stageId: "review-1", stageLabel: "Review", sequence: 0,
          speakerLabel: "Judge 1", stance: "judge_1", status: "done", layout,
        },
      }),
      agentMessage("m2", "reply", "Approved to proceed.", {
        transcript: {
          kind: "stage_transcript", groupId: "safety-gate", groupLabel: "Safety Gate",
          stageId: "verdict", stageLabel: "Verdict", sequence: 1,
          speakerLabel: "Verdict", stance: "verdict", status: "done", layout,
        },
      }),
    ];
    const html = renderToStaticMarkup(
      <AssistantTurnCard content="Gate passed" turn={{
        runId: "run-1", turnIndex: 1, status: "done", pattern: "orchestrator_subagent", sources: [],
        processSteps: [], agentMessages: messages, planList: [], artifacts: [], todos: [], approvalCount: 0, clarificationCount: 0,
      hasProposedPlan: false,
      }} />,
    );
    expect(html).toContain("Safety Gate");
    expect(html).toContain("No critical issues found.");
    expect(html).toContain("Approved to proceed.");
  });

  it("renders evidence_board layout grouping entries by stance with color dots", () => {
    const layout = {
      style: "evidence_board",
      groupId: "research",
      groupLabel: "Evidence Board",
      stanceLabels: { support: "Supporting", contradict: "Contradicting" },
      stanceTones: { support: "green", contradict: "red" },
    };
    const messages = [
      agentMessage("m1", "reply", "Data shows upward trend.", {
        transcript: {
          kind: "stage_transcript", groupId: "research", groupLabel: "Evidence Board",
          stageId: "find-1", stageLabel: "Finding", sequence: 0,
          speakerLabel: "Researcher", stance: "support", status: "done", layout,
        },
      }),
      agentMessage("m2", "reply", "Outlier contradicts the trend.", {
        transcript: {
          kind: "stage_transcript", groupId: "research", groupLabel: "Evidence Board",
          stageId: "find-2", stageLabel: "Finding", sequence: 1,
          speakerLabel: "Researcher", stance: "contradict", status: "done", layout,
        },
      }),
    ];
    const html = renderToStaticMarkup(
      <AssistantTurnCard content="Research done" turn={{
        runId: "run-1", turnIndex: 1, status: "done", pattern: "orchestrator_subagent", sources: [],
        processSteps: [], agentMessages: messages, planList: [], artifacts: [], todos: [], approvalCount: 0, clarificationCount: 0,
      hasProposedPlan: false,
      }} />,
    );
    expect(html).toContain("Evidence Board");
    expect(html).toContain("Data shows upward trend.");
    expect(html).toContain("Outlier contradicts the trend.");
  });

  it("renders comparison_table layout with dimension cards and side-by-side columns", () => {
    const layout = {
      style: "comparison_table",
      groupId: "tool-compare",
      groupLabel: "Tool Comparison",
      stanceLabels: { option_a: "Option A", option_b: "Option B" },
      stanceTones: { option_a: "green", option_b: "blue" },
    };
    const messages = [
      agentMessage("m1", "reply", "Fast and lightweight.", {
        transcript: {
          kind: "stage_transcript", groupId: "tool-compare", groupLabel: "Tool Comparison",
          stageId: "performance", stageLabel: "Performance", sequence: 0,
          speakerLabel: "Analyst", stance: "option_a", status: "done", layout,
        },
      }),
      agentMessage("m2", "reply", "Battle-tested and stable.", {
        transcript: {
          kind: "stage_transcript", groupId: "tool-compare", groupLabel: "Tool Comparison",
          stageId: "performance", stageLabel: "Performance", sequence: 1,
          speakerLabel: "Analyst", stance: "option_b", status: "done", layout,
        },
      }),
    ];
    const html = renderToStaticMarkup(
      <AssistantTurnCard content="Comparison done" turn={{
        runId: "run-1", turnIndex: 1, status: "done", pattern: "orchestrator_subagent", sources: [],
        processSteps: [], agentMessages: messages, planList: [], artifacts: [], todos: [], approvalCount: 0, clarificationCount: 0,
      hasProposedPlan: false,
      }} />,
    );
    expect(html).toContain("Tool Comparison");
    expect(html).toContain("Performance");
    expect(html).toContain("Fast and lightweight.");
    expect(html).toContain("Battle-tested and stable.");
  });

  it("renders artifact_gallery layout as a responsive card grid", () => {
    const layout = {
      style: "artifact_gallery",
      groupId: "outputs",
      groupLabel: "Generated Artifacts",
    };
    const messages = [
      agentMessage("m1", "reply", "Module A implementation.", {
        transcript: {
          kind: "stage_transcript", groupId: "outputs", groupLabel: "Generated Artifacts",
          stageId: "artifact-1", stageLabel: "Module A", sequence: 0,
          speakerLabel: "Builder", stance: "neutral", status: "done", layout,
        },
      }),
      agentMessage("m2", "reply", "Module B implementation.", {
        transcript: {
          kind: "stage_transcript", groupId: "outputs", groupLabel: "Generated Artifacts",
          stageId: "artifact-2", stageLabel: "Module B", sequence: 1,
          speakerLabel: "Builder", stance: "neutral", status: "done", layout,
        },
      }),
    ];
    const html = renderToStaticMarkup(
      <AssistantTurnCard content="All done" turn={{
        runId: "run-1", turnIndex: 1, status: "done", pattern: "orchestrator_subagent", sources: [],
        processSteps: [], agentMessages: messages, planList: [], artifacts: [], todos: [], approvalCount: 0, clarificationCount: 0,
      hasProposedPlan: false,
      }} />,
    );
    expect(html).toContain("Generated Artifacts");
    expect(html).toContain("Module A implementation.");
    expect(html).toContain("Module B implementation.");
  });

  it("renders kanban_pipeline layout with horizontal columns grouped by stage", () => {
    const layout = {
      style: "kanban_pipeline",
      groupId: "pipeline",
      groupLabel: "Processing Pipeline",
    };
    const messages = [
      agentMessage("m1", "reply", "Item triaged.", {
        transcript: {
          kind: "stage_transcript", groupId: "pipeline", groupLabel: "Processing Pipeline",
          stageId: "triage", stageLabel: "Triage", sequence: 0,
          speakerLabel: "Worker", stance: "neutral", status: "done", layout,
        },
      }),
      agentMessage("m2", "reply", "Item processed.", {
        transcript: {
          kind: "stage_transcript", groupId: "pipeline", groupLabel: "Processing Pipeline",
          stageId: "process", stageLabel: "Process", sequence: 1,
          speakerLabel: "Worker", stance: "neutral", status: "done", layout,
        },
      }),
    ];
    const html = renderToStaticMarkup(
      <AssistantTurnCard content="Pipeline done" turn={{
        runId: "run-1", turnIndex: 1, status: "done", pattern: "orchestrator_subagent", sources: [],
        processSteps: [], agentMessages: messages, planList: [], artifacts: [], todos: [], approvalCount: 0, clarificationCount: 0,
      hasProposedPlan: false,
      }} />,
    );
    expect(html).toContain("Processing Pipeline");
    expect(html).toContain("Item triaged.");
    expect(html).toContain("Item processed.");
    expect(html).toContain("Triage");
    expect(html).toContain("Process");
  });







  it("renders placeholder thinking without the old preparing copy", () => {
    const html = renderToStaticMarkup(
      <AssistantTurnCard content="" isPlaceholder />,
    );

    expect(html).toContain("正在思考");
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("正在准备");
  });


  it("renders thinking under the latest assistant text while running", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [{
        id: "text-1",
        kind: "assistant_text",
        content: "我已经找到相关组件。",
        timestamp: "00:01",
      }],
      agentMessages: [],
      planList: [],
      artifacts: [],
      todos: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
      activeLoadingTarget: { kind: "thinking" },
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="我已经找到相关组件。" turn={turn} />,
    );

    expect(html).toContain("我已经找到相关组件。");
    expect(html).toContain("正在思考");
    expect(html.indexOf("我已经找到相关组件。")).toBeLessThan(html.indexOf("正在思考"));
  });

  it("puts the running indicator on the latest progress row instead of adding thinking text", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [{
        id: "progress-1",
        kind: "status_group",
        summary: "已探索 2 个文件",
        timestamp: "00:01",
        status: "complete",
        steps: [
          processStep("grep", "complete", "已搜索 Sidebar。", { label: "搜索文件" }),
        ],
      }],
      agentMessages: [],
      planList: [],
      artifacts: [],
      todos: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
      activeLoadingTarget: { kind: "timeline", itemId: "progress-1" },
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="" turn={turn} />,
    );

    expect(html).toContain("已探索 2 个文件");
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("正在思考");
  });

  it("keeps progress loading on the latest status group when assistant text follows it", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [
        {
          id: "progress-1",
          kind: "status_group",
          summary: "已搜索 \"Channel\"（packages/shared/src/runtime.ts）（76 项）。",
          timestamp: "00:01",
          status: "complete",
          steps: [
            processStep("grep", "complete", "已搜索 Channel。", { label: "搜索文件" }),
          ],
          agentLabel: "Orchestrator",
        },
        {
          id: "text-1",
          kind: "assistant_text",
          content: "我会继续检查 channels session 的权限逻辑。",
          timestamp: "00:02",
          agentLabel: "Orchestrator",
        },
      ],
      agentMessages: [],
      planList: [],
      artifacts: [],
      todos: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
      activeLoadingTarget: { kind: "timeline", itemId: "progress-1" },
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="我会继续检查 channels session 的权限逻辑。" turn={turn} />,
    );

    expect(html).toContain("已搜索 &quot;Channel&quot;");
    expect(html).toContain("我会继续检查 channels session 的权限逻辑。");
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("正在思考");
  });

  it("keeps the assistant body visible when the timeline only contains progress rows", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [{
        id: "progress-1",
        kind: "status_group",
        summary: "已访问 1 个网页/搜索",
        timestamp: "00:01",
        status: "active",
        steps: [
          processStep("web-1", "active", "已查看 https://example.com/article。", {
            label: "浏览网页",
            contextLabel: "https://example.com/article",
          }),
        ],
      }],
      agentMessages: [],
      planList: [],
      artifacts: [],
      todos: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
      activeLoadingTarget: { kind: "timeline", itemId: "progress-1" },
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="好的，以下是我整理出的结论。" turn={turn} />,
    );

    expect(html).toContain("已访问 1 个网页/搜索");
    expect(html).toContain("好的，以下是我整理出的结论。");
  });

});
