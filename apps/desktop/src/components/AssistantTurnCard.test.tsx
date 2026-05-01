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
        processStep("step-2", "active", "正在综合专家观点。", { contextLabel: "analysis/report.md" }),
      ],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="正文" turn={turn} />,
    );

    expect(html).toContain("正在综合专家观点。");
    expect(html).toContain("对象：analysis/report.md");
    expect(html).not.toContain("正在：正在综合专家观点。");
    expect(html).not.toContain("已完成资料收集。");
  });

  it("hides placeholder live runtime status after assistant text starts", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "running",
      pattern: "orchestrator_subagent",
      liveProgressText: "正在努力",
      processSteps: [],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
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
      processSteps: [],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="我会先读取这些 skill。" turn={turn} />,
    );

    // No separate progress card when there are no process steps
    expect(html).not.toContain("运行进度");
    expect(html).not.toContain("当前状态");
    // Live progress text appears in the assistant content
    expect(html).toContain("我会先读取这些 skill。");
  });

  it("hides recovery artifacts from the assistant content stream", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "done",
      pattern: "agent_teams",
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

  it("renders handoff steps within the process timeline with accent style", () => {
    const turn: AssistantTurnAttachment = {
      runId: "run-1",
      turnIndex: 1,
      status: "done",
      pattern: "agent_teams",
      processSteps: [
        processStep("step-1", "complete", "正在收集信息。"),
        processStep("step-2", "complete", "正在生成回答。"),
        processStep("handoff-1", "complete", "请完成最终回答。", {
          eventType: "agent.handoff",
          label: "Lead → Builder",
          tone: "accent",
        }),
      ],
      agentMessages: [],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="最终回答" turn={turn} />,
    );

    expect(html).toContain("Lead → Builder");
    expect(html).toContain("请完成最终回答。");
    expect(html).toContain("交接");
    expect(html).not.toContain("协作轨迹");
  });

  it("does not render the collaboration timeline section", () => {
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
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
    };

    const html = renderToStaticMarkup(
      <AssistantTurnCard content="正文内容。" turn={turn} />,
    );

    expect(html).toContain("运行进度");
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
      processSteps: [],
      agentMessages: [transcriptMessage],
      artifacts: [],
      todos: [],
      planList: [],
      approvalCount: 0,
      clarificationCount: 0,
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
          processSteps: [],
          agentMessages: messages,
          planList: [],
          artifacts: [],
          todos: [],
          approvalCount: 0,
          clarificationCount: 0,
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
        runId: "run-1", turnIndex: 1, status: "done", pattern: "orchestrator_subagent",
        processSteps: [], agentMessages: messages, planList: [], artifacts: [], todos: [], approvalCount: 0, clarificationCount: 0,
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
        runId: "run-1", turnIndex: 1, status: "done", pattern: "orchestrator_subagent",
        processSteps: [], agentMessages: messages, planList: [], artifacts: [], todos: [], approvalCount: 0, clarificationCount: 0,
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
        runId: "run-1", turnIndex: 1, status: "done", pattern: "orchestrator_subagent",
        processSteps: [], agentMessages: messages, planList: [], artifacts: [], todos: [], approvalCount: 0, clarificationCount: 0,
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
        runId: "run-1", turnIndex: 1, status: "done", pattern: "orchestrator_subagent",
        processSteps: [], agentMessages: messages, planList: [], artifacts: [], todos: [], approvalCount: 0, clarificationCount: 0,
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
        runId: "run-1", turnIndex: 1, status: "done", pattern: "orchestrator_subagent",
        processSteps: [], agentMessages: messages, planList: [], artifacts: [], todos: [], approvalCount: 0, clarificationCount: 0,
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
        runId: "run-1", turnIndex: 1, status: "done", pattern: "orchestrator_subagent",
        processSteps: [], agentMessages: messages, planList: [], artifacts: [], todos: [], approvalCount: 0, clarificationCount: 0,
      }} />,
    );
    expect(html).toContain("Processing Pipeline");
    expect(html).toContain("Item triaged.");
    expect(html).toContain("Item processed.");
    expect(html).toContain("Triage");
    expect(html).toContain("Process");
  });
});
