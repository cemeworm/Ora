# TASK-20260422: Ora MVP

Status: Planned  
Last Updated: 2026-04-22  
Owner: Codex + Quinten  
Source of Truth: This file

## Goal

Build Ora, a local-first Mac desktop application for running general AI agents where coordination patterns are first-class runtime choices, not hidden prompt instructions.

The MVP must make three capabilities visible and operational:

- Explicit pattern switching
- Visualized runtime structure
- Observable, interruptible, replayable runs

## Scope

### MVP Patterns

- Generator-Verifier
- Orchestrator-Subagent
- Agent Teams

### Deferred

- Message Bus as a user-facing pattern
- Shared State as a user-facing pattern
- Multi-user collaboration
- Cloud sync
- Agent marketplace
- Production hosted runtime

## Product Decisions

- Default pattern is `orchestrator_subagent`.
- `generator_verifier` is used when output quality can be judged by a clear rubric.
- `agent_teams` is used when long-running workers need persistent context across tasks.
- Pattern selection must be a runtime API and UI choice, not a prompt string.
- Observable subagents must be implemented as explicit LangGraph subgraphs/nodes, not only as tool calls.
- MVP should be local-first and Mac-first.
- Adopt a LangGraph-first runtime with an Ora capability layer: LangGraph remains the execution engine, while Ora owns pattern, profile, memory, plan, action, policy, topology, and event abstractions.
- Future agent capabilities (`profile`, `memory`, `plan`, `action`) must be horizontal runtime modules, not duplicated inside each coordination pattern.

## Architecture Decisions

- Desktop shell: Tauri 2 + React + TypeScript.
- Runtime: Node/TypeScript sidecar running LangGraph.js.
- Persistence: SQLite for local metadata and checkpoints.
- Secrets: OS Keychain through Rust/Tauri boundary.
- Frontend must not hold provider API keys, MCP credentials, filesystem authority, or shell authority.
- Runtime communication: newline-delimited JSON-RPC over sidecar stdio.
- Runtime stream forwarding: Rust receives sidecar events and emits Tauri events to React.
- No local HTTP server for the MVP unless stdio proves insufficient.
- The runtime architecture is LangGraph-first, but product-facing APIs are Ora-owned. UI and persistence should depend on Ora contracts, not directly on raw LangGraph event or state shapes.
- Agent identity, memory, planning, and action execution are shared capability services available to all patterns.

## Capability Layer

Ora should expose agent capabilities as composable runtime modules that every pattern can use. This keeps the system modular enough to add new orchestration patterns without reimplementing profile, memory, plan, or action behavior.

### Agent Profile Registry

- Stores each agent's identity, role, model preference, tool permissions, resource budgets, and visible memory namespaces.
- Separates short-lived subagents from persistent teammates.
- Supports future profile templates for researcher, coder, reviewer, planner, operator, and local-automation roles.

### Memory Layer

- Uses LangGraph checkpoints for per-run and per-thread execution state.
- Adds an Ora memory store for cross-thread memory, namespaced by profile, project, session, worker, or artifact.
- Keeps memory access explicit: every agent profile declares which namespaces it can read and write.
- Treats profile memory, project memory, run memory, and worker memory as distinct UI concepts.

### Plan Layer

- Stores plans as structured trees or DAGs, not only as assistant text.
- Plan items track owner agent, status, dependencies, linked actions, artifacts, and checkpoints.
- Human edits to plans should be resumable and auditable.
- Orchestrator-Subagent uses this layer for task decomposition; Agent Teams uses it for backlog and assignments.

### Action Ledger

- Every external effect goes through the same lifecycle: proposed, approval_required, approved, denied, running, succeeded, failed, skipped, or reverted.
- Tool calls, file writes, shell commands, MCP calls, model handoffs, and exported artifacts are all action records.
- High-risk actions must pause the graph through a human approval gate before execution.
- Action records link back to run events, plan items, checkpoints, and artifacts.

### Observation/Event Model

