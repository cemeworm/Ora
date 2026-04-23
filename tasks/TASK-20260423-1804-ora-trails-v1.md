# TASK-20260423-1804-ora-trails-v1

**Created:** 2026-04-23 18:04 CST
**Status:** In Progress

---

## Goal
- Implement Trails v1 for Ora chat runs by upgrading the current right-side Details surface into a Trails workbench backed by local runtime state plus Langfuse trace metadata. The feature must add run-level trace refs and a `runs.trail` JSON-RPC API in shared/runtime, preserve backward compatibility for older runs or disabled Langfuse setups, and expose a desktop Trails drawer with `Live`, `Timeline`, `Topology`, and `Trace` views plus an `Open in Langfuse` action for managed local Langfuse.

## Scope / Out of scope
- In scope:
  - Shared contracts for run trace metadata, trail observations/generations, light live KPI summaries, and `runs.trail`.
  - Runtime Langfuse trace/generation ref capture, persistence on `StateSnapshot` / `SessionTurn`, and best-effort Langfuse trace fetch through the official JS client already present in the dependency tree.
  - Desktop refactor from `Details` to `Trails` for the chat view only, including async trace loading and host/browser open behavior.
  - Browser mock and Rust fallback parity sufficient for local desktop usage when the Node runtime is unavailable.
  - Verification across shared/runtime/desktop builds/tests plus a manual smoke path.
- Out of scope:
  - Evaluation/Trails unification.
  - Judge-style scoring, baselines, or human review queues inside Trails.
  - Full Langfuse UI embedding or secondary auth/session flows.

## Constraints
- Compatibility:
  - Preserve existing session/run/replay/export flows and keep older snapshots parseable when no trace metadata exists.
- Performance:
  - `Live` / `Timeline` / `Topology` must render from local snapshot data without waiting on Langfuse.
- Risk:
  - The repo already contains unrelated in-flight changes for custom agents/projects plus local width fixes in `DetailDrawer.tsx` / `DetailTabs.tsx`; Trails work must build on top without reverting them.
  - Langfuse API surface is partly moving toward v2; self-hosted managed local Langfuse still needs a v1-compatible path or graceful degradation.
- Tool/Environment limits:
  - No desktop E2E suite exists; final evidence will combine tests/builds with deterministic mock/manual validation.

## Plan
1. `packages/shared/src/index.ts` + shared tests: add trail schemas, optional run trace metadata on `StateSnapshot` / `SessionTurn`, and `runs.trail`.
2. `apps/runtime/src/{telemetry/langfuse,run-store,json-rpc,index}.ts` + runtime tests/package manifest: capture root trace and generation refs, expose `runs.trail`, and fetch trace detail through Langfuse when possible.
3. `apps/desktop/src/{types,lib/runtimeClient,lib/state,lib/useRunActions,components/*,App}.tsx`: replace Details drawer semantics with Trails, load trail data lazily, and add `Open in Langfuse`.
4. `apps/desktop/src-tauri/src/{main,commands/sidecar}.rs`: add a host command for opening the local Langfuse trace URL and provide deterministic `runs.trail` fallback.
5. Run task-scoped verification, update retrospective/checkpoints, and capture residual gaps.

## Active Files
- tasks/TASK-20260423-1804-ora-trails-v1.md
- packages/shared/src/index.ts
- packages/shared/test/contracts.test.ts
- apps/runtime/package.json
- apps/runtime/src/telemetry/langfuse.ts
- apps/runtime/src/run-store.ts
- apps/runtime/src/json-rpc.ts
- apps/runtime/src/index.ts
- apps/runtime/test/runtime-integration.test.ts
- apps/desktop/src/types.ts
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/lib/state.tsx
- apps/desktop/src/lib/useRunActions.ts
- apps/desktop/src/components/ChatHeader.tsx
- apps/desktop/src/components/DetailDrawer.tsx
- apps/desktop/src/components/DetailTabs.tsx
- apps/desktop/src/App.tsx
- apps/desktop/src-tauri/src/main.rs
- apps/desktop/src-tauri/src/commands/sidecar.rs

## Decisions
- Decision:
  - Why: Keep Trails hybrid and Ora-native for the primary experience: local snapshot data is the fast path, Langfuse is the deep-drill and topology-enrichment layer.
  - Alternatives: Full Langfuse embedding; purely local Trails with no Langfuse fetch path.
  - Tradeoffs: Slightly more integration code, but the UI remains responsive when Langfuse is unavailable and the packaged-app story stays simple.
- Decision: Use the official Langfuse JS core client that is already transitively installed in the repo for `runs.trail` fetches instead of hand-rolling REST calls.
  - Why: It keeps the query path aligned with the vendor's public API types and reduces drift risk for self-hosted/v1 trace lookups.
  - Alternatives: Raw `fetch` against undocumented response shapes; no runtime-side fetch at all.
  - Tradeoffs: We add a direct dependency declaration to `@ora/runtime`, but the implementation remains small and typed.

