import { describe, expect, it } from "vitest";
import {
  activeUsageForMessages,
  resolveAutoCompactTokenLimit,
  shouldCompactContext,
  usageForModelResponse,
} from "../src/context-manager.js";

describe("runtime context manager", () => {
  it("derives auto compact limits from provider context windows", () => {
    expect(resolveAutoCompactTokenLimit({
      id: "p",
      type: "openai",
      label: "Provider",
      modelId: "m",
      contextWindow: 100000,
      autoCompactTokenLimit: 95000,
      capabilities: ["chat"],
      dropParams: [],
      headers: {},
      enabled: true,
    })).toBe(90000);

    expect(resolveAutoCompactTokenLimit({
      id: "p",
      type: "openai",
      label: "Provider",
      modelId: "m",
      maxContextWindow: 200000,
      capabilities: ["chat"],
      dropParams: [],
      headers: {},
      enabled: true,
    })).toBe(180000);
  });

  it("falls back to estimated usage when provider usage is missing", () => {
    const usage = usageForModelResponse({
      providerId: "p",
      providerType: "openai",
      modelId: "m",
      text: "short answer",
      raw: {},
    }, {
      messages: [{ role: "user", content: "A moderately sized prompt" }],
      system: "System instructions",
    });

    expect(usage.source).toBe("estimate");
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBe(usage.inputTokens + usage.outputTokens);
  });

  it("detects contexts at or above the compact threshold", () => {
    const messages = [{ role: "user" as const, content: "x ".repeat(400) }];
    const usage = activeUsageForMessages(messages);
    const check = shouldCompactContext({
      provider: {
        id: "tiny",
        type: "openai",
        label: "Tiny",
        modelId: "tiny-model",
        contextWindow: Math.max(1, usage.totalTokens),
        capabilities: ["chat"],
        dropParams: [],
        headers: {},
        enabled: true,
      },
      messages,
    });

    expect(check.limit).toBe(Math.floor(usage.totalTokens * 0.9));
    expect(check.shouldCompact).toBe(true);
  });
});
