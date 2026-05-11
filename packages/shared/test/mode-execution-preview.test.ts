import { describe, expect, it } from "vitest";
import { getModePreset } from "../src/modes.js";
import { generateModeExecutionPreview } from "../src/mode-execution-preview.js";

function presetPreview(modeId: string) {
  const mode = getModePreset(modeId);
  if (!mode) throw new Error(`Unknown mode preset: ${modeId}`);
  return generateModeExecutionPreview(mode);
}

describe("generateModeExecutionPreview — built-in presets", () => {
  it("generates preview for generator_verifier", () => {
    const preview = presetPreview("generator_verifier");
    expect(preview.family).toBe("generator_verifier");
    expect(preview.manifest).toBeDefined();
    expect(preview.manifest!.execution).toBe("loop_retry");
    expect(preview.manifest!.consumesConditions).toBe(false);
    expect(preview.orderedNodes.length).toBeGreaterThanOrEqual(1);
    expect(preview.layers.every((l) => !l.parallel)).toBe(true);
    // generator_verifier preset is multi-owner (draft→generator, verify→verifier)
    expect(preview.conditionalEdges.length).toBe(0);
  });

  it("generates preview for orchestrator_subagent", () => {
    const preview = presetPreview("orchestrator_subagent");
    expect(preview.family).toBe("orchestrator_subagent");
    expect(preview.manifest!.execution).toBe("sequential");
    expect(preview.manifest!.consumesConditions).toBe(false);
    expect(preview.manifest!.supportsStaging).toBe(true);
    expect(preview.orderedNodes.length).toBeGreaterThanOrEqual(1);
    expect(preview.layers.every((l) => !l.parallel)).toBe(true);
  });

  it("generates preview for agent_teams", () => {
    const preview = presetPreview("agent_teams");
    expect(preview.family).toBe("agent_teams");
    expect(preview.manifest!.execution).toBe("sequential");
    expect(preview.manifest!.consumesConditions).toBe(false);
    expect(preview.orderedNodes.length).toBeGreaterThanOrEqual(1);
  });

  it("generates preview for message_bus", () => {
    const preview = presetPreview("message_bus");
    expect(preview.family).toBe("message_bus");
    expect(preview.manifest!.execution).toBe("sequential");
    expect(preview.manifest!.consumesConditions).toBe(false);
    expect(preview.orderedNodes.length).toBeGreaterThanOrEqual(1);
  });

  it("generates preview for shared_state", () => {
    const preview = presetPreview("shared_state");
    expect(preview.family).toBe("shared_state");
    expect(preview.manifest!.execution).toBe("layered_parallel");
    expect(preview.manifest!.consumesConditions).toBe(true);
    expect(preview.manifest!.supportsParallelLayers).toBe(true);
  });

  it("generates preview for code_development (agent_teams family with extra atoms)", () => {
    const preview = presetPreview("code_development");
    expect(preview.family).toBe("agent_teams");
    expect(preview.manifest!.execution).toBe("sequential");
    // code_development has dynamic_stage_skipping which is unsupported by agent_teams
    expect(preview.warnings.some((w) => w.includes("dynamic_stage_skipping"))).toBe(true);
  });
});

