import { describe, expect, it } from "vitest";
import type { AgentProfile } from "@ora/shared";
import { buildAgentPromptContext, userClarificationContextPrompt } from "../src/harness/prompt-context.js";

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
  it("builds deterministic sections around stage instructions", () => {
    const context = buildAgentPromptContext({
      agentId: "researcher",
      profile,
      customPersona: "Custom Agent Persona: research-pro\nSOUL:\nBe rigorous.",
      systemAgentOverride: "System Agent Override: researcher\nRole:\nBe stricter.",
      stageSystem: "You are the research subagent. Return concise findings.",
      workspaceContext: "Ora project workspace context:\n- Root path: /repo",
      clarificationContext: "Resolved clarification:\n- Use staging.",
      memoryContext: "Use long-term memory when relevant.",
      toolProtocol: "Workspace tool protocol:\nAvailable tools:\n- web.search",
      skillSnippets: ["Skill instructions here."],
      toolIds: ["web.search", "mcp.listTools", "mcp.call"],
    });

    expect(context.sections.map((section) => section.id)).toEqual([
      "custom_persona",
      "system_agent_override",
      "agent_system_prompt",
      "agent_profile",
      "stage_instructions",
      "workspace_context",
      "clarification_context",
      "memory_context",
      "tool_protocol",
      "skills",
      "mcp_deferred_tools",
    ]);
    expect(context.system).toContain("Custom Agent Persona: research-pro");
    expect(context.system).toContain("Act as the configured research system agent.");
    expect(context.system).toContain("Ora agent profile: researcher");
    expect(context.system).toContain("Role:\nGather focused evidence and return concise findings.");
    expect(context.system).toContain("Preferred model hint: openai/gpt-5.2");
    expect(context.system).toContain("Memory namespaces: session, project");
    expect(context.system).toContain("Use mcp.listTools or mcp.readResource");
  });

  it("omits empty sections and MCP hints when MCP tools are unavailable", () => {
    const context = buildAgentPromptContext({
      agentId: "solo_agent",
      stageSystem: "You are the solo agent.",
      toolIds: ["file.read"],
      skillSnippets: ["  "],
    });

    expect(context.sections.map((section) => section.id)).toEqual(["stage_instructions"]);
    expect(context.system).toBe("You are the solo agent.");
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
