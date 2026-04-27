import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AssistantTurnCard,
  agentConversationSummary,
  agentMessageDisplayKind,
  processSummary,
  visibleAgentMessages,
} from "./AssistantTurnCard";
import type { AssistantTurnAttachment, TurnAgentConversationMessage, TurnProcessStep } from "../types";

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
    timestamp: extra.timestamp ?? "13:39",
  };
}

function processStep(
  id: string,
  status: TurnProcessStep["status"],
  detail: string,
): TurnProcessStep {
  return {
    id,
    eventType: "task.progress",
    label: "进度",
    detail,
    timestamp: "00:05",
    status,
    tone: "neutral",
  };
}

describe("assistant turn display helpers", () => {
  it("renders collaboration trajectory directly below running progress", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "agent_teams",
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
      approvalCount: 0,
      clarificationCount: 0,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="正文应该在轨迹之后。" turn={turn} />,
    );

    const progressIndex = html.indexOf("运行进度");
    const trajectoryIndex = html.indexOf("协作轨迹");
    const contentIndex = html.indexOf("正文应该在轨迹之后。");

    expect(progressIndex).toBeGreaterThanOrEqual(0);
    expect(trajectoryIndex).toBeGreaterThan(progressIndex);
    expect(contentIndex).toBeGreaterThan(trajectoryIndex);
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
      processSteps: [
        processStep("step-1", "complete", "已完成资料收集。"),
        processStep("step-2", "active", "正在综合专家观点。"),
      ],
      agentMessages: [],
      artifacts: [],
      todos: [],
      approvalCount: 0,
      clarificationCount: 0,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="正文" turn={turn} />,
    );

    expect(html).toContain("正在综合专家观点。");
    expect(html).not.toContain("正在：正在综合专家观点。");
    expect(html).not.toContain("已完成资料收集。");
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

  it("keeps high-value message bus handoffs visible and hides protocol-only messages", () => {
    const messages = [
      agentMessage("message-1", "publish", "@router input event published on task.input:", {
        topic: "task.input",
        correlationId: "bus-1",
      }),
      agentMessage("message-2", "route", "@investigator routed task.findings to you:", {
        topic: "task.findings",
        correlationId: "bus-1",
      }),
      agentMessage("message-3", "reply", "@responder findings are ready.", {
        fromAgentId: "investigator",
        fromAgentLabel: "Investigator",
        toAgentIds: ["responder"],
        toAgentLabels: ["Responder"],
        topic: "task.findings",
        correlationId: "bus-1",
      }),
      agentMessage("message-4", "status", "queue drained"),
    ];

    expect(agentConversationSummary(messages)).toBe("3 个 agent，2 次交接");
    expect(visibleAgentMessages(messages, "done").map((message) => message.id)).toEqual([
      "message-2",
      "message-3",
    ]);
    expect(visibleAgentMessages(messages, "running").map((message) => message.id)).toEqual([
      "message-2",
      "message-3",
    ]);
  });

  it("limits running collaboration detail to the latest two meaningful exchanges", () => {
    const messages = [
      agentMessage("message-1", "route", "@investigator route task.input"),
      agentMessage("message-2", "reply", "@responder findings are ready"),
      agentMessage("message-3", "handoff", "@reviewer please check the answer"),
    ];

    expect(visibleAgentMessages(messages, "running").map((message) => message.id)).toEqual([
      "message-2",
      "message-3",
    ]);
    expect(visibleAgentMessages(messages, "done").map((message) => message.id)).toEqual([
      "message-1",
      "message-2",
      "message-3",
    ]);
  });

  it("truncates quoted collaboration content after 128 characters", () => {
    const quotedPrefix = "0123456789".repeat(12) + "ABCDEFGH";
    const quotedTail = "SHOULD_NOT_RENDER";
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "agent_teams",
      processSteps: [],
      agentMessages: [
        agentMessage("message-1", "route", quotedPrefix + quotedTail),
        agentMessage("message-2", "reply", "findings are ready", {
          replyToId: "message-1",
          fromAgentId: "investigator",
          fromAgentLabel: "Investigator",
        }),
        agentMessage("message-3", "handoff", "please write the final answer", {
          fromAgentId: "investigator",
          fromAgentLabel: "Investigator",
          toAgentIds: ["responder"],
          toAgentLabels: ["Responder"],
        }),
      ],
      artifacts: [],
      todos: [],
      approvalCount: 0,
      clarificationCount: 0,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="正文" turn={turn} />,
    );

    expect(html).toContain(`${quotedPrefix}...`);
    expect(html).not.toContain(quotedTail);
  });

  it("uses localized labels for agent message kinds", () => {
    expect(agentMessageDisplayKind(agentMessage("message-1", "route", "route"))).toBe("路由");
    expect(agentMessageDisplayKind(agentMessage("message-2", "reply", "reply"))).toBe("回复");
    expect(agentMessageDisplayKind(agentMessage("message-3", "handoff", "handoff"))).toBe("交接");
  });
});
