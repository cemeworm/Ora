# TASK-20260423-1644-ora-evaluation-v1

**Created:** 2026-04-23 16:44 CST
**Status:** Completed

---

## Goal
- Build Ora Evaluation v1 end-to-end across shared contracts, runtime execution/storage, CLI, and the desktop workbench. The new module should live under `Agent` as `Evaluation`, support file-imported benchmark datasets, batch execution across multiple agent-mode configs, layered scoring with preset evaluation profiles, regression/lab analysis views, and reusable runtime APIs so the same evaluation objects and execution path work for desktop, CLI, and CI.

## Scope / Out of scope
- In scope:
- Shared evaluation schemas and JSON-RPC method contracts in `packages/shared`.
- Runtime dataset import, evaluation run orchestration, scoring, scorecards, baselines, export, and CLI commands in `apps/runtime`.
- Desktop evaluation navigation/runtime client/state/view wiring and an Evaluation workbench in `apps/desktop`.
- Verification for shared/runtime/desktop behavior including import, execution, aggregation, and baseline flows.
- Out of scope:
- Product-internal dataset editor or human review queue.
- Sophisticated environment sandboxes for browser/code task completion beyond the v1 object and profile surface.
- Broad redesign of the existing Ora shell outside the navigation/view additions needed for Evaluation.

## Constraints
- Compatibility:
- Preserve the current `packages/shared` -> `apps/runtime` -> `apps/desktop` contract flow and keep evaluation execution built on top of existing `runs.start` behavior.
- Performance:
- Reuse runtime persistence and desktop shell patterns instead of building a separate eval-only store in the desktop app.
- Risk:
- This touches shared schemas, runtime persistence/JSON-RPC, CLI, and desktop state in one feature slice; drift between layers or over-designing the scoring/config surface are the main risks.
- Tool/Environment limits:
- Node/pnpm are available; Rust/Tauri verification may still be limited if `cargo` is unavailable.

## Plan
1. `packages/shared/src/index.ts` and shared tests: add evaluation domain schemas, method names, result/scorecard/baseline contracts, and import/export config shapes.
2. `apps/runtime/src/{run-store,json-rpc,cli,index}.ts` plus tests: implement dataset import, eval run orchestration/scoring/storage/baseline/export, expose JSON-RPC and CLI entrypoints, and verify import/execution/aggregation flows.
3. `apps/desktop/src/{types,lib,state,runtimeClient,components}`: add the `Evaluation` app view, wire runtime APIs, and build `Regression` / `Lab` workbench surfaces with dataset/run/case detail drill-down.
4. Run shared/runtime/desktop verification and document residual gaps in this journal.

