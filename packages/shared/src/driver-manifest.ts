import type { CoordinationPattern } from "./primitives.js";
import type { ModeRuntimeAtomId } from "./modes.js";

/**
 * Declares what a mode driver consumes, ignores, and supports at runtime.
 *
 * This is the contract between Mode Studio (editing UI), ModeSpec (persisted graph),
 * runtime topology projection, and the driver's execution plan. Mode Studio reads
 * the manifest to warn or disable operations the selected driver does not support,
 * and the execution preview helper uses it to explain what will happen at runtime.
 */
export interface DriverCapabilityManifest {
  /** The coordination pattern family this manifest describes. */
  family: CoordinationPattern;

  /** Human-readable label for the driver. */
  label: string;

  /**
   * Execution model used by the driver.
   *
   * - `sequential`: nodes execute one at a time in topological order.
   * - `layered_parallel`: independent nodes within a layer execute in parallel (Promise.all).
   * - `loop_retry`: nodes are re-executed in a loop until a stop condition is met.
   * - `dag_parallel`: layers execute sequentially, but nodes within a layer execute in parallel (Promise.all).
   */
  execution: "sequential" | "layered_parallel" | "loop_retry" | "dag_parallel";

  /**
   * Whether the driver evaluates `ModeEdgeSpec.condition` to skip or route execution.
   * When false, conditions on edges are silently ignored at runtime.
   */
  consumesConditions: boolean;

  /**
   * Whether `orderedEnabledModeLayers` parallelism is supported.
   * When false, the driver flattens all nodes to sequential execution regardless of
   * edge topology.
   */
  supportsParallelLayers: boolean;

  /**
   * How a single-owner mode (all nodes share the same owner agent, no subagent
   * delegation) projects its runtime topology.
   *
   * - `compressed`: topology is reduced to `run → primary_agent`.
   * - `full`: family default topology is preserved even for single-owner modes.
   */
  singleOwnerTopology: "compressed" | "full";

  /**
   * TopologyEdge kinds that carry execution meaning for this driver beyond source/target
   * ordering. An empty array means all edge kinds are visual/observability only — the
   * driver reads edges purely for topological sort.
   */
  executedEdgeKinds: string[];

  /**
   * Runtime atoms that are incompatible with this driver. Mode Studio should block
   * or warn when these atoms are enabled for the mode.
   */
  unsupportedAtoms: ModeRuntimeAtomId[];

  /**
   * Maximum number of enabled nodes. Zero means unlimited.
   */
  maxNodes: number;

  /**
   * Whether the driver supports staged transcripts (per-node speaker/stance stages
   * with transcript layout).
   */
  supportsStaging: boolean;

  /**
   * Whether the driver emits node-level checkpoints during execution that can be
   * inspected or used for resume.
   */
  nodeCheckpoints: boolean;

  /**
   * Human-readable constraints surfaced in Mode Studio to help authors understand
   * driver-specific limitations.
   */
  constraints: string[];
}

/**
 * Manifests for every built-in coordination pattern family.
 *
 * These are the canonical capability declarations. Every registered ModeDriver
 * MUST have a corresponding manifest entry.
 */
