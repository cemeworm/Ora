import {
  CustomAgentSummary,
  DEFAULT_RESOURCE_BUDGETS,
  ModeSpec,
  ModeSpecSchema,
  ModeStudioContextResult,
  ModeStudioDraftBundle,
  ModeStudioDraftBundleSchema,
  ModeStudioGenerateDraftParams,
  ModeStudioStartBuilderRunParams,
  ModeValidationResult,
  RunConfig,
  SINGLE_AGENT_MODE_ID,
  createModeSpecFromPattern,
  getPatternDefinition
} from "@cemeworm/shared";
import { invokeRunProvider, type ModelMessage } from "./providers/index.js";
import {
  assessModeStudioDesignCompleteness,
  enrichModeStudioGeneratedDraft,
  inferModeStudioFamily,
  isCoordinationPattern,
  modeStudioBuilderSystemPrompt,
  modeStudioBuilderUserPrompt,
  type ModeStudioBuilderProviderResponse,
  modeStudioDescription,
  modeStudioFamilyReason,
  modeStudioGuidance,
  modeStudioLabel,
  modeStudioNeedsInputBundle,
  modeStudioNodePrompt,
  modeStudioNodeStoryConfig,
  modeStudioPurpose,
  modeStudioRolePlans,
  modeStudioRuntimeAtoms,
  modeStudioStagedDraft,
  modeStudioSummary,
  modeStudioToolIds,
  modeStudioTopologyChoices,
  modeStudioUserText,
  normalizeGeneratedAgentDraft,
  ownerForModeStudioTemplate,
  parseModeStudioBuilderProviderText,
  prepareModeStudioDraft,
  slugifyModeStudio
} from "./mode-studio-draft.js";
import type { ModeStudioBuilderRunResult } from "./mode-studio-builder-run.js";

export interface ModeStudioStoreDeps {
  now: () => number;
  listAgents: () => CustomAgentSummary[];
  listModes: () => ModeSpec[];
  getMode: (params: { modeId: string }) => ModeSpec;
  validateMode: (params: { spec: ModeSpec }) => ModeValidationResult;
  modeStudioContext: () => ModeStudioContextResult;
}

export function buildModeStudioDraft(
  params: ModeStudioGenerateDraftParams & { draftBundle?: ModeStudioDraftBundle },
  deps: ModeStudioStoreDeps,
): ModeStudioDraftBundle {
  const userText = modeStudioUserText(params.messages);
  const source = modeStudioSourceMode(params, deps);
  const completeness = assessModeStudioDesignCompleteness(userText, {
    currentDraft: params.currentDraft,
    previousDraftBundle: params.draftBundle,
  });
  if (!completeness.complete) {
    return withModeStudioValidation(ModeStudioDraftBundleSchema.parse({
      modeDraft: prepareModeStudioDraft(source, userText, [], params),
      agentDrafts: [],
      guidance: {
        step: completeness.missing.includes("topology") ? "topology" : "goal",
        assistantMessage: completeness.assistantMessage,
        choices: completeness.missing.includes("topology") ? modeStudioTopologyChoices() : [],
      },
      changeSummary: ["Kept a preview draft open while the builder collects enough mode design detail."],
      validation: { valid: false, errors: [], warnings: [] },
      needsInput: true,
    }), deps);
  }

  const family = inferModeStudioFamily(userText, source.family);
  const pattern = getPatternDefinition(family);
  const base = params.currentDraft && params.currentDraft.family === family
    ? params.currentDraft
    : createModeSpecFromPattern(family);
  const rolePlans = modeStudioRolePlans(family, userText);
  const agentDrafts: ModeStudioDraftBundle["agentDrafts"] = [];
  const modeDraft = prepareModeStudioDraft(base, userText, agentDrafts, params);
  const profiles = rolePlans.map((role, index) => {
    const baseProfile = base.profiles.find((profile) => profile.id === role.profileId) ?? base.profiles[index];
    return {
      id: role.profileId,
      label: role.label,
      role: role.role,
      modelRef: baseProfile?.modelRef,
      toolPolicyId: baseProfile?.toolPolicyId ?? `${family}.default`,
      toolIds: modeStudioToolIds(role.toolIntent, userText),
      skillIds: baseProfile?.skillIds ?? [],
      memoryNamespaces: baseProfile?.memoryNamespaces ?? ["session", "project"],
      budget: baseProfile?.budget ?? DEFAULT_RESOURCE_BUDGETS[family],
    };
  });
  const toolIds = [...new Set(profiles.flatMap((profile) => profile.toolIds))];
  const skillIds = [...new Set(profiles.flatMap((profile) => profile.skillIds))];
  const runtimeAtoms = modeStudioRuntimeAtoms(family, userText, base.runtimeAtoms);
  const nextDraft = modeStudioStagedDraft({
    ...modeDraft,
    family,
    summary: modeStudioSummary(userText, pattern.summary),
    description: modeStudioDescription(userText, pattern),
    recommendedUse: `Use when the user wants: ${modeStudioPurpose(userText)}.`,
    failureMode: pattern.failureMode,
    profiles,
    nodes: modeDraft.nodes.map((node) => {
      const ownerAgentId = ownerForModeStudioTemplate(node.template, rolePlans) ?? node.ownerAgentId;
      return {
        ...node,
        ownerAgentId,
        prompt: modeStudioNodePrompt(node.template, userText, node.prompt),
        config: {
          ...node.config,
          story: modeStudioNodeStoryConfig(family, node, ownerAgentId, profiles, userText),
        },
      };
    }),
    capabilityFlags: {
      ...modeDraft.capabilityFlags,
      supportsPersistentWorkers: pattern.supportsPersistentWorkers,
      supportsSharedState: pattern.supportsSharedState,
      supportsEventRouting: pattern.supportsEventRouting,
      toolIds,
      skillIds,
    },
    runtimeAtoms,
    updatedAt: Date.now(),
  }, userText, rolePlans);
  const guidance = modeStudioGuidance(family, userText);
  return withModeStudioValidation(ModeStudioDraftBundleSchema.parse({
    modeDraft: nextDraft,
    agentDrafts,
    guidance,
    changeSummary: [
      `Selected ${pattern.label} because the request implies ${modeStudioFamilyReason(family)}.`,
      "Reused Ora's canonical system agents for the mode roles.",
      toolIds.length > 0 ? `Mounted ${toolIds.length} tool${toolIds.length === 1 ? "" : "s"} across the mode profiles.` : "Kept tools minimal until the user asks for more capability.",
    ],
    validation: { valid: false, errors: [], warnings: [] },
    needsInput: false,
  }), deps);
}

