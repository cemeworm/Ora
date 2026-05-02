import type { AgentProfile, SkillDescriptor, UserTaskInput } from "@cemeworm/shared";

export type AgentPromptSectionId =
  | "custom_persona"
  | "system_agent_override"
  | "agent_system_prompt"
  | "agent_profile"
  | "stage_instructions"
  | "workspace_context"
  | "clarification_context"
  | "memory_context"
  | "task_intent_context"
  | "available_skills"
  | "tool_protocol"
  | "skills"
  | "mcp_deferred_tools";

export interface AgentPromptSection {
  id: AgentPromptSectionId;
  title: string;
  content: string;
}

export interface AgentPromptContextInput {
  agentId: string;
  profile?: AgentProfile;
  customAgentId?: string;
  customPersona?: string;
  systemAgentOverride?: string;
  stageSystem: string;
  workspaceContext?: string;
  clarificationContext?: string;
  memoryContext?: string;
  taskIntentContext?: string;
  availableSkills?: readonly SkillDescriptor[];
  toolProtocol?: string;
  skillSnippets?: string[];
  toolIds?: readonly string[];
}

export interface BuiltAgentPromptContext {
  system: string;
  sections: AgentPromptSection[];
}

export function buildAgentPromptContext(input: AgentPromptContextInput): BuiltAgentPromptContext {
  const sections = [
    promptSection("custom_persona", "Custom Agent Persona", input.customPersona),
    promptSection("system_agent_override", "System Agent Override", input.systemAgentOverride),
    promptSection("agent_system_prompt", "Agent System Prompt", input.profile?.systemPrompt),
    promptSection("agent_profile", "Agent Profile", profileSection(input.agentId, input.profile, input.customAgentId)),
    promptSection("stage_instructions", "Stage Instructions", input.stageSystem),
    promptSection("workspace_context", "Workspace Context", input.workspaceContext),
    promptSection("clarification_context", "Clarification Context", input.clarificationContext),
    promptSection("memory_context", "Memory Context", input.memoryContext),
    promptSection("task_intent_context", "Task Intent", input.taskIntentContext),
    promptSection("available_skills", "Available Skills", availableSkillsSection(input.availableSkills)),
    promptSection("tool_protocol", "Tool Protocol", input.toolProtocol),
    ...skillSections(input.skillSnippets),
    promptSection("mcp_deferred_tools", "MCP / Deferred Tools", mcpDeferredToolsSection(input.toolIds)),
  ].filter((section): section is AgentPromptSection => Boolean(section));

  return {
    sections,
    system: sections.map((section) => section.content).join("\n\n"),
  };
}

export function userClarificationContextPrompt(context: UserTaskInput["context"]): string | undefined {
  const clarifications = context?.clarifications;
  if (!clarifications || typeof clarifications !== "object" || clarifications === null) {
    return undefined;
  }
  const entries = Object.entries(clarifications as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim().length > 0)
    .slice(0, 8)
    .map(([key, value]) => `- ${key}: ${String(value).trim().slice(0, 1000)}`);
  if (entries.length === 0) {
    return undefined;
  }
  return [
    "User-supplied clarification context:",
    ...entries,
    "Treat these clarifications as explicit constraints for the current run. Do not ignore them or replace them with assumptions.",
  ].join("\n");
}

function promptSection(
  id: AgentPromptSectionId,
  title: string,
  content: string | undefined,
): AgentPromptSection | undefined {
  const trimmed = content?.trim();
  if (!trimmed) {
    return undefined;
  }
  return { id, title, content: trimmed };
}

function profileSection(
  agentId: string,
  profile: AgentProfile | undefined,
  customAgentId: string | undefined,
): string | undefined {
  if (!profile) {
    return undefined;
  }

  const binding = customAgentId ?? profile.customAgentId;
  return [
    `Ora agent profile: ${profile.id || agentId}`,
    `Label: ${profile.label}`,
    `Role:\n${profile.role}`,
    profile.modelRef ? `Preferred model hint: ${profile.modelRef}` : undefined,
    binding ? `Custom agent binding: ${binding}` : undefined,
    profile.memoryNamespaces.length > 0 ? `Memory namespaces: ${profile.memoryNamespaces.join(", ")}` : undefined,
  ].filter(Boolean).join("\n");
}

function availableSkillsSection(skills: readonly SkillDescriptor[] | undefined): string | undefined {
  const entries = (skills ?? [])
    .filter((skill) => skill.enabled)
    .map((skill) => [
      "  <skill>",
      `    <name>${escapeXml(skill.name)}</name>`,
      `    <description>${escapeXml(skill.description)}</description>`,
      `    <location>${escapeXml(skill.path ?? skill.category)}</location>`,
      "  </skill>",
    ].join("\n"));
  if (entries.length === 0) {
    return undefined;
  }

  return [
    "<skill_system>",
    "  <usage_rule>When a user request matches an available skill, inspect that skill before answering or acting. If the full instructions are not already present in Skill Instructions, use skills.get with the skill name before applying it. Load supporting files only when needed.</usage_rule>",
    "  <available_skills>",
    entries.join("\n"),
    "  </available_skills>",
    "</skill_system>",
  ].join("\n");
}

function skillSections(snippets: string[] | undefined): AgentPromptSection[] {
  if (!snippets || snippets.length === 0) {
    return [];
  }
  return snippets
    .map((snippet) => snippet.trim())
    .filter(Boolean)
    .map((snippet) => ({
      id: "skills" as const,
      title: "Skill Instructions",
      content: snippet,
    }));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mcpDeferredToolsSection(toolIds: readonly string[] | undefined): string | undefined {
  if (!toolIds?.some((toolId) => toolId.startsWith("mcp."))) {
    return undefined;
  }

  return [
    "MCP discovery is available through the Ora runtime tools.",
    "Use mcp.listTools or mcp.readResource to inspect server capabilities before calling unknown MCP tools.",
    "Use mcp.call only when the server, tool name, and arguments are known from the user's request or discovery results.",
  ].join("\n");
}
