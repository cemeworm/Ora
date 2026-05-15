import { describe, expect, it } from "vitest";
import type { AgentProfile, SkillDescriptor } from "@cemeworm/shared";
import { buildAgentPromptContext, userClarificationContextPrompt } from "../src/harness/prompt-context.js";

const availableSkills: SkillDescriptor[] = [
  {
    id: "deep-research",
    name: "deep-research",
    description: "Follow the source-backed deep research workflow.",
    path: "skills/deep-research/SKILL.md",
    category: "public",
    enabled: true,
    editable: true,
    allowedPatterns: [],
    tags: [],
  },
  {
    id: "disabled-review",
    name: "disabled-review",
    description: "Disabled review workflow.",
    path: "skills/disabled-review/SKILL.md",
    category: "private",
    enabled: false,
    editable: true,
    allowedPatterns: [],
    tags: [],
  },
];

const profile: AgentProfile = {
  id: "researcher",
  label: "Researcher",
  role: "Gather focused evidence and return concise findings.",
  systemPrompt: "Act as the configured research system agent.",
  modelRef: "openai/gpt-5.2",
  toolPolicyId: "orchestrator_subagent.default_policy",
  toolIds: ["web.search", "mcp.listTools"],
  skillIds: ["deep-research"],
  memoryNamespaces: ["session", "project"],
  budget: {
    maxTokens: 12000,
    maxToolCalls: 12,
    maxRuntimeMs: 120000,
    maxCostUsd: 1,
  },
};

describe("buildAgentPromptContext", () => {
  it("builds deterministic sections from stable prefix to dynamic context", () => {
    const context = buildAgentPromptContext({
      agentId: "researcher",
      profile,
      customPersona: "Custom Agent Persona: research-pro\nSOUL:\nBe rigorous.",
      systemAgentOverride: "System Agent Override: researcher\nRole:\nBe stricter.",
      stageSystem: "You are the research subagent. Return concise findings.",
      workspaceContext: "Ora project workspace context:\n- Root path: /repo",
      clarificationContext: "Resolved clarification:\n- Use staging.",
      memoryContext: "Use long-term memory when relevant.",
      availableSkills,
      toolProtocol: "Workspace tool protocol:\nAvailable tools:\n- web.search",
      skillSnippets: ["Skill instructions here."],
      toolIds: ["web.search", "mcp.listTools", "mcp.call"],
    });

    expect(context.sections.map((section) => section.id)).toEqual([
      "custom_persona",
      "system_agent_override",
      "agent_system_prompt",
      "agent_profile",
      "operating_protocol",
      "tool_protocol",
      "skills_guidance",
      "available_skills",
      "skills",
      "mcp_deferred_tools",
      "workspace_context",
      "stage_instructions",
      "clarification_context",
      "memory_context",
    ]);
    expect(context.stablePrefix).toContain("Custom Agent Persona: research-pro");
    expect(context.stablePrefix).toContain("Ora operating protocol:");
    expect(context.stablePrefix).toContain("Clarify first when missing or ambiguous requirements");
    expect(context.stablePrefix).toContain("Workspace tool protocol:");
    expect(context.stablePrefix).toContain("<available_skills>");
    expect(context.stablePrefix).not.toContain("Ora project workspace context:");
    expect(context.stablePrefix).not.toContain("Resolved clarification:");
    expect(context.system).toContain("Custom Agent Persona: research-pro");
    expect(context.system).toContain("Act as the configured research system agent.");
    expect(context.system).toContain("Ora agent profile: researcher");
    expect(context.system).toContain("Role:\nGather focused evidence and return concise findings.");
    expect(context.system).toContain("Preferred model hint: openai/gpt-5.2");
    expect(context.system).toContain("Memory namespaces: session, project");
    expect(context.system).toContain("Use mode stages or delegation only when the work can be split");
    expect(context.system).toContain("do not rely on natural-language phrase whitelists");
    expect(context.system).toContain("<available_skills>");
    expect(context.system).toContain("<name>deep-research</name>");
    expect(context.system).toContain("<location>skills/deep-research/SKILL.md</location>");
    expect(context.system).toContain("inspect that skill before answering or acting");
    expect(context.system).not.toContain("disabled-review");
    expect(context.system).toContain("Use mcp.listTools or mcp.readResource");
  });

  it("omits empty sections and MCP hints when MCP tools are unavailable", () => {
    const context = buildAgentPromptContext({
      agentId: "solo_agent",
      stageSystem: "You are the solo agent.",
      availableSkills: [availableSkills[1]!],
      toolIds: ["file.read"],
      skillSnippets: ["  "],
    });

    expect(context.sections.map((section) => section.id)).toEqual(["operating_protocol", "skills_guidance", "stage_instructions"]);
    expect(context.stablePrefix).toContain("Ora operating protocol:");
    expect(context.system).toContain("Ora operating protocol:");
    expect(context.system).toContain("You are the solo agent.");
  });

  it("reuses the builder for profile and runtime context", () => {
    const system = buildAgentPromptContext({
      agentId: "researcher",
      profile,
      systemAgentOverride: "System Agent Override: researcher\nSOUL:\nBe skeptical.",
      stageSystem: "You are the researcher.",
      workspaceContext: "Ora project workspace context:\n- Root path: /repo",
      clarificationContext: userClarificationContextPrompt({
        clarifications: { environment: "staging" },
      }),
      memoryContext: "Use relevant long-term memory.",
      skillSnippets: ["Skill instructions here."],
    }).system;

    expect(system).toContain("System Agent Override: researcher");
    expect(system).toContain("Ora agent profile: researcher");
    expect(system).toContain("Ora operating protocol:");
    expect(system).toContain("You are the researcher.");
    expect(system).toContain("Root path: /repo");
    expect(system).toContain("- environment: staging");
    expect(system).toContain("Use relevant long-term memory.");
    expect(system).toContain("Skill instructions here.");
  });

  it("formats user clarification context for runtime prompts", () => {
    expect(userClarificationContextPrompt({
      clarifications: { target: "runtime prompt builder" },
    })).toContain("- target: runtime prompt builder");
  });
});