export function modeStudioSourceMode(
  params: ModeStudioGenerateDraftParams,
  deps: ModeStudioStoreDeps,
): ModeSpec {
  if (params.currentDraft) {
    return params.currentDraft;
  }
  if (params.baseModeId) {
    try {
      return deps.getMode({ modeId: params.baseModeId });
    } catch {
      // Fall back to the default pattern when a stale UI reference is supplied.
    }
  }
  return deps.listModes().find((mode) => mode.id === SINGLE_AGENT_MODE_ID)
    ?? createModeSpecFromPattern("orchestrator_subagent");
}

export function withModeStudioValidation(
  bundle: ModeStudioDraftBundle,
  deps: ModeStudioStoreDeps,
): ModeStudioDraftBundle {
  const validation = deps.validateMode({ spec: bundle.modeDraft });
  return ModeStudioDraftBundleSchema.parse({
    ...bundle,
    validation,
  });
}

export async function createModeStudioBuilderResult(
  params: ModeStudioStartBuilderRunParams,
  config: RunConfig,
  deps: ModeStudioStoreDeps,
): Promise<ModeStudioBuilderRunResult> {
  if (config.providerId === "local-smoke" || config.modelRef === "local/smoke-model") {
    return { draftBundle: buildModeStudioDraft(params, deps), issues: [] };
  }
  try {
    const firstResponse = await invokeRunProvider(config, {
      system: modeStudioBuilderSystemPrompt(),
      messages: params.messages.map((message): ModelMessage => ({
        role: message.role,
        content: message.content,
      })),
      prompt: modeStudioBuilderUserPrompt(params, deps.modeStudioContext()),
      temperature: 0.2,
      maxTokens: 5000,
      toolChoice: "none",
    });
    const firstParsed = parseModeStudioBuilderProviderText(firstResponse.text);
    const parsed = firstParsed.success
      ? firstParsed
      : parseModeStudioBuilderProviderText((await invokeRunProvider(config, {
          system: "Repair the previous response into strict JSON only. Do not add markdown.",
          messages: [
            {
              role: "user",
              content: [
                "Invalid Mode Studio builder response:",
                firstResponse.text,
                "Return JSON matching: {\"assistantMessage\": string, \"needsInput\": boolean, \"modeDraft\": ModeSpec, \"agentDrafts\": CustomAgentGeneratedDraft[], \"changeSummary\": string[], \"issues\": [{\"field\": string, \"message\": string}]}",
              ].join("\n\n"),
            },
          ],
          temperature: 0,
          maxTokens: 5000,
          toolChoice: "none",
        })).text);
    if (!parsed.success) {
      return {
        draftBundle: withModeStudioValidation(modeStudioNeedsInputBundle(modeStudioSourceMode(params, deps), params, "Builder returned invalid JSON after repair."), deps),
        issues: [{ field: "general", message: "Builder returned invalid JSON after repair." }],
        rawText: firstResponse.text,
      };
    }
    const draftBundle = modeStudioBundleFromProvider(parsed.data, params, deps);
    return { draftBundle, issues: parsed.data.issues, rawText: firstResponse.text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      draftBundle: withModeStudioValidation(modeStudioNeedsInputBundle(modeStudioSourceMode(params, deps), params, message), deps),
      issues: [{ field: "general", message }],
    };
  }
}

