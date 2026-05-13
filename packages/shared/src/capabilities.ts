import { z } from "zod";
import { CoordinationPatternSchema } from "./primitives.js";
import { ProviderConfigSchema } from "./providers.js";

export const DEFAULT_WEB_TOOL_IDS = ["web.fetch", "web.search"] as const;
export type DefaultWebToolId = typeof DEFAULT_WEB_TOOL_IDS[number];
export const DEFAULT_SKILL_TOOL_IDS = ["skills.list", "skills.get", "skills.checkName", "skills.create", "skills.update", "skills.setEnabled"] as const;

export function withDefaultWebToolIds(toolIds: readonly string[] = [], options: { disabled?: boolean } = {}): string[] {
  const withSkillTools = [...new Set([...toolIds, ...DEFAULT_SKILL_TOOL_IDS])];
  if (options.disabled) {
    return withSkillTools.filter((toolId) => !DEFAULT_WEB_TOOL_IDS.includes(toolId as DefaultWebToolId));
  }
  return [...new Set([...withSkillTools, ...DEFAULT_WEB_TOOL_IDS])];
}

export const SearchProviderIdSchema = z.enum(["brave", "tavily", "serpapi", "kagi", "duckduckgo", "mcp"]);
export type SearchProviderId = z.infer<typeof SearchProviderIdSchema>;

export const SearchProviderConfigSchema = z.object({
  id: SearchProviderIdSchema.optional(),
  apiKeyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(),
  maxResults: z.number().int().positive().max(10).default(5),
  timeoutMs: z.number().int().positive().max(30_000).default(8_000),
  mcpServerId: z.string().min(1).optional(),
  mcpToolName: z.string().min(1).optional(),
});
export type SearchProviderConfig = z.infer<typeof SearchProviderConfigSchema>;

export const WebSearchResultSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  snippet: z.string().optional(),
  source: z.string().min(1).optional(),
});
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;

export const WebSearchResponseSchema = z.object({
  query: z.string().min(1),
  providerId: SearchProviderIdSchema,
  results: z.array(WebSearchResultSchema),
});
export type WebSearchResponse = z.infer<typeof WebSearchResponseSchema>;

// ---------------------------------------------------------------------------
// Tool Descriptor Schemas
// ---------------------------------------------------------------------------

export const ToolDescriptorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(["file", "shell", "network", "mcp", "model", "export", "internal", "package"]),
  riskLevel: z.enum(["safe", "low_risk", "requires_approval"]),
  parameters: z.record(z.unknown()).default({}),
  promptSnippet: z.string().min(1).optional(),
  promptGuidelines: z.array(z.string().min(1)).optional(),
  executionMetadata: z.record(z.unknown()).optional(),
  requiresApproval: z.boolean().default(false),
  implemented: z.boolean().default(true),
  allowedForProfiles: z.array(z.string().min(1)).default([]),
});
export type ToolDescriptor = z.infer<typeof ToolDescriptorSchema>;

export const ToolRegistrySchema = z.object({
  tools: z.array(ToolDescriptorSchema),
  defaultPolicyId: z.string().min(1),
});
export type ToolRegistry = z.infer<typeof ToolRegistrySchema>;

// ---------------------------------------------------------------------------
// Permission Profile Schemas
// ---------------------------------------------------------------------------

export const ToolPermissionEnum = z.enum(["allow", "deny", "ask"]);
export type ToolPermission = z.infer<typeof ToolPermissionEnum>;

export const PermissionProfileRuleSchema = z.object({
  category: ToolDescriptorSchema.shape.category,
  riskLevel: ToolDescriptorSchema.shape.riskLevel,
  permission: ToolPermissionEnum,
});
export type PermissionProfileRule = z.infer<typeof PermissionProfileRuleSchema>;

export const PermissionProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  rules: z.array(PermissionProfileRuleSchema),
});
export type PermissionProfile = z.infer<typeof PermissionProfileSchema>;

export type ToolCategory = ToolDescriptor["category"];
export type ToolRiskLevel = ToolDescriptor["riskLevel"];

export function resolveToolPermission(
  profile: PermissionProfile,
  category: ToolCategory,
  riskLevel: ToolRiskLevel,
): ToolPermission {
  for (const rule of profile.rules) {
    if (rule.category === category && rule.riskLevel === riskLevel) {
      return rule.permission;
    }
  }
  // No matching rule: default to ask (conservative)
  return "ask";
}

