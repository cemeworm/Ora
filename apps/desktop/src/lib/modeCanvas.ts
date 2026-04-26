import {
  autoLayoutModeSpec,
  createModeSpecFromPattern,
  ensureModeNodePositions,
  getModeFamilyRule,
  orderedEnabledModeNodes,
  type CoordinationPattern,
  type ModeEdgeSpec,
  type ModeNodeTemplate,
} from "@ora/shared";
import { MarkerType, type Connection, type Edge, type Node } from "reactflow";
import type { OraModeRuntimeAtomDefinition, OraModeSpec } from "./runtimeClient";

export interface ModeCanvasNodeData {
  kind: "runtime-anchor" | "stage" | "mode-capability" | "node-attachment";
  label: string;
  template?: OraModeSpec["nodes"][number]["template"];
  ownerAgentId?: string;
  riskLevel?: OraModeSpec["nodes"][number]["riskLevel"];
  enabled: boolean;
  required: boolean;
  atomId?: string;
  atomScope?: "mode" | "node";
  atomPresentation?: "mode_capability" | "stage_attachment" | "family_capability";
  active?: boolean;
  sourceNodeId?: string;
  capabilityCount?: number;
}

export const RUNTIME_ANCHOR_NODE_ID = "__runtime_anchor__";
export const MODE_CAPABILITY_NODE_PREFIX = "__mode_atom__:";
export const NODE_ATTACHMENT_NODE_PREFIX = "__node_atom__:";

const STAGE_NODE_WIDTH = 248;
const STAGE_NODE_HEIGHT = 152;
const RUNTIME_ANCHOR_NODE_WIDTH = 248;
const RUNTIME_ANCHOR_NODE_HEIGHT = 104;
const MODE_CAPABILITY_NODE_WIDTH = 204;
const MODE_CAPABILITY_NODE_HEIGHT = 96;
const NODE_ATTACHMENT_NODE_WIDTH = 184;
const NODE_ATTACHMENT_NODE_HEIGHT = 104;
const MODE_CAPABILITY_X_GAP = 20;
const MODE_CAPABILITY_Y_GAP = 16;
const MODE_CAPABILITY_ORIGIN_X = 32;
const MODE_CAPABILITY_ORIGIN_Y = 148;
const RUNTIME_ANCHOR_ORIGIN_X = 32;
const RUNTIME_ANCHOR_ORIGIN_Y = 24;
const STAGE_TOP_GAP = 76;
const ATTACHMENT_X_OFFSET = 12;
const ATTACHMENT_Y_GAP = 14;

export function hydrateModeDraft(mode: OraModeSpec): OraModeSpec {
  return ensureModeNodePositions({
    ...mode,
    nodes: mode.nodes.map((node) => ({ ...node })),
    edges: mode.edges.map((edge) => ({ ...edge })),
    stopPolicy: { ...mode.stopPolicy },
    capabilityFlags: { ...mode.capabilityFlags },
    editorConstraints: { ...mode.editorConstraints, readOnly: false },
    defaultBudget: { ...mode.defaultBudget },
    profiles: mode.profiles.map((profile) => ({ ...profile })),
    recoveryPolicy: {
      ...mode.recoveryPolicy,
      defaults: { ...mode.recoveryPolicy.defaults },
      rules: mode.recoveryPolicy.rules.map((rule) => ({
        ...rule,
        errorTypes: [...rule.errorTypes],
        nodeIds: [...rule.nodeIds],
        nodeTemplates: [...rule.nodeTemplates],
        toolIds: [...rule.toolIds],
        alternateToolIds: [...rule.alternateToolIds],
      })),
    },
    systemPreset: false,
    createdAt: mode.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    completionPolicy: { ...mode.completionPolicy },
  });
}