- Runtime emits Ora events for run, graph, node, token, tool, approval, memory, plan, action, checkpoint, and artifact changes.
- UI consumes Ora event envelopes rather than LangGraph-specific payloads.
- LangGraph stream modes and subgraph namespaces are adapted into stable Ora event fields.
- This event model is internal preparation for later Message Bus support without exposing Message Bus as an MVP pattern.

## UI/UX Direction

Visual direction: Operator Workbench.

- The app should feel like a precise professional runtime workbench for supervising agent execution.
- No gradients. Depth comes from background steps, crisp typography, restrained shadows, status color, and motion.
- The product should not feel like a generic admin dashboard; the right and bottom regions should behave as focused product controls tied to the selected run, not as flat always-on data tables.

### Design System Direction

- CSS strategy: Tailwind only.
- Theme: light-first, with dark tokens prepared later.
- Radius scale: 4px for tiny controls, 6px for default controls, 8px for larger panes, pill only for compact status chips.
- Surface strategy: use adjacent background lightness steps and occasional soft shadow; avoid heavy borders around every container.
- Accent strategy: use a small amount of amber or acid green for active execution and attention states, never as a broad background treatment.
- Motion: buttons use active scale; topology nodes use subtle status pulses; panel changes cross-fade or slide with transform/opacity only.

### App Layout

- Left rail: Sessions, Patterns, Agents, Tools, Memory, Settings.
- Session column: recent runs, saved flows, status filters, current project context.
- Center workspace: task composer, pattern switcher, topology canvas, streamed output, and primary run controls.
- Right side: Context Dock, not a generic inspector table.
- Bottom: Run Filmstrip, not a permanent backend log table.

### Context Dock

The right side should feel like a contextual product surface.

- Default collapsed width shows selected entity identity, health, and the next meaningful action.
- Expanded dock has tabs for Overview, State, Profile, Memory, Plan, Actions, Approvals, and Checkpoints.
- Content changes based on selection: run, topology node, agent, plan item, action, memory entry, or checkpoint.
- Approval cards are promoted to the top only when execution is blocked.
- Dangerous approvals may open a focused confirmation sheet; routine approvals stay inline in the dock.
- Empty state should explain what to select next, not show blank tables.

### Run Filmstrip

The bottom surface should be a timeline control, not a raw event grid.

- Default height is compact and shows milestones as grouped beats: plan, dispatch, tool, approval, checkpoint, retry, error, done.
- Scrubbing the filmstrip previews the selected checkpoint or event in the Context Dock.
- Expanding the filmstrip reveals detailed events, token/latency/budget traces, and replay controls.
- Raw logs are available as a secondary detail view, never the default bottom experience.
- The filmstrip should make replay and fork feel like primary product capabilities.

### Pattern Switcher

- Use compact pattern cards, not a dropdown.
- Each card shows a small structural preview, recommended use, failure mode, and default constraints.
- Orchestrator-Subagent is visually marked as the default.
- Switching patterns should preview topology and policy differences before starting the run.

### Agent Capability Surfaces

- Profile: identity, role, model, tools, budgets, and permission scope.
- Memory: namespace explorer for profile, project, session, worker, and artifact memory.
- Plan: editable task tree with owners, dependencies, linked actions, and checkpoints.
- Action: ledger view focused on consequences and approval state, not just tool-call arguments.

## Repository Layout

```text
apps/
  desktop/
    src/
      app/
      components/
      features/
        sessions/
        topology/
        inspector/
        approvals/
        settings/
      lib/
        api/
        state/
        events/
    src-tauri/
      src/
        main.rs
        commands/
        sidecar/
  runtime/
    src/
      capabilities/
        action/
        memory/
        plan/
        profile/
        policy/
      patterns/
        generatorVerifier/
        orchestratorSubagent/
        agentTeams/
      graph/
      session/
      tools/
      providers/
      persistence/
      events/
      schemas/
packages/
  shared/
    src/
      capabilities/
      contracts/
      events/
      schemas/
      patterns/
tasks/
  TASK-20260422-ora-mvp.md
```

## Runtime Interfaces

Implement shared contracts in `packages/shared`.

