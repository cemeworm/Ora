---
name: mode-creator
description: >
  Create new Modes (coordination patterns) or modify and optimize existing Modes.
  Trigger when the user wants to set up multi-agent coordination, create a generate-verify
  workflow, configure an orchestrator that delegates to subagents, build an agent team,
  design an event-driven pipeline, set up shared-state collaboration, or configure any
  agent coordination topology. Also trigger for mode refinement, optimization, or
  troubleshooting requests. Use even when the user describes a workflow that sounds like
  it needs multiple agents working together, even if they don't explicitly say "mode."
---

# Mode Creator

A skill for creating and refining Ora coordination modes through natural conversation.

In Ora, a **mode** defines how multiple agents collaborate on a task — the topology, roles, capabilities, and runtime behavior. Modes are the core abstraction for multi-agent coordination.

## Process Overview

The mode creation process has 5 stages. You decide which stage to enter based on the conversation context — the user may already have a clear plan, or they may need guidance from scratch.

1. **Capture Intent** — Understand what the user wants to achieve
2. **Design Interview** — Fill in design gaps through structured questions
3. **Generate Draft** — Call `modes.generateDraft` to produce a candidate
4. **Review & Refine** — Iterate with the user using `modes.validate` and `modes.refineDraft`
5. **Apply** — Persist the mode with `modes.applyDraft` (requires user approval)

Jump to whichever stage makes sense. If the user provides enough detail upfront, skip straight to Stage 3. If they say "improve this mode," start at Stage 4.

---

## Stage 1: Capture Intent

Your goal is to understand the coordination problem, not to design the solution yet.

1. **Identify the goal** — What task or workflow should the mode handle?
2. **Check for existing context** — Does the conversation already contain clues about topology, agent roles, or success criteria?
3. **Present topology options** — Based on what you heard, suggest 1-3 likely coordination patterns. Use the topology quick-reference below, not jargon.
4. **Let the user confirm or redirect** — Summarize your understanding and ask if it matches.

If the user's request is clear enough, proceed to Stage 3 directly.

### Topology Quick Reference

| Pattern | When to use | Key trait |
|---------|------------|-----------|
| **Generator-Verifier** | Quality can be checked against explicit criteria | Generate → Check → Retry loop |
| **Orchestrator-Subagent** | Task can be decomposed into independent subtasks | Central planner delegates work |
| **Agent Teams** | Long-lived workers with identity across tasks | Persistent backlog, worker memory |
| **Message Bus** | Event-driven pipeline with extensible routing | Publish-subscribe, topic routing |
| **Shared State** | Agents build on each other's findings in real time | Shared blackboard, convergence |

For detailed topology guidance, read `references/topology-guide.md`.

---

## Stage 2: Design Interview

Ask structured questions to fill design gaps. Not all dimensions are required — skip any that the user has already addressed or doesn't care about. Use multiple-choice options rather than open-ended questions.

### Dimensions

1. **Goal clarity** — What does success look like? What's the final output?
2. **Topology** — Which coordination pattern? (offer options from the table above)
3. **Outcome format** — What should the mode produce? (report, code, analysis, decision)
4. **Acceptance criteria** — How do you know the result is good enough?
5. **Capabilities** — Does the mode need special runtime atoms? (see `references/runtime-atoms-guide.md`)
6. **Safety** — Any constraints on tool access, budget, or retry limits?

For each dimension, offer 2-3 options plus "skip" or "use default."

### Example interaction

```
Agent: What should this mode produce as its final output?
  a) A verified code change (generator writes, verifier checks)
  b) A research summary with evidence
  c) A decision recommendation

User: a

Agent: And how strict should the verification be?
  a) Must pass all criteria — no exceptions
  b) Best effort — flag issues but don't block
  c) Custom — I'll describe the rubric
```

---

## Stage 3: Generate Draft

Call `modes.generateDraft` with the conversation messages and any collected design decisions.

### Tool call

```json
{
  "tool": "modes.generateDraft",
  "args": {
    "messages": [
      { "role": "user", "content": "<user's original request>" },
      { "role": "assistant", "content": "<your design summary>" },
      { "role": "user", "content": "<user's confirmation or adjustments>" }
    ],
    "baseModeId": "<optional: existing mode to base on>",
    "providerId": "<optional: specific provider>",
    "modelRef": "<optional: specific model>"
  }
}
```

### Handling the result

The result is a `ModeStudioDraftBundle` containing:
- `modeDraft` — The generated mode spec
- `agentDrafts` — Suggested agent configurations
- `guidance` — What the draft generator thinks needs attention
- `validation` — Any issues found
- `needsInput` — Whether more information is required

