# TASK-20260424-1329-modeview-capability-topology

**Created:** 2026-04-24 13:29 CST
**Status:** Complete

---

## Goal
- Upgrade Ora's mode topology so DeerFlow-like capability orchestration is no longer limited to badges outside the graph. Mode Studio and Trails should both render runtime atoms as capability topology, while preserving the existing execution-stage DAG as the primary control flow.

## Scope / Out of scope
- In scope:
  - Add shared topology-projection metadata for runtime atoms.
  - Project active mode atoms and node atoms into topology output without turning them into regular executable stages.
  - Render projected capability topology in Mode Studio and Trails.
  - Keep the projected topology driven by runtime truth, not desktop-only heuristics.
  - Add tests for shared projection logic, runtime topology output, and desktop type/build correctness.
- Out of scope:
  - User-defined atom implementations.
  - Arbitrary freeform capability-to-capability wiring.
  - Replacing the existing stage DAG with a pure capability graph.

## Constraints
- Compatibility: preserve current mode family behavior and existing runtime atom semantics.
- Performance: topology projection must stay local/pure and not require extra runtime services.
- Risk: current worktree already contains unrelated runtime changes; do not revert or absorb them.
- Tool/Environment limits: prefer targeted tests and type checks; keep verification explicit if any environment blocker appears.

## Plan
1. `packages/shared/src/index.ts`:
   add runtime-atom presentation metadata and a shared projector that augments topology with capability nodes/attachments while preserving family built-ins like message-bus/shared-state capability nodes.
2. `apps/runtime/**` and bootstrap path:
   switch runtime topology generation to the shared projector so runs and trails read the same projected truth.
3. `apps/desktop/src/**`:
   extend topology view models and Mode Studio / Trails rendering so capability nodes and stage attachments are visible, selectable, and configuration-backed.
4. Verification:
   run shared tests, runtime smoke tests, desktop typecheck, and a TODO scan; record all evidence in this task.

## Active Files
- /Users/quintenchen/developer/ora/tasks/TASK-20260424-1329-modeview-capability-topology.md
- /Users/quintenchen/developer/ora/packages/shared/src/index.ts
- /Users/quintenchen/developer/ora/packages/shared/test/contracts.test.ts
- /Users/quintenchen/developer/ora/apps/runtime/src/run-store.ts
- /Users/quintenchen/developer/ora/apps/runtime/src/session/session-manager.ts
- /Users/quintenchen/developer/ora/apps/runtime/test/runtime-smoke.test.ts
- /Users/quintenchen/developer/ora/apps/desktop/src/types.ts
- /Users/quintenchen/developer/ora/apps/desktop/src/lib/viewModel.ts
- /Users/quintenchen/developer/ora/apps/desktop/src/components/TopologyPanel.tsx
- /Users/quintenchen/developer/ora/apps/desktop/src/components/TrailsTabs.tsx
- /Users/quintenchen/developer/ora/apps/desktop/src/components/ModesView.tsx

## Decisions
- Decision: represent runtime atoms as capability topology instead of executable stages.
  - Why: this matches the current product intent and avoids corrupting execution-order semantics.
  - Alternatives: treat all atoms as first-class DAG nodes; keep atoms in side panels only.
  - Tradeoffs: graph semantics stay clearer, but capability projection needs explicit display rules.
- Decision: ship Mode Studio and Trails together on one shared projector.
  - Why: edit-time and run-time topology drifting would be confusing and expensive to maintain.
  - Alternatives: Studio-only first; Trails-only first.
  - Tradeoffs: broader surface area now, lower long-term divergence.
- Decision: first wave includes all currently implemented atoms.
  - Why: avoids a special-case memory/tool-only model that would be refactored immediately.
  - Alternatives: only memory/tool; only memory.
  - Tradeoffs: more UI mapping work up front, stronger consistency once done.

## Progress Log
- 2026-04-24 13:29 CST - Task created after locking the design: capability topology should project runtime atoms as capability nodes or stage attachments rather than executable DAG stages.
  Next: inspect the exact shared/runtime/desktop seams that currently generate topology, then implement the shared projector, then thread it through runtime and desktop.
- 2026-04-24 13:36 CST - Inspected the full topology truth path. Shared `modeSpecToPatternDefinition()` is the primary seam; runtime `run-store` and `session-manager` consume that definition directly; desktop `Mode Studio` canvas still only renders stage nodes, while Trails already tolerates `kind: capability` in snapshot topology.
  Next: add shared atom presentation metadata and a projected-topology helper, thread runtime through that helper without changing atom behavior, then upgrade Mode Studio canvas/types so capability items are selectable and configurable from the graph.
- 2026-04-24 13:42 CST - Landed the main implementation slice. Shared contracts now carry atom topology metadata plus `projectModeRuntimeTopology()`, runtime smoke now asserts projected capability nodes in live snapshots, and desktop Mode Studio / Trails topology surfaces both understand capability nodes and stage attachments.
  Next: run verification, resolve the TODO-scan workspace drift safely, then close the task with checkpoints and retrospective evidence.
- 2026-04-24 13:45 CST - Verification passed. Shared tests, runtime smoke tests, desktop typecheck, and root lint all succeeded. The stock `todo_scan.sh` drifted into the Quantfox workspace again, so I recorded that failure mode and used a local `rg --pcre2` fallback on the Ora-changed files, which returned no blocking TODO/FIXME/XXX matches.
  Next: none; task is ready to close.