## Active Files
- packages/shared/src/index.ts
- packages/shared/test/contracts.test.ts
- apps/runtime/src/run-store.ts
- apps/runtime/src/json-rpc.ts
- apps/runtime/src/cli.ts
- apps/runtime/test/**
- apps/desktop/src/types.ts
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/lib/state.tsx
- apps/desktop/src/components/**
- tasks/TASK-20260423-1644-ora-evaluation-v1.md

## Decisions
- Decision:
  - Why: Keep evaluation as a runtime-owned domain layered on top of existing per-run execution rather than inventing a second execution system in desktop.
  - Alternatives: Implement the entire feature as a desktop-only orchestration layer with local state and ad hoc aggregation.
  - Tradeoffs: More upfront runtime/schema work, but CLI/CI reuse and cross-surface consistency come for free once the contracts are in place.

## Progress Log
- 2026-04-23 16:44 CST - Task created
  Next: Fill in Goal, Scope, Plan, and list Active Files
- 2026-04-23 16:49 CST - Scoped the feature into shared/runtime/desktop layers after confirming current JSON-RPC and runtime-store seams. The feature should sit beside existing run/session primitives, not replace them.
  Next: Add shared eval schemas and method names; implement runtime dataset/run storage and JSON-RPC handlers; wire desktop Evaluation view to runtime.
- 2026-04-23 16:58 CST - Confirmed the concrete implementation seam: runtime can own evaluation storage and orchestration with minimal drift by adding parallel dataset/run/baseline maps and JSON-RPC methods, while desktop can stay thin with a dedicated `EvaluationView`.
  Next: Extend `packages/shared/src/index.ts` with eval contracts; implement runtime persistence/API/CLI; add desktop `evaluation` app view and UI wiring.
- 2026-04-23 17:12 CST - Landed the full Evaluation v1 slice across shared/runtime/desktop: runtime now owns dataset/run/baseline objects and CLI commands, while desktop exposes a dedicated `Evaluation` workbench with import, run creation, Regression/Lab analysis, case detail, baseline promotion, and export.
  Next: Finish verification closeout, capture CLI smoke evidence, and write residual risks/retrospective notes.

## Open Issues
- [ ] Need to keep the v1 scoring/config surface compact enough that the desktop creation flow stays understandable while still leaving room for CLI/CI reuse.
- [ ] Desktop browser fallback uses a lightweight in-memory eval implementation inside `runtimeClient.ts`; it is intentionally close to runtime behavior but not byte-for-byte identical to the real runtime evaluation store.

## TODO
- [x] Add evaluation domain schemas/contracts in shared.
- [x] Implement runtime evaluation dataset import/orchestration/storage/export/baseline APIs and CLI.
- [x] Build desktop Evaluation view and runtime wiring for Regression/Lab workbench flows.
- [x] Run verification and capture evidence/residual risk.

## Retrospective
- Record 0-3 highest-value pitfalls from this task.
- Leave reusable operational lessons here even when they later get promoted into a skill.

### Item 1
- Pitfall: Desktop browser fallback silently becomes a second product surface whenever a new runtime JSON-RPC domain is added.
- Symptom: Shared and runtime verification were already green, but desktop typecheck still failed because `apps/desktop/src/lib/runtimeClient.ts` did not understand the new `evaluation.*` methods and object shapes.
- Root Cause: Ora keeps an in-process deterministic JSON-RPC mock in the desktop app for browser fallback, so runtime-domain additions need parity work there or an explicit unsupported path.
- Reusable Guardrail: For every new JSON-RPC method family, search both the real runtime handler and the desktop local mock before declaring the contract slice complete.
- Evidence: This task needed new `evaluation.*` dispatch cases, in-memory dataset/run/baseline state, and mock scoring helpers inside `runtimeClient.ts`.
- Scope: Ora cross-layer features built on JSON-RPC contracts
- Suggested Writeback Target: Ora runtime contract migration checklist
- Status: candidate_for_skill

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [ ] Lint checks pass

**Output**: Paste command outputs

### Functional Verification (Feature Works)
- [x] Core functionality verification (specify method)
- [x] Edge cases verification
- [x] Error handling verification

**Output**: Paste verification results

**Examples**:
- Database: `SELECT * FROM table WHERE field_name IS NOT NULL LIMIT 5;`
- API: `curl "url" | jq '.results[0].field_name'`
- UI: Manual test steps and results
- Bug fix: Verification bug is fixed

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: _______

### Comparison Points
- [ ] Comparison point 1: _______
- [ ] Comparison point 2: _______
- [ ] Comparison point 3: _______

### Findings
- Consistency: The shipped shape matches the intended architecture: one runtime-owned evaluation domain shared by desktop and CLI, with Regression and Lab as distinct views over the same dataset/run/baseline objects.
- Differences: v1 keeps scoring intentionally heuristic and does not include a human review queue or advanced environment sandboxing; browser fallback uses an in-memory approximation of runtime eval storage.
- Conclusion: The implementation delivers the planned v1 product slice without inventing a second execution system or desktop-only eval store.

## Checkpoints

### Checkpoint 1: Shared + Runtime Evaluation Contracts
- Requirement: Evaluation schemas, method names, and runtime APIs compile and support import/run/query/export flows.
- Verification method: shared/runtime tests plus runtime CLI/API spot checks.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/shared test` passed (51/51); `pnpm --filter @ora/shared build` passed; `pnpm --filter @ora/runtime test` passed (50/50); `pnpm --filter @ora/runtime build` passed; CLI smoke flow imported a dataset, started an eval run, promoted a baseline, and exported CSV.

### Checkpoint 2: Desktop Evaluation Workbench
- Requirement: Desktop can navigate to Evaluation, create/load runs from runtime data, and render Regression/Lab/case-detail flows.
- Verification method: desktop typecheck/build plus targeted component/runtime wiring checks.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/desktop typecheck` passed; `pnpm --filter @ora/desktop build` passed; the new `EvaluationView` compiles against runtime-backed dataset/run/baseline APIs and is reachable from the sidebar.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Land Evaluation v1 as a runtime-owned domain with desktop Regression/Lab workbench and CLI/CI-ready APIs.
- Done: Shared contracts now include evaluation datasets/specs/runs/baselines/streams/export; runtime owns eval persistence, JSON-RPC methods, and CLI eval commands; desktop adds `Evaluation` navigation plus import/run/Regression/Lab/case-detail/export flows.
- In-progress: Closeout only.
- Active files: `packages/shared/src/index.ts`, `packages/shared/test/contracts.test.ts`, `apps/runtime/src/{evaluation-store,run-store,json-rpc,cli}.ts`, `apps/runtime/test/runtime-integration.test.ts`, `apps/desktop/src/{App,types,lib/runtimeClient,components/Sidebar,components/EvaluationView}.tsx`, this journal.
- Next actions (top 3; exact file/function): optional UI polish in `apps/desktop/src/components/EvaluationView.tsx`; optional parity improvement for browser fallback in `apps/desktop/src/lib/runtimeClient.ts`; optional richer scoring in `apps/runtime/src/evaluation-store.ts`.
- Blockers/Risks: Browser fallback eval logic is approximate; v1 scoring is suitable for product iteration but not yet a rigorous external benchmark harness.
- Verification status: Shared tests/build, runtime tests/build, desktop typecheck/build, and a CLI eval smoke flow all passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, macOS, zsh, Node/pnpm available. Rust/Tauri verification may be limited if `cargo` is unavailable.

### Commands run + outputs
- Commands run + outputs:
- `pnpm --filter @ora/shared test`
  - PASS: `test/contracts.test.ts` 51/51
- `pnpm --filter @ora/shared build`
  - PASS
- `pnpm --filter @ora/runtime test`
  - PASS: 6 files, 50/50 tests
- `pnpm --filter @ora/runtime build`
  - PASS
- `pnpm --filter @ora/desktop typecheck`
  - PASS
- `pnpm --filter @ora/desktop build`
  - PASS: Vite production build completed successfully
- CLI smoke flow
  - PASS: `pnpm --filter @ora/runtime exec tsx src/cli.ts eval import --file <tmp>/dataset.json`
  - PASS: `pnpm --filter @ora/runtime exec tsx src/cli.ts eval run --spec <tmp>/spec.json`
  - PASS: `pnpm --filter @ora/runtime exec tsx src/cli.ts eval promote-baseline --run eval-run-0001 --config orch --name "CLI Smoke Baseline"`
  - PASS: `pnpm --filter @ora/runtime exec tsx src/cli.ts eval export --run eval-run-0001 --format csv --output <tmp>/results.csv`
  - Evidence snippet:
    - `DATASET_ID=dataset-0001`
    - `RUN_ID=eval-run-0001`
    - exported CSV header: `case_id,config_id,overall_score,outcome_score,process_score,efficiency_score,safety_score,failure_tags,trace_run_ids`
- `bash skills/long-task-protocol/scripts/todo_scan.sh`
  - Noise only: reported prebuilt sidecar bundle TODOs under `apps/desktop/src-tauri/resources/runtime-sidecar/**`, not feature-scoped source edits
- Diff-scoped `TODO|FIXME` scan across touched source files
  - PASS: no feature-scoped TODO/FIXME markers