```ts
type CoordinationPattern =
  | "generator_verifier"
  | "orchestrator_subagent"
  | "agent_teams";

interface AgentRunService {
  startRun(input: UserTaskInput, config: RunConfig): Promise<RunHandle>;
  streamRun(runId: string): AsyncIterable<RunEvent>;
  interruptRun(runId: string, reason?: string): Promise<void>;
  resumeRun(runId: string, patch?: StatePatch): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  getRunState(runId: string): Promise<StateSnapshot>;
  listCheckpoints(runId: string): Promise<CheckpointMeta[]>;
  forkRun(runId: string, checkpointId: string): Promise<RunHandle>;
  exportReport(runId: string): Promise<ArtifactRef>;
}
```

Capability contracts should also live in `packages/shared` so desktop UI, Rust bridge, and Node runtime all agree on stable Ora-owned shapes:

```ts
interface AgentProfile {
  id: string;
  label: string;
  role: string;
  modelRef: string;
  toolPolicyId: string;
  memoryNamespaces: string[];
  budget: ResourceBudget;
}

interface PlanItem {
  id: string;
  runId: string;
  parentId?: string;
  ownerAgentId?: string;
  status: "planned" | "ready" | "running" | "blocked" | "done" | "failed" | "skipped";
  title: string;
  dependencies: string[];
  linkedActionIds: string[];
  checkpointIds: string[];
}

interface ActionRecord {
  id: string;
  runId: string;
  planItemId?: string;
  agentId?: string;
  type: string;
  riskLevel: "low" | "medium" | "high";
  status:
    | "proposed"
    | "approval_required"
    | "approved"
    | "denied"
    | "running"
    | "succeeded"
    | "failed"
    | "skipped"
    | "reverted";
  input: unknown;
  output?: unknown;
  error?: string;
  artifactIds: string[];
}

interface MemoryRecord {
  id: string;
  namespace: string[];
  kind: "profile" | "project" | "session" | "worker" | "artifact";
  value: unknown;
  sourceRunId?: string;
  sourceActionId?: string;
  createdAt: number;
  updatedAt: number;
}
```

## Implementation Plan

1. Scaffold pnpm monorepo with `apps/desktop`, `apps/runtime`, and `packages/shared`.
2. Create Tauri 2 + React/Vite desktop app.
3. Create Node/TypeScript runtime sidecar package.
4. Add shared Zod schemas and JSON-RPC/event contracts.
5. Add shared capability contracts for agent profiles, memory records, plan items, action records, policies, topology, and Ora event envelopes.
6. Add Rust sidecar lifecycle manager.
7. Add sidecar health check and stream smoke test.
8. Add SQLite persistence for sessions, runs, configs, approvals, tool calls, artifacts, profiles, memory records, plan items, and action ledger records.
9. Add LangGraph SQLite checkpoint integration.
10. Implement baseline single-agent run lifecycle.
11. Implement provider adapters for Anthropic and OpenAI.
12. Implement capability services: Profile Registry, Memory Service, Plan Service, Action Ledger, Policy Service, and Event Adapter.
13. Implement tool descriptor registry, router, and approval gate on top of the Action Ledger.
14. Implement Generator-Verifier graph and UI.
15. Implement Orchestrator-Subagent graph with explicit subgraphs, structured plan items, and Context Dock inspection.
16. Implement Agent Teams coordinator, worker registry, mailbox, worker memory, and worker board.
17. Implement pause, resume, cancel, replay, fork, Run Filmstrip, and report export.
18. Add pattern recommendation explanation.
19. Run full verification and update this journal before claiming DONE.

## Checkpoints

