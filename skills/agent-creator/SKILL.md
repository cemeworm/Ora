---
name: agent-creator
description: Create, draft, update, delete, catalog, and configure Ora agents. Use this skill whenever the user asks to make an agent, generate an agent persona, manage custom or built-in agents, assign tools or skillIds to an agent, inspect agent usage, or connect an existing skill to an agent.
---

# Agent Creator

Use this skill to manage Ora agents with the existing agent and skill APIs. Keep it separate from `skill-creator`: this skill configures agents; `skill-creator` creates or edits skill packages.

## Workflow

1. Clarify the agent's job only when the purpose, output style, or required tools are materially unclear.
2. Inspect existing agents with `agents.list` or `agents.catalog` before creating or renaming anything.
3. Check candidate names with `agents.checkName`; use lowercase hyphen-case for custom agents.
4. For natural-language requests, call `agents.generateDraft` to produce a draft instead of hand-writing one from scratch.
5. Review the draft for:
   - a concise description;
   - concrete SOUL instructions;
   - only tools or tool groups the user actually needs;
   - `skillIds` that refer to installed skills.
6. Create or update the agent with `agents.create` or `agents.update`.
7. Use `agents.get` or `agents.catalog` to verify the saved agent.

## Skill Binding

Agents can list skills in `skillIds`, but this does not create those skills. Before binding a skill:

- Use `skills.list` to find installed candidates.
- Use `skills.get` when the exact skill behavior matters.
- If the needed skill is missing or needs new instructions, switch to `skill-creator` or tell the user that a separate skill package must be created first.

Runtime behavior uses run-config intersection: an agent's `skillIds` only take effect when the run config also includes those same skill IDs and the skills are installed and enabled. Do not promise that adding a skillId to an agent alone makes that skill active in every run.

## Built-In Agents

Use `agents.catalog` before changing built-in agents. Built-in agents are adjusted through system overrides, not custom-agent creation:

- Use `agents.updateSystemOverride` when the user wants to tune an existing built-in role.
- Use `agents.resetSystemOverride` when the user wants to remove that tuning.
- Do not create a custom agent with a name that collides with a built-in system agent.

## Output

After management actions, summarize:

- agent name;
- what changed;
- tools/tool groups;
- skillIds and whether each required skill is installed;
- any run-config requirement the user must remember.
