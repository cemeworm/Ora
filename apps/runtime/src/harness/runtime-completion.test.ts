import { completionPolicyForPreset, type ModeSpec, type RunConfig } from "@cemeworm/shared";
import { describe, expect, it } from "vitest";
import { RuntimeCompletionController } from "./runtime-completion.js";
import type { RuntimeToolCall } from "./runtime-tool-executor.js";

function createController(options: { maxRepeatedToolCalls?: number } = {}) {
  const completionPolicy = {
    ...completionPolicyForPreset("balanced"),
    maxRepeatedToolCalls: options.maxRepeatedToolCalls ?? 2,
  };
  const events: Array<Record<string, unknown>> = [];
  const controller = new RuntimeCompletionController(
    { completionPolicy } as RunConfig,
    {
      completionPolicy,
      defaultBudget: { maxToolCalls: 64 },
    } as ModeSpec,
    (_type, payload) => {
      events.push(payload as Record<string, unknown>);
    },
  );
  return { controller, events };
}

function toolCall(tool: RuntimeToolCall["tool"], args: Record<string, unknown> = {}): RuntimeToolCall {
  return { tool, args };
}

describe("RuntimeCompletionController evidence episodes", () => {
  it("warns and blocks long local-evidence episodes even when tool keys differ", () => {
    const { controller, events } = createController();

    const attempts = [
      toolCall("file.read", { path: "src/a.ts" }),
      toolCall("file.list", { path: "src" }),
      toolCall("file.grep", { path: "src", pattern: "alpha" }),
      toolCall("file.glob", { path: "src", pattern: "*.ts" }),
      toolCall("file.read", { path: "src/b.ts", offset: 10, limit: 20 }),
      toolCall("file.grep", { path: "src", pattern: "beta" }),
    ];

    for (const attempt of attempts) {
      expect(controller.registerToolAttempt(attempt).allowed).toBe(true);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      state: "loop_warning",
      reason: "tool_frequency_exhausted",
      toolFamily: "local_context",
      evidenceEpisodeCount: 4,
      evidenceEpisodeWarnLimit: 4,
      evidenceEpisodeHardLimit: 6,
    });

    const blocked = controller.registerToolAttempt(toolCall("file.list", { path: "docs" }));
    expect(blocked).toMatchObject({
      allowed: false,
      reason: "tool_frequency_exhausted",
    });
    expect(controller.completionStopReason).toBe("tool_frequency_exhausted");
    expect(controller.forcedFinal).toBe(true);
    expect(events[1]).toMatchObject({
      state: "force_final",
      reason: "tool_frequency_exhausted",
      toolFamily: "local_context",
      evidenceEpisodeCount: 7,
      evidenceEpisodeWarnLimit: 4,
      evidenceEpisodeHardLimit: 6,
    });
  });

  it("resets evidence-episode warnings after a non-evidence tool breaks the chain", () => {
    const { controller, events } = createController();

    for (const attempt of [
      toolCall("file.read", { path: "src/a.ts" }),
      toolCall("file.list", { path: "src" }),
      toolCall("file.grep", { path: "src", pattern: "alpha" }),
      toolCall("file.glob", { path: "src", pattern: "*.ts" }),
    ]) {
      expect(controller.registerToolAttempt(attempt).allowed).toBe(true);
    }

    expect(events).toHaveLength(1);
    expect(controller.registerToolAttempt(toolCall("user.clarify", { question: "需要哪个文件？" })).allowed).toBe(true);

    for (const attempt of [
      toolCall("file.read", { path: "docs/a.md" }),
      toolCall("file.list", { path: "docs" }),
      toolCall("file.grep", { path: "docs", pattern: "beta" }),
      toolCall("file.glob", { path: "docs", pattern: "*.md" }),
    ]) {
      expect(controller.registerToolAttempt(attempt).allowed).toBe(true);
    }

    const warningEvents = events.filter((event) => event.state === "loop_warning");
    expect(warningEvents).toHaveLength(2);
    expect(warningEvents[0]).toMatchObject({
      toolFamily: "local_context",
      evidenceEpisodeCount: 4,
    });
    expect(warningEvents[1]).toMatchObject({
      toolFamily: "local_context",
      evidenceEpisodeCount: 4,
    });
  });

  it("allows full-file and ranged file.read calls on the same path", () => {
    const { controller, events } = createController({ maxRepeatedToolCalls: 1 });

    const fullRead = controller.registerToolAttempt(toolCall("file.read", { path: "src/shared.ts" }));
    const rangedRead = controller.registerToolAttempt(toolCall("file.read", { path: "src/shared.ts", offset: 20, limit: 10 }));

    expect(fullRead).toMatchObject({ allowed: true });
    expect(rangedRead).toMatchObject({ allowed: true });
    expect(controller.completionStopReason).toBeUndefined();
    expect(events).toHaveLength(0);
  });

  it("allows grep broadening from a file path to a directory path", () => {
    const { controller, events } = createController({ maxRepeatedToolCalls: 1 });

    const fileScoped = controller.registerToolAttempt(toolCall("file.grep", {
      path: "src/runtime-completion.ts",
      pattern: "tool_frequency_exhausted",
    }));
    const dirScoped = controller.registerToolAttempt(toolCall("file.grep", {
      path: "src",
      pattern: "tool_frequency_exhausted",
    }));

    expect(fileScoped).toMatchObject({ allowed: true });
    expect(dirScoped).toMatchObject({ allowed: true });
    expect(controller.completionStopReason).toBeUndefined();
    expect(events).toHaveLength(0);
  });

  it("gives explicit content-search grep episodes a wider budget than generic local-context episodes", () => {
    const { controller, events } = createController();
    const scope = {
      agentId: "ora",
      nodeId: "ora",
      readContextToolStanceKind: "explicit_content_search" as const,
    };

    for (const pattern of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota"]) {
      expect(controller.registerToolAttempt(toolCall("file.grep", { path: "src", pattern }), scope).allowed).toBe(true);
    }

    expect(controller.completionStopReason).toBeUndefined();
    expect(events).toContainEqual(expect.objectContaining({
      state: "loop_warning",
      reason: "tool_frequency_exhausted",
      toolFamily: "explicit_content_search_grep",
      evidenceEpisodeCount: 6,
      evidenceEpisodeWarnLimit: 6,
      evidenceEpisodeHardLimit: 9,
    }));

    const blocked = controller.registerToolAttempt(toolCall("file.grep", { path: "src", pattern: "kappa" }), scope);
    expect(blocked).toMatchObject({
      allowed: false,
      reason: "tool_frequency_exhausted",
    });
    expect(controller.completionStopReason).toBe("tool_frequency_exhausted");
  });
});