| Requirement | Verification Method | Pass Criteria |
| --- | --- | --- |
| Monorepo scaffold | `pnpm install`, workspace package discovery | All packages install and resolve |
| Desktop launches | Tauri dev command | React shell opens |
| Sidecar launches | Runtime health check | Desktop receives healthy response |
| Runtime streams events | Smoke run | UI receives ordered run events |
| Capability contracts exist | Shared schema tests | Profile, memory, plan, action, policy, and event schemas validate |
| Checkpoints persist | Restart app and query run | Previous checkpoints are visible |
| Memory namespaces work | Store and retrieve records by namespace | Agents only see permitted namespaces |
| Plan layer works | Create and update structured plan items | Plan items link to agents, actions, and checkpoints |
| Action ledger works | Execute safe and high-risk actions | Lifecycle state transitions are persisted |
| Generator-Verifier works | Integration run with retry | Stops on pass or max retries |
| Orchestrator-Subagent is inspectable | Query subgraph state | Subagent state visible |
| Agent Teams persists workers | Assign multiple tasks | Worker threads retain identity/state |
| Approval gate works | Run high-risk tool | Execution pauses until approval |
| Replay/fork works | Fork from checkpoint | New run starts from chosen checkpoint |
| Export works | Export report | Artifact file is created and referenced |
| Context Dock feels contextual | Manual UX review | Right side changes with selected run/node/agent/action and avoids blank generic tables |
| Run Filmstrip supports replay | Manual UX review | Bottom surface groups milestones, scrubs checkpoints, and expands to detailed traces |

## Test Plan

### Unit Tests

- Shared schema validation.
- Pattern registry behavior.
- JSON-RPC request/response validation.
- Tool risk and approval policy.
- Session/run status transitions.
- Agent profile schema and permission scope validation.
- Memory namespace access rules.
- Plan item dependency and status transitions.
- Action ledger lifecycle transitions.
- Ora event envelope adaptation from LangGraph stream payloads.

### Runtime Integration Tests

- `startRun`, `streamRun`, `interruptRun`, `resumeRun`, `cancelRun`.
- Checkpoint creation and lookup.
- Profile, memory, plan, action, and policy service integration.
- Fork from checkpoint.
- Export execution report.
- Generator-Verifier retry behavior.
- Orchestrator-Subagent subgraph inspection.
- Agent Teams worker persistence.

### Desktop Integration Tests

- Tauri launches sidecar.
- Sidecar crash is surfaced and recoverable.
- Runtime events stream into React.
- Approval modal pauses and resumes execution.
- Sessions survive app restart.
- Context Dock updates when selecting run, topology node, agent, action, plan item, memory record, and checkpoint.
- Run Filmstrip scrubs milestones and opens detailed trace view on demand.

## Acceptance Criteria

- User can choose one of the three MVP patterns.
- User can start a run and see topology, stream, state, tools, checkpoints, and timeline.
- User can pause, resume, cancel, replay, and fork a run.
- User can inspect subagent state for Orchestrator-Subagent.
- User can manage persistent workers for Agent Teams.
- User can inspect and edit structured plans.
- User can inspect agent profile, memory namespaces, and action ledger state.
- High-risk tools require human approval.
- User can export an execution report.
- App can recover sessions and checkpoints after restart.
- Right-side and bottom UI read as contextual product surfaces, not flat backend tables.

## Active Files

Initially expected:

- `tasks/TASK-20260422-ora-mvp.md`
- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `pnpm-lock.yaml`
- `apps/desktop/**`
- `apps/runtime/**`
- `packages/shared/**`

## Progress Log

### 2026-04-22

Created initial Ora MVP implementation plan and persisted it as the authoritative task journal.

Next:
1. Scaffold pnpm monorepo and desktop/runtime/shared packages.
2. Implement sidecar health-check path before adding product features.
3. Keep this journal updated before and after meaningful implementation steps.

### 2026-04-22 21:10 CST

Approved and recorded the architecture refinement: Ora will use a LangGraph-first runtime plus an Ora-owned capability layer for profile, memory, plan, action, policy, topology, and event abstractions. Approved the Operator Workbench design direction and refined the right/bottom surfaces into a Context Dock and Run Filmstrip so the UI feels like a focused user product instead of a flat backend console.

Next:
1. Scaffold shared packages with capability schemas before pattern-specific code.
2. Build the desktop shell around Center Workspace, Context Dock, and Run Filmstrip primitives.
3. Keep raw logs as a secondary expanded trace view rather than the default bottom UI.

