import {
  ORA_ROOT_AGENT_ID,
  ORA_ROOT_AGENT_LABEL,
  CausalDecisionRecordSchema,
  type CausalTaskState,
  type OraEventEnvelope,
  type PlanListStep,
  type PendingClarification,
  type PendingClarificationOption,
  PendingClarificationSchema,
  type RunConfig,
} from "@cemeworm/shared";
import { invokeRunProvider } from "../providers/index.js";
import { ClarificationInterruptError } from "./runtime-interrupts.js";
import { mergeCausalTaskState } from "./causal-task-state-extractor.js";

export const INTENT_CLARIFICATION_ID = "clarification:intent_guard";
export const INTENT_CLARIFICATION_KEY = "intent_guard";
export const INTENT_CLARIFICATION_NODE_ID = ORA_ROOT_AGENT_ID;
export const INTENT_CLARIFICATION_NODE_LABEL = ORA_ROOT_AGENT_LABEL;

const INTENT_CLARIFICATION_MAX_TOKENS = 220;
const PLAN_STEP_BLOCKER_MAX_TOKENS = 220;

export interface IntentClarificationResult {
  question: string;
  missingVariables: string[];
  counterfactualRiskIfSkipped: string;
}

export async function requestIntentClarificationQuestion(
  prompt: string,
  config: RunConfig,
): Promise<IntentClarificationResult | undefined> {
  try {
    const response = await invokeRunProvider(config, {
      system: [
        "You are Ora, the root conversation agent for Ora.",
        "Decide whether the user's request is materially ambiguous before the agent uses tools or answers.",
        "",
        "Three-condition gate — only recommend clarification when ALL three hold:",
        "1. The missing information would materially change the outcome or action.",
        "2. You cannot proceed with a reasonable default assumption.",
        "3. The user's cost to answer is lower than the cost of being wrong.",
        "",
        "Ask for clarification only when the referent, requested action, or critical constraints are unclear enough that proceeding would likely answer the wrong target, take the wrong action, or create a costly mistake.",
        "Do not ask for clarification for ordinary ambiguity about style, wording, optimization preference, or low-cost defaults. In those cases the agent can proceed with a brief assumption.",
        "Material ambiguity is about variables that would change the outcome or action. Common examples are the user's role, target entity, requested action, jurisdiction, scale, eligibility, timing, or other critical constraints.",
        "When the user says things like we, our, this kind, or this scale without defining the operative context, ask only if that context would materially change the answer.",
        "If clarification is required, write one compact question in the user's language that names the missing variables. Do not invent missing facts.",
        "Also provide a counterfactualRiskIfSkipped: what would likely go wrong if we answer directly without clarifying.",
        "Return only JSON with this shape: {\"needsClarification\": boolean, \"missingVariables\": string[], \"question\": string, \"counterfactualRiskIfSkipped\": string}.",
      ].join("\n"),
      messages: [{
        role: "user",
        content: JSON.stringify({
          prompt,
          outputContract: {
            needsClarification: "boolean",
            missingVariables: "string[]; facts that would materially change the answer or action",
            question: "string; empty when needsClarification is false",
            counterfactualRiskIfSkipped: "string; what would likely go wrong if we skip clarification",
          },
        }),
      }],
      maxTokens: INTENT_CLARIFICATION_MAX_TOKENS,
      toolChoice: "none",
      temperature: 0,
    });
    return parseIntentClarificationResult(response.text);
  } catch {
    return undefined;
  }
}