export const BUILT_IN_DRIVER_MANIFESTS: Record<string, DriverCapabilityManifest> = {
  generator_verifier: {
    family: "generator_verifier",
    label: "Generator–Verifier",
    execution: "loop_retry",
    consumesConditions: false,
    supportsParallelLayers: false,
    singleOwnerTopology: "compressed",
    executedEdgeKinds: [],
    unsupportedAtoms: [
      "persistent_worker_memory",
      "event_routing",
      "shared_blackboard",
      "deferred_tool_discovery",
      "subagent_delegate",
      "dynamic_stage_skipping",
    ],
    maxNodes: 3,
    supportsStaging: false,
    nodeCheckpoints: true,
    constraints: [
      "Nodes execute in a retry loop up to maxIterations (default 3).",
      "Only draft → verify → decide templates are supported.",
      "Edge conditions are not consumed — every enabled edge is followed every iteration.",
      "Single-owner modes compress the runtime topology to run → primary agent.",
    ],
  },

  orchestrator_subagent: {
    family: "orchestrator_subagent",
    label: "Orchestrator–Subagent",
    execution: "dag_parallel",
    consumesConditions: false,
    supportsParallelLayers: true,
    singleOwnerTopology: "compressed",
    executedEdgeKinds: [],
    unsupportedAtoms: [
      "persistent_worker_memory",
      "event_routing",
      "shared_blackboard",
    ],
    maxNodes: 0,
    supportsStaging: true,
    nodeCheckpoints: true,
    constraints: [
      "Nodes execute in topological layers — independent nodes within a layer run in parallel.",
      "Staged transcripts are supported — each node can have multiple speaker/stance stages.",
      "Edge conditions are not consumed — every enabled edge is followed.",
      "Single-owner modes skip decomposition and deliver a direct solo response.",
      "Dynamic Delegation atom lets the orchestrator skip subagents at runtime based on task assessment.",
      "Custom templates fall back to generic dispatch with bag-based key naming.",
    ],
  },

  agent_teams: {
    family: "agent_teams",
    label: "Agent Teams",
    execution: "dag_parallel",
    consumesConditions: false,
    supportsParallelLayers: true,
    singleOwnerTopology: "compressed",
    executedEdgeKinds: [],
    unsupportedAtoms: [
      "event_routing",
      "shared_blackboard",
      "dynamic_stage_skipping",
    ],
    maxNodes: 0,
    supportsStaging: false,
    nodeCheckpoints: true,
    constraints: [
      "Nodes execute in topological layers — independent nodes within a layer run in parallel.",
      "Edge conditions are not consumed — every enabled edge is followed.",
      "Supports persistent worker agents with identity across tasks.",
      "Complexity assessment (L0–L3) can skip nodes based on triage output.",
    ],
  },

  message_bus: {
    family: "message_bus",
    label: "Message Bus",
    execution: "dag_parallel",
    consumesConditions: false,
    supportsParallelLayers: true,
    singleOwnerTopology: "compressed",
    executedEdgeKinds: [],
    unsupportedAtoms: [
      "persistent_worker_memory",
      "shared_blackboard",
      "dynamic_stage_skipping",
    ],
    maxNodes: 0,
    supportsStaging: false,
    nodeCheckpoints: true,
    constraints: [
      "Nodes execute sequentially in topological order.",
      "Edge conditions are not consumed.",
      "Messages are routed via publish → route → handle → respond pipeline.",
      "Correlation IDs link published messages to responses.",
    ],
  },

  shared_state: {
    family: "shared_state",
    label: "Shared State",
    execution: "layered_parallel",
    consumesConditions: true,
    supportsParallelLayers: true,
    singleOwnerTopology: "compressed",
    executedEdgeKinds: [],
    unsupportedAtoms: [
      "subagent_delegate",
      "dynamic_stage_skipping",
    ],
    maxNodes: 0,
    supportsStaging: false,
    nodeCheckpoints: true,
    constraints: [
      "Nodes execute in topological layers — independent nodes within a layer run in parallel.",
      "Edge conditions ARE consumed — conditional edges can skip nodes within a layer.",
      "Shared state is written to a board that all agents can read.",
      "Cycle detection degrades layer grouping to flat sequential execution.",
    ],
  },
};

/**
 * Returns the capability manifest for a built-in family, or undefined for custom families.
 */
export function getDriverManifest(family: CoordinationPattern): DriverCapabilityManifest | undefined {
  return BUILT_IN_DRIVER_MANIFESTS[family];
}

/**
 * Returns an array of warnings for operations in a ModeSpec that the driver does not
 * consume or support. Used by validation and execution preview.
 */