### 2026-04-22 21:28 CST

Started MVP implementation through an agent team. Root pnpm workspace files were added locally while Worker A owns `packages/shared/**` and `apps/runtime/**`, and Worker B owns `apps/desktop/**`. The first implementation milestone is intentionally scoped to scaffold, shared Ora contracts, deterministic runtime smoke events, and the Operator Workbench desktop shell.

Next:
1. Integrate Worker A shared/runtime package output.
2. Integrate Worker B desktop/Tauri shell output.
3. Install dependencies and run build/typecheck/test smoke verification.

### 2026-04-22 21:31 CST

Integrated the agent team output into a runnable first milestone. Added pnpm workspace root config, shared Zod contracts and pattern definitions, runtime JSON-RPC smoke service, and a Tauri/Vite React Operator Workbench shell. Cleaned package-local npm artifacts from worker installs and moved package relationships to pnpm workspace dependencies. Started the desktop dev server at `http://127.0.0.1:1420/`.

Next:
1. Wire the Tauri Rust command layer to the built runtime sidecar process.
2. Add SQLite persistence and LangGraph checkpoint integration.
3. Replace desktop mock data with shared contract-backed runtime data.

### 2026-04-22 21:40 CST

Started second implementation milestone through an agent team. Target scope is runtime durability/replay APIs, desktop runtime-client wiring, and a Tauri JSON-RPC command facade that can later spawn the sidecar binary. Cargo is still unavailable in this environment, so Rust edits must be structurally simple and verified as far as possible through source review plus JS/TS tests.

Next:
1. Worker A: extend shared/runtime contracts for stream, resume, fork, list runs, and report export persistence.
2. Worker B: replace desktop static mock assumptions with contract-backed runtime client/view-model wiring.
3. Worker C: add Tauri commands for JSON-RPC request forwarding and sidecar status without exposing shell authority to React.

### 2026-04-22 21:49 CST

Integrated the second milestone. Runtime now has a `LocalRunStore` abstraction with JSON-file persistence under `.ora/runtime-store` by default, plus `runs.list`, `runs.stream`, `runs.resume`, `runs.fork`, and persisted report artifact refs. Shared contracts now include run summaries, event streams, fork/resume params, artifact metadata, and expanded event types. Desktop now has a runtime client and view-model adapter layer; the React workbench initializes from contract-backed runtime state and starts smoke runs through the client. Tauri now exposes a deterministic JSON-RPC facade command for runtime discovery/start without spawning shell processes.

Next:
1. Replace JSON-file persistence backend with SQLite once the runtime storage shape settles.
2. Wire Tauri to the Node sidecar process when `cargo`/Rust verification is available.
3. Connect desktop fork/replay controls to runtime `runs.fork`, `runs.stream`, and checkpoint selection.

## Decisions

- Use explicit pattern definitions as runtime abstractions.
- Keep LangGraph runtime out of the frontend renderer.
- Use explicit subgraphs for observable subagents.
- Defer Message Bus and Shared State from MVP.
- Treat this task journal as the only authoritative implementation state.
- Approved: LangGraph-first runtime + Ora capability layer.
- Approved: Operator Workbench visual direction.
- Design refinement: right side is a Context Dock, bottom is a Run Filmstrip; neither should default to generic admin tables.

## Open Issues

- Node version observed during scaffold: `v22.20.0`.
- Package manager is locked in root `package.json` as `pnpm@10.11.0`.
- Confirm whether LangSmith tracing is opt-in settings only or hidden dev-only in MVP.
- Choose exact production typeface after the first shell mock exists; avoid reflex display use of Inter or similar default prompt fonts.
- Capability schemas shipped before and alongside the first sidecar health-check milestone.
- Rust/Tauri native verification is blocked until `cargo` is installed or added to PATH.
- Second milestone uses JSON-file persistence as a stable backend boundary; SQLite is still the target backend for the full MVP.

## TODO

