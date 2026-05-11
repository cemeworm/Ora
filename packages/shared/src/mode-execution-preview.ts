import {
  orderedEnabledModeNodes,
  orderedEnabledModeLayers,
  projectModeRuntimeTopology,
  getModeRuntimeAtom,
  nodeRuntimeAtomIds,
  type ModeSpec,
  type ModeRuntimeAtomId,
} from "./modes.js";
import {
  getDriverManifest,
  driverManifestWarnings,
  type DriverCapabilityManifest,
} from "./driver-manifest.js";
import type { CoordinationPattern } from "./primitives.js";

// ── preview output types ──────────────────────────────────────────────

export interface PreviewNode {
  id: string;
  label: string;
  template: string;
  ownerAgentId?: string;
  enabled: boolean;
  dependencies: string[];
}

export interface PreviewLayer {
  index: number;
  nodeIds: string[];
  parallel: boolean;
}

export interface PreviewEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  label?: string;
  /** Whether the driver semantically consumes this edge kind (not just ordering). */
  consumed: boolean;
}

export interface PreviewConditionalEdge {
  id: string;
  source: string;
  target: string;
  condition: string;
  /** Whether the driver evaluates this condition at runtime. */
  consumed: boolean;
}

export interface SyntheticNodeMapping {
  canvasNodeId: string;
  kind: "runtime_anchor" | "mode_capability" | "node_attachment";
  label: string;
  /** Where this synthetic node is persisted (e.g. "mode.runtimeAtoms") */
  persistedAs: string;
  /** Brief description of its runtime effect. */
  runtimeEffect: string;
  /** How it appears in projected runtime topology. */
  topologyProjection: string;
}

export interface PreviewTopologyNode {
  id: string;
  kind: string;
  label: string;
  agentId?: string;
}

export interface PreviewTopologyEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
}

export interface ModeExecutionPreview {
  family: CoordinationPattern;
  driverLabel: string;
  manifest: DriverCapabilityManifest | undefined;

  /** Nodes in topological execution order. */
  orderedNodes: PreviewNode[];
  /** Topological layers (for parallel-capable drivers). */
  layers: PreviewLayer[];
  /** All edges, annotated with whether the driver consumes them. */
  edges: PreviewEdge[];
  /** Edges with conditions, annotated with whether the driver evaluates them. */
  conditionalEdges: PreviewConditionalEdge[];
  /** Synthetic (canvas-only) nodes and where they persist. */
  syntheticNodes: SyntheticNodeMapping[];
  /** Projected runtime topology summary. */
  projectedTopology: {
    nodeCount: number;
    edgeCount: number;
    nodes: PreviewTopologyNode[];
    edges: PreviewTopologyEdge[];
    compressed: boolean;
  };

  /** Warnings about mismatches between the mode spec and driver capabilities. */
  warnings: string[];
}

// ── preview generator ─────────────────────────────────────────────────

/**
 * Produces a pure execution preview for a ModeSpec against its family's driver manifest.
 * Does NOT start any model/tool loop — it only projects what the runtime will do.
 */