export function resetModeDraftFamily(mode: OraModeSpec, family: CoordinationPattern): OraModeSpec {
  const preset = createModeSpecFromPattern(family);
  return {
    ...mode,
    family,
    nodes: preset.nodes.map((node) => ({ ...node })),
    edges: preset.edges.map((edge) => ({ ...edge })),
    stopPolicy: { ...preset.stopPolicy },
    capabilityFlags: {
      ...preset.capabilityFlags,
      approvalMode: mode.capabilityFlags.approvalMode,
      skillIds: [...mode.capabilityFlags.skillIds],
      toolIds: [...mode.capabilityFlags.toolIds],
    },
    editorConstraints: {
      ...preset.editorConstraints,
      readOnly: false,
    },
    recommendedUse: preset.recommendedUse,
    failureMode: preset.failureMode,
    defaultBudget: { ...preset.defaultBudget },
    profiles: preset.profiles.map((profile) => ({ ...profile })),
    recoveryPolicy: {
      ...preset.recoveryPolicy,
      defaults: { ...preset.recoveryPolicy.defaults },
      rules: preset.recoveryPolicy.rules.map((rule) => ({
        ...rule,
        errorTypes: [...rule.errorTypes],
        nodeIds: [...rule.nodeIds],
        nodeTemplates: [...rule.nodeTemplates],
        toolIds: [...rule.toolIds],
        alternateToolIds: [...rule.alternateToolIds],
      })),
    },
    updatedAt: Date.now(),
    completionPolicy: { ...preset.completionPolicy },
  };
}

export function buildModeFlowNodes(
  mode: OraModeSpec,
  atoms: OraModeRuntimeAtomDefinition[],
): Node<ModeCanvasNodeData>[] {
  const compatibleModeAtoms = atoms.filter((atom) => atom.scope === "mode" && atom.compatibleFamilies.includes(mode.family));
  const activeModeAtoms = compatibleModeAtoms.filter((atom) => mode.runtimeAtoms.includes(atom.id));
  const stageTopPadding = modeTopPadding(activeModeAtoms.length, compatibleModeAtoms.length > 0);
  const requiredTemplates = new Set(mode.editorConstraints.requiredNodeTemplates);
  const runtimeAnchor = compatibleModeAtoms.length > 0
    ? {
      id: RUNTIME_ANCHOR_NODE_ID,
      type: "modeNode",
      position: {
        x: RUNTIME_ANCHOR_ORIGIN_X,
        y: RUNTIME_ANCHOR_ORIGIN_Y,
      },
      draggable: false,
      selectable: true,
      data: {
        kind: "runtime-anchor" as const,
        label: "Runtime Harness",
        enabled: true,
        required: false,
        active: true,
        capabilityCount: activeModeAtoms.length,
      },
    }
    : undefined;
  const stageNodes = mode.nodes.map((node) => ({
    id: node.id,
    type: "modeNode",
    position: offsetStagePosition(node.position ?? { x: 0, y: 0 }, stageTopPadding),
    draggable: !mode.editorConstraints.readOnly,
    selectable: true,
    data: {
      kind: "stage" as const,
      label: node.label,
      template: node.template,
      ownerAgentId: node.ownerAgentId,
      riskLevel: node.riskLevel,
      enabled: node.enabled,
      required: requiredTemplates.has(node.template),
    },
  }));

  const modeCapabilityNodes = activeModeAtoms.map((atom, index) => ({
    id: `${MODE_CAPABILITY_NODE_PREFIX}${atom.id}`,
    type: "modeNode",
    position: modeCapabilityPosition(index),
    draggable: false,
    selectable: true,
    data: {
      kind: "mode-capability" as const,
      label: atom.label,
      template: "decompose" as const,
      enabled: true,
      required: false,
      atomId: atom.id,
      atomScope: atom.scope,
      atomPresentation: atom.topology.presentation,
      active: true,
    },
  }));

  const compatibleNodeAtoms = atoms.filter((atom) => atom.scope === "node" && atom.compatibleFamilies.includes(mode.family));
  const attachmentCountBySource = new Map<string, number>();
  const attachmentNodes = mode.nodes.flatMap((node) => {
    const configured = new Set(
      Array.isArray(node.config?.atoms)
        ? node.config.atoms.filter((value): value is string => typeof value === "string")
        : [],
    );
    return compatibleNodeAtoms
      .filter((atom) => configured.has(atom.id))
      .map((atom) => {
        const count = attachmentCountBySource.get(node.id) ?? 0;
        attachmentCountBySource.set(node.id, count + 1);
        const position = offsetStagePosition(node.position ?? { x: 0, y: 0 }, stageTopPadding);
        return {
          id: `${NODE_ATTACHMENT_NODE_PREFIX}${node.id}:${atom.id}`,
          type: "modeNode",
          position: {
            x: position.x + ATTACHMENT_X_OFFSET,
            y: position.y + STAGE_NODE_HEIGHT + ATTACHMENT_Y_GAP + count * (NODE_ATTACHMENT_NODE_HEIGHT + ATTACHMENT_Y_GAP),
          },
          draggable: false,
          selectable: true,
          data: {
            kind: "node-attachment" as const,
            label: atom.label,
            template: node.template,
            ownerAgentId: node.ownerAgentId,
            enabled: node.enabled,
            required: false,
            atomId: atom.id,
            atomScope: atom.scope,
            atomPresentation: atom.topology.presentation,
            active: true,
            sourceNodeId: node.id,
          },
        };
      });
  });

  return [...(runtimeAnchor ? [runtimeAnchor] : []), ...modeCapabilityNodes, ...stageNodes, ...attachmentNodes];
}

