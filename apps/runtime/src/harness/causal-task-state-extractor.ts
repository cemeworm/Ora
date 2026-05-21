import {
  CausalDecisionRecordSchema,
  InterventionActionSchema,
  isReadContextTool,
  isSearchTool,
  type CausalTaskState,
  type OraEventEnvelope,
  type RunConfig,
} from "@cemeworm/shared";
import { z } from "zod";
import { parseJsonObject } from "../provider-json.js";
import { invokeRunProvider } from "../providers/index.js";

const CAUSAL_SEMANTIC_MAX_TOKENS = 260;

const ExtractedCausalSemanticStateSchema = z.object({
  latentGoalHypotheses: z.array(z.string().min(1)).default([]),
  selectedLatentGoal: z.string().default(""),
  constraints: z.array(z.string().min(1)).default([]),
  candidateInterventions: z.array(InterventionActionSchema).default([]),
  counterfactualRiskIfSkipped: z.string().default(""),
  expectedOutcomeLift: z.string().default(""),
  stopCondition: z.string().default(""),
  confidence: z.number().min(0).max(1).optional(),
});

type ExtractedCausalSemanticState = z.infer<typeof ExtractedCausalSemanticStateSchema>;

export interface ExtractCausalTaskStateParams {
  prompt: string;
  config: RunConfig;
  phase: string;
  currentTaskState?: Partial<CausalTaskState>;
  modelResponseText?: string;
  proposedToolId?: string;
  toolCallCount?: number;
  clarificationCount?: number;
  hasUnresolvedPlanItems?: boolean;
  allowLlmExtraction?: boolean;
  counterfactualRiskIfSkipped?: string;
  clarificationQuestion?: string;
  clarificationAnswer?: unknown;
  clarificationMissingVariables?: string[];
}

export interface ExtractCausalTaskStateDeps {
  invokeProvider?: typeof invokeRunProvider;
}

export function mergeCausalTaskState(
  base?: Partial<CausalTaskState>,
  patch?: Partial<CausalTaskState>,
): Partial<CausalTaskState> {
  const left = base ?? {};
  const right = patch ?? {};
  return {
    surfaceRequest: pickString(right.surfaceRequest, left.surfaceRequest),
    latentGoalHypotheses: pickArray(right.latentGoalHypotheses, left.latentGoalHypotheses),
    selectedLatentGoal: pickString(right.selectedLatentGoal, left.selectedLatentGoal),
    keyUncertainties: pickArray(right.keyUncertainties, left.keyUncertainties),
    constraints: pickArray(right.constraints, left.constraints),
    candidateInterventions: pickArray(right.candidateInterventions, left.candidateInterventions),
    chosenIntervention: right.chosenIntervention ?? left.chosenIntervention,
    alternativeInterventions: pickArray(right.alternativeInterventions, left.alternativeInterventions),
    counterfactualRiskIfSkipped: pickString(right.counterfactualRiskIfSkipped, left.counterfactualRiskIfSkipped),
    expectedOutcomeLift: pickString(right.expectedOutcomeLift, left.expectedOutcomeLift),
    confidence: pickNumber(right.confidence, left.confidence),
    stopCondition: pickString(right.stopCondition, left.stopCondition),
  };
}

export function latestCausalTaskState(
  events: readonly OraEventEnvelope[],
): Partial<CausalTaskState> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "causal.decision.recorded") {
      continue;
    }
    const parsed = CausalDecisionRecordSchema.safeParse(event.payload);
    if (!parsed.success || parsed.data.source === "adapter_inferred") {
      continue;
    }
    return parsed.data.taskState;
  }
  return undefined;
}

export function hasPrimaryCausalDecisionInPhase(
  events: readonly OraEventEnvelope[],
  phase: string,
): boolean {
  return events.some((event) => {
    if (event.type !== "causal.decision.recorded") {
      return false;
    }
    const parsed = CausalDecisionRecordSchema.safeParse(event.payload);
    return parsed.success &&
      parsed.data.source === "router_primary" &&
      parsed.data.decisionContext?.phase === phase;
  });
}