## Progress Log
- 2026-04-23 18:04 CST - Task created
  Next: Fill in Goal, Scope, Plan, and list Active Files
- 2026-04-23 18:09 CST - Scoped Trails to chat-only and confirmed the current repo is already dirty with unrelated custom-agent/project work plus narrow width fixes in `DetailDrawer.tsx` and `DetailTabs.tsx`. Those local edits are compatible and will be preserved while Trails layers on top.
  Next: Extend shared run-trail contracts; implement Langfuse trace/generation ref capture in runtime; refactor desktop drawer into Trails.

## Open Issues
- [ ] Confirm whether managed local Langfuse `trace.get()` returns enough observation detail in this environment for the full Trace view; if not, Trails should fall back to locally synthesized observation rows without blocking the drawer.

## TODO
- [ ] Add shared `RunTrail` / trace metadata schemas and parse coverage.
- [ ] Persist trace metadata on runtime snapshots and expose `runs.trail`.
- [ ] Replace desktop Details semantics with Trails and async trace loading.
- [ ] Add desktop host/browser open support for Langfuse trace URLs.
- [ ] Run verification and record manual Trails smoke evidence.

## Retrospective
- Record 0-3 highest-value pitfalls from this task.
- Leave reusable operational lessons here even when they later get promoted into a skill.

### Item 1
- Pitfall:
- Symptom:
- Root Cause:
- Reusable Guardrail:
- Evidence:
- Scope:
- Suggested Writeback Target:
- Status: local_only | candidate_for_skill | promoted_to_skill

## Functional Verification

### Code Verification (Code Correctness)
- [ ] Code compiles/runs without errors
- [ ] Unit tests pass
- [ ] Lint checks pass

**Output**: Paste command outputs

### Functional Verification (Feature Works)
- [ ] Core functionality verification (specify method)
- [ ] Edge cases verification
- [ ] Error handling verification

**Output**: Paste verification results

**Examples**:
- Database: `SELECT * FROM table WHERE field_name IS NOT NULL LIMIT 5;`
- API: `curl "url" | jq '.results[0].field_name'`
- UI: Manual test steps and results
- Bug fix: Verification bug is fixed

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: Ora's existing `EvaluationView` async drill-down pattern plus Langfuse managed-local telemetry contract documented in `infra/observability/langfuse/README.md`.

### Comparison Points
- [ ] Comparison point 1: local state as fast path vs remote observability as enrichment.
- [ ] Comparison point 2: run-level trace refs persisted in core runtime objects.
- [ ] Comparison point 3: packaged-app trace opening flow without exposing Langfuse credentials to React.

### Findings
- Consistency: _______
- Differences: _______
- Conclusion: _______

## Checkpoints

### Checkpoint 1: _______
- Requirement: Shared/runtime layers expose parseable run trace metadata plus `runs.trail`, and disabled/unavailable Langfuse degrades cleanly.
- Verification method: shared/runtime tests and targeted runtime smoke assertions.
- Status: [ ] Pass / [ ] Fail
- Evidence: _______

### Checkpoint 2: Desktop Trails Workbench
- Requirement: Chat view opens Trails with `Live`, `Timeline`, `Topology`, and `Trace` views, and trace loading/open behavior works without blocking local views.
- Verification method: desktop typecheck/build plus manual deterministic smoke path.
- Status: [ ] Pass / [ ] Fail
- Evidence: _______

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: ship Trails v1 for chat runs with Langfuse-backed trace enrichment.
- Done: scope locked; existing dirty-file risk inspected; task journal populated; implementation seams confirmed in shared/runtime/desktop/Tauri.
- In-progress: shared/runtime contract and telemetry work.
- Active files: shared contracts/tests; runtime langfuse/run-store/json-rpc; desktop runtime client/state/components; Tauri host command wiring.
- Next actions (top 3; exact file/function):
  - `packages/shared/src/index.ts`: add `RunTraceMetadata`, `RunTrail`, `runs.trail`, and optional trace metadata fields.
  - `apps/runtime/src/telemetry/langfuse.ts`: capture root trace + generation refs and add typed trace fetch helper.
  - `apps/runtime/src/run-store.ts`: attach trace metadata to snapshots/session turns and return `runs.trail`.
- Blockers/Risks: Langfuse self-hosted/public trace fetch may need fallback-to-local synthesis; desktop/Tauri fallback also needs deterministic trail support.
- Verification status: not started.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [ ] Code Verification output (compilation/tests/lint)
- [ ] Functional Verification output (feature verification)
- [ ] Retrospective Evidence (if applicable)
- [ ] Comparison Evidence (if applicable)
- [ ] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, macOS, zsh, pnpm workspace, Tauri desktop shell, managed local Langfuse contract documented in-repo.

### Commands run + outputs
- Commands run + outputs:
