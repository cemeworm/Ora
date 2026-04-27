import type { OraGraphState } from "../graph/ora-state.js";
import { buildAgentPromptContext, userClarificationContextPrompt } from "../harness/prompt-context.js";
import { workspaceSystemPrompt } from "../harness/runtime-prompts.js";

export function withGraphPersona(state: OraGraphState, base: string, agentId?: string): string {
  const overlay = state.config.metadata?.customAgentOverlay;
  const skillOverlay = state.config.metadata?.skillPromptOverlay;
  const memoryOverlay = state.config.metadata?.memoryPromptOverlay;
  const effectiveAgentId = agentId ?? state.profiles[0]?.id ?? "agent";
  const profile = state.profiles.find((candidate) => candidate.id === effectiveAgentId);
  const systemAgentOverlays = recordOfStrings(state.config.metadata?.systemAgentOverlays);
  const customAgentContexts = recordOfCustomAgentContext(state.config.metadata?.customAgentContexts);
  const customAgentId = profile?.customAgentId;
  return buildAgentPromptContext({
    agentId: effectiveAgentId,
    profile,
    customAgentId,
    customPersona: customAgentId
      ? customAgentContexts[customAgentId]?.overlay ?? stringOrUndefined(overlay)
      : stringOrUndefined(overlay),
    systemAgentOverride: customAgentId ? undefined : systemAgentOverlays[effectiveAgentId],
    stageSystem: base,
    workspaceContext: workspaceSystemPrompt(state.input.context?.projectWorkspace),
    clarificationContext: userClarificationContextPrompt(state.input.context),
    memoryContext: stringOrUndefined(memoryOverlay),
    skillSnippets: stringOrUndefined(skillOverlay) ? [String(skillOverlay)] : [],
  }).system;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function recordOfStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0),
  );
}

function recordOfCustomAgentContext(value: unknown): Record<string, { overlay?: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const contexts: Record<string, { overlay?: string }> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const overlay = stringOrUndefined((entry as Record<string, unknown>).overlay);
      if (overlay) {
        contexts[key] = { overlay };
      }
    }
  }
  return contexts;
}
