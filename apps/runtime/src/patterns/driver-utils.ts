import {
  getModeNodeRuntimeTemplateDefinition,
  orderedEnabledModeLayers,
  type BuiltInCoordinationPattern,
  type CoordinationPattern,
  type ModeNodeSpec,
  type ModeSpec,
  type QueueSummary,
} from "@cemeworm/shared";
import type { PatternExecutionContext } from "./execution-context.js";

export function correlationId(base: string): string {
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Evaluates a simple condition expression against a bag (previous node output).
 * Supports operators: ==, !=, &&, ||, and dot-notation field access.
 * Example: `"status == 'pass'"` or `"status == 'pass' && confidence > 0.8"`.
 */
export function evaluateEdgeCondition(condition: string, bag: Record<string, unknown>): boolean {
  try {
    const parts = condition.split(/\s+(&&|\|\|)\s+/);
    if (parts.length > 1) {
      const [left, op, right] = parts;
      const leftResult = evaluateSimpleCondition(left!, bag);
      const rightResult = evaluateSimpleCondition(right!, bag);
      return op === "&&" ? leftResult && rightResult : leftResult || rightResult;
    }
    return evaluateSimpleCondition(condition, bag);
  } catch {
    return false;
  }
}

function evaluateSimpleCondition(expr: string, bag: Record<string, unknown>): boolean {
  const match = expr.match(/^(.+?)\s*(==|!=)\s*(.+)$/);
  if (!match) return false;
  const [, fieldPath, operator, rawExpected] = match;
  const value = getFieldValue(fieldPath!.trim(), bag);
  const expected = rawExpected!.trim().replace(/^['"]|['"]$/g, "");
  if (operator === "==") return String(value) === expected;
  if (operator === "!=") return String(value) !== expected;
  return false;
}

function getFieldValue(path: string, bag: Record<string, unknown>): unknown {
  return path.split(".").reduce((current: unknown, key: string) => {
    if (current && typeof current === "object") {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, bag);
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
  const template = node.prompt ?? fallback;
  const unresolved = new Set<string>();
  const resolved = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = values[key as string];
    if (value === undefined) unresolved.add(key as string);
    return asText(value);
  });
  if (unresolved.size > 0) {
    console.warn(
      `[driver-utils] Unresolved mustache placeholder(s) in prompt for node "${node.id}" (template: ${node.template}): ` +
      `${[...unresolved].join(", ")}. The generated prompt will contain literal "{{key}}" strings.`,
    );
  }
  return resolved;
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

/**
 * Default dispatch for a node template: resolve agent → callAgent → write bag → emit message.
 * Drivers with custom logic (e.g. shared-state write, message-bus publish) can wrap this
 * or provide their own handler for specific templates.
 */
export async function dispatchNodeTemplate(
  context: PatternExecutionContext,
  modeSpec: ModeSpec,
  node: ModeNodeSpec,
  bag: Record<string, unknown>,
  params: {
    bagKey: string;
    agentId: string;
    title: string;
    fallbackPrompt: string;
    toAgentIds?: string[];
    messageKind?: "reply" | "handoff" | "publish" | "mention";
  },
): Promise<unknown> {
  const result = await context.callAgent({
    agentId: params.agentId,
    planItemId: node.id,
    title: params.title,
    prompt: promptTemplate(node, params.fallbackPrompt, bag),
    system: nodeSystemPrompt(context, modeSpec, node, bag),
    customAgentId: nodeCustomAgentId(node),
    riskLevel: node.riskLevel,
  });
  bag[params.bagKey] = result;
  context.emitAgentMessage({
    fromAgentId: params.agentId,
    toAgentIds: params.toAgentIds ?? modeSpec.profiles.map((p) => p.id).filter((id) => id !== params.agentId),
    threadId: `${modeSpec.id}:${context.projectId}`,
    nodeId: node.id,
    planItemId: node.id,
    kind: params.messageKind ?? "reply",
    status: "done",
    content: asText(result),
  });
  return result;
}

/**
 * Filters target nodes whose incoming edges with conditions are not satisfied.
 * Returns the set of node IDs that should be skipped based on condition evaluation.
 */
export function resolveConditionalSkips(
  modeSpec: ModeSpec,
  bag: Record<string, unknown>,
  nextLayerNodeIds: Set<string>,
): Set<string> {
  const skipIds = new Set<string>();
  for (const edge of modeSpec.edges) {
    if (!edge.enabled || !edge.condition) continue;
    if (!nextLayerNodeIds.has(edge.target)) continue;
    if (!evaluateEdgeCondition(edge.condition, bag)) {
      skipIds.add(edge.target);
    }
  }
  return skipIds;
}

export function mention(agentId: string): string {
  return `@${agentId}`;
}

export function agentMessageContent(prefix: string, value: unknown): string {
  const text = asText(value).trim();
  return text ? `${prefix}${text}` : prefix.trimEnd();
}

export function isInternalAgentMessageText(value: unknown): boolean {
  const trimmed = asText(value).trim();
  if (!trimmed) {
    return false;
  }
  if (/I need to stop using tools here\. Based on the available context/i.test(trimmed)) {
    return true;
  }
  if (/<[^>]*DSML[^>]*tool_calls|<tool_call\b|<\/?previous_tool_call\b|<\/?result\b/i.test(trimmed)) {
    return true;
  }
  if (/<file\.(?:read|list|grep|glob)\b[^>]*\/?>/i.test(trimmed)) {
    return true;
  }
  return /(?:^|\n)\s*\{"tool"\s*:\s*"[a-z0-9_.-]+"\s*,\s*"args"\s*:/i.test(trimmed);
}

export function publicAgentMessageContent(
  prefix: string,
  value: unknown,
  fallback: string,
): string {
  const text = asText(value).trim();
  if (!text || isInternalAgentMessageText(text)) {
    return `${prefix}${fallback}`.trimEnd();
  }
  return `${prefix}${text}`;
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
  const builtInFamily = family as BuiltInCoordinationPattern;
  switch (builtInFamily) {
    case "agent_teams":
      return "backlog";
    case "message_bus":
      return "event_bus";
    case "shared_state":
      return "shared_state";
    case "generator_verifier":
    case "orchestrator_subagent":
      return "dag";
    default:
      builtInFamily satisfies never;
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
