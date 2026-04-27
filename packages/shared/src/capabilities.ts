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

export const SkillCategorySchema = z.preprocess(
  (value) => value === "custom" ? "private" : value,
  z.enum(["public", "private"])
);
export type SkillCategory = z.infer<typeof SkillCategorySchema>;

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
});
export type SkillDescriptor = z.infer<typeof SkillDescriptorSchema>;

export const SkillRegistrySchema = z.object({
  skills: z.array(SkillDescriptorSchema),
});
export type SkillRegistry = z.infer<typeof SkillRegistrySchema>;

export const SkillNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Skill names must be lowercase hyphen-case.");
export type SkillName = z.infer<typeof SkillNameSchema>;

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
  enabled: z.boolean().default(true),
});
export type SkillCreateParams = z.infer<typeof SkillCreateParamsSchema>;

export const SkillUpdateParamsSchema = z.object({
  name: SkillNameSchema,
  nextName: SkillNameSchema.optional(),
  content: z.string().min(1),
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

export const MVP_TOOLS: ToolDescriptor[] = [
  { id: "file.read", label: "Read File", description: "Read file contents inside the selected project folder.", category: "file", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "file.list", label: "List Files", description: "List files and directories inside the selected project folder.", category: "file", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "file.glob", label: "Glob Files", description: "Find project files by glob pattern.", category: "file", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "file.grep", label: "Search Files", description: "Search project file contents for a literal pattern.", category: "file", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "file.write", label: "Write File", description: "Write content to a local project file.", category: "file", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "file.patch", label: "Patch File", description: "Replace one exact string in a local project file.", category: "file", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "file.delete", label: "Delete File", description: "Delete a local file.", category: "file", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: false, allowedForProfiles: [] },
  { id: "shell.execute", label: "Execute Command", description: "Run an approved command in the selected project folder.", category: "shell", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "web.fetch", label: "Fetch URL", description: "Fetch content from an HTTP or HTTPS URL.", category: "network", riskLevel: "low_risk", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "web.search", label: "Search Web", description: "Search the web for lightweight research results.", category: "network", riskLevel: "low_risk", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "skills.list", label: "List Skills", description: "List installed Ora skills by name, description, category, and enabled state so an agent can discover relevant skills before answering.", category: "internal", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "skills.get", label: "Read Skill", description: "Read the full instructions for one installed Ora skill by name before applying that skill to the conversation.", category: "internal", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "skills.checkName", label: "Check Skill Name", description: "Check whether a private Ora skill name is available before installing or creating it.", category: "internal", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "skills.create", label: "Create Skill", description: "Create or install a private Ora skill from validated SKILL.md content.", category: "internal", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "skills.update", label: "Update Skill", description: "Update an editable private Ora skill with validated SKILL.md content.", category: "internal", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "skills.setEnabled", label: "Enable Skill", description: "Enable or disable an installed Ora skill.", category: "internal", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "mcp.listTools", label: "List MCP Tools", description: "List tools exposed by configured MCP servers.", category: "mcp", riskLevel: "low_risk", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "mcp.readResource", label: "Read MCP Resource", description: "Read a resource from a configured MCP server.", category: "mcp", riskLevel: "low_risk", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "mcp.call", label: "MCP Tool Call", description: "Invoke a tool on a configured MCP server.", category: "mcp", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "package.list", label: "List Packages", description: "List local Ora version slots and the active package pointer.", category: "package", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: true, allowedForProfiles: [] },
  { id: "package.buildCandidate", label: "Build Candidate Package", description: "Build and verify a candidate Ora package slot from the local source tree.", category: "package", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "package.verify", label: "Verify Package", description: "Verify an existing Ora package slot before promotion.", category: "package", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "package.promote", label: "Promote Package", description: "Promote a verified candidate package slot to active.", category: "package", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "package.switch", label: "Switch Package", description: "Switch the active Ora package slot.", category: "package", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "package.rollback", label: "Rollback Package", description: "Rollback to the previously active Ora package slot.", category: "package", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: true, allowedForProfiles: [] },
  { id: "model.handoff", label: "Model Handoff", description: "Delegate to another model.", category: "model", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: false, allowedForProfiles: [] },
  { id: "message.publish", label: "Publish Message", description: "Publish an event to the runtime message bus.", category: "internal", riskLevel: "low_risk", parameters: {}, requiresApproval: false, implemented: false, allowedForProfiles: [] },
  { id: "shared_state.write", label: "Write Shared State", description: "Write a versioned update to the shared blackboard.", category: "internal", riskLevel: "requires_approval", parameters: {}, requiresApproval: true, implemented: false, allowedForProfiles: [] },
  { id: "export.report", label: "Export Report", description: "Export a run report.", category: "export", riskLevel: "safe", parameters: {}, requiresApproval: false, implemented: false, allowedForProfiles: [] },
];

export const DEFAULT_AGENT_MODE_TOOL_IDS = MVP_TOOLS
  .map((tool) => tool.id);

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