- [x] Scaffold pnpm monorepo with `apps/desktop`, `apps/runtime`, and `packages/shared`.
- [x] Add shared capability schemas for profile, memory, plan, action, policy, topology, and event envelopes.
- [x] Implement sidecar health-check path.
- [x] Build Operator Workbench shell with Center Workspace, Context Dock, and Run Filmstrip.
- [x] Add runtime stream/list/resume/fork/report APIs with local persistence abstraction.
- [x] Add desktop runtime client/view-model wiring with browser fallback and Tauri bridge probing.
- [x] Add Tauri JSON-RPC facade commands without shell authority.
- [ ] Add persistence, pattern runtime, UI, replay, and export capabilities according to the implementation plan.

## Functional Verification

### Code Verification (Code Correctness)

- [x] Code compiles/runs without errors.
- [x] Unit tests pass.
- [ ] Lint checks pass.

**Output**:

```text
$ pnpm install
Scope: all 4 workspace projects
Done in 12.3s using pnpm v10.11.0

$ pnpm --filter @ora/shared build
> @ora/shared@0.1.0 build
> tsc -p tsconfig.json

$ pnpm --filter @ora/shared test
✓ test/contracts.test.ts (4 tests)
Test Files 1 passed (1)
Tests 4 passed (4)

$ pnpm --filter @ora/runtime build
> @ora/runtime@0.1.0 build
> tsc -p tsconfig.json

$ pnpm --filter @ora/runtime test
✓ test/runtime-smoke.test.ts (3 tests)
Test Files 1 passed (1)
Tests 3 passed (3)

$ pnpm --filter @ora/runtime smoke
run.runId: run-0001
run.status: succeeded
run.pattern: orchestrator_subagent
state.events.length: 7
state.checkpoints.length: 1

$ pnpm --filter @ora/desktop build
✓ 1578 modules transformed.
dist/index.html 0.41 kB
dist/assets/index-DsC3obUe.css 17.76 kB
dist/assets/index-B_95Rl1G.js 181.37 kB
✓ built

$ pnpm build
packages/shared build: Done
apps/desktop build: Done
apps/runtime build: Done

$ pnpm test
packages/shared test: Test Files 1 passed (1), Tests 4 passed (4)
apps/runtime test: Test Files 1 passed (1), Tests 3 passed (3)

$ pnpm typecheck
packages/shared typecheck: Done
apps/desktop typecheck: Done
apps/runtime typecheck: Done

$ cargo check
zsh:1: command not found: cargo
```

### 2026-04-22 21:49 CST

```text
$ pnpm build
packages/shared build: Done
apps/desktop build: ✓ 1582 modules transformed.
apps/desktop build: dist/index.html 0.41 kB
apps/desktop build: dist/assets/index-UKv2UUQY.css 17.91 kB
apps/desktop build: dist/assets/core-DhEqZVGG.js 2.44 kB
apps/desktop build: dist/assets/index-Rg1Czhc_.js 199.95 kB
apps/runtime build: Done

$ pnpm test
packages/shared test: Test Files 1 passed (1), Tests 5 passed (5)
apps/runtime test: Test Files 1 passed (1), Tests 7 passed (7)

$ pnpm typecheck
packages/shared typecheck: Done
apps/desktop typecheck: Done
apps/runtime typecheck: Done

$ ORA_RUNTIME_STORE_DIR="$(mktemp -d)" pnpm --filter @ora/runtime smoke
run.runId: run-0001
run.status: succeeded
stream.events.length: 7
report.kind: report
report.uri: file:///.../artifacts/run-0001/run-0001%253Areport-0.json
fork.runId: run-0002
runs.length: 2

$ cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
zsh:1: command not found: cargo
```

### Functional Verification (Feature Works)

- [x] Task journal exists at `tasks/TASK-20260422-ora-mvp.md`.
- [x] Required sections exist in the task journal.
- [x] No unrelated files were created for this task journal request.

**Output**:

```text
$ test -d tasks && echo 'tasks directory exists'
$ test -f tasks/TASK-20260422-ora-mvp.md && echo 'task journal exists'
tasks directory exists
task journal exists

$ for section in '## Goal' '## Scope' '## Implementation Plan' '## Checkpoints' '## Test Plan' '## Acceptance Criteria' '## Progress Log' '## Retrospective' '## Compressed State'; do rg -n "^${section}$" tasks/TASK-20260422-ora-mvp.md; done
8:## Goal
18:## Scope
125:## Implementation Plan
145:## Checkpoints
161:## Test Plan
189:## Acceptance Criteria
211:## Progress Log
291:## Retrospective
295:## Compressed State

$ find . -maxdepth 3 -type f | sort
./skills/long-task-protocol/SKILL.md
./skills/long-task-protocol/TEMPLATE.md
./tasks/TASK-20260422-2047-init-task-record-skills.md
./tasks/TASK-20260422-ora-mvp.md
```

### 2026-04-22 21:31 CST

```text
$ curl -I http://127.0.0.1:1420/
HTTP/1.1 200 OK
Content-Type: text/html
Cache-Control: no-cache
```

Implemented first milestone functionality:

- Shared contracts validate MVP patterns, profile/memory/plan/action/topology/event/JSON-RPC shapes.
- Runtime handles `runtime.health`, `patterns.list`, `runs.start`, `runs.interrupt`, `runs.cancel`, `runs.state`, `runs.checkpoints`, and `runs.exportReport`.
- Runtime smoke run emits ordered Ora event envelopes: `run.started`, `topology.updated`, `plan.updated`, `message.delta`, `token.delta`, `checkpoint.created`, `run.done`.
- Desktop shell renders left rail, session column, center workspace, compact pattern cards, topology canvas, run controls, contextual dock tabs, and run filmstrip.

### 2026-04-22 21:49 CST

Implemented second milestone functionality:

- Shared contracts now cover run summaries, stream params/results, resume/fork params, artifact refs with URI/size, and expanded event types.
- Runtime can list runs, stream ordered events, resume a run, fork from a checkpoint, and persist run snapshots/report artifacts through a swappable local persistence backend.
- Runtime smoke now starts a run, reads state, streams events, exports a report artifact, forks from the checkpoint, and lists both runs.
- Desktop has a runtime client that probes Tauri and falls back to deterministic browser runtime state, plus view-model adapters for workbench UI surfaces.
- Tauri exposes a JSON-RPC facade for `runtime.health`, `patterns.list`, and `runs.start`, with sidecar spawning explicitly disabled.

## Comparison

### Reference

- User-provided Ora MVP plan in the current thread.
- Project-local long-task protocol template at `skills/long-task-protocol/TEMPLATE.md`.

### Comparison Points

- [x] Goal, scope, architecture, implementation plan, checkpoints, test plan, acceptance criteria, decisions, open issues, and compressed state were carried into the journal.
- [x] Long-task protocol sections for active files, progress log, TODO, retrospective, functional verification, comparison, checkpoints, and compressed state are present.

### Findings

- Consistency: The journal preserves the user's implementation plan and adds only task-management structure needed for future resumable work.
- Differences: The progress log marks the journal as persisted, and TODO/verification sections are explicit so later implementation can update them.
- Conclusion: This file is ready to serve as the source of truth for Ora MVP implementation.

## Verification

Journal bootstrap verification passed. First MVP implementation milestone verification passed for TypeScript build/test/typecheck and runtime smoke.

Required before DONE:

- TODO scan output.
- Build/test/lint outputs.
- Functional verification evidence.
- Changed file list.
- Residual risks.

### 2026-04-22 21:31 CST

First milestone verification passed for TypeScript build/test/typecheck and runtime smoke. Tauri Rust verification did not run because `cargo` is not installed or not on PATH in this environment. `bash skills/long-task-protocol/scripts/todo_scan.sh` currently scans generated dependency files under `node_modules/.vite`, so its output is third-party TODO noise rather than source TODOs; do not use that as a DONE gate until the scan excludes dependency/build artifacts.