## Open Issues
- [x] Confirm the cleanest runtime insertion point so both bootstrap previews and live runs use the same projected topology path.
- Resolution: `packages/shared/src/index.ts` was the correct insertion point; updating `modeSpecToPatternDefinition()` was sufficient because runtime and desktop already consume its output.

## TODO
- [x] Add shared runtime-atom presentation metadata and projection helpers.
- [x] Replace direct family-topology passthrough with projected topology generation.
- [x] Thread projected topology through runtime state creation and resume paths.
- [x] Update desktop topology types and view-model adapters for capability nodes/attachments.
- [x] Update Mode Studio topology/config surfaces to expose projected capability topology.
- [x] Update Trails topology rendering to distinguish capability nodes from agent nodes.
- [x] Run verification commands and capture evidence.

## Retrospective
### Item 1
- Pitfall: Cross-repo long-task helpers can silently point at the wrong workspace.
- Symptom: `todo_scan.sh` reported a PASS for a Quantfox task instead of scanning the current Ora task/files.
- Root Cause: The shared helper script resolves its own prior task context and is not repo-aware in this environment.
- Reusable Guardrail: Always inspect the reported task path from `todo_scan.sh`; if it is outside the current repo, record the drift and run a local file-scoped TODO fallback instead of treating the result as valid evidence.
- Evidence: `todo_scan.sh` returned `Task file: /Users/quintenchen/developer/quantfox/tasks/...`; local fallback `rg --pcre2` over the Ora-changed files returned no matches.
- Scope: cross_repo_tooling
- Suggested Writeback Target: `long-task-protocol` reference or helper wrapper that validates cwd/task-root alignment first.
- Status: candidate_for_skill

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**: Paste command outputs

### Functional Verification (Feature Works)
- [x] Mode topology includes active capability projection
- [x] Trails topology includes active capability projection
- [x] Stage attachments remain non-executable and configuration-backed

**Output**: Paste verification results

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: `tasks/TASK-20260424-0108-deerflow-mode-atoms.md`, `tasks/TASK-20260423-1215-runtime-five-pattern-kernel.md`

### Comparison Points
- [ ] Atom truth path still flows from shared -> runtime -> desktop.
- [ ] Family-native capability nodes are reused instead of duplicated.
- [ ] Capability topology does not change executable stage ordering.

### Findings
- Consistency: preserved the existing shared -> runtime -> desktop truth path; capability topology now follows the same chain.
- Differences: runtime topology remains family/agent oriented while Mode Studio canvas remains stage oriented, so the shared contract now centralizes atom presentation metadata and runtime projection, while desktop uses the same metadata to project editor-only capability nodes over the stage DAG.
- Conclusion: the implementation stays consistent with the earlier DeerFlow-atoms work without collapsing execution stages and cross-cutting capabilities into one graph model.

## Checkpoints

### Checkpoint 1: Shared projector landed
- Requirement: shared contracts can project mode atoms and node atoms into topology deterministically.
- Verification method: shared contract tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/shared test` passed 66/66, including the new `projects active runtime atoms into capability topology without duplicating family built-ins` case.

### Checkpoint 2: Runtime emits projected topology
- Requirement: runtime snapshots and trails use the shared projected topology.
- Verification method: runtime smoke tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts` passed 70/70; smoke assertions now confirm `memory_capture` / `tool_error_boundary` capability nodes in a live run and `subagent_delegate` attachment projection for the delegated stage case.

### Checkpoint 3: Desktop renders projected capability topology
- Requirement: Mode Studio and Trails both show capability topology without breaking type safety.
- Verification method: desktop typecheck and targeted UI-oriented assertions/manual reasoning from component code.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/desktop typecheck` exited 0 after the canvas, inspector, topology-panel, and view-model changes. Mode Studio now builds canvas nodes for mode capabilities and active node attachments, while Trails consumes `kind: capability` with dedicated layout and styling.

## Compressed State (<= 20 lines)
- Objective: project runtime atoms into Ora topology so capabilities are configurable and observable in Mode Studio and Trails.
- Done: shared atom topology metadata added; runtime projector landed; runtime smoke asserts projected capability nodes; desktop topology types/layout/rendering upgraded; Mode Studio graph can select and toggle capabilities; verification completed.
- In-progress: none.
- Active files: shared contracts, runtime topology emitters, desktop topology renderers, this task file.
- Next actions (top 3; exact file/function):
-  - none
-  - none
-  - none
- Blockers/Risks: no blocker for this task; only residual risk is that the packaged `runtime-sidecar.cjs` artifact was not rebuilt in this task, so source-level truth is correct but packaged artifacts should still be regenerated as part of a later packaging/build pass if needed.
- Verification status: passed (`@ora/shared test`, `@ora/runtime test -- runtime-smoke.test.ts`, `@ora/desktop typecheck`, root `pnpm lint`, local TODO fallback scan).

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: local Ora monorepo at `/Users/quintenchen/developer/ora`

### Commands run + outputs
- `pnpm --filter @ora/shared test`
  - PASS: `test/contracts.test.ts` 66/66
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts`
  - PASS: 7 test files, 70/70 tests
  - Includes new live assertions for projected capability nodes in `state.topology`
- `pnpm --filter @ora/desktop typecheck`
  - PASS: exited 0 with no type errors
- `pnpm lint`
  - PASS: root `pnpm -r --if-present lint` completed successfully
- `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh`
  - NOT VALID FOR THIS REPO: helper drifted to `/Users/quintenchen/developer/quantfox/tasks/...`
- `rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX" <ora changed files>`
  - PASS: no matches in the changed Ora code files
