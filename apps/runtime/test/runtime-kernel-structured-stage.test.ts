import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CODE_DEVELOPMENT_MODE_ID,
  getModePreset,
  modeSpecToPatternDefinition,
} from "@cemeworm/shared";
import { executeRuntimeKernel } from "../src/index.js";

type Scenario = "repair_success" | "repair_failure_degraded";
type RequestKind = "causal" | "repair" | "triage" | "build" | "review" | "debug" | "handoff" | "other";

const capturedRequests: Array<{
  channel: "stream" | "repair";
  kind: RequestKind;
  hasTools: string[];
  system: string;
  messages: string;
  responseFormatType?: string;
}> = [];

let previousFetch: typeof fetch | undefined;
let previousApiKey: string | undefined;
let scenario: Scenario = "repair_success";
let requestCounts: Record<RequestKind, number>;

beforeEach(() => {
  capturedRequests.length = 0;
  scenario = "repair_success";
  requestCounts = {
    causal: 0,
    repair: 0,
    triage: 0,
    build: 0,
    review: 0,
    debug: 0,
    handoff: 0,
    other: 0,
  };
  previousFetch = globalThis.fetch;
  previousApiKey = process.env.STRUCTURED_STAGE_TEST_KEY;
  process.env.STRUCTURED_STAGE_TEST_KEY = "test";
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      stream?: boolean;
      response_format?: { type?: string };
      text?: { format?: { type?: string } };
      tools?: Array<{ type?: string; name?: string; function?: { name?: string } }>;
      messages?: Array<{ content?: string | null }>;
      input?: Array<{
        content?: Array<{ text?: string }>;
      }>;
    };
    const combinedText = [
      ...((body.messages ?? []).map((message) => message.content ?? "")),
      ...((body.input ?? []).flatMap((message) =>
        (message.content ?? []).map((part) => part.text ?? "")
      )),
    ].join("\n");
    const channel = body.stream ? "stream" : "repair";
    const kind = classifyRequest(combinedText);
    requestCounts[kind] += 1;
    capturedRequests.push({
      channel,
      kind,
      hasTools: Array.isArray(body.tools)
        ? body.tools.map((tool) => tool?.function?.name ?? tool?.name ?? tool?.type ?? "unknown")
        : [],
      system: combinedText,
      messages: combinedText,
      responseFormatType: body.response_format?.type ?? body.text?.format?.type,
    });

    if (kind === "causal") {
      return jsonCompletion(JSON.stringify({
        latentGoalHypotheses: ["修复 structured stage 执行链路"],
        selectedLatentGoal: "修复 structured stage 执行链路",
        constraints: ["保持修复范围聚焦"],
        candidateInterventions: ["use_tool"],
        counterfactualRiskIfSkipped: "结构化阶段仍会被降级输出污染。",
        expectedOutcomeLift: "让 structured gate 更可靠。",
        stopCondition: "修复完成并验证后结束。",
        confidence: 0.9,
        needsFreshnessEvidence: false,
      }));
    }

    if (kind === "repair") {
      if (scenario === "repair_failure_degraded") {
        return jsonCompletion("still not json after repair");
      }
      return jsonCompletion(codeDevelopmentTriageJson());
    }

    if (kind === "triage") {
      if (scenario === "repair_success" && requestCounts.triage === 1) {
        return jsonCompletion(JSON.stringify({
          text: "一个不完整的 triage 输出，用来触发 structured repair。",
          goal: "修复 structured stage 执行链路",
          successCriteria: ["需要强制进入 repair"],
          backlog: [{ id: "1", owner: "builder", description: "等待 repair 补全缺失字段" }],
          scopeBoundaries: ["不修改无关 runtime 模块"],
        }));
      }
      if (scenario === "repair_failure_degraded" && requestCounts.triage === 1) {
        return jsonCompletion([
          "下面先给一个面向人的草稿计划，不是严格 JSON。",
          "1. 继续追查 structured stage 失败链路",
          "2. 记录任务日志",
        ].join("\n"));
      }
    }

    if (kind === "build") {
      return jsonCompletion(JSON.stringify({
        text: "实施摘要：已经把 structured stage 的降级与 repair 语义收敛到 runtime kernel，并补上对应验证。",
        artifacts: ["apps/runtime/src/harness/runtime-kernel.ts"],
        changedFiles: ["apps/runtime/src/harness/runtime-kernel.ts"],
        commandsRun: [{ command: "vitest runtime-kernel-structured-stage", exitCode: 0, summary: "验证真实 kernel repair 链路" }],
        verificationEvidence: [{ verificationId: "verify-1", result: "pass", summary: "结构化阶段回归用例通过" }],
        assumptions: ["本次仅触达 structured stage 执行链路"],
        followups: [],
      }));
    }

    if (kind === "review") {
      return jsonCompletion(JSON.stringify({
        text: "审查结论：实现满足 triage 契约、repair 可观测性和降级隔离要求，没有发现阻塞问题。",
        verdict: "pass",
        acceptedArtifactIds: ["build"],
        findings: [],
        blockingIssues: [],
        acceptedFiles: ["apps/runtime/src/harness/runtime-kernel.ts"],
        verificationGaps: [],
        rejectedFiles: [],
      }));
    }

    if (kind === "debug") {
      return jsonCompletion(JSON.stringify({
        text: "调试结论：没有残留的结构化关卡故障，降级阶段也不会再被 repair 误判为成功。",
        status: "clear",
        rootCauses: [],
        diagnosticEvidence: [{ commandOrMethod: "vitest", summary: "runtime kernel 结构化回归用例通过" }],
        remainingRisks: [],
      }));
    }

    if (kind === "handoff") {
      return jsonCompletion(JSON.stringify({
        text: "最终移交摘要：本次修复让 structured stage 在 degraded 时直接失败、repair 会显式进入 action/event 轨迹，并补上了真实 kernel 路径回归测试。",
        deliveredFiles: ["apps/runtime/src/harness/runtime-kernel.ts", "apps/runtime/test/runtime-kernel-structured-stage.test.ts"],
        acceptedFiles: ["apps/runtime/src/harness/runtime-kernel.ts", "apps/runtime/test/runtime-kernel-structured-stage.test.ts"],
        taskJournalPath: "tasks/TASK-20260522-2215-code-development-structured-stage-rework.md",
        todoScanResult: { status: "clean", summary: "没有阻塞 TODO 项" },
        doneGate: { status: "pass", blockers: [] },
        verificationSummary: [{ verificationId: "verify-1", result: "pass", summary: "structured runtime integration test passed" }],
        residualRisks: [],
      }));
    }

    return jsonCompletion("默认 repair 响应。");
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = previousFetch!;
  if (previousApiKey === undefined) {
    delete process.env.STRUCTURED_STAGE_TEST_KEY;
  } else {
    process.env.STRUCTURED_STAGE_TEST_KEY = previousApiKey;
  }
});

