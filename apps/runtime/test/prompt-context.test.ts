import { describe, expect, it } from "vitest";
import { buildAgentPromptContext, temporalContextPrompt } from "../src/harness/prompt-context.js";

describe("prompt temporal context", () => {
  it("returns stable temporal guidance instead of volatile timestamps", () => {
    const temporalContext = temporalContextPrompt({
      createdAt: Date.parse("2026-05-09T01:23:45.000Z"),
      context: {
        userTemporalContext: {
          timezone: "Asia/Shanghai",
          locale: "zh-CN",
        },
      },
    });

    expect(temporalContext).toContain("Temporal reasoning protocol:");
    expect(temporalContext).toContain("not embedded as durable system facts");
    expect(temporalContext).not.toContain("Current date: 2026-05-09");
    expect(temporalContext).toContain("latest, recent, today, this week");
  });

  it("keeps temporal guidance inside the assembled stable system prompt", () => {
    const prompt = buildAgentPromptContext({
      agentId: "ora",
      stageSystem: "Answer the user.",
      temporalContext: temporalContextPrompt({
        createdAt: Date.parse("2026-05-09T01:23:45.000Z"),
        context: { timezone: "Asia/Shanghai" },
      }),
    });

    expect(prompt.sections.some((section) => section.id === "temporal_context")).toBe(true);
    expect(prompt.stablePrefix).toContain("Ora operating protocol:");
    expect(prompt.stablePrefix).toContain("Temporal reasoning protocol:");
    expect(prompt.system).toContain("Temporal reasoning protocol:");
    expect(prompt.system).not.toContain("Current date: 2026-05-09");
  });

  it("includes project instructions when provided", () => {
    const prompt = buildAgentPromptContext({
      agentId: "ora",
      stageSystem: "Answer the user.",
      projectInstructionsContext: [
        "<project_instructions>",
        "The following instructions are from the project's AGENTS.md file.",
        "Follow these guidelines when working in this project.",
        "",
        "Always use TypeScript strict mode.",
        "</project_instructions>",
      ].join("\n"),
    });

    const ids = prompt.sections.map((s) => s.id);
    expect(ids).toContain("project_instructions");
    expect(prompt.system).toContain("Always use TypeScript strict mode.");
    expect(prompt.stablePrefix).toContain("Always use TypeScript strict mode.");
  });

  it("omits project instructions section when content is empty", () => {
    const prompt = buildAgentPromptContext({
      agentId: "ora",
      stageSystem: "Answer the user.",
      projectInstructionsContext: "   ",
    });

    expect(prompt.sections.some((s) => s.id === "project_instructions")).toBe(false);
  });
});
