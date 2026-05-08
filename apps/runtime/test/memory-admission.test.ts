import { describe, expect, it } from "vitest";
import { ActiveMemoryCandidateSchema, type ActiveMemoryCandidate } from "@cemeworm/shared";
import {
  admitWithProvider,
  ProviderAdmissionResponseSchema,
  type ProviderAdmissionRequest,
  type ProviderAdmissionResponse,
} from "../src/memory-admission.js";
import type { MemoryModelInvoker } from "../src/memory.js";

const NOW = "2026-05-08T00:00:00.000Z";

function makeCandidate(overrides: Partial<ActiveMemoryCandidate> & { id: string; content: string; category: string }): ActiveMemoryCandidate {
  return ActiveMemoryCandidateSchema.parse({
    kind: "fact",
    scope: { user: true },
    confidence: 0.9,
    freshness: "fresh",
    score: 0.8,
    scoreReasons: ["keyword:test"],
    createdAt: NOW,
    ...overrides,
  });
}

function jsonInvoker(response: ProviderAdmissionResponse): MemoryModelInvoker {
  return async () => JSON.stringify(response);
}

function errorInvoker(): MemoryModelInvoker {
  return async () => { throw new Error("Provider unavailable"); };
}

describe("ProviderAdmissionResponseSchema", () => {
  it("parses valid USE response", () => {
    const result = ProviderAdmissionResponseSchema.parse({
      selectedIds: ["fact_1"],
      reason: "Matches user preference for TypeScript.",
      rejectedIds: ["fact_2"],
      uncertainty: 0.2,
      result: "USE",
    });
    expect(result.result).toBe("USE");
    expect(result.selectedIds).toEqual(["fact_1"]);
  });

  it("parses valid NONE response", () => {
    const result = ProviderAdmissionResponseSchema.parse({
      selectedIds: [],
      reason: "No memory relevant to query about weather.",
      rejectedIds: ["fact_1", "fact_2"],
      uncertainty: 0.1,
      result: "NONE",
    });
    expect(result.result).toBe("NONE");
    expect(result.selectedIds).toEqual([]);
  });
});

describe("admitWithProvider", () => {
  it("returns provider admission result on success", async () => {
    const candidates = [
      makeCandidate({ id: "fact_ts", content: "User prefers TypeScript strict mode.", category: "preference" }),
      makeCandidate({ id: "fact_lunch", content: "User likes pizza.", category: "context" }),
    ];

    const providerResponse: ProviderAdmissionResponse = {
      selectedIds: ["fact_ts"],
      reason: "TypeScript preference is relevant to the coding request.",
      rejectedIds: ["fact_lunch"],
      uncertainty: 0.15,
      result: "USE",
    };

    const result = await admitWithProvider(
      candidates,
      {
        candidates,
        prompt: "How should I configure TypeScript?",
        maxSummaryChars: 2000,
      },
      jsonInvoker(providerResponse),
      5000,
    );

    expect(result.providerUsed).toBe(true);
    expect(result.decision.mode).toBe("provider");
    expect(result.decision.status).toBe("USE");
    expect(result.decision.selectedIds).toContain("fact_ts");
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.id).toBe("fact_ts");
  });

  it("returns NONE when provider finds no relevant memory", async () => {
    const candidates = [
      makeCandidate({ id: "fact_lunch", content: "User likes pizza.", category: "context" }),
    ];

    const providerResponse: ProviderAdmissionResponse = {
      selectedIds: [],
      reason: "No memory relevant to the coding task.",
      rejectedIds: ["fact_lunch"],
      uncertainty: 0.1,
      result: "NONE",
    };

    const result = await admitWithProvider(
      candidates,
      {
        candidates,
        prompt: "Write a binary search implementation.",
        maxSummaryChars: 2000,
      },
      jsonInvoker(providerResponse),
      5000,
    );

    expect(result.decision.status).toBe("NONE");
    expect(result.cards).toHaveLength(0);
  });

  it("falls back to deterministic when provider errors", async () => {
    const candidates = [
      makeCandidate({ id: "fact_pnpm", content: "User prefers pnpm over npm.", category: "preference" }),
    ];

    const result = await admitWithProvider(
      candidates,
      {
        candidates,
        prompt: "How should I install packages?",
        maxSummaryChars: 2000,
      },
      errorInvoker(),
      5000,
    );

    expect(result.providerUsed).toBe(false);
    expect(result.decision.mode).toBe("provider_fallback");
  });

  it("falls back when provider times out", async () => {
    const candidates = [
      makeCandidate({ id: "fact_slow", content: "User prefers slow responses.", category: "preference" }),
    ];

    const slowInvoker: MemoryModelInvoker = async () => {
      await new Promise((r) => setTimeout(r, 200));
      return JSON.stringify({
        selectedIds: ["fact_slow"],
        reason: "Too late.",
        rejectedIds: [],
        uncertainty: 0,
        result: "USE",
      } satisfies ProviderAdmissionResponse);
    };

    const result = await admitWithProvider(
      candidates,
      {
        candidates,
        prompt: "Test timeout.",
        maxSummaryChars: 2000,
      },
      slowInvoker,
      10, // 10ms timeout
    );

    expect(result.providerUsed).toBe(false);
    expect(result.decision.mode).toBe("provider_fallback");
  });

  it("returns empty immediately for no candidates", async () => {
    const result = await admitWithProvider(
      [],
      {
        candidates: [],
        prompt: "Anything.",
        maxSummaryChars: 2000,
      },
      errorInvoker(),
      5000,
    );

    expect(result.cards).toHaveLength(0);
    expect(result.providerUsed).toBe(false);
  });
});