export const BUILTIN_PERMISSION_PROFILES: PermissionProfile[] = [
  {
    id: "runtime.full_trust",
    label: "Full Trust",
    description: "Allow all tools without approval. Equivalent to requiresApproval: false for every tool.",
    rules: [
      { category: "file", riskLevel: "safe", permission: "allow" },
      { category: "file", riskLevel: "low_risk", permission: "allow" },
      { category: "file", riskLevel: "requires_approval", permission: "allow" },
      { category: "shell", riskLevel: "safe", permission: "allow" },
      { category: "shell", riskLevel: "low_risk", permission: "allow" },
      { category: "shell", riskLevel: "requires_approval", permission: "allow" },
      { category: "network", riskLevel: "safe", permission: "allow" },
      { category: "network", riskLevel: "low_risk", permission: "allow" },
      { category: "network", riskLevel: "requires_approval", permission: "allow" },
      { category: "mcp", riskLevel: "safe", permission: "allow" },
      { category: "mcp", riskLevel: "low_risk", permission: "allow" },
      { category: "mcp", riskLevel: "requires_approval", permission: "allow" },
      { category: "model", riskLevel: "safe", permission: "allow" },
      { category: "model", riskLevel: "low_risk", permission: "allow" },
      { category: "model", riskLevel: "requires_approval", permission: "allow" },
      { category: "export", riskLevel: "safe", permission: "allow" },
      { category: "export", riskLevel: "low_risk", permission: "allow" },
      { category: "export", riskLevel: "requires_approval", permission: "allow" },
      { category: "internal", riskLevel: "safe", permission: "allow" },
      { category: "internal", riskLevel: "low_risk", permission: "allow" },
      { category: "internal", riskLevel: "requires_approval", permission: "allow" },
      { category: "package", riskLevel: "safe", permission: "allow" },
      { category: "package", riskLevel: "low_risk", permission: "allow" },
      { category: "package", riskLevel: "requires_approval", permission: "allow" },
    ],
  },
  {
    id: "runtime.default_policy",
    label: "Default Policy",
    description: "Safe and low-risk tools auto-allowed. Requires-approval tools need user confirmation.",
    rules: [
      { category: "file", riskLevel: "safe", permission: "allow" },
      { category: "file", riskLevel: "low_risk", permission: "allow" },
      { category: "file", riskLevel: "requires_approval", permission: "ask" },
      { category: "shell", riskLevel: "safe", permission: "allow" },
      { category: "shell", riskLevel: "low_risk", permission: "allow" },
      { category: "shell", riskLevel: "requires_approval", permission: "ask" },
      { category: "network", riskLevel: "safe", permission: "allow" },
      { category: "network", riskLevel: "low_risk", permission: "allow" },
      { category: "network", riskLevel: "requires_approval", permission: "ask" },
      { category: "mcp", riskLevel: "safe", permission: "allow" },
      { category: "mcp", riskLevel: "low_risk", permission: "allow" },
      { category: "mcp", riskLevel: "requires_approval", permission: "ask" },
      { category: "model", riskLevel: "safe", permission: "allow" },
      { category: "model", riskLevel: "low_risk", permission: "allow" },
      { category: "model", riskLevel: "requires_approval", permission: "ask" },
      { category: "export", riskLevel: "safe", permission: "allow" },
      { category: "export", riskLevel: "low_risk", permission: "allow" },
      { category: "export", riskLevel: "requires_approval", permission: "ask" },
      { category: "internal", riskLevel: "safe", permission: "allow" },
      { category: "internal", riskLevel: "low_risk", permission: "allow" },
      { category: "internal", riskLevel: "requires_approval", permission: "ask" },
      { category: "package", riskLevel: "safe", permission: "allow" },
      { category: "package", riskLevel: "low_risk", permission: "allow" },
      { category: "package", riskLevel: "requires_approval", permission: "ask" },
    ],
  },
  {
    id: "runtime.readonly",
    label: "Read Only",
    description: "Only allow read-type tools (file read/list/glob/grep, web fetch/search). All write/execute tools are denied.",
    rules: [
      // file read tools: allow
      { category: "file", riskLevel: "safe", permission: "allow" },
      { category: "file", riskLevel: "low_risk", permission: "deny" },
      { category: "file", riskLevel: "requires_approval", permission: "deny" },
      // everything else: deny
      { category: "shell", riskLevel: "safe", permission: "deny" },
      { category: "shell", riskLevel: "low_risk", permission: "deny" },
      { category: "shell", riskLevel: "requires_approval", permission: "deny" },
      { category: "network", riskLevel: "safe", permission: "deny" },
      { category: "network", riskLevel: "low_risk", permission: "allow" },
      { category: "network", riskLevel: "requires_approval", permission: "deny" },
      { category: "mcp", riskLevel: "safe", permission: "deny" },
      { category: "mcp", riskLevel: "low_risk", permission: "deny" },
      { category: "mcp", riskLevel: "requires_approval", permission: "deny" },
      { category: "model", riskLevel: "safe", permission: "deny" },
      { category: "model", riskLevel: "low_risk", permission: "deny" },
      { category: "model", riskLevel: "requires_approval", permission: "deny" },
      { category: "export", riskLevel: "safe", permission: "deny" },
      { category: "export", riskLevel: "low_risk", permission: "deny" },
      { category: "export", riskLevel: "requires_approval", permission: "deny" },
      { category: "internal", riskLevel: "safe", permission: "allow" },
      { category: "internal", riskLevel: "low_risk", permission: "deny" },
      { category: "internal", riskLevel: "requires_approval", permission: "deny" },
      { category: "package", riskLevel: "safe", permission: "deny" },
      { category: "package", riskLevel: "low_risk", permission: "deny" },
      { category: "package", riskLevel: "requires_approval", permission: "deny" },
    ],
  },
];

export function getPermissionProfile(profileId: string): PermissionProfile | undefined {
  return BUILTIN_PERMISSION_PROFILES.find((p) => p.id === profileId);
}

export const SkillCategorySchema = z.preprocess(
  (value) => value === "custom" ? "private" : value,
  z.enum(["public", "private"])
);
export type SkillCategory = z.infer<typeof SkillCategorySchema>;

export const SkillNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Skill names must be lowercase hyphen-case.");
export type SkillName = z.infer<typeof SkillNameSchema>;

export const SkillPackageFileKindSchema = z.enum(["script", "agent", "template", "asset", "reference", "other"]);
export type SkillPackageFileKind = z.infer<typeof SkillPackageFileKindSchema>;

export const SkillPackageFileDescriptorSchema = z.object({
  path: z.string().min(1),
  kind: SkillPackageFileKindSchema.default("other"),
  size: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
  executable: z.boolean().default(false),
});
export type SkillPackageFileDescriptor = z.infer<typeof SkillPackageFileDescriptorSchema>;

export const SkillPackageFileContentSchema = SkillPackageFileDescriptorSchema.extend({
  skillName: SkillNameSchema,
  content: z.string(),
});
export type SkillPackageFileContent = z.infer<typeof SkillPackageFileContentSchema>;

export const SkillDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  promptSnippet: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  category: SkillCategorySchema.default("public"),
  enabled: z.boolean().default(true),
  editable: z.boolean().default(false),
  license: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
  allowedPatterns: z.array(CoordinationPatternSchema).default([]),
  tags: z.array(z.string().min(1)).default([]),
  files: z.array(SkillPackageFileDescriptorSchema).optional(),
});
export type SkillDescriptor = z.infer<typeof SkillDescriptorSchema>;

export const SkillRegistrySchema = z.object({
  skills: z.array(SkillDescriptorSchema),
});
export type SkillRegistry = z.infer<typeof SkillRegistrySchema>;

export const SkillDetailSchema = SkillDescriptorSchema.extend({
  content: z.string().min(1),
});
export type SkillDetail = z.infer<typeof SkillDetailSchema>;

export const SkillListParamsSchema = z.object({
  category: SkillCategorySchema.optional(),
  enabledOnly: z.boolean().optional(),
  query: z.string().optional(),
  pattern: CoordinationPatternSchema.optional(),
}).default({});
export type SkillListParams = z.infer<typeof SkillListParamsSchema>;

export const SkillGetParamsSchema = z.object({
  name: SkillNameSchema,
});
export type SkillGetParams = z.infer<typeof SkillGetParamsSchema>;

export const SkillCreateParamsSchema = z.object({
  name: SkillNameSchema,
  description: z.string().default(""),
  content: z.string().optional(),
  files: z.array(z.object({
    path: z.string().min(1),
    content: z.string(),
    executable: z.boolean().optional(),
  })).optional(),
  enabled: z.boolean().default(true),
});
export type SkillCreateParams = z.infer<typeof SkillCreateParamsSchema>;