export function generateModeExecutionPreview(mode: ModeSpec): ModeExecutionPreview {
  const manifest = getDriverManifest(mode.family);
  const ordered = orderedEnabledModeNodes(mode);
  const layers = orderedEnabledModeLayers(mode);

  let topology: ReturnType<typeof projectModeRuntimeTopology>;
  try {
    topology = projectModeRuntimeTopology(mode);
  } catch {
    topology = { nodes: [], edges: [] };
  }

  const activeAtoms = new Set(mode.runtimeAtoms);

  // ── ordered nodes ──────────────────────────────────────────────
  const nodeIdSet = new Set(ordered.map((n) => n.id));
  const depMap = new Map<string, string[]>();
  for (const edge of mode.edges.filter(
    (e) => e.enabled && nodeIdSet.has(e.source) && nodeIdSet.has(e.target),
  )) {
    const deps = depMap.get(edge.target) ?? [];
    deps.push(edge.source);
    depMap.set(edge.target, deps);
  }

  const orderedNodes: PreviewNode[] = ordered.map((n) => ({
    id: n.id,
    label: n.label,
    template: n.template,
    ownerAgentId: n.ownerAgentId,
    enabled: n.enabled,
    dependencies: depMap.get(n.id) ?? [],
  }));

  // ── layers ─────────────────────────────────────────────────────
  const consumedEdgeKindSet = new Set(manifest?.executedEdgeKinds ?? []);
  const previewLayers: PreviewLayer[] = layers.map((layer, index) => ({
    index,
    nodeIds: layer.map((n) => n.id),
    parallel: (manifest?.supportsParallelLayers ?? false) && layer.length > 1,
  }));

  // ── edges ──────────────────────────────────────────────────────
  const previewEdges: PreviewEdge[] = mode.edges
    .filter((e) => e.enabled)
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      kind: e.kind,
      label: e.label,
      consumed: consumedEdgeKindSet.has(e.kind),
    }));

  // ── conditional edges ──────────────────────────────────────────
  const previewConditionalEdges: PreviewConditionalEdge[] = mode.edges
    .filter((e) => e.enabled && typeof e.condition === "string" && e.condition.length > 0)
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      condition: e.condition!,
      consumed: manifest?.consumesConditions ?? false,
    }));

  // ── synthetic nodes ────────────────────────────────────────────
  const syntheticNodes: SyntheticNodeMapping[] = [];

  // Runtime anchor (only if mode-scoped atoms exist)
  const modeScopedAtoms = mode.runtimeAtoms
    .map((id) => getModeRuntimeAtom(id))
    .filter((a): a is NonNullable<typeof a> => a !== undefined && a.scope === "mode");
  if (modeScopedAtoms.length > 0) {
    syntheticNodes.push({
      canvasNodeId: "__runtime_anchor__",
      kind: "runtime_anchor",
      label: "Runtime Harness",
      persistedAs: "mode.runtimeAtoms",
      runtimeEffect: `Activates mode-scoped atoms: ${modeScopedAtoms.map((a) => a.id).join(", ")}`,
      topologyProjection:
        manifest?.singleOwnerTopology === "compressed"
          ? "Anchors capability nodes; topology may be compressed for single-owner modes."
          : "Anchors capability nodes to the run node in full family topology.",
    });
  }

  for (const atomId of mode.runtimeAtoms) {
    const atom = getModeRuntimeAtom(atomId);
    if (!atom || atom.scope !== "mode") continue;
    syntheticNodes.push({
      canvasNodeId: `__mode_atom__:${atom.id}`,
      kind: "mode_capability",
      label: atom.label,
      persistedAs: `mode.runtimeAtoms[${atom.id}]`,
      runtimeEffect: atom.description,
      topologyProjection:
        atom.topology.presentation === "family_capability"
          ? `Merged into existing topology node "${atom.topology.builtinNodeId ?? "?"}" metadata.`
          : `Added as capability node "capability:${atom.id}" connected to run anchor.`,
    });
  }

  for (const node of mode.nodes) {
    for (const atomId of nodeRuntimeAtomIds(node)) {
      const atom = getModeRuntimeAtom(atomId);
      if (!atom) continue;
      syntheticNodes.push({
        canvasNodeId: `__node_atom__:${node.id}:${atom.id}`,
        kind: "node_attachment",
        label: atom.label,
        persistedAs: `node[${node.id}].config.atoms[${atom.id}]`,
        runtimeEffect: atom.description,
        topologyProjection: `Added as capability node "capability:${node.id}:${atom.id}" connected to node "${node.id}" or its owner agent.`,
      });
    }
  }

  // ── projected topology ─────────────────────────────────────────
  // Compressed = single-owner projection: exactly one "agent" kind node
  // (full family topologies have multiple agent nodes, e.g. generator + verifier)
  const agentNodes = topology.nodes.filter((n) => n.kind === "agent");
  const compressed = agentNodes.length === 1 && topology.nodes.some((n) => n.kind === "run");

  const previewTopologyNodes: PreviewTopologyNode[] = topology.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label,
    agentId: n.agentId,
  }));

  const previewTopologyEdges: PreviewTopologyEdge[] = topology.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    kind: e.kind,
  }));

  // ── warnings ───────────────────────────────────────────────────
  const hasConditions = previewConditionalEdges.length > 0;
  const atomWarnings = manifest
    ? driverManifestWarnings(manifest, {
        hasConditions,
        nodeCount: ordered.length,
        activeAtomIds: mode.runtimeAtoms,
      })
    : [];
  const warnings = [...atomWarnings];

  if (!manifest) {
    warnings.push(
      `No driver capability manifest registered for family "${mode.family}". Execution semantics are unknown.`,
    );
  }

  if (mode.transcriptLayout && !(manifest?.supportsStaging ?? false)) {
    warnings.push(
      `Transcript layout is configured, but the "${manifest?.label ?? mode.family}" driver does not support staged transcripts. The layout will be ignored at runtime.`,
    );
  }

  return {
    family: mode.family,
    driverLabel: manifest?.label ?? mode.family,
    manifest,
    orderedNodes,
    layers: previewLayers,
    edges: previewEdges,
    conditionalEdges: previewConditionalEdges,
    syntheticNodes,
    projectedTopology: {
      nodeCount: previewTopologyNodes.length,
      edgeCount: previewTopologyEdges.length,
      nodes: previewTopologyNodes,
      edges: previewTopologyEdges,
      compressed,
    },
    warnings,
  };
}
