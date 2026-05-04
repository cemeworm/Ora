import { z } from "zod";
import {
  DEFAULT_RESOURCE_BUDGETS,
  DEFAULT_SKILL_TOOL_IDS,
  DEFAULT_WEB_TOOL_IDS,
  DEFAULT_PROVIDERS,
  EffectiveRunStrategySchema,
  ModeSpec,
  PatternDefinition,
  ProviderConfig,
  ORA_ROOT_AGENT_ID,
  RunConfig,
  RunConfigSchema,
  SessionSummary,
  SINGLE_AGENT_MODE_ID,
  UserTaskInput,
  modeSpecToPatternDefinition,
  withDefaultWebToolIds
} from "@cemeworm/shared";
import { buildActiveMemoryContext } from "./active-memory.js";
import { RuntimeSkillRegistry } from "./harness/capability-registries.js";
import { LongTermMemoryManager } from "./memory.js";
import { ModeSpecFileStore } from "./modes.js";
import { invokeRunProvider, type ModelMessage } from "./providers/index.js";
import {
  resolveAgenticRuntimeScheduling,
  routerCostHintForMode,
  taskIntentFromMetadata,
} from "./runtime-scheduling.js";

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
  const baseBudget = parsed.budget ?? modeSpec.defaultBudget ?? DEFAULT_RESOURCE_BUDGETS[modeSpec.family];
  const scheduling = resolveAgenticRuntimeScheduling({
    budget: baseBudget,
    explicitBudget: config?.budget !== undefined,
    metadata: parsed.metadata,
  });
  const budget = scheduling.budget;
  const effectiveStrategy = resolveEffectiveRunStrategy(modeSpec, {
    ...parsed,
    modeSelection: parsed.modeSelection,
    budget,
    toolIds,
  });
  const fullConfig = RunConfigSchema.parse({
    ...parsed,
    pattern: modeSpec.family,
    modeId: modeSpec.id,
    modeSelection: parsed.modeSelection,
    budget,
    completionPolicy: parsed.completionPolicy ?? modeSpec.completionPolicy,
    effectiveStrategy,
    approvalMode: resolvedApprovalMode,
    skillIds,
    toolIds,
      metadata: {
        ...parsed.metadata,
        modeId: modeSpec.id,
        oraEntry: {
          agentId: ORA_ROOT_AGENT_ID,
          decision: parsed.modeSelection === "auto" ? "route" : "proceed",
          status: autoRoute?.metadata.status ?? "proceed",
          selectedModeId: modeSpec.id,
          reason: autoRoute?.metadata.reason ?? "Manual mode selection proceeds with the requested mode.",
          ...(autoRoute?.metadata.handoffSummary ? { handoffSummary: autoRoute.metadata.handoffSummary } : {}),
        },
        effectiveStrategy,
        ...(scheduling.metadata ? { agenticScheduling: scheduling.metadata } : {}),
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

export function resolveEffectiveRunStrategy(
  modeSpec: ModeSpec,
  config: Pick<RunConfig, "modeSelection" | "budget" | "providerConfig" | "providerId" | "modelRef" | "toolIds">,
) {
  const policy = modeSpec.runtimePolicy;
  const budget = config.budget ?? modeSpec.defaultBudget ?? DEFAULT_RESOURCE_BUDGETS[modeSpec.family];
  const notes: string[] = [];
  const providerConfig = resolveProviderConfig(config);
  const providerSupportsReasoning = providerConfig?.capabilities.includes("reasoning") ?? false;
  const providerThinkingDesired = policy.thinking !== "off" && policy.providerThinking !== "disabled";
  const providerThinkingEnabled = providerThinkingDesired && providerSupportsReasoning;
  const providerPolicyStatus = !providerThinkingDesired
    ? "applied"
    : providerSupportsReasoning
      ? "applied"
      : policy.providerThinking === "required"
        ? "degraded"
        : "unsupported";

  if (providerThinkingDesired && !providerSupportsReasoning) {
    notes.push(providerConfig
      ? `Provider '${providerConfig.id}' does not advertise reasoning support.`
      : "No provider capability record was available for reasoning support.");
  }

  const modeToolIds = new Set(config.toolIds ?? modeSpec.capabilityFlags.toolIds);
  const delegationSupported =
    modeSpec.capabilityFlags.supportsPersistentWorkers
    || modeSpec.runtimeAtoms.includes("subagent_delegate")
    || modeToolIds.has("model.handoff")
    || modeSpec.nodes.some((node) => Array.isArray(node.config.atoms) && node.config.atoms.includes("subagent_delegate"));
  const delegationEnabled = policy.delegation !== "none" && delegationSupported;

  if (policy.delegation !== "none" && !delegationSupported) {
    notes.push("Mode policy allows delegation, but this mode has no delegation runtime capability enabled.");
  }

  return EffectiveRunStrategySchema.parse({
    sourceModeId: modeSpec.id,
    sourceModeSelection: config.modeSelection,
    thinking: policy.thinking,
    reasoningEffort: policy.thinking === "off" ? "none" : policy.reasoningEffort,
    budgetProfile: policy.budgetProfile,
    budget,
    planning: policy.planning,
    planningEnabled: policy.planning !== "none",
    delegation: policy.delegation,
    delegationEnabled,
    providerThinkingEnabled,
    providerPolicyStatus,
    notes,
  });
}

function resolveProviderConfig(
  config: Pick<RunConfig, "providerConfig" | "providerId" | "modelRef">,
): ProviderConfig | undefined {
  if (config.providerConfig) {
    return config.providerConfig;
  }
  return DEFAULT_PROVIDERS.find((provider) =>
    provider.id === config.providerId ||
    provider.id === config.modelRef ||
    provider.modelId === config.modelRef
  );
}

export function withMemoryPrompt(
  config: RunConfig,
  input: UserTaskInput | undefined,
  session: SessionSummary | undefined,
  deps: ModeSelectionDeps,
): RunConfig {
  const policy = resolveMemoryPolicy(config, deps);
  if (!policy.enabled) {
    return config;
  }
  if (!input?.prompt) {
    return config;
  }
  const activeMemory = buildActiveMemoryContext({
    memory: deps.longTermMemory.get(),
    projectMemory: input.projectId ? deps.longTermMemory.getProject(input.projectId) : undefined,
    prompt: input.prompt,
    projectId: input.projectId,
    sessionId: session?.sessionId,
    profileIds: config.profileIds,
    recentMessages: session ? deps.buildConversationMessages(session.sessionId, input.prompt) : [],
    maxCandidates: policy.injectionMaxFacts,
  });
  const overlay = activeMemory.rendered || undefined;
  return RunConfigSchema.parse({
    ...config,
    metadata: {
      ...config.metadata,
      activeMemory: {
        decision: activeMemory.decision,
        cards: activeMemory.cards,
      },
      ...(overlay ? { memoryPromptOverlay: overlay } : {}),
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
      agenticCostHint: routerCostHintForMode(mode),
    }));
  const candidateIds = new Set(candidates.map((mode) => mode.id));
  const fallbackModeId = candidateIds.has(SINGLE_AGENT_MODE_ID)
    ? SINGLE_AGENT_MODE_ID
    : candidates[0]?.id ?? config.pattern;
  const fallback = (reason: string, detail?: unknown) => ({
    modeId: fallbackModeId,
      metadata: {
      entryAgentId: ORA_ROOT_AGENT_ID,
      selectedModeId: fallbackModeId,
      confidence: 0,
      reason,
      status: "fallback",
      handoffSummary: reason,
      detail,
    },
  });

  if (candidates.length === 0) {
    return fallback("No modes were available to route.");
  }

  try {
    const response = await invokeRunProvider(config, {
      system: [
        "You are Ora, Ora's root conversation agent and agent mode router.",
        "Choose exactly one modeId from the provided candidates for the next run.",
        "Return only compact JSON with keys modeId, confidence, and reason.",
        "confidence must be a number from 0 to 1.",
        "reason must be a short plain string under 120 characters.",
        "When multiple modes fit equally well, prefer lower agenticCostHint costTier and coordinationTier.",
        "For chat or planning requests, prefer single_agent unless the task clearly needs verification, delegation, persistent workers, message routing, or shared state.",
        "If the task is underspecified, choose the fallbackModeId with confidence below the threshold.",
        "Do not include markdown or extra text.",
      ].join(" "),
      prompt: JSON.stringify({
        task: input.prompt,
        projectId: input.projectId,
        context: input.context ?? {},
        taskIntent: taskIntentFromMetadata(config.metadata),
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
        entryAgentId: ORA_ROOT_AGENT_ID,
        handoffSummary: parsed.reason,
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
