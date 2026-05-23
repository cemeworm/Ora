import {
  AgentCatalogResult,
  AgentCatalogResultSchema,
  CustomAgentCatalogItemSchema,
  CustomAgentDetail,
  CustomAgentSummary,
  DEFAULT_AGENT_MODE_TOOL_IDS,
  ModeSpec,
  ORA_ROOT_AGENT_ID,
  ORA_ROOT_AGENT_LABEL,
  SystemAgentOverride,
  SYSTEM_AGENT_ID_ALIASES,
  SystemAgentCatalogItem,
  visibleToolIdsForPreset,
} from "@cemeworm/shared";
import { CustomAgentFileStore, SystemAgentOverrideFileStore } from "./custom-agents.js";
import { ModeSpecFileStore } from "./modes.js";

export function applySystemAgentOverridesToMode(
  modeSpec: ModeSpec,
  systemAgentOverrideStore: SystemAgentOverrideFileStore,
): ModeSpec {
  return {
    ...modeSpec,
    profiles: modeSpec.profiles.map((profile) => systemAgentOverrideStore.apply(profile)),
  };
}

export function customAgentIdsForMode(modeSpec: ModeSpec): string[] {
  return [
    ...modeSpec.profiles.map((profile) => profile.customAgentId?.trim() ?? ""),
    ...modeSpec.nodes.map((node) =>
      typeof node.config?.customAgentId === "string" ? node.config.customAgentId.trim() : "",
    ),
  ].filter(Boolean);
}

export function customAgentOverlaysForMode(
  modeSpec: ModeSpec,
  customAgentStore: CustomAgentFileStore,
): Record<string, string> {
  const overlays: Record<string, string> = {};
  for (const customAgentId of customAgentIdsForMode(modeSpec)) {
    if (!customAgentId || overlays[customAgentId]) {
      continue;
    }
    try {
      const overlay = customAgentStore.personaOverlay(customAgentId);
      if (overlay) {
        overlays[customAgentId] = overlay;
      }
    } catch {
      // A deleted custom agent should not make an otherwise valid mode unusable.
    }
  }
  return overlays;
}

export function customAgentContextsForMode(
  modeSpec: ModeSpec,
  customAgentStore: CustomAgentFileStore,
): Record<string, Pick<CustomAgentDetail, "model" | "skillIds" | "toolIds"> & { overlay: string }> {
  const contexts: Record<string, Pick<CustomAgentDetail, "model" | "skillIds" | "toolIds"> & { overlay: string }> = {};
  for (const customAgentId of customAgentIdsForMode(modeSpec)) {
    if (!customAgentId || contexts[customAgentId]) {
      continue;
    }
    try {
      const agent = customAgentStore.get({ name: customAgentId });
      const overlay = customAgentStore.personaOverlay(customAgentId);
      if (overlay) {
        contexts[customAgentId] = {
          overlay,
          model: agent.model,
          toolIds: agent.toolIds,
          skillIds: agent.skillIds,
        };
      }
    } catch {
      // A deleted custom agent should not make an otherwise valid mode unusable.
    }
  }
  return contexts;
}

export function systemAgentOverlaysForMode(
  modeSpec: ModeSpec,
  systemAgentOverrideStore: SystemAgentOverrideFileStore,
): Record<string, string> {
  const overlays: Record<string, string> = {};
  for (const profile of modeSpec.profiles) {
    if (profile.customAgentId) {
      continue;
    }
    const overlay = systemAgentOverrideStore.overlay(profile.id);
    if (overlay) {
      overlays[profile.id] = overlay;
    }
  }
  return overlays;
}

export function systemAgentIds(modeStore: ModeSpecFileStore): Set<string> {
  const ids = new Set(
    modeStore.list()
      .filter((mode) => mode.systemPreset)
      .flatMap((mode) => mode.profiles.map((profile) => profile.id)),
  );
  ids.add(ORA_ROOT_AGENT_ID);
  for (const legacyId of Object.keys(SYSTEM_AGENT_ID_ALIASES)) {
    ids.add(legacyId);
  }
  return ids;
}

