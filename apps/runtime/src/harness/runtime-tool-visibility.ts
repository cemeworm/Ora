import {
  type AgentSpawnCapabilityGroup,
  type AgentSpawnDegradationReason,
  type AgentSpawnPreflightResult,
  AgentSpawnPreflightResultSchema,
  CODE_DEVELOPMENT_MODE_ID,
  DEEP_RESEARCH_MODE_ID,
  type AgentToolBundleId,
  isLegacyDefaultAgentModeToolIds,
  type ModeStagePreflightResult,
  ModeStagePreflightResultSchema,
  ORA_ROOT_AGENT_ID,
  ORA_SELF_BUILDER_MODE_ID,
  SINGLE_AGENT_MODE_ID,
  TOOL_VISIBILITY_PRESETS,
  type ToolCapabilityGroup,
  resolveToolVisibility,
  REVIEW_CRITIQUE_MODE_ID,
  type ModeNodeSpec,
  type ModeSpec,
  type ToolDescriptor,
  type ToolVisibilityPresetId,
  type ToolVisibilityResolution,
} from "@cemeworm/shared";
import { CODE_DEVELOPMENT_ORCHESTRATOR_BLOCKED_TOOLS } from "./runtime-tool-boundary.js";

export interface ChildToolBundleDefinition {
  toolIds: string[];
  preflight: AgentSpawnPreflightResult;
  visibility: ToolVisibilityResolution;
}

const CHILD_TOOL_BUNDLE_PRESET_IDS: Record<AgentToolBundleId, ToolVisibilityPresetId> = {
  research_readonly: "research_readonly",
  repo_forensics: "repo_forensics",
  review_readonly: "review_readonly",
  builder_write: "builder_write",
};

const REPO_SEARCH_TOOL_IDS = ["file.list", "file.glob", "file.grep"] as const;

const CHILD_TOOL_BUNDLE_ALTERNATIVES: Partial<Record<AgentToolBundleId, AgentToolBundleId>> = {
  builder_write: "review_readonly",
  repo_forensics: "review_readonly",
};

function presetForNode(
  modeSpec: ModeSpec,
  agentId: string,
  node: ModeNodeSpec | undefined,
  taskIntent?: "chat" | "plan" | "implement",
): ToolVisibilityPresetId {
  if (agentId === ORA_ROOT_AGENT_ID) {
    if (modeSpec.id === SINGLE_AGENT_MODE_ID && taskIntent === "implement") {
      return "single_agent_implement";
    }
    if (modeSpec.id === ORA_SELF_BUILDER_MODE_ID) {
      return "self_builder_root";
    }
    return modeSpec.id === CODE_DEVELOPMENT_MODE_ID ? "coding_root" : "root_default";
  }
  if (modeSpec.id === DEEP_RESEARCH_MODE_ID) {
    return "research_readonly";
  }
  if (modeSpec.id === REVIEW_CRITIQUE_MODE_ID) {
    return "review_readonly";
  }
  if (modeSpec.id === ORA_SELF_BUILDER_MODE_ID) {
    switch (node?.template) {
      case "build":
        return "self_builder_build";
      case "check":
        return "self_builder_review";
      default:
        return "self_builder_root";
    }
  }

  switch (node?.template) {
    case "build":
      return "builder_write";
    case "check":
      if (modeSpec.id === CODE_DEVELOPMENT_MODE_ID && node.id === "debug") {
        return "repo_forensics";
      }
      return "review_readonly";
    case "review":
    case "verify":
    case "decide":
      return "review_readonly";
    case "research":
      return "research_readonly";
    default:
      return modeSpec.id === CODE_DEVELOPMENT_MODE_ID ? "coding_root" : "root_default";
  }
}

function explicitProfileToolIds(toolIds: readonly string[]): string[] | undefined {
  if (toolIds.length === 0 || isLegacyDefaultAgentModeToolIds(toolIds)) {
    return undefined;
  }
  return [...toolIds];
}

