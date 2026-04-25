# TASK-20260426-0101-ora-auto-agent-mode-router

**Created:** 2026-04-26 01:01 Asia/Shanghai
**Status:** Done

---

## Goal
- Add an explicit Auto work-mode option for Ora agent runs. When selected, the runtime runs a small LLM-based mode router before execution, chooses the best concrete mode from the current mode list, and then executes the run exactly as that resolved mode.

## Scope / Out of scope
- In scope:
  - Shared run config support for manual vs auto mode selection.
  - Runtime auto router using current provider/model, current prompt/session context, built-in modes, and custom modes.
  - Desktop composer Auto option that does not send `auto` as a real `modeId`.
  - Tests for schema compatibility, runtime selection/fallback, and desktop selection state.
- Out of scope:
  - Creating or editing `ModeSpec` presets from router output.
  - A separate router model/provider setting.
  - Learning from prior router outcomes or user feedback.
  - Reworking existing mode execution families.

## Constraints
- Compatibility: Existing runs with explicit `modeId` must behave exactly as before.
- Performance: Router adds one model call only when Auto is selected.
- Risk: Router output may be malformed or low confidence, so fallback must be deterministic.
- Tool/Environment limits: Preserve existing dirty changes in shared/runtime/desktop files for project file browsing.

## Plan
1. Update shared types in `packages/shared/src/index.ts` to add `modeSelection: "manual" | "auto"` with default `"manual"`.
2. Add runtime router logic in `apps/runtime/src/run-store.ts`: build candidates from `modeStore.list()`, call the configured provider with JSON-only instructions, validate `{ modeId, confidence, reason }`, and fallback to `single_agent`.
3. Store router explainability in `config.metadata.autoModeRouter` while persisting concrete `modeId` and `pattern` for snapshots/history.
4. Add desktop state and composer wiring in `apps/desktop/src/lib/state.tsx`, `apps/desktop/src/lib/useRunActions.ts`, `apps/desktop/src/lib/viewModel.ts`, `apps/desktop/src/components/ChatInput.tsx`, and related tests so Auto appears as a selection strategy.
5. Update browser/mock runtime client behavior in `apps/desktop/src/lib/runtimeClient.ts` so local mock runs resolve Auto deterministically.
6. Add and run targeted tests, then update this journal with evidence and remaining risks.