describe("runtime structured stage execution", () => {
  it("repairs one invalid structured stage through an explicit runtime action", async () => {
    scenario = "repair_success";
    const snapshot = await runCodeDevelopment(scenario);
    const output = snapshot.output as { text?: string };

    expect(snapshot.status).toBe("succeeded");
    expect(output.text).toContain("structured stage");

    const repairRequests = capturedRequests.filter((request) =>
      request.messages.includes("You repair Ora stage outputs"),
    );
    expect(repairRequests).toHaveLength(1);
    expect(repairRequests[0]?.messages).toContain("Invalid stage response");

    const repairAction = snapshot.actions.find((action) => action.type.endsWith(".structured_repair"));
    expect(repairAction).toMatchObject({
      status: "succeeded",
      riskLevel: "low",
    });
    expect(snapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "structured_output.repair",
        payload: expect.objectContaining({
          status: "started",
          actionId: repairAction?.id,
          outputKey: "triage",
        }),
      }),
      expect.objectContaining({
        type: "structured_output.repair",
        payload: expect.objectContaining({
          status: "succeeded",
          actionId: repairAction?.id,
          outputKey: "triage",
        }),
      }),
    ]));
    expect(capturedRequests.some((request) =>
      request.messages.includes("做出最小的可行代码变更"),
    )).toBe(true);
    expect(capturedRequests
      .filter((request) =>
        request.messages.includes("创建一个紧凑的开发计划")
        || request.messages.includes("做出最小的可行代码变更")
        || request.messages.includes("逐条对照开发计划中的 successCriteria")
        || request.messages.includes("审查已通过。执行最终诊断")
        || request.messages.includes("重要约束：仅引用已验收产物的内容撰写移交报告")
        || request.messages.includes("repair Ora stage outputs"),
      )
      .every((request) => request.responseFormatType === "json_object")).toBe(true);
  });

  it("makes the tool-error boundary explicit: structured triage is toolless, and unrecoverable repair blocks builder", async () => {
    scenario = "repair_failure_degraded";
    const snapshot = await runCodeDevelopment(scenario);
    const output = snapshot.output as {
      text?: string;
      modeOutput?: {
        stoppedAfterInvalidTriage?: boolean;
        invalidTriageReason?: string;
        triage?: { _degraded?: boolean; _diagnostics?: { repairAttempted?: boolean; repairSucceeded?: boolean } };
      };
      stoppedAfterInvalidTriage?: boolean;
      invalidTriageReason?: string;
      triage?: { _degraded?: boolean; _diagnostics?: { repairAttempted?: boolean; repairSucceeded?: boolean } };
    };
    const modeOutput = output.modeOutput ?? output;

    expect(snapshot.status).toBe("failed");
    expect(snapshot.error).toContain("Mode progress is incomplete");
    expect(modeOutput.stoppedAfterInvalidTriage).toBe(true);
    expect(modeOutput.invalidTriageReason).toBe("invalid_or_degraded_triage_contract");
    expect(modeOutput.triage?._degraded).toBe(true);
    expect(modeOutput.triage?._diagnostics).toMatchObject({
      repairAttempted: true,
      repairSucceeded: false,
    });

    const repairAction = snapshot.actions.find((action) => action.type.endsWith(".structured_repair"));
    expect(repairAction).toMatchObject({ status: "succeeded" });
    expect(snapshot.events.map((event) => event.type)).not.toContain("recovery.detected");
    expect(capturedRequests.filter((request) => request.kind === "triage")).toHaveLength(1);
    expect(capturedRequests.filter((request) => request.kind === "repair")).toHaveLength(1);
    expect(capturedRequests.filter((request) => request.kind === "build")).toHaveLength(0);
    expect(capturedRequests.filter((request) => request.kind === "triage").every((request) => request.hasTools.length === 0)).toBe(true);
    expect(capturedRequests.some((request) =>
      request.kind === "repair" && request.messages.includes("You repair Ora stage outputs"),
    )).toBe(true);
  });
});

