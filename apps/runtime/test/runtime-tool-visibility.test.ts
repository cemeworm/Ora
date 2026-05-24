import { describe, expect, it } from "vitest";
import {
  CODE_DEVELOPMENT_MODE_ID,
  DEFAULT_AGENT_MODE_TOOL_IDS,
  MVP_TOOLS,
  ORA_SELF_BUILDER_MODE_ID,
  type AgentProfile,
  ModeSpecSchema,
  ORA_ROOT_AGENT_ID,
  SINGLE_AGENT_MODE_ID,
  type ModeNodeSpec,
  type ModeSpec,
} from "@cemeworm/shared";
import {
  resolveModeStageToolPreflight,
  resolveChildToolBundleDefinition,
  resolveVisibleToolsForAgent,
} from "../src/harness/runtime-tool-visibility.js";

function testBudget(): AgentProfile["budget"] {
  return {
    maxTokens: 2000,
    maxToolCalls: 32,
    maxRuntimeMs: 30_000,
  };
}

function makeProfile(id: string, label: string): AgentProfile {
  return {
    id,
    label,
    role: `${label} role`,
    toolPolicyId: "runtime.default_policy",
    toolIds: [...DEFAULT_AGENT_MODE_TOOL_IDS],
    skillIds: [],
    memoryNamespaces: ["session"],
    budget: testBudget(),
  };
}

function makeMode(params: {
  id: string;
  nodes: ModeNodeSpec[];
  profiles?: AgentProfile[];
  family?: ModeSpec["family"];
}): ModeSpec {
  return ModeSpecSchema.parse({
    id: params.id,
    family: params.family ?? "orchestrator_subagent",
    label: params.id,
    summary: `${params.id} summary`,
    nodes: params.nodes,
    stopPolicy: { type: "manual", detail: "test" },
    capabilityFlags: {
      toolIds: [...DEFAULT_AGENT_MODE_TOOL_IDS],
      skillIds: [],
    },
    editorConstraints: {},
    defaultBudget: testBudget(),
    profiles: params.profiles ?? [makeProfile(ORA_ROOT_AGENT_ID, "Ora")],
    createdAt: 0,
    updatedAt: 0,
  });
}