export async function extractCausalTaskState(
  params: ExtractCausalTaskStateParams,
  deps: ExtractCausalTaskStateDeps = {},
): Promise<Partial<CausalTaskState>> {
  const heuristicState = buildHeuristicTaskState(params);
  if (!params.allowLlmExtraction) {
    return heuristicState;
  }
  const extracted = await extractSemanticStateWithLlm(params, deps.invokeProvider ?? invokeRunProvider);
  if (!extracted) {
    return heuristicState;
  }
  return mergeCausalTaskState(heuristicState, extracted);
}

async function extractSemanticStateWithLlm(
  params: ExtractCausalTaskStateParams,
  invokeProvider: typeof invokeRunProvider,
): Promise<Partial<CausalTaskState> | undefined> {
  try {
    const response = await invokeProvider(params.config, {
      system: [
        "You are Ora's causal task-state extractor.",
        "Infer the user's latent goal and the decision state for the current agent turn.",
        "Return only JSON. Do not add prose.",
        "",
        "Populate only these fields:",
        "- latentGoalHypotheses: 1-3 concise hypotheses of the user's real goal",
        "- selectedLatentGoal: the best current hypothesis",
        "- constraints: explicit task constraints already implied by the request or clarification",
        "- candidateInterventions: likely next interventions from this enum [answer_directly, clarify, search_web, read_context, use_tool, plan, request_approval, stop]",
        "- counterfactualRiskIfSkipped: what likely goes wrong if the key intervention is skipped",
        "- expectedOutcomeLift: what better outcome the chosen intervention is trying to produce",
        "- stopCondition: when the agent should stop instead of taking more actions",
        "- confidence: number from 0 to 1",
        "",
        "Keep values compact, factual, and grounded in the provided context.",
        "If context is insufficient, return empty strings or empty arrays instead of inventing detail.",
      ].join("\n"),
      messages: [{
        role: "user",
        content: JSON.stringify({
          phase: params.phase,
          prompt: params.prompt,
          currentTaskState: params.currentTaskState ?? {},
          proposedToolId: params.proposedToolId,
          toolCallCount: params.toolCallCount ?? 0,
          clarificationCount: params.clarificationCount ?? 0,
          hasUnresolvedPlanItems: params.hasUnresolvedPlanItems ?? false,
          modelResponseText: clipText(params.modelResponseText ?? "", 1200),
          clarificationQuestion: params.clarificationQuestion,
          clarificationAnswer: stringifyUnknown(params.clarificationAnswer),
          clarificationMissingVariables: params.clarificationMissingVariables ?? [],
          counterfactualRiskIfSkipped: params.counterfactualRiskIfSkipped ?? "",
        }),
      }],
      maxTokens: CAUSAL_SEMANTIC_MAX_TOKENS,
      toolChoice: "none",
      temperature: 0,
    });
    const parsed = ExtractedCausalSemanticStateSchema.parse(parseJsonObject(response.text));
    return normalizeExtractedState(parsed);
  } catch {
    return undefined;
  }
}

function buildHeuristicTaskState(params: ExtractCausalTaskStateParams): Partial<CausalTaskState> {
  const current = params.currentTaskState ?? {};
  const heuristicLatentGoal = inferHeuristicLatentGoal(params);
  return mergeCausalTaskState(current, {
    surfaceRequest: pickString(current.surfaceRequest, params.prompt),
    latentGoalHypotheses: current.latentGoalHypotheses?.length ? current.latentGoalHypotheses : (heuristicLatentGoal ? [heuristicLatentGoal] : []),
    selectedLatentGoal: pickString(current.selectedLatentGoal, heuristicLatentGoal),
    keyUncertainties: current.keyUncertainties?.length ? current.keyUncertainties : inferKeyUncertainties(params),
    constraints: current.constraints ?? [],
    counterfactualRiskIfSkipped: pickString(params.counterfactualRiskIfSkipped, current.counterfactualRiskIfSkipped),
    confidence: pickNumber(current.confidence, heuristicConfidence(params)),
  });
}