Changed source/config files:

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `.gitignore`
- `packages/shared/package.json`
- `packages/shared/tsconfig.json`
- `packages/shared/src/index.ts`
- `packages/shared/test/contracts.test.ts`
- `apps/runtime/package.json`
- `apps/runtime/tsconfig.json`
- `apps/runtime/vitest.config.ts`
- `apps/runtime/src/index.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/stdio.ts`
- `apps/runtime/src/cli.ts`
- `apps/runtime/test/runtime-smoke.test.ts`
- `apps/desktop/package.json`
- `apps/desktop/index.html`
- `apps/desktop/tsconfig.json`
- `apps/desktop/tsconfig.node.json`
- `apps/desktop/vite.config.ts`
- `apps/desktop/tailwind.config.ts`
- `apps/desktop/postcss.config.cjs`
- `apps/desktop/src/main.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/types.ts`
- `apps/desktop/src/lib/mockData.ts`
- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/lib/viewModel.ts`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/build.rs`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/src/main.rs`
- `apps/desktop/src-tauri/src/commands/mod.rs`
- `apps/desktop/src-tauri/src/commands/sidecar.rs`
- `tasks/TASK-20260422-ora-mvp.md`

Second milestone additional changed files are included in the list above. `.ora/` was added to `.gitignore`; generated smoke runtime stores were removed from the workspace after verification.

## Retrospective

- Pitfall: Treating observability panels as always-visible admin tables would make Ora feel like infrastructure tooling instead of a desktop user product.
  - Symptom: Right and bottom regions become flat inspectors/log grids detached from the user's current decision.
  - Root Cause: Runtime observability needs were mapped directly to layout regions without enough product interaction design.
  - Reusable Guardrail: Default to contextual surfaces tied to selection and user intent; keep raw tables/logs behind expanded detail views.
  - Evidence: User explicitly approved Operator Workbench but flagged the initial right/bottom concept as too backend-like.
  - Scope: Ora UI design and future agent workbench surfaces.
  - Suggested Writeback Target: None yet; keep local until implementation validates the pattern.
  - Status: local_only

## Compressed State

Ora MVP is planned as a Tauri 2 + React desktop app with a Node/TypeScript LangGraph.js sidecar. The approved architecture is LangGraph-first runtime + Ora capability layer: Ora owns pattern, profile, memory, plan, action, policy, topology, and event contracts while LangGraph handles graph execution, checkpoints, interrupts, subgraphs, and streaming. MVP includes Generator-Verifier, Orchestrator-Subagent, and Agent Teams; Message Bus and Shared State are deferred. Sidecar owns runtime, tools, providers, capability services, and persistence; frontend is UI only. SQLite and LangGraph checkpoints provide local-first durability. Approved visual direction is Operator Workbench, with Center Workspace, contextual right Context Dock, and bottom Run Filmstrip instead of flat backend tables. This file is the source of truth.
Implementation has started with root pnpm workspace config in place. Agent team split: Worker A handles shared contracts and runtime smoke sidecar, Worker B handles desktop/Tauri Operator Workbench shell; main Codex handles integration, verification, and journal updates.
First milestone is implemented and verified on the JS/TS side: pnpm workspace, shared contracts, deterministic in-memory runtime JSON-RPC smoke path, and desktop Operator Workbench shell. Desktop dev server is running at `http://127.0.0.1:1420/`. Remaining MVP work is real Tauri sidecar process wiring, SQLite/LangGraph persistence, provider adapters, real pattern graphs, replay/fork/report persistence, and replacing desktop mock data with runtime data. Rust/Tauri native check is blocked because `cargo` is unavailable.
Second milestone is starting with an agent-team split for runtime replay/persistence semantics, desktop runtime view models, and a Tauri JSON-RPC bridge facade. Keep this journal as the source of truth and update verification before claiming the milestone complete.
Second milestone is integrated and verified on JS/TS. Runtime persistence is currently JSON-file-backed behind `LocalRunStore`, with stream/list/resume/fork/report APIs now present. Desktop bootstraps from runtime client/view-model state and uses browser fallback until real Tauri sidecar spawning is enabled. Tauri JSON-RPC facade exists but native Rust verification remains blocked because `cargo` and `rustfmt` are unavailable.