describe("runtime tool visibility", () => {
  it("gives single_agent implement root a writable builder-capable surface", () => {
    const mode = makeMode({
      id: SINGLE_AGENT_MODE_ID,
      nodes: [
        {
          id: "respond",
          template: "respond",
          label: "Respond",
          ownerAgentId: ORA_ROOT_AGENT_ID,
          config: {},
        },
      ],
    });
    const profile = mode.profiles[0]!;

    const resolution = resolveVisibleToolsForAgent({
      availableToolIds: DEFAULT_AGENT_MODE_TOOL_IDS,
      toolDescriptors: MVP_TOOLS,
      modeSpec: mode,
      agentId: ORA_ROOT_AGENT_ID,
      profileToolIds: profile.toolIds,
      nodeId: "respond",
      taskIntent: "implement",
    });

    expect(resolution.decisionSource).toBe("resolver_default");
    expect(resolution.visibleToolIds).toContain("repo.explore");
    expect(resolution.visibleToolIds).toContain("file.read");
    expect(resolution.visibleToolIds).toContain("file.apply_patch");
    expect(resolution.visibleToolIds).toContain("shell.execute");
    expect(resolution.visibleToolIds).toContain("agent.spawn");
    expect(resolution.visibleToolIds).not.toContain("skills.create");
  });

  it("keeps single_agent chat root on the narrow default surface", () => {
    const mode = makeMode({
      id: SINGLE_AGENT_MODE_ID,
      nodes: [
        {
          id: "respond",
          template: "respond",
          label: "Respond",
          ownerAgentId: ORA_ROOT_AGENT_ID,
          config: {},
        },
      ],
    });

    const resolution = resolveVisibleToolsForAgent({
      availableToolIds: DEFAULT_AGENT_MODE_TOOL_IDS,
      toolDescriptors: MVP_TOOLS,
      modeSpec: mode,
      agentId: ORA_ROOT_AGENT_ID,
      profileToolIds: mode.profiles[0]!.toolIds,
      nodeId: "respond",
      taskIntent: "chat",
    });

    expect(resolution.decisionSource).toBe("resolver_default");
    expect(resolution.visibleToolIds).not.toContain("repo.explore");
    expect(resolution.visibleToolIds).not.toContain("agent.spawn");
    expect(resolution.visibleToolIds).not.toContain("file.apply_patch");
    expect(resolution.visibleToolIds).not.toContain("shell.execute");
  });

  it("uses builder_write for code development build stages", () => {
    const mode = makeMode({
      id: CODE_DEVELOPMENT_MODE_ID,
      nodes: [
        {
          id: "build",
          template: "build",
          label: "Build",
          ownerAgentId: "builder",
          config: {},
        },
      ],
      profiles: [makeProfile(ORA_ROOT_AGENT_ID, "Ora"), makeProfile("builder", "Builder")],
    });

    const resolution = resolveVisibleToolsForAgent({
      availableToolIds: DEFAULT_AGENT_MODE_TOOL_IDS,
      toolDescriptors: MVP_TOOLS,
      modeSpec: mode,
      agentId: "builder",
      profileToolIds: mode.profiles[1]!.toolIds,
      nodeId: "build",
      taskIntent: "implement",
    });

    expect(resolution.visibleToolIds).toContain("file.apply_patch");
    expect(resolution.visibleToolIds).toContain("repo.explore");
    expect(resolution.visibleToolIds).toContain("shell.execute");
    expect(resolution.visibleToolIds).not.toContain("agent.spawn");
  });

  it("gives ora_self_builder build stages package-aware write tools", () => {
    const mode = makeMode({
      id: ORA_SELF_BUILDER_MODE_ID,
      family: "agent_teams",
      nodes: [
        {
          id: "build",
          template: "build",
          label: "Build",
          ownerAgentId: "builder",
          config: {
            requiredCapabilityGroups: ["repo_read", "repo_explore", "repo_apply_patch", "package_build_candidate"],
          },
        },
      ],
      profiles: [makeProfile(ORA_ROOT_AGENT_ID, "Ora"), makeProfile("builder", "Builder")],
    });

    const resolution = resolveVisibleToolsForAgent({
      availableToolIds: DEFAULT_AGENT_MODE_TOOL_IDS,
      toolDescriptors: MVP_TOOLS,
      modeSpec: mode,
      agentId: "builder",
      profileToolIds: mode.profiles[1]!.toolIds,
      nodeId: "build",
      taskIntent: "implement",
    });

    expect(resolution.visibleToolIds).toContain("file.apply_patch");
    expect(resolution.visibleToolIds).toContain("package.buildCandidate");
    expect(resolution.visibleToolIds).not.toContain("package.promote");
  });

  it("gives ora_self_builder handoff root the package promotion surface", () => {
    const mode = makeMode({
      id: ORA_SELF_BUILDER_MODE_ID,
      family: "agent_teams",
      nodes: [
        {
          id: "handoff",
          template: "handoff",
          label: "Handoff",
          ownerAgentId: ORA_ROOT_AGENT_ID,
          config: {
            requiredCapabilityGroups: ["package_promote"],
          },
        },
      ],
    });

    const resolution = resolveVisibleToolsForAgent({
      availableToolIds: DEFAULT_AGENT_MODE_TOOL_IDS,
      toolDescriptors: MVP_TOOLS,
      modeSpec: mode,
      agentId: ORA_ROOT_AGENT_ID,
      profileToolIds: mode.profiles[0]!.toolIds,
      nodeId: "handoff",
      taskIntent: "implement",
    });

    expect(resolution.visibleToolIds).toContain("package.promote");
    expect(resolution.visibleToolIds).toContain("package.switch");
    expect(resolution.visibleToolIds).not.toContain("file.apply_patch");
  });

  it("hides agent.spawn from the code development root agent", () => {
    const mode = makeMode({
      id: CODE_DEVELOPMENT_MODE_ID,
      nodes: [
        {
          id: "triage",
          template: "triage",
          label: "Triage",
          ownerAgentId: ORA_ROOT_AGENT_ID,
          config: {},
        },
      ],
    });

    const resolution = resolveVisibleToolsForAgent({
      availableToolIds: DEFAULT_AGENT_MODE_TOOL_IDS,
      toolDescriptors: MVP_TOOLS,
      modeSpec: mode,
      agentId: ORA_ROOT_AGENT_ID,
      profileToolIds: mode.profiles[0]!.toolIds,
      nodeId: "triage",
      taskIntent: "implement",
    });

    expect(resolution.visibleToolIds).toContain("repo.explore");
    expect(resolution.visibleToolIds).toContain("plan.update");
    expect(resolution.visibleToolIds).not.toContain("agent.spawn");
    expect(resolution.visibleToolIds).not.toContain("shell.execute");
  });

  it("uses review_readonly for check stages", () => {
    const mode = makeMode({
      id: CODE_DEVELOPMENT_MODE_ID,
      nodes: [
        {
          id: "check",
          template: "check",
          label: "Check",
          ownerAgentId: "reviewer",
          config: {},
        },
      ],
      profiles: [makeProfile(ORA_ROOT_AGENT_ID, "Ora"), makeProfile("reviewer", "Reviewer")],
    });

    const resolution = resolveVisibleToolsForAgent({
      availableToolIds: DEFAULT_AGENT_MODE_TOOL_IDS,
      toolDescriptors: MVP_TOOLS,
      modeSpec: mode,
      agentId: "reviewer",
      profileToolIds: mode.profiles[1]!.toolIds,
      nodeId: "check",
      taskIntent: "implement",
    });

    expect(resolution.visibleToolIds).toContain("file.read");
    expect(resolution.visibleToolIds).toContain("repo.explore");
    expect(resolution.visibleToolIds).not.toContain("file.apply_patch");
    expect(resolution.visibleToolIds).not.toContain("shell.execute");
  });

  it("uses repo_forensics for code development debug stage", () => {
    const mode = makeMode({
      id: CODE_DEVELOPMENT_MODE_ID,
      nodes: [
        {
          id: "debug",
          template: "check",
          label: "Debug",
          ownerAgentId: "debugger",
          config: {},
        },
      ],
      profiles: [makeProfile(ORA_ROOT_AGENT_ID, "Ora"), makeProfile("debugger", "Debugger")],
    });

    const resolution = resolveVisibleToolsForAgent({
      availableToolIds: DEFAULT_AGENT_MODE_TOOL_IDS,
      toolDescriptors: MVP_TOOLS,
      modeSpec: mode,
      agentId: "debugger",
      profileToolIds: mode.profiles[1]!.toolIds,
      nodeId: "debug",
      taskIntent: "implement",
    });

    expect(resolution.visibleToolIds).toContain("file.read");
    expect(resolution.visibleToolIds).toContain("repo.explore");
    expect(resolution.visibleToolIds).toContain("shell.execute");
    expect(resolution.visibleToolIds).not.toContain("file.apply_patch");
  });

  it("removes nested agent.spawn from resolver defaults", () => {
    const mode = makeMode({
      id: SINGLE_AGENT_MODE_ID,
      nodes: [
        {
          id: "respond",
          template: "respond",
          label: "Respond",
          ownerAgentId: ORA_ROOT_AGENT_ID,
          config: {},
        },
      ],
    });

    const resolution = resolveVisibleToolsForAgent({
      availableToolIds: DEFAULT_AGENT_MODE_TOOL_IDS,
      toolDescriptors: MVP_TOOLS,
      modeSpec: mode,
      agentId: ORA_ROOT_AGENT_ID,
      profileToolIds: mode.profiles[0]!.toolIds,
      nodeId: "respond",
      taskIntent: "implement",
      isNestedAgentSpawn: true,
    });

    expect(resolution.visibleToolIds).not.toContain("agent.spawn");
  });

  it("blocks a mode stage when its declared package capability is unavailable", () => {
    const availableToolIds = DEFAULT_AGENT_MODE_TOOL_IDS.filter((toolId) => toolId !== "package.buildCandidate");
    const mode = makeMode({
      id: ORA_SELF_BUILDER_MODE_ID,
      family: "agent_teams",
      nodes: [
        {
          id: "build",
          template: "build",
          label: "Build",
          ownerAgentId: "builder",
          config: {
            requiredCapabilityGroups: ["repo_read", "repo_explore", "repo_apply_patch", "package_build_candidate"],
          },
        },
      ],
      profiles: [makeProfile(ORA_ROOT_AGENT_ID, "Ora"), makeProfile("builder", "Builder")],
    });

    const resolution = resolveVisibleToolsForAgent({
      availableToolIds,
      toolDescriptors: MVP_TOOLS,
      modeSpec: mode,
      agentId: "builder",
      profileToolIds: mode.profiles[1]!.toolIds,
      nodeId: "build",
      taskIntent: "implement",
    });
    const preflight = resolveModeStageToolPreflight({
      modeSpec: mode,
      agentId: "builder",
      nodeId: "build",
      resolvedToolIds: resolution.visibleToolIds,
      taskIntent: "implement",
    });

    expect(preflight).toMatchObject({
      status: "blocked",
      presetId: "self_builder_build",
    });
    expect(preflight?.missingCapabilities).toContain("package_build_candidate");
  });

  it("resolves child tool bundles from shared presets", () => {
    const bundle = resolveChildToolBundleDefinition({
      bundleId: "builder_write",
      availableToolIds: DEFAULT_AGENT_MODE_TOOL_IDS,
      toolDescriptors: MVP_TOOLS,
      taskIntent: "implement",
    });

    expect(bundle.toolIds).toContain("file.apply_patch");
    expect(bundle.toolIds).toContain("shell.execute");
    expect(bundle.preflight.status).toBe("ready");
    expect(bundle.visibility.decisionSource).toBe("bundle_preset");
  });

  it("degrades builder_write to file.patch when apply_patch is unavailable", () => {
    const bundle = resolveChildToolBundleDefinition({
      bundleId: "builder_write",
      availableToolIds: ["repo.explore", "file.read", "file.list", "file.glob", "file.grep", "file.patch", "shell.execute"],
      toolDescriptors: MVP_TOOLS,
      taskIntent: "implement",
    });

    expect(bundle.preflight.status).toBe("degraded");
    expect(bundle.preflight.missingCapabilities).toContain("repo_apply_patch");
    expect(bundle.preflight.appliedDegradations).toContain("apply_patch_unavailable_fallback_patch");
    expect(bundle.toolIds).toContain("file.patch");
    expect(bundle.toolIds).not.toContain("file.apply_patch");
  });

  it("blocks builder_write when no patch capability is available", () => {
    const bundle = resolveChildToolBundleDefinition({
      bundleId: "builder_write",
      availableToolIds: ["repo.explore", "file.read", "file.list", "file.glob", "file.grep", "file.write"],
      toolDescriptors: MVP_TOOLS,
      taskIntent: "implement",
    });

    expect(bundle.preflight.status).toBe("blocked");
    expect(bundle.preflight.missingCapabilities).toEqual(
      expect.arrayContaining(["repo_apply_patch", "repo_patch"]),
    );
    expect(bundle.preflight.recommendedAlternativePreset).toBe("review_readonly");
  });

  it("degrades repo_forensics when shell.execute is unavailable", () => {
    const bundle = resolveChildToolBundleDefinition({
      bundleId: "repo_forensics",
      availableToolIds: ["repo.explore", "file.read", "file.list", "file.glob", "file.grep", "web.fetch", "web.search"],
      toolDescriptors: MVP_TOOLS,
      taskIntent: "implement",
    });

    expect(bundle.preflight.status).toBe("degraded");
    expect(bundle.preflight.missingCapabilities).toContain("repo_shell_execute");
    expect(bundle.preflight.appliedDegradations).toContain("shell_execute_unavailable_shallow_forensics");
  });

  it("degrades review_readonly to concrete read tools when repo.explore is unavailable", () => {
    const bundle = resolveChildToolBundleDefinition({
      bundleId: "review_readonly",
      availableToolIds: ["file.read", "file.list", "file.glob", "file.grep", "web.fetch"],
      toolDescriptors: MVP_TOOLS,
      taskIntent: "implement",
    });

    expect(bundle.preflight.status).toBe("degraded");
    expect(bundle.preflight.missingCapabilities).toContain("repo_explore");
    expect(bundle.preflight.appliedDegradations).toContain("repo_explore_unavailable_fallback_read");
    expect(bundle.toolIds).toEqual(expect.arrayContaining(["file.read", "file.list", "file.glob", "file.grep"]));
  });

  it("keeps research_readonly launchable on a web-only evidence surface", () => {
    const bundle = resolveChildToolBundleDefinition({
      bundleId: "research_readonly",
      availableToolIds: ["web.fetch", "web.search"],
      toolDescriptors: MVP_TOOLS,
      taskIntent: "implement",
    });

    expect(bundle.preflight.status).toBe("degraded");
    expect(bundle.preflight.missingCapabilities).toEqual(
      expect.arrayContaining(["repo_read", "repo_search", "repo_explore"]),
    );
    expect(bundle.preflight.appliedDegradations).toContain("repo_read_surface_unavailable");
    expect(bundle.toolIds).toEqual(expect.arrayContaining(["web.fetch", "web.search"]));
  });

  it("keeps research_readonly launchable on a repo.explore-only evidence surface", () => {
    const bundle = resolveChildToolBundleDefinition({
      bundleId: "research_readonly",
      availableToolIds: ["repo.explore"],
      toolDescriptors: MVP_TOOLS,
      taskIntent: "implement",
    });

    expect(bundle.preflight.status).toBe("degraded");
    expect(bundle.preflight.appliedDegradations).toEqual([]);
    expect(bundle.toolIds).toEqual(["repo.explore"]);
  });
});
