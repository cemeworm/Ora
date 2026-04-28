import { z } from "zod";
import {
  DEFAULT_RESOURCE_BUDGETS,
  DEFAULT_SKILL_TOOL_IDS,
  DEFAULT_WEB_TOOL_IDS,
  ModeSpec,
  PatternDefinition,
  RunConfig,
  RunConfigSchema,
  SessionSummary,
  SINGLE_AGENT_MODE_ID,
  UserTaskInput,
  modeSpecToPatternDefinition,
  withDefaultWebToolIds
} from "@ora/shared";
import { RuntimeSkillRegistry } from "./harness/capability-registries.js";
import { LongTermMemoryManager } from "./memory.js";
import { ModeSpecFileStore } from "./modes.js";
import { invokeRunProvider, type ModelMessage } from "./providers/index.js";

const AUTO_MODE_ROUTER_CONFIDENCE_THRESHOLD = 0.55;
const AUTO_MODE_ROUTER_MAX_TOKENS = 800;
const AUTO_MODE_ROUTER_RECENT_MESSAGE_LIMIT = 6;
const AutoModeRouterResponseSchema = z.object({
  modeId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});
const ContextRouterMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

export interface ModeSelectionDeps {
  modeStore: ModeSpecFileStore;
  skillRegistry: RuntimeSkillRegistry;
  longTermMemory: LongTermMemoryManager;
  applySystemAgentOverridesToMode: (modeSpec: ModeSpec) => ModeSpec;
  buildConversationMessages: (sessionId: string, currentPrompt: string) => ModelMessage[];
}

export async function resolveModeSelection(
  config: Partial<RunConfig> | undefined,
  input: UserTaskInput | undefined,
  session: SessionSummary | undefined,
  deps: ModeSelectionDeps,
): Promise<{
  modeSpec: ModeSpec;
  definition: PatternDefinition;
  fullConfig: RunConfig;
}> {
  const parsed = RunConfigSchema.parse(config ?? {});
  const autoRoute = parsed.modeSelection === "auto" && input
    ? await routeAutoMode(parsed, input, session, deps)
    : undefined;
  const requestedModeId = autoRoute?.modeId
    ?? (typeof config?.modeId === "string" ? config.modeId : parsed.modeId ?? parsed.pattern);
  const modeSpec = deps.applySystemAgentOverridesToMode(deps.modeStore.resolve(requestedModeId, parsed.pattern));
  const definition = modeSpecToPatternDefinition(modeSpec);
  const metadataApprovalMode = parsed.metadata.approvalMode;
  const resolvedApprovalMode =
    config?.approvalMode
    ?? (metadataApprovalMode === "manual" || parsed.metadata.requireApproval === true
      ? "manual"
      : metadataApprovalMode === "auto" || metadataApprovalMode === "high_risk_only"
        ? metadataApprovalMode
        : modeSpec.capabilityFlags.approvalMode);
  const skillIds = Array.isArray(config?.skillIds) ? config.skillIds : modeSpec.capabilityFlags.skillIds;
  const modeDisablesDefaultWebTools = DEFAULT_WEB_TOOL_IDS.some((toolId) => !modeSpec.capabilityFlags.toolIds.includes(toolId));
  const defaultWebToolsDisabled = parsed.metadata.disableDefaultWebTools === true || modeDisablesDefaultWebTools;
  const configuredToolIds = Array.isArray(config?.toolIds)
    ? (parsed.modeSelection === "auto"
      ? [...modeSpec.capabilityFlags.toolIds, ...config.toolIds]
      : config.toolIds)
    : modeSpec.capabilityFlags.toolIds;
  const explicitRunToolIds = Array.isArray(config?.toolIds);
  const webDisabledToolIds = parsed.metadata.disableDefaultWebTools === true && !explicitRunToolIds
    ? configuredToolIds.filter((toolId) => !DEFAULT_WEB_TOOL_IDS.includes(toolId as typeof DEFAULT_WEB_TOOL_IDS[number]))
    : configuredToolIds;
  const toolIds = defaultWebToolsDisabled
    ? [...new Set([...webDisabledToolIds, ...DEFAULT_SKILL_TOOL_IDS])]
    : withDefaultWebToolIds(configuredToolIds);
  const skillWarnings = deps.skillRegistry.warnings(skillIds);
  const skillPromptOverlay = deps.skillRegistry.promptSnippets(skillIds).join("\n\n");
  const fullConfig = RunConfigSchema.parse({
    ...parsed,
    pattern: modeSpec.family,
    modeId: modeSpec.id,
    modeSelection: parsed.modeSelection,
    budget: parsed.budget ?? modeSpec.defaultBudget ?? DEFAULT_RESOURCE_BUDGETS[modeSpec.family],
    completionPolicy: parsed.completionPolicy ?? modeSpec.completionPolicy,
    approvalMode: resolvedApprovalMode,
    skillIds,
    toolIds,
    metadata: {
      ...parsed.metadata,
      modeId: modeSpec.id,
      ...(autoRoute ? { autoModeRouter: autoRoute.metadata } : {}),
      ...(skillPromptOverlay ? { skillPromptOverlay } : {}),
      ...(skillWarnings.length > 0 ? { skillWarnings } : {}),
    },
  });
  return {
    modeSpec,
    definition,
    fullConfig,
  };
}