function modeTopPadding(modeCapabilityCount: number, hasRuntimeAnchor: boolean) {
  if (!hasRuntimeAnchor) {
    return 0;
  }
  if (modeCapabilityCount === 0) {
    return RUNTIME_ANCHOR_ORIGIN_Y + RUNTIME_ANCHOR_NODE_HEIGHT + STAGE_TOP_GAP;
  }

  return MODE_CAPABILITY_ORIGIN_Y
    + modeCapabilityRows(modeCapabilityCount) * MODE_CAPABILITY_NODE_HEIGHT
    + Math.max(0, modeCapabilityRows(modeCapabilityCount) - 1) * MODE_CAPABILITY_Y_GAP
    + STAGE_TOP_GAP;
}

function modeCapabilityRows(count: number) {
  return Math.ceil(count / modeCapabilityColumns(count));
}

function modeCapabilityColumns(count: number) {
  return Math.min(5, Math.max(1, count));
}

function modeCapabilityPosition(index: number) {
  const columnCount = modeCapabilityColumns(index + 1);
  return {
    x: MODE_CAPABILITY_ORIGIN_X + (index % columnCount) * (MODE_CAPABILITY_NODE_WIDTH + MODE_CAPABILITY_X_GAP),
    y: MODE_CAPABILITY_ORIGIN_Y + Math.floor(index / columnCount) * (MODE_CAPABILITY_NODE_HEIGHT + MODE_CAPABILITY_Y_GAP),
  };
}

function offsetStagePosition(position: { x: number; y: number }, topPadding: number) {
  return {
    x: position.x,
    y: position.y + topPadding,
  };
}

export function buildModeFlowEdges(
  mode: OraModeSpec,
  atoms: OraModeRuntimeAtomDefinition[],
): Edge[] {
  const visibleEdges = getVisibleModeEdges(mode);
  const stageEdges = visibleEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: "smoothstep",
    animated: false,
    deletable: !mode.editorConstraints.readOnly,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 18,
      height: 18,
      color: "#51606f",
    },
    style: {
      stroke: "#51606f",
      strokeWidth: 1.6,
    },
    labelStyle: {
      fill: "#6b7280",
      fontSize: 11,
    },
  }));

  const activeModeAtoms = atoms.filter((atom) =>
    atom.scope === "mode"
    && atom.compatibleFamilies.includes(mode.family)
    && mode.runtimeAtoms.includes(atom.id),
  );
  const modeAtomEdges = activeModeAtoms.length > 0
    ? atoms
      .filter((atom) =>
        atom.scope === "mode"
        && atom.compatibleFamilies.includes(mode.family)
        && mode.runtimeAtoms.includes(atom.id),
      )
      .map((atom) => ({
        id: `synthetic:${RUNTIME_ANCHOR_NODE_ID}:${atom.id}`,
        source: RUNTIME_ANCHOR_NODE_ID,
        target: `${MODE_CAPABILITY_NODE_PREFIX}${atom.id}`,
        label: atom.topology.edgeLabel,
        type: "smoothstep",
        animated: false,
        selectable: false,
        deletable: false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: "#94a3b8",
        },
        style: {
          stroke: "#94a3b8",
          strokeWidth: 1.2,
          strokeDasharray: "6 4",
        },
        labelStyle: {
          fill: "#64748b",
          fontSize: 10,
        },
      }))
    : [];

  const compatibleNodeAtoms = atoms.filter((atom) => atom.scope === "node" && atom.compatibleFamilies.includes(mode.family));
  const attachmentEdges = mode.nodes.flatMap((node) => {
    const configured = new Set(
      Array.isArray(node.config?.atoms)
        ? node.config.atoms.filter((value): value is string => typeof value === "string")
        : [],
    );
    return compatibleNodeAtoms
      .filter((atom) => configured.has(atom.id))
      .map((atom) => ({
        id: `synthetic:${node.id}:${atom.id}`,
        source: node.id,
        target: `${NODE_ATTACHMENT_NODE_PREFIX}${node.id}:${atom.id}`,
        label: atom.topology.edgeLabel,
        type: "smoothstep",
        animated: false,
        selectable: false,
        deletable: false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: "#94a3b8",
        },
        style: {
          stroke: "#94a3b8",
          strokeWidth: 1.1,
          strokeDasharray: "4 4",
        },
        labelStyle: {
          fill: "#64748b",
          fontSize: 10,
        },
      }));
  });

  return [...modeAtomEdges, ...stageEdges, ...attachmentEdges];
}

