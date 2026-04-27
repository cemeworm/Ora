import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalRunStore } from "../src/index.js";

function freshStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-mode-studio-builder-"));
}

describe("Mode Studio guided builder", () => {
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
});