async function runCodeDevelopment(currentScenario: Scenario) {
  const modeSpec = getModePreset(CODE_DEVELOPMENT_MODE_ID)!;
  const definition = modeSpecToPatternDefinition(modeSpec);
  const { snapshot } = await executeRuntimeKernel(
    `run-structured-stage-${currentScenario}`,
    {
      prompt: "修复一个需要结构化关卡的代码开发任务。",
      createdAt: 1,
      context: {},
    },
    {
      pattern: "orchestrator_subagent",
      modeId: CODE_DEVELOPMENT_MODE_ID,
      providerId: "structured-stage-test",
      modelRef: "structured-stage-model",
      providerConfig: {
        id: "structured-stage-test",
        type: "openai_compatible",
        label: "Structured Stage Test",
        modelId: "structured-stage-model",
        baseUrl: "https://structured-stage.test/v1",
        apiKeyEnv: "STRUCTURED_STAGE_TEST_KEY",
        capabilities: ["chat", "json_mode", "tool_use"],
        headers: {},
      },
      metadata: {},
      deterministicSeed: `structured-stage-${currentScenario}`,
      profileIds: [],
      skillIds: [],
      toolIds: ["file.read"],
      approvalMode: "auto",
      budget: {
        maxTokens: 2048,
        maxToolCalls: 4,
        maxRuntimeMs: 60_000,
      },
    },
    { modeSpec, definition },
  );
  return snapshot;
}

function jsonCompletion(content: string) {
  return new Response(JSON.stringify({
    choices: [{
      finish_reason: "stop",
      message: {
        role: "assistant",
        content,
      },
    }],
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function codeDevelopmentTriageJson() {
  return JSON.stringify({
    text: "开发计划摘要：先收敛 runtime kernel 里的 structured stage 语义，再补真实路径测试，最后验证 repair 与 degraded 分支。",
    goal: "修复 structured stage 执行链路",
    successCriteria: ["triage 产出有效结构化契约", "degraded 阶段不能被 repair 伪装成成功"],
    backlog: [{ id: "1", owner: "builder", description: "收敛 kernel structured 执行语义" }],
    scopeBoundaries: ["不修改无关 runtime 模块"],
    taskJournalPath: "tasks/TASK-20260522-2215-code-development-structured-stage-rework.md",
    targetFiles: ["apps/runtime/src/harness/runtime-kernel.ts"],
    verificationPlan: [{ id: "verify-1", commandOrMethod: "vitest", expectation: "结构化回归用例通过" }],
    riskFiles: ["apps/runtime/src/harness/runtime-kernel.ts"],
    doneCriteria: ["targeted tests pass"],
  });
}

function classifyRequest(combinedText: string): RequestKind {
  if (combinedText.includes("causal task-state extractor")) {
    return "causal";
  }
  if (combinedText.includes("repair Ora stage outputs")) {
    return "repair";
  }
  if (combinedText.includes("创建一个紧凑的开发计划")) {
    return "triage";
  }
  if (combinedText.includes("做出最小的可行代码变更")) {
    return "build";
  }
  if (combinedText.includes("逐条对照开发计划中的 successCriteria")) {
    return "review";
  }
  if (combinedText.includes("审查已通过。执行最终诊断")) {
    return "debug";
  }
  if (combinedText.includes("重要约束：仅引用已验收产物的内容撰写移交报告")) {
    return "handoff";
  }
  return "other";
}
