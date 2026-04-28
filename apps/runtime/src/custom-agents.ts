import fs from "node:fs";
import path from "node:path";
import {
  type AgentProfile,
  CustomAgentCheckNameParamsSchema,
  CustomAgentCheckNameResultSchema,
  CustomAgentCreateParamsSchema,
  CustomAgentDeleteParamsSchema,
  CustomAgentDetailSchema,
  CustomAgentGetParamsSchema,
  CustomAgentSummarySchema,
  CustomAgentUpdateParamsSchema,
  type CustomAgentCheckNameResult,
  type CustomAgentCreateParams,
  type CustomAgentDeleteParams,
  type CustomAgentDetail,
  type CustomAgentGetParams,
  type CustomAgentSummary,
  type CustomAgentUpdateParams,
  SystemAgentIdSchema,
  SystemAgentOverrideResetParamsSchema,
  SystemAgentOverrideSchema,
  SystemAgentOverrideUpdateParamsSchema,
  canonicalSystemAgentId,
  legacySystemAgentIdsFor,
  type SystemAgentOverride,
  type SystemAgentOverrideResetParams,
  type SystemAgentOverrideUpdateParams,
} from "@ora/shared";

interface PersistedCustomAgentConfig {
  name: string;
  description?: string;
  model?: string;
  tool_groups?: string[];
  tool_ids?: string[];
  skill_ids?: string[];
  created_at: number;
  updated_at: number;
}

interface PersistedSystemAgentConfig {
  agent_id: string;
  label?: string;
  role?: string;
  model_ref?: string;
  tool_ids?: string[];
  skill_ids?: string[];
  created_at: number;
  updated_at: number;
}

export class CustomAgentFileStore {
  constructor(
    private readonly rootDir: string,
    private readonly clock: () => number = Date.now,
  ) {}

  list(): CustomAgentSummary[] {
    fs.mkdirSync(this.rootDir, { recursive: true });

    const agents = fs.readdirSync(this.rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        try {
          return [this.readAgent(entry.name)];
        } catch {
          return [];
        }
      })
      .map((agent) => CustomAgentSummarySchema.parse({
        name: agent.name,
        description: agent.description,
        model: agent.model,
        toolGroups: agent.toolGroups,
        toolIds: agent.toolIds,
        skillIds: agent.skillIds,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      }));

    return agents.sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name));
  }

  get(params: CustomAgentGetParams | unknown): CustomAgentDetail {
    const parsed = CustomAgentGetParamsSchema.parse(params);
    return this.readAgent(normalizeAgentName(parsed.name));
  }

  create(params: CustomAgentCreateParams | unknown): CustomAgentDetail {
    const parsed = CustomAgentCreateParamsSchema.parse(params);
    const name = normalizeAgentName(parsed.name);
    const agentDir = this.agentDir(name);
    if (fs.existsSync(agentDir)) {
      throw new Error(`Custom agent '${name}' already exists.`);
    }

    const now = this.clock();
    const detail = CustomAgentDetailSchema.parse({
      name,
      description: parsed.description,
      model: parsed.model,
      toolGroups: parsed.toolGroups,
      toolIds: parsed.toolIds,
      skillIds: parsed.skillIds,
      soul: parsed.soul,
      createdAt: now,
      updatedAt: now,
    });

    this.writeAgent(detail);
    return detail;
  }

  update(params: CustomAgentUpdateParams | unknown): CustomAgentDetail {
    const parsed = CustomAgentUpdateParamsSchema.parse(params);
    const existing = this.get({ name: parsed.name });
    const detail = CustomAgentDetailSchema.parse({
      ...existing,
      description: parsed.description ?? existing.description,
      model: parsed.model === null ? undefined : parsed.model ?? existing.model,
      toolGroups: parsed.toolGroups === null ? undefined : parsed.toolGroups ?? existing.toolGroups,
      toolIds: parsed.toolIds === null ? [] : parsed.toolIds ?? existing.toolIds,
      skillIds: parsed.skillIds === null ? [] : parsed.skillIds ?? existing.skillIds,
      soul: parsed.soul ?? existing.soul,
      updatedAt: this.clock(),
    });

    this.writeAgent(detail);
    return detail;
  }

  delete(params: CustomAgentDeleteParams | unknown): { deleted: true; name: string } {
    const parsed = CustomAgentDeleteParamsSchema.parse(params);
    const name = normalizeAgentName(parsed.name);
    const agentDir = this.agentDir(name);
    if (!fs.existsSync(agentDir)) {
      throw new Error(`Custom agent '${name}' not found.`);
    }

    fs.rmSync(agentDir, { recursive: true, force: true });
    return { deleted: true, name };
  }

  checkName(params: unknown): CustomAgentCheckNameResult {
    const parsed = CustomAgentCheckNameParamsSchema.parse(params);
    const name = normalizeAgentName(parsed.name);
    return CustomAgentCheckNameResultSchema.parse({
      available: !fs.existsSync(this.agentDir(name)),
      name,
    });
  }

  personaOverlay(agentId: string | undefined): string | undefined {
    if (!agentId) {
      return undefined;
    }

    const agent = this.get({ name: agentId });
    const sections = [
      `Custom Agent Persona: ${agent.name}`,
      agent.description.trim() ? `Description:\n${agent.description.trim()}` : "",
      agent.soul.trim() ? `SOUL:\n${agent.soul.trim()}` : "",
      agent.model ? `Preferred model hint: ${agent.model}` : "",
      agent.toolGroups && agent.toolGroups.length > 0 ? `Preferred tool groups: ${agent.toolGroups.join(", ")}` : "",
    ].filter(Boolean);

    return sections.length > 0 ? sections.join("\n\n") : undefined;
  }

  private readAgent(name: string): CustomAgentDetail {
    const agentDir = this.agentDir(name);
    const configPath = path.join(agentDir, "config.yaml");
    const soulPath = path.join(agentDir, "SOUL.md");

    if (!fs.existsSync(configPath)) {
      throw new Error(`Custom agent '${name}' is missing config.yaml.`);
    }

    const rawConfig = fs.readFileSync(configPath, "utf8").trim();
    const decoded = rawConfig ? JSON.parse(rawConfig) as PersistedCustomAgentConfig : undefined;
    if (!decoded) {
      throw new Error(`Custom agent '${name}' has an empty config.yaml.`);
    }

    const soul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, "utf8") : "";
    return CustomAgentDetailSchema.parse({
      name: decoded.name,
      description: decoded.description ?? "",
      model: decoded.model,
      toolGroups: decoded.tool_groups,
      toolIds: decoded.tool_ids ?? [],
      skillIds: decoded.skill_ids ?? [],
      soul,
      createdAt: decoded.created_at,
      updatedAt: decoded.updated_at,
    });
  }

  private writeAgent(agent: CustomAgentDetail): void {
    const agentDir = this.agentDir(agent.name);
    fs.mkdirSync(agentDir, { recursive: true });

    const config: PersistedCustomAgentConfig = {
      name: agent.name,
      description: agent.description,
      model: agent.model,
      tool_groups: agent.toolGroups,
      tool_ids: agent.toolIds,
      skill_ids: agent.skillIds,
      created_at: agent.createdAt,
      updated_at: agent.updatedAt,
    };

    fs.writeFileSync(path.join(agentDir, "config.yaml"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(agentDir, "SOUL.md"), agent.soul, "utf8");
  }

  private agentDir(name: string): string {
    return path.join(this.rootDir, name);
  }
}

