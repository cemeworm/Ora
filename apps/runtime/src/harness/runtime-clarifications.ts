import {
  ORA_ROOT_AGENT_ID,
  ORA_ROOT_AGENT_LABEL,
  type OraEventEnvelope,
  type PendingClarification,
  type PendingClarificationOption,
  PendingClarificationSchema,
  type RunConfig,
} from "@cemeworm/shared";
import { invokeRunProvider } from "../providers/index.js";
import { ClarificationInterruptError } from "./runtime-interrupts.js";

export const INTENT_CLARIFICATION_ID = "clarification:intent_guard";
export const INTENT_CLARIFICATION_KEY = "intent_guard";
export const INTENT_CLARIFICATION_NODE_ID = ORA_ROOT_AGENT_ID;
export const INTENT_CLARIFICATION_NODE_LABEL = ORA_ROOT_AGENT_LABEL;

const INTENT_CLARIFICATION_MAX_TOKENS = 220;

export async function requestIntentClarificationQuestion(
  prompt: string,
  config: RunConfig,
): Promise<string | undefined> {
  try {
    const response = await invokeRunProvider(config, {
      system: [
        "You are Ora, the root conversation agent for Ora.",
        "Decide whether the user's request is materially ambiguous before the agent uses tools or answers.",
        "Ask for clarification only when the referent, requested action, or critical constraints are unclear enough that proceeding would likely answer the wrong target, take the wrong action, or create a costly mistake.",
        "Do not ask for clarification for ordinary ambiguity about style, wording, optimization preference, or low-cost defaults. In those cases the agent can proceed with a brief assumption.",
        "Material ambiguity is about variables that would change the outcome or action. Common examples are the user's role, target entity, requested action, jurisdiction, scale, eligibility, timing, or other critical constraints.",
        "When the user says things like we, our, this kind, or this scale without defining the operative context, ask only if that context would materially change the answer.",
        "If clarification is required, write one compact question in the user's language that names the missing variables. Do not invent missing facts.",
        "Return only JSON with this shape: {\"needsClarification\": boolean, \"missingVariables\": string[], \"question\": string}.",
      ].join("\n"),
      messages: [{
        role: "user",
        content: JSON.stringify({
          prompt,
          outputContract: {
            needsClarification: "boolean",
            missingVariables: "string[]; facts that would materially change the answer or action",
            question: "string; empty when needsClarification is false",
          },
        }),
      }],
      maxTokens: INTENT_CLARIFICATION_MAX_TOKENS,
      toolChoice: "none",
      temperature: 0,
    });
    return parseIntentClarificationQuestion(response.text);
  } catch {
    return undefined;
  }
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
    narrate?: boolean;
  },
  deps: {
    answer: (key: string, id: string) => unknown;
    pendingClarifications: PendingClarification[];
    now: () => number;
    emit: RuntimeClarificationEmit;
    emitProgressNarration: (params: {
      trigger: string;
      nodeId?: string;
      title?: string;
      detail?: string;
    }) => Promise<void>;
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
    requestedAt: deps.now(),
  });
  deps.pendingClarifications.push(clarification);
  deps.emit(
    "clarification.required",
    {
      clarification,
      pending: deps.pendingClarifications.length,
    },
    { nodeId: params.nodeId, agentId: params.nodeId },
  );
  if (params.narrate !== false) {
    await deps.emitProgressNarration({
      trigger: "clarification.required",
      nodeId: params.nodeId,
      title: params.nodeLabel,
      detail: params.question,
    });
  }
  throw new ClarificationInterruptError(clarification);
}

function parseIntentClarificationQuestion(text: string): string | undefined {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) {
    return parseTaggedIntentClarificationQuestion(trimmed);
  }
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const missingVariables = Array.isArray(parsed.missingVariables)
      ? parsed.missingVariables.filter((item) => typeof item === "string" && item.trim().length > 0)
      : [];
    const needsClarification = parsed.needsClarification === true || missingVariables.length > 0;
    if (!needsClarification || typeof parsed.question !== "string") {
      return undefined;
    }
    const question = parsed.question.trim();
    return question.length > 0 ? question.slice(0, 800) : undefined;
  } catch {
    return parseTaggedIntentClarificationQuestion(trimmed);
  }
}

function parseTaggedIntentClarificationQuestion(text: string): string | undefined {
  const block = text.match(/<clarification_decision>([\s\S]*?)<\/clarification_decision>/i)?.[1] ?? text;
  const needsClarification = /needs[_\s-]*clarification\s*:\s*(true|yes)/i.test(block);
  if (!needsClarification) {
    return undefined;
  }
  const question = block.match(/question\s*:\s*(.+?)(?:\n\w[\w\s-]*\s*:|$)/is)?.[1]?.trim();
  return question ? question.slice(0, 800) : undefined;
}
