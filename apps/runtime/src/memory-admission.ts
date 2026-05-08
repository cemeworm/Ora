import { z } from "zod";
import type {
  ActiveMemoryCandidate,
  ActiveMemoryCard,
  ActiveMemoryContext,
  ActiveMemoryAdmissionDecision,
} from "@cemeworm/shared";
import { admitActiveMemoryCandidates } from "./active-memory.js";
import type { MemoryModelInvoker } from "./memory.js";

// === Provider Admission Types ===

export const ProviderAdmissionResponseSchema = z.object({
  selectedIds: z.array(z.string().min(1)).default([]),
  reason: z.string().min(1),
  rejectedIds: z.array(z.string().min(1)).default([]),
  uncertainty: z.number().min(0).max(1).default(0),
  result: z.enum(["USE", "NONE"]),
});
export type ProviderAdmissionResponse = z.infer<typeof ProviderAdmissionResponseSchema>;

export interface ProviderAdmissionRequest {
  candidates: ActiveMemoryCandidate[];
  prompt: string;
  recentMessages?: { role: string; content: string }[];
  maxSummaryChars: number;
}

export interface ProviderAdmissionResult {
  cards: ActiveMemoryCard[];
  decision: ActiveMemoryAdmissionDecision;
  providerUsed: boolean;
  elapsedMs: number;
}

// === Admission Prompt ===

function buildAdmissionPrompt(request: ProviderAdmissionRequest): string {
  const candidateSummary = request.candidates
    .map((c, i) => `[${i}] id: ${c.id}\n    category: ${c.category}\n    confidence: ${c.confidence.toFixed(2)}\n    content: ${c.content.slice(0, 240)}`)
    .join("\n\n");

  const recentSummary = (request.recentMessages ?? [])
    .slice(-4)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 300)}`)
    .join("\n");

  return [
    "You are Ora's memory admission gate. Select only memory that is relevant to the current request.",
    "",
    "Current request:",
    request.prompt.slice(0, request.maxSummaryChars),
    "",
    recentSummary ? `Recent conversation:\n${recentSummary}` : "",
    "",
    "Memory candidates:",
    candidateSummary,
    "",
    "Rules:",
    "- Select only candidates that are clearly relevant to the current request.",
    "- A correction or preference is relevant when the current request touches the same topic.",
    "- A stale fact (over 1 year old) should be rejected unless explicitly referenced.",
    "- Return NONE when no candidate is clearly relevant.",
    "- Do not select more than 6 candidates.",
    "",
    "Return only JSON:",
    '{"selectedIds":["id1"],"reason":"...","rejectedIds":["id2"],"uncertainty":0.0,"result":"USE|NONE"}',
  ].filter(Boolean).join("\n");
}

function parseAdmissionResponse(text: string): ProviderAdmissionResponse {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(trimmed);
  return ProviderAdmissionResponseSchema.parse(parsed);
}

// === Provider-Backed Admission ===

export async function admitWithProvider(
  candidates: ActiveMemoryCandidate[],
  request: ProviderAdmissionRequest,
  invokeModel: MemoryModelInvoker,
  timeoutMs: number,
): Promise<ProviderAdmissionResult> {
  const start = Date.now();

  if (candidates.length === 0) {
    const deterministic = admitActiveMemoryCandidates([]);
    return {
      cards: [],
      decision: deterministic.decision,
      providerUsed: false,
      elapsedMs: Date.now() - start,
    };
  }

  const prompt = buildAdmissionPrompt(request);

  try {
    const responseText = await withTimeout(
      invokeModel({
        prompt,
        messages: [{ role: "user", content: prompt }],
        system: "You are Ora's memory admission gate. Return only valid JSON.",
        maxTokens: 600,
      }),
      timeoutMs,
    );

    const response = parseAdmissionResponse(responseText);
    const selectedSet = new Set(response.selectedIds);
    const cards = candidates
      .filter((c) => selectedSet.has(c.id))
      .slice(0, 6)
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        category: c.category,
        confidence: c.confidence,
        sourceRunId: c.sourceRunId,
        freshness: c.freshness,
        content: c.content.slice(0, 420),
      }));

    const decision: ActiveMemoryAdmissionDecision = {
      status: cards.length > 0 ? "USE" : "NONE",
      mode: "provider",
      reason: response.reason,
      candidateIds: candidates.map((c) => c.id),
      selectedIds: cards.map((c) => c.id),
      rejectedIds: [...response.rejectedIds, ...candidates.filter((c) => !selectedSet.has(c.id)).map((c) => c.id)].filter((id, i, arr) => arr.indexOf(id) === i),
      budget: { maxCandidates: candidates.length, maxChars: request.maxSummaryChars, renderedChars: 0 },
      warnings: response.uncertainty > 0.6 ? [`Provider uncertainty is high (${response.uncertainty.toFixed(2)}).`] : [],
    };

    return {
      cards,
      decision,
      providerUsed: true,
      elapsedMs: Date.now() - start,
    };
  } catch {
    // Fallback to deterministic admission
    const deterministic = admitActiveMemoryCandidates(candidates);
    return {
      cards: deterministic.cards,
      decision: {
        ...deterministic.decision,
        mode: "provider_fallback",
        reason: `Provider admission failed, fell back to deterministic. ${deterministic.decision.reason}`,
      },
      providerUsed: false,
      elapsedMs: Date.now() - start,
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Provider admission timed out.")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