function modeStudioBundleFromProvider(
  providerResult: ModeStudioBuilderProviderResponse,
  params: ModeStudioStartBuilderRunParams,
  deps: ModeStudioStoreDeps,
): ModeStudioDraftBundle {
  const text = modeStudioUserText(params.messages);
  const source = modeStudioSourceMode(params, deps);
  const rawMode = isPlainRecord(providerResult.modeDraft) ? providerResult.modeDraft : {};
  const rawFamily = typeof rawMode.family === "string" && isCoordinationPattern(rawMode.family)
    ? rawMode.family
    : source.family;
  const base = params.currentDraft && params.currentDraft.family === rawFamily
    ? params.currentDraft
    : source.family === rawFamily
      ? source
      : createModeSpecFromPattern(rawFamily);
  const now = deps.now();
  const idSeed = typeof rawMode.id === "string"
    ? rawMode.id
    : typeof rawMode.label === "string"
      ? rawMode.label
      : modeStudioPurpose(text);
  const modeDraft = ModeSpecSchema.parse({
    ...base,
    ...rawMode,
    id: slugifyModeStudio(idSeed) || slugifyModeStudio(base.id) || "guided-mode",
    family: rawFamily,
    label: typeof rawMode.label === "string" && rawMode.label.trim() ? rawMode.label.trim() : modeStudioLabel(text),
    summary: typeof rawMode.summary === "string" && rawMode.summary.trim() ? rawMode.summary.trim() : modeStudioSummary(text, base.summary),
    description: typeof rawMode.description === "string" && rawMode.description.trim() ? rawMode.description.trim() : modeStudioDescription(text, getPatternDefinition(rawFamily)),
    recommendedUse: typeof rawMode.recommendedUse === "string" && rawMode.recommendedUse.trim() ? rawMode.recommendedUse.trim() : `Use when the user wants: ${modeStudioPurpose(text)}.`,
    systemPreset: false,
    visibility: "user",
    nodes: Array.isArray(rawMode.nodes) ? rawMode.nodes : base.nodes,
    edges: Array.isArray(rawMode.edges) ? rawMode.edges : base.edges,
    profiles: Array.isArray(rawMode.profiles) ? rawMode.profiles : base.profiles,
    createdAt: params.currentDraft?.createdAt ?? now,
    updatedAt: now,
  });
  const agentDrafts = providerResult.agentDrafts.map((draft) => normalizeGeneratedAgentDraft(draft));
  const enrichedDraft = enrichModeStudioGeneratedDraft(modeDraft, {
    text,
    agentDrafts,
    currentDraft: params.currentDraft,
  });
  const completeness = assessModeStudioDesignCompleteness(text, {
    currentDraft: params.currentDraft,
    previousDraftBundle: params.draftBundle,
  });
  const needsInput = providerResult.needsInput || !completeness.complete;
  const bundle = ModeStudioDraftBundleSchema.parse({
    modeDraft: enrichedDraft,
    agentDrafts,
    guidance: {
      step: needsInput ? "goal" : "preview",
      assistantMessage: providerResult.needsInput
        ? providerResult.assistantMessage
        : needsInput
          ? completeness.assistantMessage
          : providerResult.assistantMessage,
      choices: needsInput
        ? (completeness.missing.includes("topology") ? modeStudioTopologyChoices() : [])
        : modeStudioGuidance(enrichedDraft.family, text).choices,
    },
    changeSummary: providerResult.changeSummary.length > 0
      ? providerResult.changeSummary
      : [`Generated ${enrichedDraft.label} through the runtime-backed Mode Studio builder.`],
    validation: { valid: false, errors: [], warnings: [] },
    needsInput,
  });
  return withModeStudioValidation(bundle, deps);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