function normalizeAgentName(name: string): string {
  return CustomAgentCheckNameResultSchema.shape.name.parse(name.trim().toLowerCase());
}

export class SystemAgentOverrideFileStore {
  constructor(
    private readonly rootDir: string,
    private readonly clock: () => number = Date.now,
  ) {}

  list(): SystemAgentOverride[] {
    fs.mkdirSync(this.rootDir, { recursive: true });
    const overrides = new Map<string, SystemAgentOverride>();
    for (const entry of fs.readdirSync(this.rootDir, { withFileTypes: true })) {
      try {
        const parsed = entry.isDirectory()
          ? this.readDirectoryOverride(entry.name)
          : entry.isFile() && entry.name.endsWith(".json")
            ? this.readLegacyJsonOverride(entry.name)
            : undefined;
        if (!parsed) {
          continue;
        }
        const agentId = canonicalSystemAgentId(parsed.agentId);
        if (!overrides.has(agentId) || entry.name === agentId || entry.name === `${agentId}.json`) {
          overrides.set(agentId, { ...parsed, agentId });
        }
      } catch {
        continue;
      }
    }
    return [...overrides.values()].sort((left, right) => left.agentId.localeCompare(right.agentId));
  }

  get(agentId: string): SystemAgentOverride | undefined {
    const parsedAgentId = canonicalSystemAgentId(SystemAgentIdSchema.parse(agentId));
    const candidates = [parsedAgentId, ...legacySystemAgentIdsFor(parsedAgentId)];
    for (const candidate of candidates) {
      const directoryOverride = this.readDirectoryOverrideIfExists(candidate);
      if (directoryOverride) {
        return { ...directoryOverride, agentId: parsedAgentId };
      }
    }
    for (const candidate of candidates) {
      const legacyOverride = this.readLegacyJsonOverrideIfExists(candidate);
      if (legacyOverride) {
        return { ...legacyOverride, agentId: parsedAgentId };
      }
    }
    return undefined;
  }