export const SkillUpdateParamsSchema = z.object({
  name: SkillNameSchema,
  nextName: SkillNameSchema.optional(),
  content: z.string().min(1),
  files: z.array(z.object({
    path: z.string().min(1),
    content: z.string(),
    executable: z.boolean().optional(),
  })).optional(),
});
export type SkillUpdateParams = z.infer<typeof SkillUpdateParamsSchema>;

export const SkillDeleteParamsSchema = z.object({
  name: SkillNameSchema,
});
export type SkillDeleteParams = z.infer<typeof SkillDeleteParamsSchema>;

export const SkillCheckNameParamsSchema = z.object({
  name: z.string().min(1),
});
export type SkillCheckNameParams = z.infer<typeof SkillCheckNameParamsSchema>;

export const SkillCheckNameResultSchema = z.object({
  available: z.boolean(),
  name: SkillNameSchema,
});
export type SkillCheckNameResult = z.infer<typeof SkillCheckNameResultSchema>;

export const SkillSetEnabledParamsSchema = z.object({
  name: SkillNameSchema,
  enabled: z.boolean(),
});
export type SkillSetEnabledParams = z.infer<typeof SkillSetEnabledParamsSchema>;

export const SkillFileGetParamsSchema = z.object({
  skillName: SkillNameSchema,
  path: z.string().min(1),
});
export type SkillFileGetParams = z.infer<typeof SkillFileGetParamsSchema>;

export const SkillFileUpsertParamsSchema = z.object({
  skillName: SkillNameSchema,
  path: z.string().min(1),
  content: z.string(),
  executable: z.boolean().optional(),
});
export type SkillFileUpsertParams = z.infer<typeof SkillFileUpsertParamsSchema>;

export const SkillFileDeleteParamsSchema = SkillFileGetParamsSchema;
export type SkillFileDeleteParams = z.infer<typeof SkillFileDeleteParamsSchema>;

// ---------------------------------------------------------------------------
// Custom Agent Schemas
// ---------------------------------------------------------------------------

export const CustomAgentNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9-]+$/, "Custom agent names must contain only letters, digits, and hyphens.");
export type CustomAgentName = z.infer<typeof CustomAgentNameSchema>;

export const CustomAgentSummarySchema = z.object({
  name: CustomAgentNameSchema,
  description: z.string().default(""),
  model: z.string().min(1).optional(),
  toolGroups: z.array(z.string().min(1)).optional(),
  toolIds: z.array(z.string().min(1)).default([]),
  skillIds: z.array(z.string().min(1)).default([]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type CustomAgentSummary = z.infer<typeof CustomAgentSummarySchema>;

export const CustomAgentDetailSchema = CustomAgentSummarySchema.extend({
  soul: z.string().default(""),
});
export type CustomAgentDetail = z.infer<typeof CustomAgentDetailSchema>;

export const CustomAgentCreateParamsSchema = z.object({
  name: CustomAgentNameSchema,
  description: z.string().default(""),
  model: z.string().min(1).optional(),
  toolGroups: z.array(z.string().min(1)).optional(),
  toolIds: z.array(z.string().min(1)).default([]),
  skillIds: z.array(z.string().min(1)).default([]),
  soul: z.string().default(""),
});
export type CustomAgentCreateParams = z.infer<typeof CustomAgentCreateParamsSchema>;

export const CustomAgentUpdateParamsSchema = z.object({
  name: CustomAgentNameSchema,
  description: z.string().optional(),
  model: z.string().min(1).nullable().optional(),
  toolGroups: z.array(z.string().min(1)).nullable().optional(),
  toolIds: z.array(z.string().min(1)).nullable().optional(),
  skillIds: z.array(z.string().min(1)).nullable().optional(),
  soul: z.string().optional(),
});
export type CustomAgentUpdateParams = z.infer<typeof CustomAgentUpdateParamsSchema>;

export const CustomAgentGetParamsSchema = z.object({
  name: CustomAgentNameSchema,
});
export type CustomAgentGetParams = z.infer<typeof CustomAgentGetParamsSchema>;

export const CustomAgentDeleteParamsSchema = z.object({
  name: CustomAgentNameSchema,
});
export type CustomAgentDeleteParams = z.infer<typeof CustomAgentDeleteParamsSchema>;

export const CustomAgentCheckNameParamsSchema = z.object({
  name: z.string().min(1),
});
export type CustomAgentCheckNameParams = z.infer<typeof CustomAgentCheckNameParamsSchema>;

export const CustomAgentCheckNameResultSchema = z.object({
  available: z.boolean(),
  name: CustomAgentNameSchema,
});
export type CustomAgentCheckNameResult = z.infer<typeof CustomAgentCheckNameResultSchema>;

export const CustomAgentDraftMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});
export type CustomAgentDraftMessage = z.infer<typeof CustomAgentDraftMessageSchema>;

export const CustomAgentGeneratedDraftSchema = z.object({
  name: z.string().default(""),
  description: z.string().default(""),
  model: z.string().min(1).optional(),
  toolGroups: z.array(z.string().min(1)).default([]),
  toolIds: z.array(z.string().min(1)).default([]),
  skillIds: z.array(z.string().min(1)).default([]),
  soul: z.string().default(""),
});
export type CustomAgentGeneratedDraft = z.infer<typeof CustomAgentGeneratedDraftSchema>;

export const CustomAgentGenerateDraftParamsSchema = z.object({
  messages: z.array(CustomAgentDraftMessageSchema).min(1),
  partialDraft: CustomAgentGeneratedDraftSchema.partial().optional(),
  providerId: z.string().min(1).optional(),
  providerConfig: ProviderConfigSchema.optional(),
  modelRef: z.string().min(1).optional(),
});
export type CustomAgentGenerateDraftParams = z.infer<typeof CustomAgentGenerateDraftParamsSchema>;

const CustomAgentDraftIssueSchema = z.object({
  field: z.enum(["name", "description", "model", "toolGroups", "soul", "general"]).default("general"),
  message: z.string().min(1),
});
export type CustomAgentDraftIssue = z.infer<typeof CustomAgentDraftIssueSchema>;

export const CustomAgentGenerateDraftResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("needs_input"),
    assistantMessage: z.string().min(1),
    draft: CustomAgentGeneratedDraftSchema.partial().optional(),
    issues: z.array(CustomAgentDraftIssueSchema).default([]),
  }),
  z.object({
    status: z.literal("draft_ready"),
    assistantMessage: z.string().min(1),
    draft: CustomAgentGeneratedDraftSchema,
    issues: z.array(CustomAgentDraftIssueSchema).default([]),
  }),
]);
export type CustomAgentGenerateDraftResult = z.infer<typeof CustomAgentGenerateDraftResultSchema>;