export function resolveVisibleToolsForAgent(params: {
  availableToolIds: readonly string[];
  toolDescriptors: readonly ToolDescriptor[];
  modeSpec: ModeSpec;
  agentId: string;
  profileToolIds?: readonly string[];
  customAgentToolIds?: readonly string[];
  taskIntent?: "chat" | "plan" | "implement";
  nodeId?: string;
  requestedToolIds?: readonly string[];
  isNestedAgentSpawn?: boolean;
}): ToolVisibilityResolution {
  const node = params.nodeId
    ? params.modeSpec.nodes.find((candidate) => candidate.id === params.nodeId)
    : undefined;
  const explicitToolIds = params.requestedToolIds
    ?? explicitProfileToolIds(params.profileToolIds ?? [])
    ?? explicitProfileToolIds(params.customAgentToolIds ?? []);
  const hardBlockedToolIds = [
    ...(params.isNestedAgentSpawn ? ["agent.spawn"] : []),
    ...(params.modeSpec.id === CODE_DEVELOPMENT_MODE_ID && params.agentId === ORA_ROOT_AGENT_ID
      ? [...CODE_DEVELOPMENT_ORCHESTRATOR_BLOCKED_TOOLS]
      : []),
  ];

  if (explicitToolIds) {
    return resolveToolVisibility({
      availableToolIds: params.availableToolIds,
      toolDescriptors: params.toolDescriptors,
      explicitToolIds,
      taskIntent: params.taskIntent,
      hardBlockedToolIds,
    });
  }

  return resolveToolVisibility({
    availableToolIds: params.availableToolIds,
    toolDescriptors: params.toolDescriptors,
    presetId: presetForNode(params.modeSpec, params.agentId, node, params.taskIntent),
    taskIntent: params.taskIntent,
    hardBlockedToolIds,
    defaultDecisionSource: "resolver_default",
  });
}

function requiredCapabilityGroupsForNode(node: ModeNodeSpec | undefined): ToolCapabilityGroup[] {
  const raw = node?.config && typeof node.config === "object"
    ? (node.config as { requiredCapabilityGroups?: unknown }).requiredCapabilityGroups
    : undefined;
  return Array.isArray(raw)
    ? raw.filter((value): value is ToolCapabilityGroup => typeof value === "string")
    : [];
}

function hasCapabilityGroup(group: ToolCapabilityGroup, resolved: ReadonlySet<string>): boolean {
  switch (group) {
    case "repo_read":
      return resolved.has("file.read");
    case "repo_search":
      return REPO_SEARCH_TOOL_IDS.some((toolId) => resolved.has(toolId));
    case "repo_explore":
      return resolved.has("repo.explore");
    case "repo_patch":
      return resolved.has("file.patch");
    case "repo_apply_patch":
      return resolved.has("file.apply_patch");
    case "repo_shell_execute":
      return resolved.has("shell.execute");
    case "package_list":
      return resolved.has("package.list");
    case "package_build_candidate":
      return resolved.has("package.buildCandidate");
    case "package_verify":
      return resolved.has("package.verify");
    case "package_promote":
      return resolved.has("package.promote");
    case "package_switch":
      return resolved.has("package.switch");
    case "package_rollback":
      return resolved.has("package.rollback");
    default:
      return false;
  }
}

export function resolveModeStageToolPreflight(params: {
  modeSpec: ModeSpec;
  agentId: string;
  nodeId?: string;
  resolvedToolIds: readonly string[];
  taskIntent?: "chat" | "plan" | "implement";
}): ModeStagePreflightResult | undefined {
  if (params.agentId === ORA_ROOT_AGENT_ID && !params.nodeId) {
    return undefined;
  }
  const node = params.nodeId
    ? params.modeSpec.nodes.find((candidate) => candidate.id === params.nodeId)
    : undefined;
  const requiredCapabilityGroups = requiredCapabilityGroupsForNode(node);
  if (requiredCapabilityGroups.length === 0) {
    return undefined;
  }
  const resolved = new Set(params.resolvedToolIds);
  const missingCapabilities = requiredCapabilityGroups.filter((group) => !hasCapabilityGroup(group, resolved));
  return ModeStagePreflightResultSchema.parse({
    status: missingCapabilities.length === 0 ? "ready" : "blocked",
    presetId: presetForNode(params.modeSpec, params.agentId, node, params.taskIntent),
    resolvedToolIds: [...params.resolvedToolIds],
    missingCapabilities,
  });
}

export function resolveChildToolBundleDefinition(params: {
  bundleId: AgentToolBundleId;
  availableToolIds: readonly string[];
  toolDescriptors: readonly ToolDescriptor[];
  taskIntent?: "chat" | "plan" | "implement";
  isNestedAgentSpawn?: boolean;
}): ChildToolBundleDefinition {
  const presetId = CHILD_TOOL_BUNDLE_PRESET_IDS[params.bundleId];
  const visibility = resolveToolVisibility({
    availableToolIds: params.availableToolIds,
    toolDescriptors: params.toolDescriptors,
    presetId,
    taskIntent: params.taskIntent,
    hardBlockedToolIds: params.isNestedAgentSpawn ? ["agent.spawn"] : [],
    defaultDecisionSource: "bundle_preset",
  });
  const preflight = bundlePreflightForVisibility(params.bundleId, presetId, visibility.visibleToolIds);
  return {
    toolIds: visibility.visibleToolIds,
    preflight,
    visibility,
  };
}