export function driverManifestWarnings(
  manifest: DriverCapabilityManifest,
  options: {
    hasConditions: boolean;
    nodeCount: number;
    activeAtomIds: string[];
  },
): string[] {
  const warnings: string[] = [];

  if (options.hasConditions && !manifest.consumesConditions) {
    warnings.push(
      `This mode has conditional edges, but the "${manifest.label}" driver does not consume edge conditions. Conditions will be silently ignored at runtime.`,
    );
  }

  if (manifest.maxNodes > 0 && options.nodeCount > manifest.maxNodes) {
    warnings.push(
      `This mode has ${options.nodeCount} enabled nodes, but the "${manifest.label}" driver supports at most ${manifest.maxNodes}.`,
    );
  }

  for (const atomId of options.activeAtomIds) {
    if (manifest.unsupportedAtoms.includes(atomId as ModeRuntimeAtomId)) {
      warnings.push(
        `Runtime atom "${atomId}" is not supported by the "${manifest.label}" driver and may have no effect.`,
      );
    }
  }

  return warnings;
}

// ── repair suggestions ───────────────────────────────────────────────

export interface RepairSuggestion {
  issue: string;
  action: "switch_family" | "remove_condition" | "convert_edge" | "rebuild_layers" | "remove_atom" | "remove_layout";
  target?: string;
  label: string;
}

/**
 * Generates repair suggestions when a ModeSpec mismatches its driver's capability manifest.
 * Called after validation to offer actionable fixes.
 */
export function generateRepairSuggestions(
  mode: { family: string; nodes: Array<{ id: string }>; edges: Array<{ id: string; condition?: string; kind: string }>; runtimeAtoms: string[]; transcriptLayout?: unknown },
): RepairSuggestion[] {
  const manifest = getDriverManifest(mode.family);
  if (!manifest) return [];

  const suggestions: RepairSuggestion[] = [];
  const hasConditions = mode.edges.some((e) => typeof e.condition === "string" && e.condition.length > 0);

  // Conditions not consumed → suggest removing them or switching to shared_state
  if (hasConditions && !manifest.consumesConditions) {
    for (const edge of mode.edges.filter((e) => typeof e.condition === "string" && e.condition.length > 0)) {
      suggestions.push({
        issue: `Conditional edge "${edge.id}" is not consumed by the "${manifest.label}" driver.`,
        action: "remove_condition",
        target: edge.id,
        label: `Remove condition from edge "${edge.id}"`,
      });
    }
    suggestions.push({
      issue: `The "${manifest.label}" driver does not consume conditions.`,
      action: "switch_family",
      target: "shared_state",
      label: 'Switch family to "Shared State" (supports conditions)',
    });
  }

  // Max nodes exceeded → suggest switching family
  if (manifest.maxNodes > 0 && mode.nodes.length > manifest.maxNodes) {
    suggestions.push({
      issue: `This mode has ${mode.nodes.length} nodes but "${manifest.label}" supports at most ${manifest.maxNodes}.`,
      action: "switch_family",
      label: "Switch to a family without node limits",
    });
  }

  // Unsupported atoms → suggest removing them
  for (const atomId of mode.runtimeAtoms) {
    if (manifest.unsupportedAtoms.includes(atomId as never)) {
      suggestions.push({
        issue: `Runtime atom "${atomId}" is not supported by "${manifest.label}".`,
        action: "remove_atom",
        target: atomId,
        label: `Remove runtime atom "${atomId}"`,
      });
    }
  }

  // Transcript layout without staging support
  if (mode.transcriptLayout && !manifest.supportsStaging) {
    suggestions.push({
      issue: `Transcript layout is configured but "${manifest.label}" does not support staging.`,
      action: "remove_layout",
      label: "Remove transcript layout",
    });
    suggestions.push({
      issue: `Transcript layouts require staging support.`,
      action: "switch_family",
      target: "orchestrator_subagent",
      label: 'Switch family to "Orchestrator-Subagent" (supports staging)',
    });
  }

  return suggestions;
}