export const SystemAgentIdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/, "System agent ids must contain only letters, digits, hyphens, and underscores.");
export type SystemAgentId = z.infer<typeof SystemAgentIdSchema>;

export const SYSTEM_AGENT_ID_ALIASES: Record<string, string> = {
  solo_agent: "ora",
  lead_agent: "orchestrator",
  upgrade_lead: "orchestrator",
  seed_agent: "orchestrator",
  research_subagent: "researcher",
  research_agent: "researcher",
  investigator: "researcher",
  review_subagent: "reviewer",
  checker: "reviewer",
  critic_agent: "reviewer",
  code_builder: "builder",
  builder_lead: "orchestrator",
  draft_architect: "builder",
  quality_reviewer: "reviewer",
};

export function canonicalSystemAgentId(agentId: string): string {
  return SYSTEM_AGENT_ID_ALIASES[agentId] ?? agentId;
}

export function legacySystemAgentIdsFor(agentId: string): string[] {
  const canonical = canonicalSystemAgentId(agentId);
  return Object.entries(SYSTEM_AGENT_ID_ALIASES)
    .filter(([, target]) => target === canonical)
    .map(([legacy]) => legacy);
}

export const AgentModeUsageSchema = z.object({
  modeId: z.string().min(1),
  modeLabel: z.string().min(1),
  systemPreset: z.boolean().default(false),
  profileId: z.string().min(1).optional(),
  profileLabel: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  nodeLabel: z.string().min(1).optional(),
});
export type AgentModeUsage = z.infer<typeof AgentModeUsageSchema>;

export const SystemAgentOverrideSchema = z.object({
  agentId: SystemAgentIdSchema,
  label: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  modelRef: z.string().min(1).optional(),
  toolIds: z.array(z.string().min(1)).optional(),
  skillIds: z.array(z.string().min(1)).optional(),
  soul: z.string().default(""),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type SystemAgentOverride = z.infer<typeof SystemAgentOverrideSchema>;

export const SystemAgentOverrideUpdateParamsSchema = z.object({
  agentId: SystemAgentIdSchema,
  label: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  modelRef: z.string().min(1).nullable().optional(),
  toolIds: z.array(z.string().min(1)).nullable().optional(),
  skillIds: z.array(z.string().min(1)).nullable().optional(),
  soul: z.string().optional(),
});
export type SystemAgentOverrideUpdateParams = z.infer<typeof SystemAgentOverrideUpdateParamsSchema>;

export const SystemAgentOverrideResetParamsSchema = z.object({
  agentId: SystemAgentIdSchema,
});
export type SystemAgentOverrideResetParams = z.infer<typeof SystemAgentOverrideResetParamsSchema>;

export const SystemAgentCatalogItemSchema = z.object({
  source: z.literal("system"),
  id: SystemAgentIdSchema,
  label: z.string().min(1),
  role: z.string().min(1),
  modelRef: z.string().min(1).optional(),
  toolPolicyId: z.string().min(1),
  toolIds: z.array(z.string().min(1)).default([]),
  skillIds: z.array(z.string().min(1)).default([]),
  memoryNamespaces: z.array(z.string().min(1)).default([]),
  soul: z.string().default(""),
  overridden: z.boolean().default(false),
  override: SystemAgentOverrideSchema.optional(),
  usages: z.array(AgentModeUsageSchema).default([]),
});
export type SystemAgentCatalogItem = z.infer<typeof SystemAgentCatalogItemSchema>;

export const CustomAgentCatalogItemSchema = CustomAgentSummarySchema.extend({
  source: z.literal("custom"),
  usages: z.array(AgentModeUsageSchema).default([]),
});
export type CustomAgentCatalogItem = z.infer<typeof CustomAgentCatalogItemSchema>;

export const AgentCatalogResultSchema = z.object({
  systemAgents: z.array(SystemAgentCatalogItemSchema),
  customAgents: z.array(CustomAgentCatalogItemSchema),
});
export type AgentCatalogResult = z.infer<typeof AgentCatalogResultSchema>;

// ---------------------------------------------------------------------------
// Default Definitions
// ---------------------------------------------------------------------------

const workspacePathParameter = {
  type: "string",
  description: "Path inside the selected project folder. Parent-directory escapes are rejected; absolute paths are allowed only when they still resolve inside the selected project.",
};

const positiveLimitParameter = (description: string) => ({
  type: "number",
  minimum: 1,
  description,
});

const fileReadParameters = {
  type: "object",
  properties: {
    path: workspacePathParameter,
  },
  required: ["path"],
  additionalProperties: false,
};

const fileListParameters = {
  type: "object",
  properties: {
    path: {
      ...workspacePathParameter,
      description: "Directory path inside the selected project folder. Defaults to the workspace root.",
    },
    limit: positiveLimitParameter("Maximum number of directory entries to return."),
  },
  additionalProperties: false,
};

const fileGlobParameters = {
  type: "object",
  properties: {
    pattern: {
      type: "string",
      description: "Glob pattern matched against workspace-relative file paths, for example **/*.ts. When path points to a subdirectory, bare patterns like *.ts are treated as scoped to that path while explicit path patterns keep their original semantics.",
    },
    path: {
      ...workspacePathParameter,
      description: "Directory path to search from. Defaults to the workspace root.",
    },
    limit: positiveLimitParameter("Maximum number of matching file paths to return."),
  },
  required: ["pattern"],
  additionalProperties: false,
};

const fileGrepParameters = {
  type: "object",
  properties: {
    pattern: {
      type: "string",
      description: "Literal text to search for in workspace files.",
    },
    include: {
      type: "string",
      description: "Optional glob pattern limiting searched files, for example **/*.ts. When path points to a subdirectory, bare patterns like *.ts are treated as scoped to that path while explicit path patterns keep their original semantics.",
    },
    path: {
      ...workspacePathParameter,
      description: "Directory path to search from. Defaults to the workspace root.",
    },
    caseSensitive: {
      type: "boolean",
      description: "Whether matching is case sensitive. Defaults to true.",
    },
    limit: positiveLimitParameter("Maximum number of matching lines to return."),
  },
  required: ["pattern"],
  additionalProperties: false,
};

const fileWriteParameters = {
  type: "object",
  properties: {
    path: workspacePathParameter,
    content: {
      type: "string",
      description: "Full file content to write. Existing content is overwritten.",
    },
  },
  required: ["path", "content"],
  additionalProperties: false,
};

const filePatchEditParameters = {
  type: "object",
  properties: {
    oldText: {
      type: "string",
      description: "Exact text to replace. It must appear exactly once in the original file.",
    },
    newText: {
      type: "string",
      description: "Replacement text.",
    },
  },
  required: ["oldText", "newText"],
  additionalProperties: false,
};

const filePatchParameters = {
  type: "object",
  properties: {
    path: workspacePathParameter,
    edits: {
      type: "array",
      minItems: 1,
      items: filePatchEditParameters,
      description: "One or more exact replacements. All oldText matches are resolved against the original file before writing.",
    },
    search: {
      type: "string",
      description: "Legacy single replacement search text. Prefer edits[].oldText for new calls.",
    },
    replace: {
      type: "string",
      description: "Legacy single replacement text. Prefer edits[].newText for new calls.",
    },
  },
  required: ["path"],
  anyOf: [
    { required: ["edits"] },
    { required: ["search", "replace"] },
  ],
  additionalProperties: false,
};

const fileApplyPatchParameters = {
  type: "object",
  properties: {
    patch: {
      type: "string",
      description: "Unified diff text compatible with git diff style output. May include one or more file hunks rooted inside the workspace.",
    },
  },
  required: ["patch"],
  additionalProperties: false,
};

const webFetchParameters = {
  type: "object",
  properties: {
    url: {
      type: "string",
      format: "uri",
      description: "HTTP or HTTPS URL to fetch.",
    },
    maxBytes: positiveLimitParameter("Maximum response text bytes to return."),
  },
  required: ["url"],
  additionalProperties: false,
};

const webSearchParameters = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search query.",
    },
    limit: {
      type: "number",
      minimum: 1,
      maximum: 10,
      description: "Maximum number of search results to return.",
    },
  },
  required: ["query"],
  additionalProperties: false,
};