## Active Files
- `tasks/TASK-20260426-0101-ora-auto-agent-mode-router.md`
- `packages/shared/src/index.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/patterns/driver-registry.ts`
- `apps/runtime/test/runtime-smoke.test.ts`
- `apps/runtime/test/desktop-composer-state.test.ts`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/state.tsx`
- `apps/desktop/src/lib/useRunActions.ts`
- `apps/desktop/src/lib/viewModel.ts`
- `apps/desktop/src/components/ChatInput.tsx`
- `apps/desktop/src/components/ChatView.tsx`
- `apps/desktop/src/lib/runtimeClient.ts`

## Decisions
- Decision: Auto is a run selection strategy, not a `ModeSpec`.
  - Why: Snapshots, topology, history, evaluations, and Mode Studio should keep referring to concrete modes.
  - Alternatives: Add an `auto` system preset; infer automatically when no mode is selected.
  - Tradeoffs: Requires extra desktop/run config state, but avoids polluting mode editing and persisted run history.
- Decision: Use LLM JSON routing for v1.
  - Why: Existing mode summaries/recommended-use text are natural router inputs, and users need an explainable reason.
  - Alternatives: Static keyword rules or hybrid rules plus LLM.
  - Tradeoffs: Adds a model call and must handle malformed output, but produces better fit across custom modes.
- Decision: Fallback to `single_agent`.
  - Why: It is already the desktop default and the lowest-overhead execution path.
  - Alternatives: Fallback to selected manual mode or `orchestrator_subagent`.
  - Tradeoffs: Safe and simple, though it may under-use orchestration for complex prompts when routing fails.

## Progress Log
- 2026-04-26 01:01 - Task created with implementation plan and checkpoints.
  Next: Update shared run config schema; add runtime router; wire desktop Auto selection.
- 2026-04-26 01:12 CST - Shared schema, runtime auto router, desktop Auto selection state, and browser-mock fallback were implemented. Added runtime tests for fallback and custom-mode routing plus desktop reducer tests for Auto state hydration.
  Next: Run typecheck/tests/lint, capture TODO-scan evidence, and close checkpoints.
- 2026-04-26 01:16 CST - Verification passed: root typecheck, runtime-focused tests, and root lint all succeeded. Repository-wide `todo_scan.sh` remained noisy because it reports task-journal TODO headers across historical tasks, so a local file-scoped `rg --pcre2` fallback over the touched source files returned no blocking TODO/FIXME/XXX markers.
  Next: None.

## Open Issues
- None.

## TODO
- None.

## Retrospective
### Item 1
- Pitfall: Desktop-provided explicit `toolIds` can accidentally override the resolved mode defaults when mode choice is deferred to runtime.
- Symptom: In Auto mode, the run would have used the fallback/manual mode's tool set instead of the router-selected mode's capability defaults.
- Root Cause: Existing manual flow treated caller-supplied `toolIds` as a full override, which is fine when the caller already knows the concrete mode.
- Reusable Guardrail: When selection is deferred until runtime, merge caller-supplied additive tool ids onto the resolved mode defaults instead of replacing them.
- Evidence: `apps/runtime/src/run-store.ts` now merges `config.toolIds` with `modeSpec.capabilityFlags.toolIds` only for `modeSelection === "auto"`.
- Scope: local_only
- Suggested Writeback Target: n/a
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm -r --if-present typecheck` -> passed for `packages/shared`, `apps/runtime`, and `apps/desktop`.
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts desktop-composer-state.test.ts` -> passed; Vitest ran 12 files / 141 tests, including the updated runtime and desktop suites.
- `pnpm lint` -> passed.

### Functional Verification (Feature Works)
- [x] Auto selects a valid concrete mode.
- [x] Router failures fall back to `single_agent`.
- [x] Manual mode selection is unchanged.

**Output**:
- `apps/runtime/test/runtime-smoke.test.ts` now verifies `RunConfigSchema` defaults `modeSelection` to `manual`.
- `apps/runtime/test/runtime-smoke.test.ts` verifies invalid Auto routing falls back to `single_agent` and records fallback metadata.
- `apps/runtime/test/runtime-smoke.test.ts` verifies mocked JSON routing can select a cloned custom mode.
- `apps/runtime/test/desktop-composer-state.test.ts` verifies desktop state tracks `selectedModeSelection` separately from concrete `selectedModeId` and hydrates Auto state from snapshot config.

## Comparison (If Applicable)

### Reference
- Existing manual mode flow: desktop `selectedModeId` -> run config `modeId` -> runtime `resolveModeSelection` -> concrete snapshot mode.

### Comparison Points
- [x] Manual mode behavior remains unchanged.
- [x] Auto mode resolves before snapshot creation.
- [x] Mode Studio list remains concrete modes only.

### Findings
- Consistency: Existing manual `modeId` path still resolves directly and persists concrete mode ids as before.
- Differences: Auto adds a runtime-only selection strategy (`modeSelection`) plus `config.metadata.autoModeRouter`; no synthetic `ModeSpec` was added.
- Conclusion: The feature extends run selection behavior without changing mode editing or persisted history semantics.

## Checkpoints

### Checkpoint 1: Schema Compatibility
- Requirement: Existing run configs parse without `modeSelection`, and manual mode defaults remain unchanged.
- Verification method: Unit test and typecheck.
- Status: [x] Pass / [ ] Fail
- Evidence: `RunConfigSchema.parse({ pattern: "orchestrator_subagent" }).modeSelection === "manual"` test added in `apps/runtime/test/runtime-smoke.test.ts`; root typecheck passed.

### Checkpoint 2: Runtime Routing
- Requirement: Auto can select built-in/custom modes and safely falls back on invalid routing.
- Verification method: Runtime tests with mocked provider behavior.
- Status: [x] Pass / [ ] Fail
- Evidence: runtime smoke tests cover invalid JSON fallback to `single_agent` and successful selection of `agent-teams-auto-custom`.

### Checkpoint 3: Desktop UX Wiring
- Requirement: Auto is selectable in composer but persisted run state shows a concrete mode.
- Verification method: Desktop state tests and typecheck.
- Status: [x] Pass / [ ] Fail
- Evidence: desktop reducer tests cover explicit Auto selection and snapshot hydration; desktop typecheck passed.

## Compressed State (<= 20 lines)
- Objective: Add explicit Auto agent mode that routes each run to a concrete mode using LLM JSON selection.
- Done: Added `modeSelection` to run config, implemented runtime auto router with metadata/fallback, wired desktop Auto picker and state hydration, updated browser mock behavior, and added schema/runtime/desktop tests.
- In-progress: None.
- Active files: shared schema, runtime store + pattern driver + tests, desktop App/state/input/view model/runtime client, task journal.
- Next actions (top 3; exact file/function): None.
- Blockers/Risks: Existing unrelated dirty changes remain in nearby files and were preserved.
- Verification status: Passed (typecheck, runtime tests, lint, local TODO scan fallback).

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: local workspace `/Users/quintenchen/developer/Ora`, zsh, 2026-04-26 Asia/Shanghai.

### Commands run + outputs
- `pnpm --filter @ora/shared build`
  - Passed.
- `pnpm -r --if-present typecheck`
  - Passed for `packages/shared`, `apps/runtime`, and `apps/desktop`.
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts desktop-composer-state.test.ts`
  - Passed; Vitest reported 12 files and 141 tests passing.
- `pnpm lint`
  - Passed.
- `bash /Users/quintenchen/.codex/skills/long-task-protocol/scripts/todo_scan.sh`
  - Noisy for this repo because it reports historical task-journal `## TODO` sections outside this task; not suitable as blocking evidence by itself.
- `rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX" packages/shared/src/index.ts apps/runtime/src/run-store.ts apps/runtime/src/patterns/driver-registry.ts apps/runtime/test/runtime-smoke.test.ts apps/runtime/test/desktop-composer-state.test.ts apps/desktop/src/App.tsx apps/desktop/src/components/ChatInput.tsx apps/desktop/src/components/ChatView.tsx apps/desktop/src/lib/runtimeClient.ts apps/desktop/src/lib/state.tsx apps/desktop/src/lib/useRunActions.ts apps/desktop/src/lib/viewModel.ts`
  - No matches.
