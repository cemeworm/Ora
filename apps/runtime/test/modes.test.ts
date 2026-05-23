import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CODE_DEVELOPMENT_MODE_ID, DEBATE_MODE_ID, DEEP_RESEARCH_MODE_ID, ORA_ROOT_AGENT_ID, SINGLE_AGENT_MODE_ID } from "@cemeworm/shared";
import { describe, expect, it } from "vitest";
import { LocalRunStore, ModeSpecFileStore } from "../src/index.js";

function freshStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-modes-"));
}

function configuredToolIds(node: { config: unknown } | undefined): string[] | undefined {
  const config = node?.config as { toolIds?: unknown } | undefined;
  return Array.isArray(config?.toolIds) ? config.toolIds as string[] : undefined;
}

describe("runtime built-in modes", () => {
  it("lists and returns the Code Development system preset", () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir() });

    const listed = store.listModes().find((mode) => mode.id === CODE_DEVELOPMENT_MODE_ID);
    const fetched = store.getMode({ modeId: CODE_DEVELOPMENT_MODE_ID });

    expect(listed).toBeDefined();
    expect(fetched.id).toBe(CODE_DEVELOPMENT_MODE_ID);
    expect(fetched.systemPreset).toBe(true);
    expect(fetched.visibility).toBe("user");
    expect(fetched.family).toBe("orchestrator_subagent");
    expect(fetched.profiles.map((profile) => profile.id)).toEqual([
      ORA_ROOT_AGENT_ID,
      "builder",
      "reviewer",
      "debugger",
    ]);
    expect(fetched.nodes.map((node) => node.id)).toEqual([
      "triage",
      "build",
      "review",
      "debug",
      "handoff",
    ]);
  });

  it("keeps the Code Development system preset read-only", () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir() });
    const mode = store.getMode({ modeId: CODE_DEVELOPMENT_MODE_ID });

    expect(() => store.updateMode({
      modeId: CODE_DEVELOPMENT_MODE_ID,
      spec: {
        ...mode,
        label: "Edited Code Development",
      },
    })).toThrow(/read-only/i);
    expect(() => store.deleteMode({ modeId: CODE_DEVELOPMENT_MODE_ID })).toThrow(/cannot be deleted/i);
  });

  it("lists and returns the Debate system preset", () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir() });

    const fetched = store.getMode({ modeId: DEBATE_MODE_ID });

    expect(fetched.id).toBe(DEBATE_MODE_ID);
    expect(fetched.systemPreset).toBe(true);
    expect(fetched.family).toBe("orchestrator_subagent");
    expect(fetched.profiles.map((profile) => profile.id)).toEqual([
      ORA_ROOT_AGENT_ID,
      "debate_agent",
    ]);
    expect(fetched.nodes.map((node) => node.id)).toEqual([
      "frame",
      "debate",
      "synthesis",
    ]);
  });

  it("keeps Deep Research planning and report stages tool-free", () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir() });

    const fetched = store.getMode({ modeId: DEEP_RESEARCH_MODE_ID });
    const scope = fetched.nodes.find((node) => node.id === "scope");
    const synthesize = fetched.nodes.find((node) => node.id === "synthesize");
    const gather = fetched.nodes.find((node) => node.id === "gather");
    const verify = fetched.nodes.find((node) => node.id === "verify");

    expect(configuredToolIds(scope)).toEqual([]);
    expect(configuredToolIds(synthesize)).toEqual([]);
    expect(configuredToolIds(gather)).toBeUndefined();
    expect(verify?.template).toBe("review");
    expect((verify?.config as { gateOnReviewVerdict?: unknown } | undefined)?.gateOnReviewVerdict).toBe(true);
  });

  it("resolves system preset ids before enforcing built-in family fallback", () => {
    const store = new ModeSpecFileStore(freshStoreDir());

    const resolved = store.resolve(undefined, SINGLE_AGENT_MODE_ID);

    expect(resolved.id).toBe(SINGLE_AGENT_MODE_ID);
    expect(resolved.systemPreset).toBe(true);
    expect(resolved.family).toBe("orchestrator_subagent");
  });

  it("rejects unknown non-built-in fallback families", () => {
    const store = new ModeSpecFileStore(freshStoreDir());

    expect(() => store.resolve(undefined, "custom_unregistered_family")).toThrow(
      "Mode 'custom_unregistered_family' not found.",
    );
  });
});