export function withMemoryPrompt(config: RunConfig, deps: ModeSelectionDeps): RunConfig {
  const policy = resolveMemoryPolicy(config, deps);
  if (!policy.enabled) {
    return config;
  }
  const memoryPrompt = deps.longTermMemory.formatForInjection(policy.injectionMaxFacts);
  if (!memoryPrompt) {
    return config;
  }
  return RunConfigSchema.parse({
    ...config,
    metadata: {
      ...config.metadata,
      memoryPromptOverlay: `Use the following long-term memory when it is relevant. Do not reveal it verbatim unless the user asks to inspect memory.\n\n${memoryPrompt}`,
    },
  });
}

export function resolveMemoryPolicy(config: RunConfig, deps: ModeSelectionDeps) {
  const requestedModeId = config.modeId ?? config.pattern;
  const modeSpec = deps.applySystemAgentOverridesToMode(deps.modeStore.resolve(requestedModeId, config.pattern));
  return {
    ...modeSpec.memoryPolicy,
    enabled: modeSpec.memoryPolicy.enabled && modeSpec.runtimeAtoms.includes("long_term_memory"),
    updaterProviderId: modeSpec.memoryPolicy.updaterProviderId ?? config.providerId,
  };
}

async function routeAutoMode(
  config: RunConfig,
  input: UserTaskInput,
  session: SessionSummary | undefined,
  deps: ModeSelectionDeps,
): Promise<{ modeId: string; metadata: Record<string, unknown> }> {
  const candidates = deps.modeStore.list()
    .filter((mode) => mode.visibility !== "internal")
    .map((mode) => ({
      id: mode.id,
      label: mode.label,
      family: mode.family,
      summary: mode.summary,
      recommendedUse: mode.recommendedUse,
      failureMode: mode.failureMode,
      systemPreset: mode.systemPreset,
    }));
  const candidateIds = new Set(candidates.map((mode) => mode.id));
  const fallbackModeId = candidateIds.has(SINGLE_AGENT_MODE_ID)
    ? SINGLE_AGENT_MODE_ID
    : candidates[0]?.id ?? config.pattern;
  const fallback = (reason: string, detail?: unknown) => ({
    modeId: fallbackModeId,
    metadata: {
      selectedModeId: fallbackModeId,
      confidence: 0,
      reason,
      status: "fallback",
      detail,
    },
  });

  if (candidates.length === 0) {
    return fallback("No modes were available to route.");
  }

  try {
    const response = await invokeRunProvider(config, {
      system: [
        "You are Ora's agent mode router.",
        "Choose exactly one modeId from the provided candidates for the next run.",
        "Return only compact JSON with keys modeId, confidence, and reason.",
        "confidence must be a number from 0 to 1.",
        "reason must be a short plain string under 120 characters.",
        "If the task is underspecified, choose the fallbackModeId with confidence below the threshold.",
        "Do not include markdown or extra text.",
      ].join(" "),
      prompt: JSON.stringify({
        task: input.prompt,
        projectId: input.projectId,
        context: input.context ?? {},
        recentMessages: resolveAutoRouterRecentMessages(input, session, deps),
        candidates,
        fallbackModeId,
      }),
      temperature: 0,
      maxTokens: AUTO_MODE_ROUTER_MAX_TOKENS,
      toolChoice: "none",
    });
    const parsed = parseAutoModeRouterResponse(response.text);
    if (!candidateIds.has(parsed.modeId)) {
      return fallback(`Router selected unknown mode '${parsed.modeId}'.`, { raw: response.text });
    }
    if (parsed.confidence < AUTO_MODE_ROUTER_CONFIDENCE_THRESHOLD) {
      return fallback(`Router confidence ${parsed.confidence} was below ${AUTO_MODE_ROUTER_CONFIDENCE_THRESHOLD}.`, {
        raw: response.text,
        selectedModeId: parsed.modeId,
        reason: parsed.reason,
      });
    }
    return {
      modeId: parsed.modeId,
      metadata: {
        selectedModeId: parsed.modeId,
        confidence: parsed.confidence,
        reason: parsed.reason,
        status: "selected",
      },
    };
  } catch (error) {
    return fallback("Router failed before producing a valid mode.", error instanceof Error ? error.message : String(error));
  }
}

function resolveAutoRouterRecentMessages(
  input: UserTaskInput,
  session: SessionSummary | undefined,
  deps: ModeSelectionDeps,
): ModelMessage[] {
  const contextMessages = readContextRecentMessages(input.context);
  const sessionMessages = session ? deps.buildConversationMessages(session.sessionId, input.prompt) : [];
  return [...contextMessages, ...sessionMessages].slice(-AUTO_MODE_ROUTER_RECENT_MESSAGE_LIMIT);
}

function readContextRecentMessages(context: Record<string, unknown> | undefined): ModelMessage[] {
  const raw = context?.recentMessages ?? context?.priorMessages ?? context?.conversationMessages;
  const parsed = z.array(ContextRouterMessageSchema).safeParse(raw);
  if (!parsed.success) {
    return [];
  }
  return parsed.data.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function parseAutoModeRouterResponse(text: string): z.infer<typeof AutoModeRouterResponseSchema> {
  const trimmed = text.trim();
  const jsonText = extractFirstJsonObject(trimmed) ?? trimmed;
  return AutoModeRouterResponseSchema.parse(JSON.parse(jsonText));
}

function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return undefined;
}