const documentExtractParameters = {
  type: "object",
  properties: {
    path: {
      ...workspacePathParameter,
      description: "PDF path inside the selected project folder. Provide exactly one of path or url.",
    },
    url: {
      type: "string",
      format: "uri",
      description: "HTTP or HTTPS PDF URL. Provide exactly one of path or url.",
    },
    format: {
      type: "string",
      enum: ["text", "markdown"],
      description: "Output text format. Defaults to text.",
    },
    maxBytes: positiveLimitParameter("Maximum extracted text bytes to return."),
  },
  oneOf: [
    { required: ["path"] },
    { required: ["url"] },
  ],
  additionalProperties: false,
};

const skillNameParameter = {
  type: "string",
  description: "Lowercase hyphen-case skill name, for example my-custom-skill.",
  pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
};

const skillsListParameters = {
  type: "object",
  properties: {
    category: { type: "string", enum: ["public", "private"], description: "Optional skill category filter." },
    enabledOnly: { type: "boolean", description: "When true, return only enabled skills." },
    query: { type: "string", description: "Optional search query for name or description." },
  },
  additionalProperties: false,
};

const skillsGetParameters = {
  type: "object",
  properties: {
    name: { ...skillNameParameter, description: "Exact name of the skill to read." },
  },
  required: ["name"],
  additionalProperties: false,
};

const skillsCheckNameParameters = {
  type: "object",
  properties: {
    name: { ...skillNameParameter, description: "Skill name to check for availability." },
  },
  required: ["name"],
  additionalProperties: false,
};

const skillsCreateParameters = {
  type: "object",
  properties: {
    name: skillNameParameter,
    description: { type: "string", description: "Short description of what the skill provides." },
    content: { type: "string", description: "Full SKILL.md markdown content." },
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the skill package root." },
          content: { type: "string", description: "File content." },
          executable: { type: "boolean", description: "Whether the file should be executable." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      description: "Optional supporting files to include in the skill package.",
    },
    enabled: { type: "boolean", description: "Whether the skill is enabled after creation. Defaults to true." },
  },
  required: ["name"],
  additionalProperties: false,
};

const skillsUpdateParameters = {
  type: "object",
  properties: {
    name: { ...skillNameParameter, description: "Name of the skill to update." },
    nextName: { ...skillNameParameter, description: "New name if renaming the skill." },
    description: { type: "string", description: "Updated skill description." },
    content: { type: "string", description: "Updated SKILL.md content." },
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the skill package root." },
          content: { type: "string", description: "File content." },
          executable: { type: "boolean" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      description: "Replacement file list (omitting a file deletes it).",
    },
  },
  required: ["name"],
  additionalProperties: false,
};

const skillsSetEnabledParameters = {
  type: "object",
  properties: {
    name: { ...skillNameParameter, description: "Skill name to enable or disable." },
    enabled: { type: "boolean", description: "true to enable, false to disable." },
  },
  required: ["name", "enabled"],
  additionalProperties: false,
};

const mcpServerParameter = {
  type: "string",
  description: "MCP server id as configured in .ora/mcp.json.",
};

const mcpListToolsParameters = {
  type: "object",
  properties: {
    server: { ...mcpServerParameter, description: "Optional server id. Lists tools from all servers when omitted." },
  },
  additionalProperties: false,
};

const mcpReadResourceParameters = {
  type: "object",
  properties: {
    server: { ...mcpServerParameter, description: "MCP server id." },
    uri: { type: "string", description: "Resource URI, for example docs://intro." },
  },
  required: ["server", "uri"],
  additionalProperties: false,
};

const mcpCallParameters = {
  type: "object",
  properties: {
    server: mcpServerParameter,
    name: { type: "string", description: "Tool name as returned by mcp.listTools." },
    arguments: { type: "object", description: "Tool arguments as a JSON object.", additionalProperties: true },
  },
  required: ["server", "name"],
  additionalProperties: false,
};

const packageIdParameter = {
  type: "string",
  description: "Package ID or slot identifier.",
};

const packageListParameters = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const packageSlotParameters = {
  type: "object",
  properties: {
    id: { ...packageIdParameter, description: "Package slot id." },
  },
  required: ["id"],
  additionalProperties: false,
};

const modesListParameters = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const modesDraftParameters = {
  type: "object",
  properties: {
    description: { type: "string", description: "Description of the desired mode coordination pattern." },
    messages: { type: "array", items: { type: "object" }, description: "Conversation messages to derive the mode from." },
  },
  additionalProperties: false,
};

const modesRefineParameters = {
  type: "object",
  properties: {
    draftId: { type: "string", description: "ID of the existing mode draft to refine." },
    feedback: { type: "string", description: "User feedback or additional requirements." },
  },
  required: ["draftId"],
  additionalProperties: false,
};

const modesValidateParameters = {
  type: "object",
  properties: {
    draftId: { type: "string", description: "ID of the draft to validate." },
  },
  required: ["draftId"],
  additionalProperties: false,
};

