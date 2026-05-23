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
    expect(html).not.toContain("对象：analysis/report.md");
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

  it("hides trivial completed progress even when the assistant turn has no body text", () => {
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
        timestamp: "00:49",
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
      <AssistantTurnCard content="" turn={turn} />,
    );

    expect(html).not.toContain("已完成");
    expect(html).not.toContain("00:49");
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

  it("prefers collaboration summaries over later generic tool details in collapsed progress", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [
        {
          id: "spawn-text",
          kind: "assistant_text",
          content: "已委派 Research subagent，正在处理子任务。",
          timestamp: "00:00",
        },
        {
          id: "status-1",
          kind: "status_group",
          summary: "已委派 Research subagent 在后台处理子任务（research_readonly）。",
          timestamp: "00:01",
          status: "active",
          steps: [
            processStep("spawn-step", "complete", "已委派 Research subagent 在后台处理子任务（research_readonly）。", {
              label: "委派子代理",
            }),
            processStep("read-step", "active", "已读取 apps/desktop/src/components/AssistantTurnCard.tsx。", {
              label: "读取文件",
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
      <AssistantTurnCard content="" turn={turn} />,
    );

    expect(html).toContain("已委派 Research subagent，正在处理子任务。");
    expect(html).toContain("已委派 Research subagent 在后台处理子任务（research_readonly）。");
    expect(html).not.toContain("已读取 apps/desktop/src/components/AssistantTurnCard.tsx。");
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
    expect(html).toContain("Preview");
    expect(html).toContain("file - text/plain");
    expect(html).toContain("m-0 block w-full appearance-none rounded-none border-0 bg-transparent p-0 text-left shadow-none");
    expect(html).toContain("data-slot=\"artifact\"");
    expect(html).toContain("rounded-md border border-border bg-card/70 shadow-xs");
    expect(html).toContain("data-slot=\"artifact-header\"");
    expect(html).toContain("bg-muted/35 px-3 py-2.5");
    expect(html).not.toContain("const oldValue = true;");
    expect(html).not.toContain("const newValue = true;");
  });

  it("keeps artifact card structure intact in compact density", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-compact",
      turnIndex: 1,
      status: "done",
      pattern: "agent_teams",
      sources: [],
      processSteps: [],
      agentMessages: [],
      artifacts: [
        artifact("artifact-compact", "tasks/plan.md", {
          kind: "file",
          mimeType: "text/markdown",
          previewable: true,
        }),
      ],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="正文" turn={turn} density="compact" />,
    );

    expect(html).toContain("tasks/plan.md");
    expect(html).toContain("file - text/markdown");
    expect(html).toContain("Preview");
    expect(html).toContain("[&amp;_div[data-slot=&#x27;artifact-header&#x27;]]:gap-2");
  });

  it("renders plan summaries and artifact cards without internal plan update or artifact export progress copy", () => {
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
          summary: "已探索 1 个文件，已运行 1 条命令",
          timestamp: "00:01",
          status: "complete",
          steps: [
            processStep("read", "complete", "已读取 notes/project.md。", { label: "读取文件" }),
            processStep("shell", "complete", "已运行命令：git diff。", { label: "运行命令", eventType: "tool.called" }),
          ],
        },
        {
          id: "plan-update-1",
          kind: "plan_update",
          summary: "已更新任务计划：1/2 完成，正在 汇总结论",
          timestamp: "00:02",
        },
        {
          id: "final-1",
          kind: "final_text",
          content: "文档已更新。",
          timestamp: "00:03",
        },
      ],
      agentMessages: [],
      artifacts: [
        artifact("artifact-1", "notes/project.md", {
          kind: "file",
          mimeType: "text/markdown",
          payload: {
            kind: "file_change",
            path: "notes/project.md",
            operation: "patch",
            beforeContent: "old",
            afterContent: "new",
            additions: 1,
            deletions: 1,
            metadata: { replacements: 1 },
          },
        }),
      ],
      fileChanges: [{
        artifactId: "artifact-1",
        path: "notes/project.md",
        operation: "patch",
        beforeContent: "old",
        afterContent: "new",
        additions: 1,
        deletions: 1,
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
      <AssistantTurnCard content="文档已更新。" turn={turn} />,
    );

    expect(html).toContain("已更新任务计划：1/2 完成，正在 汇总结论");
    expect(html).toContain("notes/project.md");
    expect(html).not.toContain("工具调用更新：plan.update（已完成）");
    expect(html).not.toContain("已发布产物：notes/project.md。");
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

  it("does not render transcript group labels when only transcript metadata is present", () => {
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

    expect(html).toContain("主持人总结");
    expect(html).not.toContain("结构化辩论");
    expect(html).not.toContain("正方主辩");
    expect(html).not.toContain("正方开篇内容");
    expect(html).not.toContain("协作轨迹");
  });

  it("does not duplicate body text when a transcript-owned final answer already contains it", () => {
    const finalVerdict = "最终裁决：采用方案A。";
    const moderatorMessage = agentMessage("message-1", "reply", finalVerdict, {
      fromAgentId: "moderator",
      fromAgentLabel: "Moderator",
      toAgentIds: ["debate_agent"],
      toAgentLabels: ["Debate Agent"],
      transcript: {
        kind: "stage_transcript",
        groupId: "debate",
        stageId: "moderator-synthesis",
        stageLabel: "主持总结",
        sequence: 0,
        speakerLabel: "主持人总结",
        stance: "moderator",
        status: "done",
        layout: {
          style: "two_sided_duel",
          ownsFinalAnswer: true,
          supplementalBody: "never",
        },
      },
    });
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "done",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [{
        id: "message-1:timeline",
        kind: "agent_message",
        messageKind: "reply",
        fromAgentLabel: "Moderator",
        toAgentLabels: ["Debate Agent"],
        content: finalVerdict,
        timestamp: "+1s",
      }],
      agentMessages: [moderatorMessage],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content={finalVerdict} turn={turn} />,
    );

    expect(html.split(finalVerdict).length - 1).toBe(1);
  });

  it("keeps the body visible when a non-transcript agent message overlaps with it", () => {
    const finalVerdict = "最终裁决：采用方案A。";
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "done",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [{
        id: "timeline-1",
        kind: "agent_message",
        messageKind: "reply",
        fromAgentLabel: "Moderator",
        toAgentLabels: ["Debate Agent"],
        content: finalVerdict,
        timestamp: "+1s",
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
      <AssistantTurnCard content={finalVerdict} turn={turn} />,
    );

    expect(html.split(finalVerdict).length - 1).toBe(2);
  });

  it("recomputes presentation from current props instead of trusting stale cached presentation", () => {
    const finalVerdict = "最终裁决：采用方案A。";
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "done",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [{
        id: "timeline-1",
        kind: "agent_message",
        messageKind: "reply",
        fromAgentLabel: "Moderator",
        toAgentLabels: ["Debate Agent"],
        content: finalVerdict,
        timestamp: "+1s",
      }],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
      presentation: {
        primarySurface: "body",
        bodyContent: finalVerdict,
        showStandaloneBody: true,
        visibleTimelineItems: [{
          id: "timeline-1",
          kind: "agent_message",
          messageKind: "reply",
          fromAgentLabel: "Moderator",
          toAgentLabels: ["Debate Agent"],
          content: finalVerdict,
          timestamp: "+1s",
        }],
      },
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content={finalVerdict} turn={turn} />,
    );

    expect(html.split(finalVerdict).length - 1).toBe(2);
  });

  it("deduplicates repeated timeline text before rendering", () => {
    const finalVerdict = "最终裁决：采用方案A。";
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [
        {
          id: "timeline-1",
          kind: "assistant_text",
          content: finalVerdict,
          timestamp: "+1s",
        },
        {
          id: "timeline-2",
          kind: "final_text",
          content: finalVerdict,
          timestamp: "+2s",
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
      <AssistantTurnCard content={finalVerdict} turn={turn} />,
    );

    expect(html.split(finalVerdict).length - 1).toBe(1);
  });

  it("keeps distinct body text visible alongside projected timeline agent messages", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "done",
      pattern: "orchestrator_subagent",
      sources: [],
      processSteps: [],
      timelineItems: [{
        id: "timeline-1",
        kind: "agent_message",
        messageKind: "reply",
        fromAgentLabel: "Red Team",
        toAgentLabels: ["Moderator"],
        content: "Red Team critique.",
        timestamp: "+1s",
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
      <AssistantTurnCard content="最终建议：先保留普通时间线，再补一段简短结论。" turn={turn} />,
    );

    expect(html).toContain("Red Team critique.");
    expect(html).toContain("最终建议：先保留普通时间线，再补一段简短结论。");
    expect(html).not.toContain("Review Debate");
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

  it("keeps full actions in the default density", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-default-actions",
      turnIndex: 1,
      status: "done",
      pattern: "agent_teams",
      sources: [{ title: "Spec", url: "https://example.com/spec" }],
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
      <AssistantTurnCard
        content="Implementation completed."
        turn={turn}
        onSubmitFeedback={async () => {}}
      />,
    );

    expect(html).toContain("space-y-3 pt-1");
    expect(html).toContain("aria-label=\"复制消息\"");
    expect(html).toContain("aria-label=\"Feedback\"");
    expect(html).toContain("aria-label=\"引用来源\"");
  });

  it("uses compact density for narrow overlay cards while keeping sources", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-compact-actions",
      turnIndex: 1,
      status: "done",
      pattern: "orchestrator_subagent",
      sources: [{ title: "Spec", url: "https://example.com/spec" }],
      processSteps: [],
      timelineItems: [{
        id: "timeline-1",
        kind: "assistant_text",
        content: "子代理已完成第一轮排查。",
        timestamp: "00:02",
      }],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
      hasProposedPlan: false,
      activeLoadingTarget: { kind: "timeline", itemId: "timeline-1" },
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard
        content="子代理已完成第一轮排查。"
        turn={turn}
        density="compact"
        onSubmitFeedback={async () => {}}
      />,
    );

    expect(html).toContain("space-y-2 pt-0");
    expect(html).toContain("aria-label=\"引用来源\"");
    expect(html).not.toContain("aria-label=\"复制消息\"");
    expect(html).not.toContain("aria-label=\"Feedback\"");
  });

});