**If `needsInput` is true**: Read the `guidance.assistantMessage` and relay the question to the user. Then call `modes.generateDraft` again with the additional messages.

**If `needsInput` is false**: Present a summary of the draft to the user and proceed to Stage 4.

### Presenting the draft

When showing the draft to the user, focus on:
- **Topology shape** — How many nodes, how they connect
- **Agent roles** — What each agent does
- **Capabilities** — Which runtime atoms are enabled
- **Any open questions** — From the `validation` field

Don't dump raw JSON. Use human-readable summaries.

---

## Stage 4: Review & Refine

This is an iterative loop. The user reviews the draft and requests changes.

### Validation

Before each refinement, call `modes.validate` to check correctness:

```json
{
  "tool": "modes.validate",
  "args": {
    "draftBundle": { ... }
  }
}
```

Check `validation.errors` and `validation.warnings`. Surface them to the user as actionable suggestions, not as raw error messages.

### Refinement

When the user requests changes, call `modes.refineDraft`:

```json
{
  "tool": "modes.refineDraft",
  "args": {
    "messages": [
      { "role": "user", "content": "<user's change request>" }
    ],
    "draftBundle": { ... }
  }
}
```

The result is an updated `ModeStudioDraftBundle`. Show the user what changed (use `changeSummary` from the result).

### Iteration loop

1. Present current draft summary
2. Call `modes.validate` and show any issues
3. Ask: "Would you like to adjust anything?"
4. If yes → collect feedback → call `modes.refineDraft` → go to step 1
5. If no → proceed to Stage 5

Don't over-iterate. If the user says "looks good" or "go ahead," move to apply.

---

## Stage 5: Apply

Persist the mode by calling `modes.applyDraft`. This requires user approval.

```json
{
  "tool": "modes.applyDraft",
  "args": {
    "draftBundle": { ... },
    "saveAgentDrafts": true
  }
}
```

### What happens

- The mode spec is written to Ora's mode store
- Agent drafts are created as custom agents (if `saveAgentDrafts` is true)
- The mode becomes available for future runs

### After applying

Tell the user:
1. The mode name and a brief summary of what it does
2. How to use it: "Select this mode when starting a new run, or configure it as the default for a project"
3. That they can edit it later through Mode Studio or ask you to refine it

---

## Domain Knowledge

### Coordination Patterns (5 families)

Read `references/topology-guide.md` for detailed guidance on when to use each pattern and their default agent configurations.

### Runtime Atoms (14 capabilities)

Runtime atoms are optional capabilities that modify mode behavior — things like loop guards, memory capture, subagent delegation, and shared blackboards. Read `references/runtime-atoms-guide.md` when you need to recommend specific atoms for a mode.

Commonly useful atoms:
- **Loop Guard** — Prevents infinite retry loops (default on)
- **Recovery Policy** — Handles tool failures gracefully (default on)
- **Clarification Interrupt** — Pauses to ask the user when stuck (default on)
- **Memory Capture** — Saves run summaries for context (default on)
- **Subagent Delegate** — Enables explicit subagent lifecycle (advanced)

### Mode Spec Fields

For detailed field reference, read `references/mode-spec-fields.md`.

---

## Communicating with the User

### Tone and style

- Be conversational, not technical. The user may not know what a "topology" or a "runtime atom" is.
- When introducing a concept, explain it briefly: "A Generator-Verifier mode means one agent creates something and another agent checks it — like a writer and an editor."
- Prefer options over open-ended questions. Instead of "What topology do you want?", say "Based on what you described, I'd suggest one of these three approaches..."
- Don't explain Ora internals (JSON-RPC, schemas, mode store) unless the user asks.

### Progressive disclosure

- Start with high-level concepts (what the mode does)
- Introduce details (agent roles, capabilities) as needed
- Only reference the detailed docs when the user asks "what else can I configure?" or when a specific design decision requires it

### Handling uncertainty

If you're unsure about the user's intent:
- Ask a focused question with options, not a vague "what do you mean?"
- Make your best guess and let the user correct you — it's faster than asking them to explain everything
- If the draft generator returns `needsInput`, relay the question directly

### Common user patterns

- **"I want agents that..."** — They're describing a topology. Help them map it to a pattern.
- **"Make it more strict / more lenient"** — Adjust the verification or retry settings.
- **"Can it also do X?"** — Consider whether X fits the current topology or needs a different pattern.
- **"I don't know, just make something good"** — Use sensible defaults for the detected pattern and present the result for review.
