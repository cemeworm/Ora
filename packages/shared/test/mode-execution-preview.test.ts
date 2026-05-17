import { describe, expect, it } from "vitest";
import { DEBATE_MODE_ID, SINGLE_AGENT_MODE_ID } from "../src/primitives.js";
import { getModePreset } from "../src/modes.js";
import { generateModeExecutionPreview } from "../src/mode-execution-preview.js";

function presetPreview(modeId: string) {
  const mode = getModePreset(modeId);
  if (!mode) throw new Error(`Unknown mode preset: ${modeId}`);
  return generateModeExecutionPreview(mode);
}

describe("generateModeExecutionPreview — kept presets", () => {
  it("generates preview for single_agent", () => {
    const preview = presetPreview(SINGLE_AGENT_MODE_ID);
    expect(preview.family).toBe("orchestrator_subagent");
    expect(preview.manifest).toBeDefined();
    expect(preview.manifest!.execution).toBe("dag_parallel");
    expect(preview.orderedNodes.length).toBeGreaterThanOrEqual(1);
    expect(preview.layers.every((l) => !l.parallel)).toBe(true);
  });

  it("generates preview for code_development", () => {
    const preview = presetPreview("code_development");
    expect(preview.family).toBe("orchestrator_subagent");
    expect(preview.manifest!.execution).toBe("dag_parallel");
    expect(preview.manifest!.supportsStaging).toBe(true);
    expect(preview.orderedNodes.length).toBeGreaterThanOrEqual(1);
  });

  it("generates preview for deep_research", () => {
    const preview = presetPreview("deep_research");
    expect(preview.family).toBe("orchestrator_subagent");
    expect(preview.manifest!.execution).toBe("dag_parallel");
    expect(preview.orderedNodes.length).toBeGreaterThanOrEqual(1);
  });

  it("generates preview for review_critique", () => {
    const preview = presetPreview("review_critique");
    expect(preview.family).toBe("orchestrator_subagent");
    expect(preview.manifest!.execution).toBe("dag_parallel");
    expect(preview.orderedNodes.length).toBeGreaterThanOrEqual(1);
  });

  it("generates preview for debate", () => {
    const preview = presetPreview(DEBATE_MODE_ID);
    expect(preview.family).toBe("orchestrator_subagent");
    expect(preview.manifest!.execution).toBe("dag_parallel");
    expect(preview.manifest!.supportsStaging).toBe(true);
    expect(preview.orderedNodes.length).toBeGreaterThanOrEqual(1);
  });
});

describe("generateModeExecutionPreview — topology projection", () => {
  it("detects compressed single-owner topology for single_agent mode", () => {
    const preview = presetPreview(SINGLE_AGENT_MODE_ID);
    expect(preview.projectedTopology.compressed).toBe(true);
    expect(preview.projectedTopology.nodes.some((n) => n.kind === "run")).toBe(true);
    expect(preview.projectedTopology.nodes.some((n) => n.kind === "agent")).toBe(true);
  });

  it("includes topology edges for multi-node modes", () => {
    const preview = presetPreview("code_development");
    expect(preview.projectedTopology.edgeCount).toBeGreaterThan(0);
    const controlEdge = preview.projectedTopology.edges.find((e) => e.kind === "control");
    expect(controlEdge).toBeDefined();
  });
});

describe("generateModeExecutionPreview — synthetic nodes", () => {
  it("synthetic node structure is valid for kept presets", () => {
    for (const modeId of [SINGLE_AGENT_MODE_ID, "code_development", "deep_research", "review_critique", DEBATE_MODE_ID]) {
      const mode = getModePreset(modeId);
      if (!mode) continue;
      const preview = generateModeExecutionPreview(mode);
      for (const s of preview.syntheticNodes) {
        expect(s.canvasNodeId.length).toBeGreaterThan(0);
        expect(s.label.length).toBeGreaterThan(0);
        expect(s.persistedAs.length).toBeGreaterThan(0);
        expect(s.topologyProjection.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("generateModeExecutionPreview — warnings", () => {
  it("warns when no manifest exists for the family", () => {
    const mode = getModePreset(SINGLE_AGENT_MODE_ID)!;
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
  });
});
