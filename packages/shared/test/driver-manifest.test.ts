import { describe, expect, it } from "vitest";
import { BuiltInCoordinationPatternSchema } from "../src/primitives.js";
import { BUILT_IN_DRIVER_MANIFESTS, getDriverManifest, driverManifestWarnings, generateRepairSuggestions } from "../src/driver-manifest.js";

describe("driver capability manifest", () => {
  it("every built-in family has a manifest", () => {
    for (const family of BuiltInCoordinationPatternSchema.options) {
      const manifest = getDriverManifest(family);
      expect(manifest, `Missing manifest for family "${family}"`).toBeDefined();
      expect(manifest!.family).toBe(family);
      expect(manifest!.label.length).toBeGreaterThan(0);
    }
  });

  it("all manifest families match BuiltInCoordinationPattern", () => {
    const builtInFamilies = new Set(BuiltInCoordinationPatternSchema.options);
    for (const [key, manifest] of Object.entries(BUILT_IN_DRIVER_MANIFESTS)) {
      expect(builtInFamilies.has(key as typeof BuiltInCoordinationPatternSchema.options[number]),
        `Manifest key "${key}" is not a built-in family`).toBe(true);
      expect(manifest.family).toBe(key);
    }
  });

  it("shared_state is the only family that consumes conditions", () => {
    for (const manifest of Object.values(BUILT_IN_DRIVER_MANIFESTS)) {
      if (manifest.family === "shared_state") {
        expect(manifest.consumesConditions).toBe(true);
      } else {
        expect(manifest.consumesConditions).toBe(false);
      }
    }
  });

  it("families with parallel layers support", () => {
    for (const manifest of Object.values(BUILT_IN_DRIVER_MANIFESTS)) {
      if (manifest.family === "shared_state") {
        expect(manifest.supportsParallelLayers).toBe(true);
        expect(manifest.execution).toBe("layered_parallel");
      } else if (manifest.family === "orchestrator_subagent" || manifest.family === "agent_teams" || manifest.family === "message_bus") {
        expect(manifest.supportsParallelLayers).toBe(true);
      } else {
        expect(manifest.supportsParallelLayers).toBe(false);
      }
    }
  });

  it("all families use compressed single-owner topology", () => {
    for (const manifest of Object.values(BUILT_IN_DRIVER_MANIFESTS)) {
      expect(manifest.singleOwnerTopology).toBe("compressed");
    }
  });

  it("all families have empty executedEdgeKinds (no kind-based branching yet)", () => {
    for (const manifest of Object.values(BUILT_IN_DRIVER_MANIFESTS)) {
      expect(manifest.executedEdgeKinds).toEqual([]);
    }
  });

  it("generator_verifier has maxNodes 3", () => {
    const manifest = getDriverManifest("generator_verifier");
    expect(manifest!.maxNodes).toBe(3);
  });

  it("only orchestrator_subagent supports staging", () => {
    for (const manifest of Object.values(BUILT_IN_DRIVER_MANIFESTS)) {
      if (manifest.family === "orchestrator_subagent") {
        expect(manifest.supportsStaging).toBe(true);
      } else {
        expect(manifest.supportsStaging).toBe(false);
      }
    }
  });
});