export function buildAgentCatalog(params: {
  modeStore: ModeSpecFileStore;
  systemAgentOverrideStore: SystemAgentOverrideFileStore;
  agents: CustomAgentSummary[];
}): AgentCatalogResult {
  const { modeStore, systemAgentOverrideStore, agents } = params;
  const rawModes = modeStore.list().filter((mode) => mode.visibility !== "internal");
  const effectiveModes = rawModes.map((mode) => applySystemAgentOverridesToMode(mode, systemAgentOverrideStore));
  const effectiveModeById = new Map(effectiveModes.map((mode) => [mode.id, mode]));
  const systemProfiles = new Map<string, {
    source: "system";
    id: string;
    label: string;
    role: string;
    modelRef?: string;
    toolPolicyId: string;
    toolIds: string[];
    skillIds: string[];
    memoryNamespaces: string[];
    soul: string;
    overridden: boolean;
    override?: SystemAgentOverride;
    usages: unknown[];
  }>();
  const customUsages = new Map<string, unknown[]>();
  const addCustomUsage = (name: string | undefined, usage: unknown) => {
    if (!name) {
      return;
    }
    const normalized = name.trim().toLowerCase();
    const current = customUsages.get(normalized) ?? [];
    const key = JSON.stringify(usage);
    if (!current.some((item) => JSON.stringify(item) === key)) {
      current.push(usage);
    }
    customUsages.set(normalized, current);
  };

  systemProfiles.set(ORA_ROOT_AGENT_ID, rootAgentCatalogItem(systemAgentOverrideStore));

  for (const mode of rawModes.filter((candidate) => candidate.systemPreset)) {
    const effectiveMode = effectiveModeById.get(mode.id) ?? mode;
    for (const profile of mode.profiles) {
      if (systemProfiles.has(profile.id)) {
        continue;
      }
      const effectiveProfile = effectiveMode.profiles.find((candidate) => candidate.id === profile.id) ?? profile;
      const override = systemAgentOverrideStore.get(profile.id);
      const modelRef = explicitSystemAgentModelRef(profile.modelRef);
      systemProfiles.set(profile.id, {
        source: "system",
        id: profile.id,
        label: effectiveProfile.label,
        role: effectiveProfile.role,
        ...(modelRef ? { modelRef } : {}),
        toolPolicyId: effectiveProfile.toolPolicyId,
        toolIds: effectiveProfile.toolIds,
        skillIds: effectiveProfile.skillIds,
        memoryNamespaces: effectiveProfile.memoryNamespaces,
        soul: override?.soul ?? effectiveProfile.systemPrompt ?? "",
        overridden: override !== undefined,
        ...(override ? { override } : {}),
        usages: [],
      });
    }
  }

  for (const mode of rawModes) {
    const effectiveMode = effectiveModeById.get(mode.id) ?? mode;
    for (const profile of mode.profiles) {
      const effectiveProfile = effectiveMode.profiles.find((candidate) => candidate.id === profile.id) ?? profile;
      const usage = {
        modeId: mode.id,
        modeLabel: effectiveMode.label,
        systemPreset: mode.systemPreset,
        profileId: profile.id,
        profileLabel: effectiveProfile.label,
      };
      if (profile.customAgentId) {
        addCustomUsage(profile.customAgentId, usage);
        continue;
      }
      systemProfiles.get(profile.id)?.usages.push(usage);
    }
    for (const node of mode.nodes) {
      addCustomUsage(
        typeof node.config?.customAgentId === "string" ? node.config.customAgentId : undefined,
        {
          modeId: mode.id,
          modeLabel: effectiveMode.label,
          systemPreset: mode.systemPreset,
          nodeId: node.id,
          nodeLabel: node.title ?? node.label,
        },
      );
    }
  }

  return AgentCatalogResultSchema.parse({
    systemAgents: [...systemProfiles.values()].sort((left, right) => left.label.localeCompare(right.label)),
    customAgents: agents.map((agent) => CustomAgentCatalogItemSchema.parse({
      ...agent,
      source: "custom",
      usages: customUsages.get(agent.name) ?? [],
    })),
  });
}

function explicitSystemAgentModelRef(modelRef: string | undefined): string | undefined {
  return modelRef || undefined;
}

function rootAgentCatalogItem(systemAgentOverrideStore: SystemAgentOverrideFileStore): SystemAgentCatalogItem {
  const override = systemAgentOverrideStore.get(ORA_ROOT_AGENT_ID);
  const role = "Root conversation agent, Auto Mode Router initiator, clarification owner, handoff parent, observer, and final responder.";
  return {
    source: "system",
    id: ORA_ROOT_AGENT_ID,
    label: override?.label ?? ORA_ROOT_AGENT_LABEL,
    role: override?.role ?? role,
    ...(explicitSystemAgentModelRef(override?.modelRef) ? { modelRef: explicitSystemAgentModelRef(override?.modelRef) } : {}),
    toolPolicyId: "root.default_policy",
    toolIds: override?.toolIds ?? visibleToolIdsForPreset("single_agent_implement", DEFAULT_AGENT_MODE_TOOL_IDS),
    skillIds: override?.skillIds ?? [],
    memoryNamespaces: ["session", "project"],
    soul: override?.soul ?? "",
    overridden: override !== undefined,
    ...(override ? { override } : {}),
    usages: [
      rootAgentUsage("global_entry", "Global Entry"),
      rootAgentUsage("auto_mode_router", "Auto Mode Router"),
      rootAgentUsage("clarification", "Clarification"),
      rootAgentUsage("final_response", "Final Response"),
    ],
  };
}

function rootAgentUsage(modeId: string, modeLabel: string) {
  return {
    modeId,
    modeLabel,
    systemPreset: true,
    profileId: ORA_ROOT_AGENT_ID,
    profileLabel: ORA_ROOT_AGENT_LABEL,
  };
}
