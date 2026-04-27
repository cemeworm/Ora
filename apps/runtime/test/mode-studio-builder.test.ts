import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createModeSpecFromPattern } from "@ora/shared";

const providerResponses: string[] = [];

vi.mock("../src/providers/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/index.js")>(
    "../src/providers/index.js"
  );

  return {
    ...actual,
    invokeRunProvider: vi.fn(async (config, request) => {
      const text = providerResponses.shift() ?? `reply:${request.prompt ?? ""}`;
      return {
        providerId: config.providerId ?? "mock-provider",
        providerType: "local_smoke",
        modelId: config.modelRef ?? "mock-model",
        text,
        raw: {
          prompt: request.prompt,
          messages: request.messages ?? [],
          system: request.system,
        },
      };
    }),
  };
});

import { LocalRunStore } from "../src/index.js";

function freshStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-mode-studio-builder-"));
}

describe("Mode Studio guided builder", () => {
  beforeEach(() => {
    providerResponses.length = 0;
  });

  it("generates a validated draft bundle without persisting modes or agents", () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir() });
    const modeCount = store.listModes().length;

    const bundle = store.generateModeStudioDraft({
      messages: [
        { role: "user", content: "做一个代码审查 mode，builder 先产出，reviewer 严格检查风险和测试。" },
      ],
      baseModeId: "generator_verifier",
      modelRef: "local/smoke-model",
    });

    expect(bundle.needsInput).toBe(false);
    expect(bundle.validation.valid).toBe(true);
    expect(bundle.modeDraft.systemPreset).toBe(false);
    expect(bundle.modeDraft.family).toBe("generator_verifier");
    expect(bundle.agentDrafts.map((agent) => agent.name)).toHaveLength(2);
    expect(bundle.modeDraft.nodes.every((node) => {
      const story = node.config.story as { summary?: unknown; generatedBy?: unknown } | undefined;
      return typeof story?.summary === "string"
        && story.summary.includes("代码审查")
        && story.generatedBy === "mode_studio_builder";
    })).toBe(true);
    expect(bundle.guidance.choices.length).toBeGreaterThan(0);
    expect(store.listModes()).toHaveLength(modeCount);
    expect(store.listAgents()).toEqual([]);
  });

  it("applies a draft bundle only when explicitly requested", () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir() });
    const bundle = store.generateModeStudioDraft({
      messages: [
        { role: "user", content: "需要多个 agent 分工并行处理代码实现、审查和验证。" },
      ],
      baseModeId: "agent_teams",
    });

    const applied = store.applyModeStudioDraft({ draftBundle: bundle });

    expect(bundle.modeDraft.family).toBe("agent_teams");
    expect(applied.mode.id).toBe(bundle.modeDraft.id);
    expect(applied.agents.map((agent) => agent.name)).toEqual(bundle.agentDrafts.map((agent) => agent.name));
    expect(store.getMode({ modeId: bundle.modeDraft.id }).profiles.every((profile) => profile.customAgentId)).toBe(true);
    expect(store.listAgents().map((agent) => agent.name).sort()).toEqual(bundle.agentDrafts.map((agent) => agent.name).sort());
  });

  it("returns proactive guidance instead of a full roster for vague prompts", () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir() });

    const bundle = store.generateModeStudioDraft({
      messages: [{ role: "user", content: "mode" }],
    });

    expect(bundle.needsInput).toBe(true);
    expect(bundle.agentDrafts).toEqual([]);
    expect(bundle.guidance.step).toBe("topology");
    expect(bundle.guidance.choices.map((choice) => choice.label)).toContain("Team Parallel");
  });

  it("starts a runtime-backed builder run and returns a validated provider draft", async () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir() });
    const modeCount = store.listModes().length;
    const base = createModeSpecFromPattern("generator_verifier");
    const modeDraft = {
      ...base,
      id: "strict-code-review-mode",
      label: "Strict Code Review",
      summary: "Generate code changes and verify them with strict risk and test review.",
      description: "A runtime-generated Mode Studio draft for strict code review.",
      recommendedUse: "Use for code changes that need a builder and a strict reviewer.",
      systemPreset: false,
      visibility: "user",
      nodes: base.nodes.map((node) => ({
        ...node,
        ownerAgentId: node.template === "verify" ? "verifier" : "generator",
        prompt: node.template === "verify"
          ? "Review the candidate code for regressions, missing tests, and unclear acceptance criteria."
          : "Produce the requested code change with concise implementation notes.",
        config: { story: { summary: `${node.label} is fully specified.`, generatedBy: "provider" } },
      })),
      profiles: base.profiles.map((profile) => ({
        ...profile,
        customAgentId: `${profile.id}-strict-code-review`,
        toolIds: ["file.read", "file.grep"],
        skillIds: [],
      })),
    };
    providerResponses.push(JSON.stringify({
      assistantMessage: "已生成严格代码审查 mode。",
      needsInput: false,
      modeDraft,
      agentDrafts: [
        {
          name: "generator-strict-code-review",
          description: "Builds the candidate code change.",
          toolGroups: ["files"],
          toolIds: ["file.read", "file.grep"],
          skillIds: [],
          soul: "Implement narrowly, keep assumptions visible, and report changed files and verification evidence.",
        },
        {
          name: "verifier-strict-code-review",
          description: "Reviews the candidate code change.",
          toolGroups: ["files"],
          toolIds: ["file.read", "file.grep"],
          skillIds: [],
          soul: "Prioritize regressions, missing tests, unclear acceptance criteria, and risky behavior before summary.",
        },
      ],
      changeSummary: ["Named the mode for strict code review.", "Wrote concrete prompts for each stage."],
      issues: [],
    }));

    const handle = await store.startModeStudioBuilderRun({
      operation: "generate",
      messages: [{ role: "user", content: "做一个严格代码审查 mode，builder 产出，reviewer 检查风险和测试。" }],
      baseModeId: "generator_verifier",
      providerId: "mock-provider",
      modelRef: "mock-model",
    });
    const result = store.modeStudioBuilderResult({ runId: handle.runId });

    expect(handle.modeId).toBe("mode_studio_builder");
    expect(result.status).toBe("succeeded");
    expect(result.draftBundle?.validation.valid).toBe(true);
    expect(result.draftBundle?.modeDraft.label).toBe("Strict Code Review");
    expect(result.draftBundle?.modeDraft.nodes.every((node) => node.prompt)).toBe(true);
    expect(store.listModes()).toHaveLength(modeCount);
    expect(store.listAgents()).toEqual([]);
  });

  it("preserves current draft edits during runtime-backed refine", async () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir() });
    const firstBundle = store.generateModeStudioDraft({
      messages: [{ role: "user", content: "做一个代码实现和审查 mode。" }],
      baseModeId: "generator_verifier",
    });
    const editedDraft = {
      ...firstBundle.modeDraft,
      nodes: firstBundle.modeDraft.nodes.map((node) => node.id === firstBundle.modeDraft.nodes[0]?.id
        ? { ...node, prompt: "MANUAL PROMPT: preserve this stage instruction." }
        : node),
    };
    const providerModeDraft = {
      ...editedDraft,
      id: "refined-code-review-mode",
      label: "Refined Code Review",
      nodes: editedDraft.nodes.map(({ prompt: _prompt, ...node }) => node),
    };
    providerResponses.push(JSON.stringify({
      assistantMessage: "已基于当前草稿 refine。",
      needsInput: false,
      modeDraft: providerModeDraft,
      agentDrafts: firstBundle.agentDrafts,
      changeSummary: ["Refined the existing draft without dropping manual stage edits."],
      issues: [],
    }));

    const handle = await store.startModeStudioBuilderRun({
      operation: "refine",
      messages: [
        { role: "user", content: "做一个代码实现和审查 mode。" },
        { role: "assistant", content: firstBundle.guidance.assistantMessage },
        { role: "user", content: "名字更专业一点，但保留我改过的阶段 prompt。" },
      ],
      currentDraft: editedDraft,
      draftBundle: firstBundle,
      providerId: "mock-provider",
      modelRef: "mock-model",
    });
    const result = store.modeStudioBuilderResult({ runId: handle.runId });

    expect(result.draftBundle?.modeDraft.label).toBe("Refined Code Review");
    expect(result.draftBundle?.modeDraft.nodes[0]?.prompt).toBe("MANUAL PROMPT: preserve this stage instruction.");
  });

  it("repairs invalid provider JSON before returning the builder result", async () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir() });
    const base = createModeSpecFromPattern("agent_teams");
    providerResponses.push("not json");
    providerResponses.push(JSON.stringify({
      assistantMessage: "已修复为结构化草稿。",
      needsInput: false,
      modeDraft: {
        ...base,
        id: "team-implementation-mode",
        label: "Team Implementation",
        summary: "Coordinate implementation, review, and handoff.",
        systemPreset: false,
        visibility: "user",
        nodes: base.nodes.map((node) => ({
          ...node,
          prompt: `Run the ${node.template} stage with explicit evidence.`,
        })),
      },
      agentDrafts: [
        {
          name: "team-lead-implementation",
          description: "Coordinates the implementation team.",
          toolGroups: ["files"],
          toolIds: ["file.read"],
          skillIds: [],
          soul: "Triage work into a compact backlog with explicit owners and acceptance criteria.",
        },
      ],
      changeSummary: ["Repaired provider JSON into an apply-ready bundle."],
      issues: [],
    }));

    const handle = await store.startModeStudioBuilderRun({
      operation: "generate",
      messages: [{ role: "user", content: "多个 agent 分工实现、审查、交接。" }],
      baseModeId: "agent_teams",
      providerId: "mock-provider",
      modelRef: "mock-model",
    });
    const result = store.modeStudioBuilderResult({ runId: handle.runId });

    expect(result.draftBundle?.modeDraft.label).toBe("Team Implementation");
    expect(result.draftBundle?.validation.valid).toBe(true);
  });
});