export function getVisibleModeEdges(mode: OraModeSpec): OraModeSpec["edges"] {
  const enabledNodeIds = new Set(mode.nodes.filter((node) => node.enabled).map((node) => node.id));
  return mode.edges.filter((edge) => edge.enabled && enabledNodeIds.has(edge.source) && enabledNodeIds.has(edge.target));
}

export function getExecutionPreview(mode: OraModeSpec) {
  return {
    nodes: orderedEnabledModeNodes(mode),
    edges: getVisibleModeEdges(mode),
    disabledNodes: mode.nodes.filter((node) => !node.enabled),
  };
}

export function autoLayoutDraft(mode: OraModeSpec): OraModeSpec {
  return {
    ...autoLayoutModeSpec(mode),
    updatedAt: Date.now(),
  };
}

export function patchModeNodePosition(
  mode: OraModeSpec,
  nodeId: string,
  position: { x: number; y: number },
): OraModeSpec {
  return {
    ...mode,
    nodes: mode.nodes.map((node) => node.id === nodeId ? { ...node, position } : node),
    updatedAt: Date.now(),
  };
}

export function modeCanvasStagePositionToStoredPosition(
  mode: OraModeSpec,
  atoms: OraModeRuntimeAtomDefinition[],
  position: { x: number; y: number },
): { x: number; y: number } {
  const activeModeAtomCount = atoms.filter((atom) =>
    atom.scope === "mode"
    && atom.compatibleFamilies.includes(mode.family)
    && mode.runtimeAtoms.includes(atom.id),
  ).length;
  const hasRuntimeAnchor = atoms.some((atom) => atom.scope === "mode" && atom.compatibleFamilies.includes(mode.family));
  return {
    x: position.x,
    y: position.y - modeTopPadding(activeModeAtomCount, hasRuntimeAnchor),
  };
}

export function removeModeEdges(mode: OraModeSpec, edgeIds: string[]): OraModeSpec {
  const removeSet = new Set(edgeIds);
  return {
    ...mode,
    edges: mode.edges.filter((edge) => !removeSet.has(edge.id)),
    updatedAt: Date.now(),
  };
}

export function addModeNode(mode: OraModeSpec, template?: ModeNodeTemplate): OraModeSpec {
  const nextTemplate = template ?? pickDefaultTemplate(mode);
  if (!nextTemplate) {
    return mode;
  }

  const nextNode = {
    id: nextModeNodeId(mode, nextTemplate),
    template: nextTemplate,
    label: nextTemplate.replace(/_/g, " "),
    title: nextTemplate.replace(/_/g, " "),
    ownerAgentId: mode.nodes.find((node) => node.template === nextTemplate)?.ownerAgentId,
    enabled: true,
    config: {},
  } satisfies OraModeSpec["nodes"][number];

  const draft = {
    ...mode,
    nodes: [...mode.nodes, nextNode],
    updatedAt: Date.now(),
  };
  const laidOut = autoLayoutModeSpec(draft);
  const positionedNode = laidOut.nodes.find((node) => node.id === nextNode.id)?.position;
  return {
    ...draft,
    nodes: draft.nodes.map((node) => node.id === nextNode.id ? { ...node, position: positionedNode } : node),
  };
}