describe("driverManifestWarnings", () => {
  it("warns when conditions are present but driver does not consume them", () => {
    const manifest = BUILT_IN_DRIVER_MANIFESTS.orchestrator_subagent;
    const warnings = driverManifestWarnings(manifest, {
      hasConditions: true,
      nodeCount: 4,
      activeAtomIds: [],
    });
    expect(warnings.some((w) => w.includes("conditional edges"))).toBe(true);
  });

  it("does not warn about conditions for shared_state", () => {
    const manifest = BUILT_IN_DRIVER_MANIFESTS.shared_state;
    const warnings = driverManifestWarnings(manifest, {
      hasConditions: true,
      nodeCount: 4,
      activeAtomIds: [],
    });
    expect(warnings.some((w) => w.includes("conditional edges"))).toBe(false);
  });

  it("warns when node count exceeds maxNodes", () => {
    const manifest = BUILT_IN_DRIVER_MANIFESTS.generator_verifier;
    const warnings = driverManifestWarnings(manifest, {
      hasConditions: false,
      nodeCount: 5,
      activeAtomIds: [],
    });
    expect(warnings.some((w) => w.includes("5 enabled nodes") && w.includes("3"))).toBe(true);
  });

  it("does not warn on node count when maxNodes is 0", () => {
    const manifest = BUILT_IN_DRIVER_MANIFESTS.orchestrator_subagent;
    const warnings = driverManifestWarnings(manifest, {
      hasConditions: false,
      nodeCount: 100,
      activeAtomIds: [],
    });
    expect(warnings.some((w) => w.includes("enabled nodes"))).toBe(false);
  });

  it("warns about unsupported atoms", () => {
    const manifest = BUILT_IN_DRIVER_MANIFESTS.generator_verifier;
    const warnings = driverManifestWarnings(manifest, {
      hasConditions: false,
      nodeCount: 2,
      activeAtomIds: ["subagent_delegate", "thread_workspace"],
    });
    expect(warnings.some((w) => w.includes("subagent_delegate"))).toBe(true);
    expect(warnings.some((w) => w.includes("thread_workspace"))).toBe(false);
  });

  it("returns empty warnings for a fully compatible mode", () => {
    const manifest = BUILT_IN_DRIVER_MANIFESTS.shared_state;
    const warnings = driverManifestWarnings(manifest, {
      hasConditions: true,
      nodeCount: 4,
      activeAtomIds: ["thread_workspace", "long_term_memory"],
    });
    expect(warnings).toEqual([]);
  });
});

describe("generateRepairSuggestions", () => {
  it("suggests removing conditions and switching to shared_state for non-condition families", () => {
    const suggestions = generateRepairSuggestions({
      family: "orchestrator_subagent",
      nodes: [{ id: "n1" }, { id: "n2" }],
      edges: [
        { id: "e1", kind: "control", condition: "status == 'pass'" },
      ],
      runtimeAtoms: [],
    });
    const removeActions = suggestions.filter((s) => s.action === "remove_condition");
    const switchActions = suggestions.filter((s) => s.action === "switch_family");
    expect(removeActions.length).toBeGreaterThanOrEqual(1);
    expect(switchActions.some((s) => s.target === "shared_state")).toBe(true);
  });

  it("suggests removing unsupported atoms", () => {
    const suggestions = generateRepairSuggestions({
      family: "generator_verifier",
      nodes: [{ id: "n1" }],
      edges: [],
      runtimeAtoms: ["subagent_delegate", "thread_workspace"],
    });
    expect(suggestions.some((s) => s.action === "remove_atom" && s.target === "subagent_delegate")).toBe(true);
    // thread_workspace is supported, so no suggestion
    expect(suggestions.every((s) => s.target !== "thread_workspace")).toBe(true);
  });

  it("suggests removing transcript layout for non-staging families", () => {
    const suggestions = generateRepairSuggestions({
      family: "agent_teams",
      nodes: [{ id: "n1" }],
      edges: [],
      runtimeAtoms: [],
      transcriptLayout: { style: "stage_list" },
    });
    expect(suggestions.some((s) => s.action === "remove_layout")).toBe(true);
    expect(suggestions.some((s) => s.action === "switch_family" && s.target === "orchestrator_subagent")).toBe(true);
  });

  it("returns empty suggestions for a fully compatible mode", () => {
    const suggestions = generateRepairSuggestions({
      family: "shared_state",
      nodes: [{ id: "s1" }, { id: "r1" }, { id: "c1" }],
      edges: [
        { id: "e1", kind: "control", condition: "status == 'pass'" },
      ],
      runtimeAtoms: ["thread_workspace", "long_term_memory"],
    });
    expect(suggestions).toEqual([]);
  });

  it("returns empty suggestions for unknown family", () => {
    const suggestions = generateRepairSuggestions({
      family: "unknown_custom_family",
      nodes: [{ id: "n1" }],
      edges: [{ id: "e1", kind: "control", condition: "x == '1'" }],
      runtimeAtoms: ["subagent_delegate"],
    });
    expect(suggestions).toEqual([]);
  });

  it("suggests switching family when maxNodes exceeded", () => {
    const suggestions = generateRepairSuggestions({
      family: "generator_verifier",
      nodes: [{ id: "n1" }, { id: "n2" }, { id: "n3" }, { id: "n4" }, { id: "n5" }],
      edges: [],
      runtimeAtoms: [],
    });
    expect(suggestions.some((s) => s.action === "switch_family")).toBe(true);
  });
});
