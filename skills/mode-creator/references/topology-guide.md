# Topology Guide

Detailed reference for the 5 coordination patterns (families) available in Ora.

## 1. Generator-Verifier (`generator_verifier`)

**How it works:** A generator agent produces candidate work, then a verifier agent evaluates it against explicit acceptance criteria. If the verifier rejects, the generator retries. The loop continues until the verifier accepts or the retry budget is exhausted.

**When to use:**
- Quality can be judged by explicit rubrics or acceptance criteria
- You need guaranteed output quality, not just best-effort
- Examples: code review, document proofreading, test generation with validation

**Default agents:**
- **Generator** — Produces concrete candidate work for review
- **Verifier** — Evaluates candidate work against acceptance criteria

**Default stop policy:** Max 3 iterations

**Common customization:**
- Tighten the verifier rubric for higher quality
- Increase max iterations for complex tasks
- Give the generator access to more tools (web search, file read)

---

## 2. Orchestrator-Subagent (`orchestrator_subagent`)

**How it works:** An orchestrator agent decomposes the task into subtasks and delegates them to specialized subagents. The orchestrator tracks progress and synthesizes final results.

**When to use:**
- Tasks can be broken into independent or sequential subtasks
- You want inspectable delegation — see what each subagent is doing
- Examples: research and report writing, multi-file code changes, analysis pipelines

**Default agents:**
- **Orchestrator** — Frames scope, coordinates stages, synthesizes results
- **Researcher** — Gathers focused evidence and context
- **Reviewer** — Checks completeness, risks, and acceptance criteria

**Default stop policy:** Queue drained — stops when all subtasks are complete

**Common customization:**
- Add more subagent roles (builder, analyst, tester)
- Configure subagent delegation for explicit lifecycle tracking
- Adjust the orchestrator's planning strategy

---

## 3. Agent Teams (`agent_teams`)

**How it works:** Persistent worker agents coordinate around a shared backlog. Each worker has identity and context that persists across tasks. A team lead prioritizes work and manages handoffs.

**When to use:**
- Long-running workers need identity and accumulated context
- Work arrives as a stream of tasks, not a single request
- Examples: ongoing development team, content production pipeline, monitoring and response

**Default agents:**
- **Team Lead** — Prioritizes backlog and coordinates workers
- **Builder** — Completes assigned implementation or production work
- **Reviewer** — Validates completed work for quality

**Default stop policy:** Queue drained — stops when backlog is empty and all outcomes collected

**Special capabilities:**
- **Persistent Worker Memory** — Workers remember context across tasks
- **Thread Workspace** — Per-run isolated workspace

**Common customization:**
- Add specialized workers (security reviewer, performance tester)
- Configure worker memory namespaces
- Set up artifact handoff protocols

---

## 4. Message Bus (`message_bus`)

**How it works:** Agents publish and subscribe to routed events through a shared bus. A router agent classifies incoming messages and routes them to interested subscribers. This enables extensible, event-driven pipelines.

**When to use:**
- Event-driven pipelines where routing should be extensible
- The agent ecosystem may grow — new subscribers should be easy to add
- Examples: multi-channel content distribution, event processing, notification routing

**Default agents:**
- **Router** — Classifies messages and routes to subscribers
- **Researcher** — Handles routed work items, publishes findings
- **Responder** — Publishes the final response after findings arrive

**Default stop policy:** Queue drained — stops when no pending events and final response published

**Special capabilities:**
- **Event Routing** — Track routed topics, subscribers, correlation records
- **Artifact Publish** — Promote stage outputs as explicit artifacts

**Common customization:**
- Define custom topics and routing rules
- Add more subscriber agents
- Configure correlation ID tracking

---

## 5. Shared State (`shared_state`)

**How it works:** Agents collaborate through a versioned shared blackboard. Instead of a central coordinator, agents read and write to a shared state, building on each other's findings. Convergence is detected when no new meaningful findings are added.

**When to use:**
- Agents need to build on each other's findings in near real time
- No single agent should be the bottleneck
- Examples: brainstorming, multi-perspective analysis, collaborative research

**Default agents:**
- **Orchestrator** — Seeds the board with scope and initial hypotheses
- **Researcher** — Adds evidence-backed findings to the shared board
- **Reviewer** — Validates findings and checks convergence

**Default stop policy:** Converged — stops after 2 idle cycles with no new findings

**Special capabilities:**
- **Shared Blackboard** — Versioned shared state with convergence tracking

**Common customization:**
- Adjust convergence threshold (idle cycles)
- Add more contributor roles
- Configure write visibility rules

---

## Choosing Between Patterns

**Quick decision guide:**

1. **Need quality guarantees with clear criteria?** → Generator-Verifier
2. **Need to decompose a complex task?** → Orchestrator-Subagent
3. **Need persistent workers over time?** → Agent Teams
4. **Need event-driven extensibility?** → Message Bus
5. **Need real-time collaborative building?** → Shared State

**Not sure?** Start with Orchestrator-Subagent — it's the most versatile default and works well for most decomposable tasks. You can always evolve to a more specialized pattern later.