export function validateCanvasConnection(mode: OraModeSpec, connection: Connection): string | null {
  const sourceId = connection.source ?? "";
  const targetId = connection.target ?? "";
  if (!sourceId || !targetId) {
    return "Choose both a source and target node.";
  }
  if (sourceId === targetId) {
    return "Mode nodes cannot connect to themselves.";
  }

  const sourceNode = mode.nodes.find((node) => node.id === sourceId);
  const targetNode = mode.nodes.find((node) => node.id === targetId);
  if (!sourceNode || !targetNode) {
    return "Connections must target existing mode nodes.";
  }
  if (!sourceNode.enabled || !targetNode.enabled) {
    return "Only enabled nodes can participate in active connections.";
  }
  if (mode.edges.some((edge) => edge.enabled && edge.source === sourceId && edge.target === targetId)) {
    return "That connection already exists.";
  }
  if (wouldCreateCycle(mode, sourceId, targetId)) {
    return "That connection would create a cycle.";
  }
  return null;
}

export function addModeEdge(mode: OraModeSpec, connection: Connection): OraModeSpec {
  const sourceId = connection.source ?? "";
  const targetId = connection.target ?? "";
  const nextEdge: ModeEdgeSpec = {
    id: `${sourceId}-${targetId}`,
    source: sourceId,
    target: targetId,
    kind: "control",
    enabled: true,
  };

  return {
    ...mode,
    edges: [...mode.edges, nextEdge],
    updatedAt: Date.now(),
  };
}

function wouldCreateCycle(mode: OraModeSpec, sourceId: string, targetId: string): boolean {
  const enabledNodeIds = new Set(mode.nodes.filter((node) => node.enabled).map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  for (const nodeId of enabledNodeIds) {
    adjacency.set(nodeId, []);
  }
  for (const edge of getVisibleModeEdges(mode)) {
    adjacency.get(edge.source)?.push(edge.target);
  }
  adjacency.get(sourceId)?.push(targetId);

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }
    visiting.add(nodeId);
    for (const nextId of adjacency.get(nodeId) ?? []) {
      if (visit(nextId)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  for (const nodeId of enabledNodeIds) {
    if (visit(nodeId)) {
      return true;
    }
  }
  return false;
}

function pickDefaultTemplate(mode: OraModeSpec): ModeNodeTemplate | undefined {
  const allowedTemplates = mode.editorConstraints.allowedNodeTemplates;
  return allowedTemplates.find((template) => !mode.nodes.some((node) => node.template === template && !isRequiredTemplate(mode, template)))
    ?? allowedTemplates[0];
}

function isRequiredTemplate(mode: OraModeSpec, template: ModeNodeTemplate): boolean {
  return mode.editorConstraints.requiredNodeTemplates.includes(template);
}

function nextModeNodeId(mode: OraModeSpec, template: ModeNodeTemplate): string {
  const existingIds = new Set(mode.nodes.map((node) => node.id));
  const prefixMatches = mode.nodes.filter((node) => node.id === template || node.id.startsWith(`${template}-`)).length;
  let index = Math.max(2, prefixMatches + 1);
  let candidate = `${template}-${index}`;
  while (existingIds.has(candidate)) {
    index += 1;
    candidate = `${template}-${index}`;
  }
  return candidate;
}

export function canDeleteModeNode(mode: OraModeSpec, nodeId: string): boolean {
  const node = mode.nodes.find((item) => item.id === nodeId);
  return Boolean(node && !getModeFamilyRule(mode.family).requiredTemplates.includes(node.template));
}

export function canDisableModeNode(mode: OraModeSpec, nodeId: string): boolean {
  const node = mode.nodes.find((item) => item.id === nodeId);
  return Boolean(node && !getModeFamilyRule(mode.family).requiredTemplates.includes(node.template));
}