  update(params: SystemAgentOverrideUpdateParams | unknown): SystemAgentOverride {
    const parsed = SystemAgentOverrideUpdateParamsSchema.parse(params);
    const agentId = canonicalSystemAgentId(parsed.agentId);
    const existing = this.get(agentId);
    const now = this.clock();
    const next = SystemAgentOverrideSchema.parse({
      agentId,
      label: parsed.label ?? existing?.label,
      role: parsed.role ?? existing?.role,
      modelRef: parsed.modelRef === null ? undefined : parsed.modelRef ?? existing?.modelRef,
      toolIds: parsed.toolIds === null ? undefined : parsed.toolIds ?? existing?.toolIds,
      skillIds: parsed.skillIds === null ? undefined : parsed.skillIds ?? existing?.skillIds,
      soul: parsed.soul ?? existing?.soul ?? "",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.writeOverride(next);
    return next;
  }

  reset(params: SystemAgentOverrideResetParams | unknown): { reset: true; agentId: string } {
    const parsed = SystemAgentOverrideResetParamsSchema.parse(params);
    const agentId = canonicalSystemAgentId(parsed.agentId);
    fs.rmSync(this.overrideDir(agentId), { recursive: true, force: true });
    fs.rmSync(this.legacyOverridePath(agentId), { force: true });
    for (const legacyId of legacySystemAgentIdsFor(agentId)) {
      fs.rmSync(this.overrideDir(legacyId), { recursive: true, force: true });
      fs.rmSync(this.legacyOverridePath(legacyId), { force: true });
    }
    return { reset: true, agentId };
  }

  apply(profile: AgentProfile): AgentProfile {
    if (profile.customAgentId) {
      return { ...profile };
    }
    const override = this.get(profile.id);
    if (!override) {
      return { ...profile };
    }
    return {
      ...profile,
      label: override.label ?? profile.label,
      role: override.role ?? profile.role,
      systemPrompt: override.soul.trim() ? override.soul : profile.systemPrompt,
      modelRef: override.modelRef ?? profile.modelRef,
      toolIds: override.toolIds ?? profile.toolIds,
      skillIds: override.skillIds ?? profile.skillIds,
    };
  }

  overlay(agentId: string | undefined): string | undefined {
    if (!agentId) {
      return undefined;
    }
    const override = this.get(agentId);
    if (!override) {
      return undefined;
    }
    const sections = [
      `System Agent Override: ${override.agentId}`,
      override.label ? `Label:\n${override.label}` : "",
      override.role ? `Role:\n${override.role}` : "",
      override.modelRef ? `Preferred model hint: ${override.modelRef}` : "",
      override.soul.trim() ? `SOUL:\n${override.soul.trim()}` : "",
    ].filter(Boolean);
    return sections.length > 1 ? sections.join("\n\n") : undefined;
  }

  private writeOverride(override: SystemAgentOverride): void {
    const overrideDir = this.overrideDir(override.agentId);
    fs.mkdirSync(overrideDir, { recursive: true });

    const config: PersistedSystemAgentConfig = {
      agent_id: override.agentId,
      label: override.label,
      role: override.role,
      model_ref: override.modelRef,
      tool_ids: override.toolIds,
      skill_ids: override.skillIds,
      created_at: override.createdAt,
      updated_at: override.updatedAt,
    };

    fs.writeFileSync(path.join(overrideDir, "config.yaml"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(overrideDir, "SOUL.md"), override.soul, "utf8");
  }

  private readDirectoryOverrideIfExists(agentId: string): SystemAgentOverride | undefined {
    const overrideDir = this.overrideDir(agentId);
    if (!fs.existsSync(path.join(overrideDir, "config.yaml"))) {
      return undefined;
    }
    return this.readDirectoryOverride(agentId);
  }

  private readDirectoryOverride(agentId: string): SystemAgentOverride {
    const overrideDir = this.overrideDir(agentId);
    const rawConfig = fs.readFileSync(path.join(overrideDir, "config.yaml"), "utf8").trim();
    const decoded = rawConfig ? JSON.parse(rawConfig) as PersistedSystemAgentConfig : undefined;
    if (!decoded) {
      throw new Error(`System agent override '${agentId}' has an empty config.yaml.`);
    }
    const soulPath = path.join(overrideDir, "SOUL.md");
    return SystemAgentOverrideSchema.parse({
      agentId: decoded.agent_id,
      label: decoded.label,
      role: decoded.role,
      modelRef: decoded.model_ref,
      toolIds: decoded.tool_ids,
      skillIds: decoded.skill_ids,
      soul: fs.existsSync(soulPath) ? fs.readFileSync(soulPath, "utf8") : "",
      createdAt: decoded.created_at,
      updatedAt: decoded.updated_at,
    });
  }

  private readLegacyJsonOverrideIfExists(agentId: string): SystemAgentOverride | undefined {
    const overridePath = this.legacyOverridePath(agentId);
    if (!fs.existsSync(overridePath)) {
      return undefined;
    }
    return this.readLegacyJsonOverride(`${SystemAgentIdSchema.parse(agentId)}.json`);
  }

  private readLegacyJsonOverride(fileName: string): SystemAgentOverride {
    const value = JSON.parse(fs.readFileSync(path.join(this.rootDir, fileName), "utf8"));
    return SystemAgentOverrideSchema.parse(value);
  }

  private overrideDir(agentId: string): string {
    return path.join(this.rootDir, SystemAgentIdSchema.parse(agentId));
  }

  private legacyOverridePath(agentId: string): string {
    return path.join(this.rootDir, `${SystemAgentIdSchema.parse(agentId)}.json`);
  }
}