export async function requestPlanStepBlockerClarification(params: {
  prompt: string;
  responseText: string;
  activeStep?: Pick<PlanListStep, "id" | "step" | "status">;
  planList: readonly Pick<PlanListStep, "id" | "step" | "status">[];
  config: RunConfig;
}): Promise<IntentClarificationResult | undefined> {
  const responseText = params.responseText.trim();
  if (!params.activeStep || responseText.length === 0) {
    return undefined;
  }
  try {
    const response = await invokeRunProvider(params.config, {
      system: [
        "You are Ora's execution-blocker clarification classifier.",
        "Decide whether the assistant's latest reply shows that the CURRENT active plan step is blocked on user-provided information.",
        "",
        "Recommend clarification only when ALL conditions hold:",
        "1. The assistant cannot continue the current active plan step without user input or a user decision.",
        "2. The missing input materially affects execution of the current step, not just style or optional polish.",
        "3. Pausing for the user is better than continuing execution or marking later plan steps complete.",
        "",
        "Do not ask for clarification when the assistant can continue with existing context, can make a safe default assumption, or is only giving a progress update.",
        "Do not ask for clarification when the reply is merely reporting a blocker without actually requesting the user to provide something.",
        "If clarification is required, rewrite it as one concise user-facing question in the user's language.",
        "Return only JSON with this shape: {\"needsClarification\": boolean, \"missingVariables\": string[], \"question\": string, \"counterfactualRiskIfSkipped\": string}.",
      ].join("\n"),
      messages: [{
        role: "user",
        content: JSON.stringify({
          prompt: params.prompt,
          activeStep: params.activeStep,
          planList: params.planList,
          assistantReply: responseText,
          outputContract: {
            needsClarification: "boolean",
            missingVariables: "string[]; the concrete missing inputs or decisions",
            question: "string; empty when needsClarification is false",
            counterfactualRiskIfSkipped: "string; what would likely go wrong if the run keeps going without the user input",
          },
        }),
      }],
      maxTokens: PLAN_STEP_BLOCKER_MAX_TOKENS,
      toolChoice: "none",
      temperature: 0,
    });
    return parseIntentClarificationResult(response.text);
  } catch {
    return undefined;
  }
}

export function planStepBlockerFingerprint(params: {
  activeStep: Pick<PlanListStep, "id" | "step" | "status">;
  clarification: IntentClarificationResult;
}): string {
  const stepSeed = stableBlockerSlug(params.activeStep.id ?? params.activeStep.step, "step");
  const rawMissingVariables = [...new Set(
    params.clarification.missingVariables
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )].sort();
  const blockerSource = rawMissingVariables.length > 0
    ? rawMissingVariables.join("|")
    : params.clarification.question.trim();
  const blockerSeed = stableBlockerSlug(blockerSource, "blocker");
  return `${stepSeed}_${blockerSeed}`.slice(0, 120);
}

type RuntimeClarificationEmit = (
  type: OraEventEnvelope["type"],
  payload: unknown,
  extra?: Partial<OraEventEnvelope>,
) => OraEventEnvelope;

export function resolveClarificationAnswer(params: {
  key: string;
  id: string;
  resumeClarifications?: Record<string, unknown>;
  inputClarifications?: unknown;
}): unknown {
  const resumeClarifications = params.resumeClarifications;
  if (resumeClarifications && typeof resumeClarifications === "object") {
    if (params.id in resumeClarifications) {
      return resumeClarifications[params.id];
    }
    if (params.key in resumeClarifications) {
      return resumeClarifications[params.key];
    }
  }
  const clarifications = params.inputClarifications;
  if (
    !clarifications ||
    typeof clarifications !== "object" ||
    clarifications === null
  ) {
    return undefined;
  }
  if (params.id in clarifications) {
    return (clarifications as Record<string, unknown>)[params.id];
  }
  if (params.key in clarifications) {
    return (clarifications as Record<string, unknown>)[params.key];
  }
  return undefined;
}