function bundlePreflightForVisibility(
  bundleId: AgentToolBundleId,
  presetId: ToolVisibilityPresetId,
  resolvedToolIds: readonly string[],
) {
  const resolved = new Set(resolvedToolIds);
  const missingToolIds = TOOL_VISIBILITY_PRESETS[presetId].toolIds.filter((toolId) => !resolved.has(toolId));
  const missingCapabilities = new Set<AgentSpawnCapabilityGroup>();
  const appliedDegradations = new Set<AgentSpawnDegradationReason>();
  let status: "ready" | "degraded" | "blocked" = "ready";
  let recommendedAlternativePreset: AgentToolBundleId | undefined;

  const hasFileRead = resolved.has("file.read");
  const hasRepoSearch = REPO_SEARCH_TOOL_IDS.some((toolId) => resolved.has(toolId));
  const hasRepoExplore = resolved.has("repo.explore");
  const hasRepoEvidenceSurface = hasRepoExplore || (hasFileRead && hasRepoSearch);
  const hasWebEvidenceSurface = resolved.has("web.fetch") || resolved.has("web.search");
  const hasFilePatch = resolved.has("file.patch");
  const hasApplyPatch = resolved.has("file.apply_patch");
  const hasShellExecute = resolved.has("shell.execute");

  const blockWith = (capabilities: AgentSpawnCapabilityGroup[], reason?: AgentSpawnDegradationReason) => {
    status = "blocked";
    for (const capability of capabilities) {
      missingCapabilities.add(capability);
    }
    if (reason) {
      appliedDegradations.add(reason);
    }
    recommendedAlternativePreset = CHILD_TOOL_BUNDLE_ALTERNATIVES[bundleId];
  };

  const degradeWith = (capabilities: AgentSpawnCapabilityGroup[], reason: AgentSpawnDegradationReason) => {
    if (status !== "blocked") {
      status = "degraded";
    }
    for (const capability of capabilities) {
      missingCapabilities.add(capability);
    }
    appliedDegradations.add(reason);
  };

  switch (bundleId) {
    case "builder_write":
      if (!hasFileRead) {
        blockWith(["repo_read"], "repo_read_surface_unavailable");
        break;
      }
      if (!hasRepoSearch && !hasRepoExplore) {
        blockWith(["repo_search", "repo_explore"], "repo_read_surface_unavailable");
        break;
      }
      if (!hasApplyPatch && hasFilePatch) {
        degradeWith(["repo_apply_patch"], "apply_patch_unavailable_fallback_patch");
      } else if (!hasApplyPatch) {
        blockWith(["repo_apply_patch", "repo_patch"], "builder_write_without_patch_capability");
      }
      break;
    case "review_readonly":
      if (!hasRepoEvidenceSurface) {
        blockWith(["repo_read", "repo_search", "repo_explore"], "repo_read_surface_unavailable");
        break;
      }
      if (!hasRepoExplore) {
        degradeWith(["repo_explore"], "repo_explore_unavailable_fallback_read");
      }
      break;
    case "research_readonly":
      if (!hasRepoEvidenceSurface && !hasWebEvidenceSurface) {
        blockWith(["repo_read", "repo_search", "repo_explore"], "repo_read_surface_unavailable");
        break;
      }
      if (hasRepoEvidenceSurface && !hasRepoExplore) {
        degradeWith(["repo_explore"], "repo_explore_unavailable_fallback_read");
      } else if (!hasRepoEvidenceSurface && hasWebEvidenceSurface) {
        degradeWith(["repo_read", "repo_search", "repo_explore"], "repo_read_surface_unavailable");
      } else if (!hasWebEvidenceSurface) {
        // Research can run on repository evidence alone, but it is still a degraded preset surface.
        status = "degraded";
      }
      break;
    case "repo_forensics":
      if (!hasRepoEvidenceSurface) {
        blockWith(["repo_read", "repo_search", "repo_explore"], "repo_read_surface_unavailable");
        break;
      }
      if (!hasShellExecute) {
        degradeWith(["repo_shell_execute"], "shell_execute_unavailable_shallow_forensics");
      }
      break;
  }

  return AgentSpawnPreflightResultSchema.parse({
    requestedPreset: bundleId,
    resolvedPreset: presetId,
    status,
    resolvedToolIds: [...resolvedToolIds],
    missingToolIds,
    missingCapabilities: [...missingCapabilities],
    appliedDegradations: [...appliedDegradations],
    recommendedAlternativePreset,
  });
}
