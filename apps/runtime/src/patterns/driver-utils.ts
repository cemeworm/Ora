import {
  getModeNodeRuntimeTemplateDefinition,
  type CoordinationPattern,
  type ModeNodeSpec,
  type ModeSpec,
  type QueueSummary,
} from "@cemeworm/shared";
import type { PatternExecutionContext } from "./execution-context.js";

export function correlationId(base: string): string {
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export function asText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return JSON.stringify(value);
}

export function interpolate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => asText(values[key]));
}

export function promptTemplate(
  node: ModeNodeSpec,
  fallback: string,
  values: Record<string, unknown>,
): string {
  return interpolate(node.prompt ?? fallback, values);
}

export function nodeInstructions(
  modeSpec: ModeSpec,
  node: ModeNodeSpec,
  values: Record<string, unknown>,
  fallback?: string,
): string {
  const template = node.instructions
    ?? getModeNodeRuntimeTemplateDefinition(modeSpec.family, node.template).fallbackInstructions
    ?? fallback
    ?? "";
  return interpolate(template, values);
}

export function nodeSystemPrompt(
  context: PatternExecutionContext,
  modeSpec: ModeSpec,
  node: ModeNodeSpec,
  values: Record<string, unknown>,
  fallback?: string,
): string {
  return context.systemPrompt(nodeInstructions(modeSpec, node, values, fallback));
}

export function titleForNode(node: ModeNodeSpec, fallback: string): string {
  return node.title ?? node.label ?? fallback;
}

export function nodeCustomAgentId(node: ModeNodeSpec): string | undefined {
  return typeof node.config?.customAgentId === "string" && node.config.customAgentId.trim()
    ? node.config.customAgentId.trim()
    : undefined;
}

export function mention(agentId: string): string {
  return `@${agentId}`;
}

export function agentMessageContent(prefix: string, value: unknown): string {
  const text = asText(value).trim();
  return text ? `${prefix}${text}` : prefix.trimEnd();
}

export function ownerForTemplate(
  nodes: ModeNodeSpec[],
  template: ModeNodeSpec["template"],
  fallback: string,
): string {
  return nodes.find((node) => node.template === template)?.ownerAgentId ?? fallback;
}

export function runtimeFallbackPrompt(family: CoordinationPattern, template: ModeNodeSpec["template"]): string {
  return getModeNodeRuntimeTemplateDefinition(family, template).fallbackPrompt ?? "";
}

function queueModeForFamily(family: CoordinationPattern): QueueSummary["mode"] {
  switch (family) {
    case "agent_teams":
      return "backlog";
    case "message_bus":
      return "event_bus";
    case "shared_state":
      return "shared_state";
    default:
      return "dag";
  }
}

export function nodeAtomIds(node: ModeNodeSpec): Set<string> {
  return new Set(
    Array.isArray(node.config?.atoms)
      ? node.config.atoms.filter((value): value is string => typeof value === "string")
      : [],
  );
}

export function modeUsesSingleOwner(modeSpec: ModeSpec, nodes: ModeNodeSpec[]): boolean {
  const fallbackAgentId = modeSpec.profiles[0]?.id;
  const ownerIds = new Set(
    nodes.map((node) => node.ownerAgentId ?? fallbackAgentId).filter((id): id is string => typeof id === "string"),
  );
  return ownerIds.size <= 1 && !nodes.some((node) => nodeAtomIds(node).has("subagent_delegate"));
}

export function primaryOwnerAgentId(modeSpec: ModeSpec, nodes: ModeNodeSpec[]): string {
  return nodes.find((node) => node.ownerAgentId)?.ownerAgentId ?? modeSpec.profiles[0]?.id ?? "agent";
}

export function initializeQueueSummary(
  context: PatternExecutionContext,
  family: CoordinationPattern,
  totalActiveNodes: number,
): void {
  context.setQueueSummary({
    mode: queueModeForFamily(family),
    pending: totalActiveNodes,
    inProgress: 0,
    completed: 0,
    topics: family === "message_bus" ? ["task.input", "task.findings", "task.response"] : [],
  });
}
