import { describe, expect, it } from "vitest";
import { buildAgentPromptContext, temporalContextPrompt } from "../src/harness/prompt-context.js";

describe("prompt temporal context", () => {
  it("anchors the prompt to the run timestamp and timezone", () => {
    const temporalContext = temporalContextPrompt({
      createdAt: Date.parse("2026-05-09T01:23:45.000Z"),
      context: {
        userTemporalContext: {
          timezone: "Asia/Shanghai",
          locale: "zh-CN",
        },
      },
    });

    expect(temporalContext).toContain("Current date: 2026-05-09");
    expect(temporalContext).toContain("Current local time: 2026-05-09 09:23:45");
    expect(temporalContext).toContain("Timezone: Asia/Shanghai");
    expect(temporalContext).toContain("Locale: zh-CN");
    expect(temporalContext).toContain("Current UTC time: 2026-05-09T01:23:45.000Z");
    expect(temporalContext).toContain("latest, recent, today, this week");
  });

  it("includes temporal context in the assembled system prompt", () => {
    const prompt = buildAgentPromptContext({
      agentId: "ora",
      stageSystem: "Answer the user.",
      temporalContext: temporalContextPrompt({
        createdAt: Date.parse("2026-05-09T01:23:45.000Z"),
        context: { timezone: "Asia/Shanghai" },
      }),
    });

    expect(prompt.sections.some((section) => section.id === "temporal_context")).toBe(true);
    expect(prompt.stablePrefix).toBe("");
    expect(prompt.system).toContain("Current temporal context:");
    expect(prompt.system).toContain("Current date: 2026-05-09");
  });
});