const modesApplyDraftParameters = {
  type: "object",
  properties: {
    draftId: { type: "string", description: "ID of the validated draft to apply." },
  },
  required: ["draftId"],
  additionalProperties: false,
};

const selfIterationCandidateIdParameter = {
  type: "string",
  description: "Self-Iteration candidate id.",
};

const selfIterationListParameters = {
  type: "object",
  properties: {
    projectId: { type: "string", description: "Optional project filter." },
    kind: { type: "string", description: "Optional candidate kind filter." },
    status: { type: "string", enum: ["reviewed", "applied", "rejected"], description: "Optional status filter." },
    limit: positiveLimitParameter("Maximum number of candidates to return."),
  },
  additionalProperties: false,
};

const selfIterationGetParameters = {
  type: "object",
  properties: {
    id: selfIterationCandidateIdParameter,
  },
  required: ["id"],
  additionalProperties: false,
};

const selfIterationScanParameters = {
  type: "object",
  properties: {
    projectId: { type: "string", description: "Optional project filter." },
    kinds: { type: "array", items: { type: "string" }, description: "Optional candidate kinds to scan for." },
  },
  additionalProperties: false,
};

const selfIterationEvaluateParameters = {
  type: "object",
  properties: {
    id: selfIterationCandidateIdParameter,
  },
  required: ["id"],
  additionalProperties: false,
};

const selfIterationApplyParameters = {
  type: "object",
  properties: {
    id: selfIterationCandidateIdParameter,
  },
  required: ["id"],
  additionalProperties: false,
};