export async function ensureRuntimeClarification(
  params: {
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    options?: PendingClarificationOption[];
    missingVariables?: string[];
    counterfactualRiskIfSkipped?: string;
    narrate?: boolean;
  },
  deps: {
    answer: (key: string, id: string) => unknown;
    pendingClarifications: PendingClarification[];
    now: () => number;
    emit: RuntimeClarificationEmit;
    currentTaskState?: () => Partial<CausalTaskState> | undefined;
    resumeClarifications?: Record<string, unknown>;
  },
): Promise<unknown> {
  const answered = deps.answer(params.key, params.id);
  if (answered !== undefined) {
    const resumeClarifications = deps.resumeClarifications;
    if (
      resumeClarifications &&
      (params.id in resumeClarifications || params.key in resumeClarifications)
    ) {
      deps.emit(
        "clarification.resolved",
        {
          clarificationId: params.id,
          nodeId: params.nodeId,
          answer: answered,
          mode: "resume",
        },
        { nodeId: params.nodeId, agentId: params.nodeId },
      );
    }
    return answered;
  }
  const clarification = PendingClarificationSchema.parse({
    id: params.id,
    nodeId: params.nodeId,
    nodeLabel: params.nodeLabel,
    key: params.key,
    question: params.question,
    options: params.options ?? [],
    missingVariables: params.missingVariables ?? [],
    counterfactualRiskIfSkipped: params.counterfactualRiskIfSkipped ?? "",
    requestedAt: deps.now(),
  });
  deps.pendingClarifications.push(clarification);
  const inheritedTaskState = deps.currentTaskState?.();
  // Record causal decision for clarification gate
  deps.emit("causal.decision.recorded", CausalDecisionRecordSchema.parse({
    decisionId: `${params.nodeId}:clarification:${clarification.id}`,
    source: "runtime_followup",
    decisionKind: "clarification_triggered",
    taskState: mergeCausalTaskState(inheritedTaskState, {
      surfaceRequest: inheritedTaskState?.surfaceRequest ?? params.question,
      keyUncertainties: ["用户目标不明确"],
      chosenIntervention: "clarify",
      counterfactualRiskIfSkipped: params.counterfactualRiskIfSkipped ?? inheritedTaskState?.counterfactualRiskIfSkipped,
      confidence: 0.3,
    }),
    policyDecision: {
      goalUncertainty: 0.7,
      factUncertainty: 0.2,
      contextUncertainty: 0.2,
      actionRisk: 0.1,
      userCost: 0.6,
      reversibility: "high",
      recommendedAction: "clarify",
      reason: "clarify: clarification gate triggered at runtime",
      wouldChangeOutcomeIfWrong: true,
    },
    chosenIntervention: "clarify",
    alternativeInterventions: [],
    recordedAt: deps.now(),
    decisionContext: {
      phase: "clarification_triggered",
      clarificationId: clarification.id,
      nodeId: params.nodeId,
      agentId: params.nodeId,
    },
  }), { nodeId: params.nodeId, agentId: params.nodeId });
  deps.emit(
    "clarification.required",
    {
      clarification,
      pending: deps.pendingClarifications.length,
    },
    { nodeId: params.nodeId, agentId: params.nodeId },
  );
  throw new ClarificationInterruptError(clarification);
}

