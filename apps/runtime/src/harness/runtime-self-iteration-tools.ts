import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { RuntimeToolExecutionContext, SelfIterationRegistryTools } from "./runtime-tool-executor.js";
import { approvalRequestLanguage, stringArg } from "./runtime-tool-approval.js";

export function selfIterationToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  switch (toolId) {
    case "selfIteration.list":
      return {
        promptExample: "{\"tool\":\"selfIteration.list\",\"args\":{\"status\":\"ready\",\"limit\":10}}",
        execute: (args, context) => ({ output: listRuntimeSelfIterationCandidates(context.selfIterationRegistry, args) }),
      };
    case "selfIteration.get":
      return {
        promptExample: "{\"tool\":\"selfIteration.get\",\"args\":{\"candidateId\":\"project:self:prompt:single_agent\"}}",
        execute: (args, context) => ({ output: getRuntimeSelfIterationCandidate(context.selfIterationRegistry, args) }),
      };
    case "selfIteration.scan":
      return {
        promptExample: "{\"tool\":\"selfIteration.scan\",\"args\":{\"projectId\":\"local-project\"}}",
        requiresApprovalCopy: true,
        actionRiskLevel: () => "medium",
        execute: (args, context) => ({ output: scanRuntimeSelfIteration(context.selfIterationRegistry, args) }),
      };
    case "selfIteration.evaluate":
      return {
        promptExample: "{\"tool\":\"selfIteration.evaluate\",\"args\":{\"candidateId\":\"project:self:prompt:single_agent\"}}",
        requiresApprovalCopy: true,
        actionRiskLevel: () => "medium",
        execute: async (args, context) => ({ output: await evaluateRuntimeSelfIterationCandidate(context.selfIterationRegistry, args) }),
      };
    case "selfIteration.apply":
      return {
        promptExample: "{\"tool\":\"selfIteration.apply\",\"args\":{\"candidateId\":\"project:self:prompt:single_agent\"}}",
        requiresApprovalCopy: true,
        actionRiskLevel: () => "high",
        approvalRequest: selfIterationApplyApprovalRequest,
        execute: (args, context) => ({ output: applyRuntimeSelfIterationCandidate(context.selfIterationRegistry, args, context.allowRisky === true) }),
      };
    default:
      return {};
  }
}

function selfIterationApplyApprovalRequest(args: Record<string, unknown>, context: { userPrompt?: string }) {
  const zh = approvalRequestLanguage({ userPrompt: context.userPrompt }) === "zh";
  const candidateId = stringArg(args, "candidateId", zh ? "这个候选方案" : "this candidate");
  return zh
    ? {
        title: "需要你确认应用自迭代候选",
        summary: `我准备应用 Self-Iteration 候选“${candidateId}”。`,
        whatWillChange: "可能会接受评测用例，或在候选已通过评测后应用 prompt、mode、skill 相关变更。",
        whyNeeded: "Self-Iteration 的高风险变更必须经过用户确认后才能落地。",
        riskNote: "请先确认候选内容、评测结果和影响范围；prompt/mode/skill 变更会影响后续运行行为。",
        confirmLabel: "批准并应用",
      }
    : {
        title: "Confirm Self-Iteration apply",
        summary: `I am ready to apply Self-Iteration candidate "${candidateId}".`,
        whatWillChange: "This may accept evaluation material or apply reviewed prompt, mode, or skill changes after evaluation.",
        whyNeeded: "High-risk Self-Iteration changes require explicit user confirmation before they can land.",
        riskNote: "Review the candidate, evaluation result, and scope first; prompt/mode/skill changes affect future runs.",
        confirmLabel: "Approve and apply",
      };
}

function listRuntimeSelfIterationCandidates(registry: SelfIterationRegistryTools | undefined, args: Record<string, unknown>) {
  if (!registry) {
    throw new Error("A Self-Iteration registry is required for selfIteration.list.");
  }
  return { candidates: registry.listSelfIterationCandidates(args) };
}

function getRuntimeSelfIterationCandidate(registry: SelfIterationRegistryTools | undefined, args: Record<string, unknown>) {
  if (!registry) {
    throw new Error("A Self-Iteration registry is required for selfIteration.get.");
  }
  return registry.getSelfIterationCandidate(args);
}

function scanRuntimeSelfIteration(registry: SelfIterationRegistryTools | undefined, args: Record<string, unknown>) {
  if (!registry) {
    throw new Error("A Self-Iteration registry is required for selfIteration.scan.");
  }
  return registry.scanSelfIteration(args);
}

async function evaluateRuntimeSelfIterationCandidate(registry: SelfIterationRegistryTools | undefined, args: Record<string, unknown>) {
  if (!registry) {
    throw new Error("A Self-Iteration registry is required for selfIteration.evaluate.");
  }
  return await registry.evaluateSelfIterationCandidate(args);
}

function applyRuntimeSelfIterationCandidate(registry: SelfIterationRegistryTools | undefined, args: Record<string, unknown>, approved: boolean) {
  if (!registry) {
    throw new Error("A Self-Iteration registry is required for selfIteration.apply.");
  }
  if (!approved) {
    throw new Error("selfIteration.apply requires user approval before execution.");
  }
  return registry.applySelfIterationCandidate({ ...args, confirmed: approved });
}