export const MVP_TOOLS: ToolDescriptor[] = [
  { id: "file.read", label: "Read File", description: "Read file contents inside the selected project folder.", category: "file", riskLevel: "safe", parameters: fileReadParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "file.list", label: "List Files", description: "List files and directories inside the selected project folder.", category: "file", riskLevel: "safe", parameters: fileListParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "file.glob", label: "Glob Files", description: "Find project files by glob pattern.", category: "file", riskLevel: "safe", parameters: fileGlobParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "file.grep", label: "Search Files", description: "Search project file contents for a literal pattern.", category: "file", riskLevel: "safe", parameters: fileGrepParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "file.write", label: "Write File", description: "Write content to a local project file.", category: "file", riskLevel: "requires_approval", parameters: fileWriteParameters, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "file.patch", label: "Patch File", description: "Replace exact strings in a local project file.", category: "file", riskLevel: "requires_approval", parameters: filePatchParameters, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "file.apply_patch", label: "Apply Patch", description: "Apply a unified diff patch to one or more local project files.", category: "file", riskLevel: "requires_approval", parameters: fileApplyPatchParameters, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "file.delete", label: "Delete File", description: "Delete a local file.", category: "file", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: false, allowedForProfiles: [] },
  {
    id: "shell.execute",
    label: "Execute Shell Command",
    description: "Run a shell command in the selected project folder with timeout and output limits. Risky commands require approval according to the active permission profile.",
    category: "shell",
    riskLevel: "requires_approval",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to run from the workspace root.",
        },
        timeoutMs: {
          type: "number",
          description: "Optional timeout in milliseconds, capped by the active mode's shell timeout limit.",
        },
        login: {
          type: "boolean",
          description: "When true, run the command through a login shell when the selected shell supports it.",
        },
        shell: {
          type: "string",
          description: "Optional shell executable path or command name, for example /bin/zsh or pwsh.",
        },
      },
      required: ["command"],
      additionalProperties: true,
    },
    promptSnippet: "Use shell.execute for ordinary project shell commands such as sed, rg pipelines, package scripts, and test commands. Commands run from the workspace root and may require approval depending on the active permission profile.",
    promptGuidelines: [
      "Pass the full command as args.command; shell syntax such as pipes and quotes is supported.",
      "Do not use shell commands when a narrower Ora file or web tool is a better fit.",
    ],
    requiresApproval: true,
    implemented: true,
    allowedForProfiles: [],
  },
  { id: "web.fetch", label: "Fetch URL", description: "Fetch content from an HTTP or HTTPS URL.", category: "network", riskLevel: "low_risk", parameters: webFetchParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "web.search", label: "Search Web", description: "Search the web for lightweight research results.", category: "network", riskLevel: "low_risk", parameters: webSearchParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "document.extract", label: "Extract Document Text", description: "Extract readable text from supported documents such as PDF files or PDF URLs.", category: "file", riskLevel: "safe", parameters: documentExtractParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  {
    id: "user.clarify",
    label: "Ask User Clarification",
    description: "Ask the user a focused clarification question during execution, with optional suggested answers. Use only when missing information materially affects the next action or final answer.",
    category: "internal",
    riskLevel: "safe",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Stable short key for the missing variable being clarified.",
        },
        question: {
          type: "string",
          description: "One concise user-facing clarification question in the user's language.",
        },
        options: {
          type: "array",
          maxItems: 6,
          description: "Optional suggested answers the user can choose instead of typing freely.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Stable option id." },
              label: { type: "string", description: "Short user-facing option label." },
              value: { type: "string", description: "Answer value to resume with; defaults to label when omitted." },
              description: { type: "string", description: "Optional detail shown with the option." },
            },
            required: ["id", "label"],
            additionalProperties: false,
          },
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
    requiresApproval: false,
    implemented: true,
    allowedForProfiles: [],
  },
  { id: "skills.list", label: "List Skills", description: "List installed Ora skill packages by name, description, category, enabled state, and supporting file metadata so an agent can discover relevant skills before answering.", category: "internal", riskLevel: "safe", parameters: skillsListParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "skills.get", label: "Read Skill", description: "Read the full SKILL.md instructions and package file metadata for one installed Ora skill before applying that skill to the conversation.", category: "internal", riskLevel: "safe", parameters: skillsGetParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "skills.checkName", label: "Check Skill Name", description: "Check whether an Ora skill name is available before installing or creating it.", category: "internal", riskLevel: "safe", parameters: skillsCheckNameParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "skills.create", label: "Create Skill", description: "Create or install a private Ora skill package from validated SKILL.md content plus optional supporting files.", category: "internal", riskLevel: "requires_approval", parameters: skillsCreateParameters, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "skills.update", label: "Update Skill", description: "Update an editable Ora skill package with validated SKILL.md content while preserving or replacing supporting files.", category: "internal", riskLevel: "requires_approval", parameters: skillsUpdateParameters, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "skills.setEnabled", label: "Enable Skill", description: "Enable or disable an installed Ora skill.", category: "internal", riskLevel: "requires_approval", parameters: skillsSetEnabledParameters, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "mcp.listTools", label: "List MCP Tools", description: "List tools exposed by configured MCP servers.", category: "mcp", riskLevel: "low_risk", parameters: mcpListToolsParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "mcp.readResource", label: "Read MCP Resource", description: "Read a resource from a configured MCP server.", category: "mcp", riskLevel: "low_risk", parameters: mcpReadResourceParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "mcp.call", label: "MCP Tool Call", description: "Invoke a tool on a configured MCP server.", category: "mcp", riskLevel: "requires_approval", parameters: mcpCallParameters, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "package.list", label: "List Packages", description: "List local Ora version slots and the active package pointer.", category: "package", riskLevel: "safe", parameters: packageListParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "package.buildCandidate", label: "Build Candidate Package", description: "Build and verify a candidate Ora package slot from the local source tree.", category: "package", riskLevel: "requires_approval", parameters: packageSlotParameters, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "package.verify", label: "Verify Package", description: "Verify an existing Ora package slot before promotion.", category: "package", riskLevel: "requires_approval", parameters: packageSlotParameters, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "package.promote", label: "Promote Package", description: "Promote a verified candidate package slot to active.", category: "package", riskLevel: "requires_approval", parameters: packageSlotParameters, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "package.switch", label: "Switch Package", description: "Switch the active Ora package slot.", category: "package", riskLevel: "requires_approval", parameters: packageSlotParameters, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "package.rollback", label: "Rollback Package", description: "Rollback to the previously active Ora package slot.", category: "package", riskLevel: "requires_approval", parameters: packageSlotParameters, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "modes.list", label: "List Modes", description: "List all installed coordination modes (Mode specs) visible to the user.", category: "internal", riskLevel: "safe", parameters: modesListParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "modes.generateDraft", label: "Generate Mode Draft", description: "Generate a mode draft from conversation messages describing the desired coordination pattern, agents, and capabilities.", category: "internal", riskLevel: "safe", parameters: modesDraftParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "modes.refineDraft", label: "Refine Mode Draft", description: "Refine an existing mode draft based on user feedback or additional requirements.", category: "internal", riskLevel: "safe", parameters: modesRefineParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "modes.validate", label: "Validate Mode Draft", description: "Validate a mode draft for correctness and completeness before applying.", category: "internal", riskLevel: "safe", parameters: modesValidateParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "modes.applyDraft", label: "Apply Mode Draft", description: "Apply a validated mode draft, creating the mode spec and optional agent drafts.", category: "internal", riskLevel: "requires_approval", parameters: modesApplyDraftParameters, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "selfIteration.list", label: "List Self-Iteration Candidates", description: "List reviewed Self-Iteration candidates by project, kind, status, or limit so an agent can inspect pending improvements.", category: "internal", riskLevel: "safe", parameters: selfIterationListParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "selfIteration.get", label: "Get Self-Iteration Candidate", description: "Read one Self-Iteration candidate, including evidence, risk, evaluation metadata, and proposed change details.", category: "internal", riskLevel: "safe", parameters: selfIterationGetParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "selfIteration.scan", label: "Scan for Self-Iteration Candidates", description: "Run a bounded Self-Iteration scan over existing feedback, evaluations, runs, and insights without applying prompt, mode, or skill changes.", category: "internal", riskLevel: "safe", parameters: selfIterationScanParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "selfIteration.evaluate", label: "Evaluate Self-Iteration Candidate", description: "Evaluate one Self-Iteration candidate through Evaluation Studio and attach pass/fail plus before/after score evidence for review.", category: "internal", riskLevel: "safe", parameters: selfIterationEvaluateParameters, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "selfIteration.apply", label: "Apply Self-Iteration Candidate", description: "Apply a reviewed Self-Iteration candidate only after explicit user approval; prompt, mode, and skill changes remain approval-gated.", category: "internal", riskLevel: "requires_approval", parameters: selfIterationApplyParameters, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "automations.list", label: "List Scheduled Tasks", description: "List Ora scheduled tasks, including active and optionally paused entries, so an agent can inspect existing automation before changing it.", category: "internal", riskLevel: "safe", parameters: { type: "object", properties: { includePaused: { type: "boolean", description: "Whether paused scheduled tasks should be included. Defaults to true." } }, additionalProperties: false }, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "automations.get", label: "Get Scheduled Task", description: "Read one Ora scheduled task by id, including schedule, target run config, status, and recent run history.", category: "internal", riskLevel: "safe", parameters: { type: "object", properties: { id: { type: "string", description: "Scheduled task id." } }, required: ["id"], additionalProperties: false }, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "automations.previewSchedule", label: "Preview Scheduled Task", description: "Preview future occurrences for an Ora scheduled task schedule before creating or updating it.", category: "internal", riskLevel: "safe", parameters: { type: "object", properties: { schedule: { type: "object", description: "AutomationSchedule object, using once or RRULE shape." }, from: { type: "number", description: "Optional millisecond timestamp to preview from." }, limit: { type: "number", description: "Maximum occurrences to return, up to 20." } }, required: ["schedule"], additionalProperties: false }, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "automations.create", label: "Create Scheduled Task", description: "Create an Ora scheduled task that will run an agent prompt on the configured schedule after user approval.", category: "internal", riskLevel: "requires_approval", parameters: { type: "object", properties: { title: { type: "string" }, prompt: { type: "string" }, schedule: { type: "object" }, status: { type: "string", enum: ["active", "paused"] }, projectId: { type: "string" }, modeId: { type: "string" }, modeSelection: { type: "string", enum: ["manual", "auto"] }, providerId: { type: "string" }, modelRef: { type: "string" }, customAgentId: { type: "string" }, skillIds: { type: "array", items: { type: "string" } }, toolIds: { type: "array", items: { type: "string" } }, taskIntent: { type: "string", enum: ["chat", "plan", "implement"] }, runConfig: { type: "object" } }, required: ["title", "prompt", "schedule"], additionalProperties: true }, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "automations.update", label: "Update Scheduled Task", description: "Update an existing Ora scheduled task after user approval.", category: "internal", riskLevel: "requires_approval", parameters: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, prompt: { type: "string" }, schedule: { type: "object" }, status: { type: "string", enum: ["active", "paused"] } }, required: ["id"], additionalProperties: true }, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "automations.pause", label: "Pause Scheduled Task", description: "Pause an existing Ora scheduled task after user approval.", category: "internal", riskLevel: "requires_approval", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false }, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "automations.resume", label: "Resume Scheduled Task", description: "Resume an existing Ora scheduled task after user approval.", category: "internal", riskLevel: "requires_approval", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false }, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "automations.delete", label: "Delete Scheduled Task", description: "Delete an Ora scheduled task after user approval. Running scheduled tasks cannot be deleted until the run finishes.", category: "internal", riskLevel: "requires_approval", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false }, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "automations.runNow", label: "Run Scheduled Task Now", description: "Immediately start one run for an existing Ora scheduled task after user approval and record the run in task history.", category: "internal", riskLevel: "requires_approval", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false }, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  {
    id: "plan.update",
    label: "Update Plan",
    description: "Create or update the current task plan list. Provide the full plan array with each step's status: pending, in_progress, or completed. Use short step descriptions. Always maintain exactly one in_progress step until all are completed.",
    category: "internal",
    riskLevel: "safe",
    parameters: {
      type: "object",
      properties: {
        explanation: { type: "string", description: "Optional one-line explanation of the plan change." },
        plan: {
          type: "array",
          items: {
            type: "object",
            properties: {
              step: { type: "string", description: "Short step description." },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            },
            required: ["step", "status"],
          },
        },
      },
      required: ["plan"],
    },
    requiresApproval: false,
    implemented: true,
    allowedForProfiles: [],
  },
  {
    id: "agent.spawn",
    label: "Spawn Agent",
    description: "Spawn a sub-agent to handle a delegated task. The sub-agent runs autonomously with its own tool loop and returns a result. Use this to delegate complex, multi-step subtasks without consuming the parent agent's context window.",
    category: "model",
    riskLevel: "low_risk",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "A short (3-5 word) description of the task." },
        prompt: { type: "string", description: "The task for the sub-agent to perform. Be specific and self-contained — the sub-agent cannot see the parent's conversation." },
        agent_type: { type: "string", description: "Optional agent profile id to use for the sub-agent. Defaults to the root agent profile." },
        run_in_background: { type: "boolean", description: "When true, spawn the sub-agent asynchronously and return immediately. The sub-agent's result will be available as context in the next turn. Use for parallelizable subtasks." },
        inherit_context: { type: "boolean", description: "When true, the sub-agent inherits the parent's system prompt and task context. Use when the sub-agent needs the full context to understand the task." },
        system_prompt: { type: "string", description: "Custom system prompt for the sub-agent. Overrides the default agent profile's system prompt." },
        tool_ids: { type: "array", items: { type: "string" }, description: "Custom tool IDs for the sub-agent. If not provided, uses the default agent profile's tools." },
      },
      required: ["description", "prompt"],
      additionalProperties: false,
    },
    promptSnippet: "Use agent.spawn to delegate complex subtasks to a fresh sub-agent. The sub-agent gets its own context window and tool loop. Write self-contained prompts — the sub-agent cannot see your conversation.",
    promptGuidelines: [
      "Delegate only substantial, self-contained subtasks that benefit from a fresh context window.",
      "Write prompts that include all necessary context — file paths, line numbers, error messages.",
      "State what \"done\" looks like for the sub-agent.",
      "Do not spawn agents for trivial lookups that a single tool call can handle.",
    ],
    requiresApproval: false,
    implemented: true,
    allowedForProfiles: [],
  },
  {
    id: "message.send",
    label: "Send Message to Agent",
    description: "Send a message to a running or completed sub-agent. The message will be delivered when the agent is next invoked. Use this to continue work with an agent that already has context loaded.",
    category: "internal",
    riskLevel: "low_risk",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "The agent ID to send the message to." },
        message: { type: "string", description: "The message content. Be specific — include file paths, line numbers, and clear instructions." },
      },
      required: ["to", "message"],
      additionalProperties: false,
    },
    promptSnippet: "Use message.send to continue work with a sub-agent that already has context loaded. Prefer continuing an existing agent over spawning a fresh one when the agent already has relevant files in its context.",
    promptGuidelines: [
      "Continue agents whose work is relevant to the next task — they have useful context already loaded.",
      "Spawn fresh agents for completely unrelated tasks.",
      "Reference what the agent did previously in your message.",
    ],
    requiresApproval: false,
    implemented: true,
    allowedForProfiles: [],
  },
  { id: "model.handoff", label: "Model Handoff", description: "Delegate to another model.", category: "model", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: false, allowedForProfiles: [] },
  { id: "message.publish", label: "Publish Message", description: "Publish an event to the runtime message bus.", category: "internal", riskLevel: "low_risk", parameters: {}, requiresApproval: false, implemented: false, allowedForProfiles: [] },
  { id: "shared_state.write", label: "Write Shared State", description: "Write a versioned update to the shared blackboard.", category: "internal", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: false, allowedForProfiles: [] },
  { id: "export.report", label: "Export Report", description: "Export a run report.", category: "export", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: false, allowedForProfiles: [] },
];