export async function ensureRuntimeClarifications(
  requests: Array<{
    id: string;
    key: string;
    nodeId: string;
    nodeLabel: string;
    question: string;
    options?: PendingClarificationOption[];
    missingVariables?: string[];
    counterfactualRiskIfSkipped?: string;
    narrate?: boolean;
  }>,
  deps: {
    answer: (key: string, id: string) => unknown;
    pendingClarifications: PendingClarification[];
    now: () => number;
    emit: RuntimeClarificationEmit;
    currentTaskState?: () => Partial<CausalTaskState> | undefined;
    resumeClarifications?: Record<string, unknown>;
  },
): Promise<unknown[]> {
  const results: Array<{ index: number; answer: unknown }> = [];
  const unanswered: typeof requests = [];

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i]!;
    const answered = deps.answer(req.key, req.id);
    if (answered !== undefined) {
      results.push({ index: i, answer: answered });
      const resumeClarifications = deps.resumeClarifications;
      if (
        resumeClarifications &&
        (req.id in resumeClarifications || req.key in resumeClarifications)
      ) {
        deps.emit(
          "clarification.resolved",
          {
            clarificationId: req.id,
            nodeId: req.nodeId,
            answer: answered,
            mode: "resume",
          },
          { nodeId: req.nodeId, agentId: req.nodeId },
        );
      }
    } else {
      unanswered.push(req);
    }
  }

  if (unanswered.length === 0) {
    results.sort((a, b) => a.index - b.index);
    return results.map((r) => r.answer);
  }

  const newClarifications = unanswered.map((req) =>
    PendingClarificationSchema.parse({
      id: req.id,
      nodeId: req.nodeId,
      nodeLabel: req.nodeLabel,
      key: req.key,
      question: req.question,
      options: req.options ?? [],
      missingVariables: req.missingVariables ?? [],
      counterfactualRiskIfSkipped: req.counterfactualRiskIfSkipped ?? "",
      requestedAt: deps.now(),
    }),
  );

  deps.pendingClarifications.push(...newClarifications);

  // Record one causal decision for the batch clarification gate
  const firstClarification = newClarifications[0]!;
  const inheritedTaskState = deps.currentTaskState?.();
  deps.emit("causal.decision.recorded", CausalDecisionRecordSchema.parse({
    decisionId: `${firstClarification.nodeId}:clarification:${firstClarification.id}`,
    source: "runtime_followup",
    decisionKind: "clarification_triggered",
    taskState: mergeCausalTaskState(inheritedTaskState, {
      surfaceRequest: inheritedTaskState?.surfaceRequest ?? firstClarification.question,
      keyUncertainties: ["用户目标不明确"],
      chosenIntervention: "clarify",
      counterfactualRiskIfSkipped: firstClarification.counterfactualRiskIfSkipped ?? inheritedTaskState?.counterfactualRiskIfSkipped,
      confidence: 0.3,
    }),
    policyDecision: {
      goalUncertainty: 0.7,
      factUncertainty: 0.2,
      contextUncertainty: 0.2,
      actionRisk: 0.1,
      userCost: 0.6,
      reversibility: "high",
      recommendedAction: "clarify",
      reason: "clarify: batch clarification gate triggered at runtime",
      wouldChangeOutcomeIfWrong: true,
    },
    chosenIntervention: "clarify",
    alternativeInterventions: [],
    recordedAt: deps.now(),
    decisionContext: {
      phase: "clarification_triggered",
      clarificationId: firstClarification.id,
      nodeId: firstClarification.nodeId,
      agentId: firstClarification.nodeId,
    },
  }), { nodeId: firstClarification.nodeId, agentId: firstClarification.nodeId });

  for (const clarification of newClarifications) {
    deps.emit(
      "clarification.required",
      {
        clarification,
        pending: deps.pendingClarifications.length,
      },
      { nodeId: clarification.nodeId, agentId: clarification.nodeId },
    );
  }

  throw new ClarificationInterruptError(newClarifications);
}

function parseIntentClarificationResult(text: string): IntentClarificationResult | undefined {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const missingVariables = Array.isArray(parsed.missingVariables)
      ? parsed.missingVariables.filter((item) => typeof item === "string" && item.trim().length > 0) as string[]
      : [];
    const needsClarification = parsed.needsClarification === true || missingVariables.length > 0;
    if (!needsClarification || typeof parsed.question !== "string") {
      return undefined;
    }
    const question = parsed.question.trim();
    if (question.length === 0) return undefined;
    const counterfactualRiskIfSkipped = typeof parsed.counterfactualRiskIfSkipped === "string"
      ? parsed.counterfactualRiskIfSkipped.trim()
      : "";
    return {
      question: question.slice(0, 800),
      missingVariables: missingVariables.slice(0, 6),
      counterfactualRiskIfSkipped: counterfactualRiskIfSkipped.slice(0, 400),
    };
  } catch {
    return undefined;
  }
}

function normalizeBlockerToken(value: string): string {
  return value
    .replace(/\s*\([^)]+\)/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function stableBlockerSlug(value: string, fallbackPrefix: string): string {
  const normalized = normalizeBlockerToken(value);
  if (normalized.length > 0) {
    return normalized;
  }
  return `${fallbackPrefix}_${hashBlockerValue(value)}`;
}

function hashBlockerValue(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
