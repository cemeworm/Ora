# Mode Spec Fields Reference

Key fields in a Mode specification, for when you need to understand or explain specific configuration options.

## Core Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique mode identifier (e.g., "code_review_mode") |
| `family` | enum | Coordination pattern: `generator_verifier`, `orchestrator_subagent`, `agent_teams`, `message_bus`, `shared_state` |
| `label` | string | Human-readable mode name |
| `summary` | string | Brief description of what this mode does |
| `visibility` | enum | `"default"` (shown in mode picker) or `"internal"` (hidden) |

## Topology

The topology defines the graph of agents and their connections.

### Nodes

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Node identifier |
| `template` | enum | Node role template (see below) |
| `label` | string | Display name |
| `agentId` | string | Which agent profile fills this role |

### Node Templates

| Template | Purpose |
|----------|---------|
| `draft` | Produce initial candidate work |
| `verify` | Check work against criteria |
| `decide` | Make a judgment or routing decision |
| `decompose` | Break down a complex task |
| `research` | Gather information and evidence |
| `review` | Evaluate quality and completeness |
| `synthesize` | Combine inputs into a unified output |
| `triage` | Sort and prioritize incoming work |
| `build` | Implement or produce concrete output |
| `check` | Validate against requirements |
| `handoff` | Transfer work between agents |
| `publish` | Emit a final or intermediate artifact |
| `route` | Direct messages to subscribers |
| `handle` | Process a routed message |
| `respond` | Produce a final response |
| `seed` | Initialize shared state |
| `converge` | Check if shared state has converged |

### Edges

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Edge identifier |
| `source` | string | Source node id |
| `target` | string | Target node id |
| `kind` | enum | `control`, `delegation`, `verification`, `artifact`, `memory` |
| `label` | string | Descriptive label for the connection |

## Agent Profiles

Each agent in the mode has a profile:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Agent identifier |
| `label` | string | Display name |
| `role` | string | Description of what this agent does |
| `modelRef` | string? | Override the default model |
| `toolIds` | string[] | Tools this agent can use |
| `skillIds` | string[] | Skills this agent can reference |
| `soul` | string | System prompt / instructions for the agent |
| `memoryNamespaces` | string[] | Memory scopes this agent can access |

Common memory namespaces:
- `session` — Current conversation context
- `project` — Project-level knowledge
- `worker` — Persistent worker identity (agent teams)
- `artifact` — Output artifacts

## Runtime Configuration

| Field | Type | Description |
|-------|------|-------------|
| `atoms` | string[] | Enabled runtime atom IDs |
| `completionPolicy` | object | When and how the run stops |
| `recoveryPolicy` | object | How to handle failures |
| `resourceBudget` | object | Token and time limits |

## Completion Policies

| Preset | Behavior |
|--------|----------|
| `max_iterations` | Stop after N iterations (generator-verifier) |
| `queue_drained` | Stop when all tasks are complete (orchestrator, teams, bus) |
| `converged` | Stop when shared state stabilizes (shared state) |

## Resource Budget

| Field | Description |
|-------|-------------|
| `maxTokens` | Maximum total tokens across all agents |
| `maxSteps` | Maximum tool call steps |
| `maxDurationMs` | Maximum wall-clock time |

## Validation Rules

The mode validator checks:
1. At least one agent profile exists
2. All topology edges reference valid nodes
3. Node templates are compatible with the pattern family
4. Required atoms are present when needed
5. Agent memory namespaces are valid

When validation fails, the errors are human-readable and actionable — surface them to the user as suggestions, not raw errors.