export const DEFAULT_AGENT_MODE_TOOL_IDS = MVP_TOOLS
  .map((tool) => tool.id);

// ---------------------------------------------------------------------------
// Tool Registry Builder
// ---------------------------------------------------------------------------

export class ToolRegistryBuilder {
  private readonly tools: Map<string, ToolDescriptor> = new Map();

  static fromDefaults(): ToolRegistryBuilder {
    const builder = new ToolRegistryBuilder();
    for (const tool of MVP_TOOLS) {
      builder.tools.set(tool.id, tool);
    }
    return builder;
  }

  register(descriptor: ToolDescriptor): void {
    const validated = ToolDescriptorSchema.parse(descriptor);
    this.tools.set(validated.id, validated);
  }

  unregister(toolId: string): boolean {
    return this.tools.delete(toolId);
  }

  get(toolId: string): ToolDescriptor | undefined {
    return this.tools.get(toolId);
  }

  list(): ToolDescriptor[] {
    return Array.from(this.tools.values());
  }

  snapshot(): ToolRegistry {
    return ToolRegistrySchema.parse({
      tools: this.list(),
      defaultPolicyId: "runtime.default_policy",
    });
  }
}

export const MVP_SKILLS: SkillDescriptor[] = [
  {
    id: "long-task-protocol",
    enabled: true,
    name: "Long Task Protocol",
    description: "Keep complex work resumable with a task journal, checkpoints, and strict verification gates.",
    category: "public",
    editable: false,
    promptSnippet: "Use a task journal for complex multi-step work and keep verification evidence explicit.",
    path: "skills/long-task-protocol/SKILL.md",
    allowedPatterns: [
      "orchestrator_subagent",
      "agent_teams",
      "message_bus",
      "shared_state"
    ],
    tags: ["planning", "verification", "resumable"]
  }
];
