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
import type { OraModeSpec } from "./runtimeClient";

export interface ModeCanvasNodeData {
  label: string;
  template: OraModeSpec["nodes"][number]["template"];
  ownerAgentId?: string;
  enabled: boolean;
  required: boolean;
}

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
    systemPreset: false,
    createdAt: mode.createdAt ?? Date.now(),
    updatedAt: Date.now(),
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
    updatedAt: Date.now(),
  };
}

export function buildModeFlowNodes(mode: OraModeSpec): Node<ModeCanvasNodeData>[] {
  const requiredTemplates = new Set(mode.editorConstraints.requiredNodeTemplates);
  return mode.nodes.map((node) => ({
    id: node.id,
    type: "modeNode",
    position: node.position ?? { x: 0, y: 0 },
    draggable: !mode.editorConstraints.readOnly,
    selectable: true,
    data: {
      label: node.label,
      template: node.template,
      ownerAgentId: node.ownerAgentId,
      enabled: node.enabled,
      required: requiredTemplates.has(node.template),
    },
  }));
}

export function buildModeFlowEdges(mode: OraModeSpec): Edge[] {
  const visibleEdges = getVisibleModeEdges(mode);
  return visibleEdges.map((edge) => ({
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