describe("generateModeExecutionPreview — synthetic nodes", () => {
  it("maps mode-scoped runtime atoms to synthetic mode_capability nodes", () => {
    const mode = getModePreset("shared_state")!;
    const preview = generateModeExecutionPreview(mode);
    const modeCaps = preview.syntheticNodes.filter((s) => s.kind === "mode_capability");
    // Verify structure regardless of count
    for (const cap of modeCaps) {
      expect(cap.persistedAs).toContain("mode.runtimeAtoms");
      expect(cap.canvasNodeId).toMatch(/^__mode_atom__:/);
    }
  });

  it("synthetic node structure is valid for all built-in presets", () => {
    for (const modeId of ["generator_verifier", "orchestrator_subagent", "agent_teams", "message_bus", "shared_state"]) {
      const mode = getModePreset(modeId);
      if (!mode) continue;
      const preview = generateModeExecutionPreview(mode);
      // Every synthetic node has valid identifiers
      for (const s of preview.syntheticNodes) {
        expect(s.canvasNodeId.length).toBeGreaterThan(0);
        expect(s.label.length).toBeGreaterThan(0);
        expect(s.persistedAs.length).toBeGreaterThan(0);
        expect(s.topologyProjection.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("generateModeExecutionPreview — conditional edges", () => {
  it("shared_state declares condition support", () => {
    const mode = getModePreset("shared_state")!;
    const preview = generateModeExecutionPreview(mode);
    expect(preview.manifest!.consumesConditions).toBe(true);
  });

  it("non-shared_state families do not consume conditions", () => {
    for (const modeId of ["generator_verifier", "orchestrator_subagent", "agent_teams", "message_bus"]) {
      const mode = getModePreset(modeId)!;
      const preview = generateModeExecutionPreview(mode);
      expect(preview.manifest!.consumesConditions).toBe(false);
    }
  });
});

describe("generateModeExecutionPreview — topology projection", () => {
  it("detects compressed single-owner topology for single_agent mode", () => {
    const preview = presetPreview("single_agent");
    expect(preview.projectedTopology.compressed).toBe(true);
    expect(preview.projectedTopology.nodes.some((n) => n.kind === "run")).toBe(true);
    expect(preview.projectedTopology.nodes.some((n) => n.kind === "agent")).toBe(true);
  });

  it("includes topology edges", () => {
    const preview = presetPreview("orchestrator_subagent");
    expect(preview.projectedTopology.edgeCount).toBeGreaterThan(0);
    const controlEdge = preview.projectedTopology.edges.find((e) => e.kind === "control");
    expect(controlEdge).toBeDefined();
  });
});

describe("generateModeExecutionPreview — warnings", () => {
  it("base built-in presets have no severe warnings", () => {
    // Only test the base pattern presets (not derived modes like code_development
    // which deliberately adds unsupported atoms)
    for (const modeId of [
      "generator_verifier",
      "orchestrator_subagent",
      "agent_teams",
      "message_bus",
      "shared_state",
    ]) {
      const mode = getModePreset(modeId);
      if (!mode) continue;
      const preview = generateModeExecutionPreview(mode);
      expect(
        preview.warnings,
        `Unexpected warnings for ${modeId}: ${preview.warnings.join("; ")}`,
      ).toEqual([]);
    }
  });

  it("warns when no manifest exists for the family", () => {
    const mode = getModePreset("generator_verifier")!;
    const customMode = {
      ...mode,
      family: "custom_family_123" as never,
      nodes: [...mode.nodes],
      edges: [...mode.edges],
      profiles: [...mode.profiles],
      runtimeAtoms: [...mode.runtimeAtoms],
      capabilityFlags: { ...mode.capabilityFlags },
      editorConstraints: { ...mode.editorConstraints },
      stopPolicy: { ...mode.stopPolicy },
      defaultBudget: { ...mode.defaultBudget },
      completionPolicy: { ...mode.completionPolicy },
      runtimePolicy: { ...mode.runtimePolicy },
      recoveryPolicy: {
        ...mode.recoveryPolicy,
        defaults: { ...mode.recoveryPolicy.defaults },
        rules: mode.recoveryPolicy.rules.map((r) => ({
          ...r,
          errorTypes: [...r.errorTypes],
          nodeIds: [...r.nodeIds],
          nodeTemplates: [...r.nodeTemplates],
          toolIds: [...r.toolIds],
          alternateToolIds: [...r.alternateToolIds],
        })),
      },
      memoryPolicy: { ...mode.memoryPolicy },
    };
    const preview = generateModeExecutionPreview(customMode as never);
    expect(preview.manifest).toBeUndefined();
    expect(preview.warnings.some((w) => w.includes("No driver capability manifest"))).toBe(true);
    // Topology projection gracefully degrades for unknown families
    expect(preview.projectedTopology.nodeCount).toBe(0);
  });

  it("warns when transcript layout is set but driver does not support staging", () => {
    const mode = getModePreset("agent_teams")!;
    const modeWithLayout = {
      ...mode,
      nodes: [...mode.nodes],
      edges: [...mode.edges],
      profiles: [...mode.profiles],
      runtimeAtoms: [...mode.runtimeAtoms],
      capabilityFlags: { ...mode.capabilityFlags },
      editorConstraints: { ...mode.editorConstraints },
      stopPolicy: { ...mode.stopPolicy },
      defaultBudget: { ...mode.defaultBudget },
      completionPolicy: { ...mode.completionPolicy },
      runtimePolicy: { ...mode.runtimePolicy },
      recoveryPolicy: {
        ...mode.recoveryPolicy,
        defaults: { ...mode.recoveryPolicy.defaults },
        rules: mode.recoveryPolicy.rules.map((r) => ({
          ...r,
          errorTypes: [...r.errorTypes],
          nodeIds: [...r.nodeIds],
          nodeTemplates: [...r.nodeTemplates],
          toolIds: [...r.toolIds],
          alternateToolIds: [...r.alternateToolIds],
        })),
      },
      memoryPolicy: { ...mode.memoryPolicy },
      transcriptLayout: { style: "stage_list" as const },
      stages: [],
    };
    const preview = generateModeExecutionPreview(modeWithLayout);
    expect(preview.warnings.some((w) => w.includes("Transcript layout"))).toBe(true);
  });
});

describe("generateModeExecutionPreview — layers", () => {
  it("shared_state layers can be parallel when multi-node", () => {
    const mode = getModePreset("shared_state")!;
    const preview = generateModeExecutionPreview(mode);
    for (const layer of preview.layers) {
      expect(typeof layer.index).toBe("number");
      expect(Array.isArray(layer.nodeIds)).toBe(true);
      if (layer.nodeIds.length > 1) {
        expect(layer.parallel).toBe(true);
      }
    }
  });

  it("non-shared_state families never have parallel layers", () => {
    for (const modeId of ["generator_verifier", "orchestrator_subagent"]) {
      const mode = getModePreset(modeId)!;
      const preview = generateModeExecutionPreview(mode);
      for (const layer of preview.layers) {
        expect(layer.parallel).toBe(false);
      }
    }
  });
});