function inferHeuristicLatentGoal(params: ExtractCausalTaskStateParams): string {
  const prompt = params.prompt.trim();
  const lower = prompt.toLowerCase();
  if (!prompt) return "";
  if ((params.clarificationMissingVariables?.length ?? 0) > 0 || params.phase === "clarification_triggered") {
    return "明确任务目标与关键变量后再继续执行";
  }
  if (isPromptFreshnessSensitive(lower)) {
    return `获取最新且可验证的${extractPromptTopic(prompt)}信息`;
  }
  if (hasPromptArtifactHandle(lower)) {
    if (includesAny(lower, ["review", "审查", "评审", "pr", "diff"])) {
      return "基于现有上下文完成审查并给出结论";
    }
    if (includesAny(lower, ["报告", "report", "报表"])) {
      return "基于现有上下文整理结果并输出报告";
    }
    if (includesAny(lower, ["分析", "analy", "趋势", "数据"])) {
      return "基于现有数据或上下文完成分析";
    }
    return "基于现有上下文完成用户请求";
  }
  if (includesAny(lower, ["什么是", "解释", "explain"])) {
    return "解释概念并帮助用户理解";
  }
  return normalizePromptAsGoal(prompt);
}

function inferKeyUncertainties(params: ExtractCausalTaskStateParams): string[] {
  const items: string[] = [];
  if ((params.clarificationMissingVariables?.length ?? 0) > 0 || params.phase === "clarification_triggered") {
    items.push("用户目标不明确");
  }
  if ((params.counterfactualRiskIfSkipped ?? "").trim().length > 0 && !items.includes("用户目标不明确")) {
    items.push("用户目标不明确");
  }
  if (params.proposedToolId && isSearchTool(params.proposedToolId)) {
    items.push("事实信息缺失");
  }
  if ((params.proposedToolId && isReadContextTool(params.proposedToolId)) || (params.hasUnresolvedPlanItems && !params.proposedToolId)) {
    items.push("上下文不足");
  }
  if (params.phase === "approval_triggered") {
    items.push("行动风险较高");
  }
  return [...new Set(items)];
}

function heuristicConfidence(params: ExtractCausalTaskStateParams): number {
  switch (params.phase) {
    case "run_start":
      return 0.3;
    case "clarification_resume":
      return 0.6;
    case "tool_request":
      return (params.currentTaskState?.selectedLatentGoal ?? "").trim().length > 0 ? 0.7 : 0.45;
    case "completion":
      return (params.toolCallCount ?? 0) > 0 ? 0.7 : 0.5;
    case "clarification_triggered":
      return 0.3;
    case "approval_triggered":
      return 0.4;
    case "plan_updated":
      return 0.5;
    default:
      return 0.5;
  }
}

function isPromptFreshnessSensitive(text: string): boolean {
  if (text.includes("天气")) return false;
  return includesAny(text, ["最新", "当前", "截至", "latest", "current", "新特性", "支持情况", "兼容性", "版本"]) &&
    includesAny(text, ["react", "vue", "webassembly", "wasm", "浏览器", "browser", "support", "特性", "api"]);
}

function hasPromptArtifactHandle(text: string): boolean {
  if (/\b[\w./-]+\.(ts|tsx|js|jsx|json|md|sql|py|yaml|yml|csv|txt|log|sh)\b/i.test(text)) {
    return true;
  }
  return includesAny(text, ["pr", "diff", "日志", "log", "trace", "报表", "数据", "文档", "方案", "代码", "函数", "循环"]);
}

function includesAny(text: string, signals: readonly string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}

function extractPromptTopic(prompt: string): string {
  return prompt
    .replace(/^(帮我|请|请先|请帮我|告诉我|了解一下)/u, "")
    .replace(/(有哪些新特性|最新支持情况|新特性|支持情况|怎么样|是什么)$/u, "")
    .trim() || "相关";
}

function normalizePromptAsGoal(prompt: string): string {
  return prompt.replace(/[。！？!?]+$/u, "").trim();
}

function normalizeExtractedState(parsed: ExtractedCausalSemanticState): Partial<CausalTaskState> {
  return {
    latentGoalHypotheses: normalizeStringArray(parsed.latentGoalHypotheses),
    selectedLatentGoal: parsed.selectedLatentGoal.trim(),
    constraints: normalizeStringArray(parsed.constraints),
    candidateInterventions: parsed.candidateInterventions,
    counterfactualRiskIfSkipped: parsed.counterfactualRiskIfSkipped.trim(),
    expectedOutcomeLift: parsed.expectedOutcomeLift.trim(),
    stopCondition: parsed.stopCondition.trim(),
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
  };
}

function pickString(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function pickArray<T>(...values: Array<readonly T[] | undefined>): T[] {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) {
      return [...value];
    }
  }
  return [];
}

function pickNumber(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.min(1, value));
    }
  }
  return 0;
}

function normalizeStringArray(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function clipText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
