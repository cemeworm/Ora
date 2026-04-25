# TASK-20260425-2054-ora-long-run-recovery-hardening

**Created:** 2026-04-25 20:54 CST
**Status:** Done

---

## Goal
- Harden Ora's long-running agent reliability by borrowing the most relevant DeerFlow middleware guardrails, starting with provider failure observability and recovery so repeated transient LLM failures do not keep every run hammering the provider blindly.

## Scope / Out of scope
- In scope:
  - Add a minimal provider health guard/circuit breaker around Ora model provider invocation.
  - Keep the existing `RecoveryCoordinator` and runtime event model as the source of per-run retry/fallback behavior.
  - Add focused tests proving transient failures retry, repeated provider failures trip fast-fail, and recovery can later close again.
  - Record the remaining DeerFlow parity gaps as follow-up checkpoints, not speculative implementation.
- Out of scope:
  - Rewriting Ora provider APIs or the coordination-pattern graph architecture.
  - Implementing full DeerFlow middleware parity in one pass: dangling tool-call repair, summarization rescue, todo re-entry, and richer loop detection stay as follow-ups unless this task reaches them explicitly.
  - Changing provider auth/billing behavior.
  - Rebuilding packaged sidecar artifacts.

## Constraints
- Compatibility: preserve existing provider registry public functions and run snapshot/event schemas unless a test proves a schema change is necessary.
- Performance: provider guard checks must be in-memory and O(1); no extra network call just to check health.
- Risk: keep edits surgical because the worktree is already dirty from prior Ora tasks.
- Tool/Environment limits: verify with pnpm TypeScript tests/typecheck available in this repo.

## Plan
1. `apps/runtime/src/providers/`: add a small provider health guard that tracks failures by provider id, trips after repeated transient/busy failures, supports recovery timeout and half-open probing, and resets on success.
2. `apps/runtime/src/providers/registry.ts`: wrap both non-streaming and streaming provider invocation with the guard before Langfuse generation tracing, without changing call sites.
3. `apps/runtime/test/`: add focused tests for retry-compatible transient failures plus guard fast-fail/recovery behavior; keep existing runtime recovery tests passing.
4. Update this journal after each meaningful implementation/verification step and close only after the journal, test, and retrospective gates pass.

## Active Files
- tasks/TASK-20260425-2054-ora-long-run-recovery-hardening.md
- apps/runtime/src/providers/registry.ts
- apps/runtime/src/providers/provider-health.ts
- apps/runtime/test/provider-health.test.ts
- apps/runtime/test/runtime-smoke.test.ts

## Decisions
- Decision: first optimization pass targets provider circuit-breaker behavior, not all DeerFlow middleware categories.
  - Why: earlier comparison found Ora already has per-run recovery events and artifacts, but lacks cross-run continuous-failure protection.
  - Alternatives: implement loop guard or todo continuity first.
  - Tradeoffs: improves the most expensive long-run failure mode now; leaves context/todo/dangling-tool parity as explicit follow-ups.
- Decision: implement provider health as an internal provider-layer wrapper.
  - Why: both deterministic kernel and LangGraph SessionManager call through `invokeRunProvider`, so provider-layer wrapping gives broad coverage with minimal surface churn.
  - Alternatives: duplicate guard logic in `runtime-kernel.ts` and LangGraph nodes.
  - Tradeoffs: less event-rich than kernel recovery events, but much more consistent and smaller.

## Progress Log
- 2026-04-25 20:54 CST - Created task journal from the DeerFlow/Ora comparison and scoped the first optimization pass to provider long-run protection.
  Next: inspect provider registry call paths, implement provider health guard, and add focused tests.
- 2026-04-25 21:02 CST - Added `ProviderHealthGuard` and wrapped provider registry `invoke`/`invokeStream` so repeated transient provider failures can fast-fail before another network call.
  Next: add focused provider health tests, run typecheck/tests, and update checkpoints.
- 2026-04-25 21:08 CST - Added focused provider health and registry tests; runtime test suite and runtime typecheck passed.
  Next: none.
- 2026-04-25 21:12 CST - Final verification repeated runtime tests/typecheck and recorded TODO scan behavior. The repo-wide scan is noisy because existing generated sidecar resources contain vendored TODOs; task-scoped scan only has allowed TODO(FOLLOWUP) entries mirrored in Open Issues.
  Next: none.

## Open Issues
- TODO(FOLLOWUP): LangGraph graph-node recovery parity still needs a separate decision after provider guard lands.
- TODO(FOLLOWUP): Rich loop detection, todo continuity, dangling tool-call repair, and summarization rescue remain DeerFlow parity follow-ups.

## TODO
- None.

## Retrospective
### Item 1
- Pitfall: Per-run retry alone does not protect long-running agent systems from repeated provider outages across many runs.
- Symptom: Ora could retry/fallback inside one run, but a new run would still immediately hit the same failing provider until its own recovery policy exhausted.
- Root Cause: Recovery policy lived in the runtime kernel, while provider health state was not tracked at the provider boundary.
- Reusable Guardrail: When model providers are shared across runs, add provider-layer health state in addition to run-local recovery decisions.
- Evidence: `ProviderHealthGuard` now tracks failures by provider id; provider registry tests assert both `invoke` and `invokeStream` fast-fail after the circuit opens.
- Scope: Ora runtime provider registry.
- Suggested Writeback Target: None.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass where applicable

**Output**:
- `pnpm --filter @ora/runtime test -- provider-health.test.ts`
  - Result: `Test Files  12 passed (12)`; `Tests  121 passed (121)`.
- `pnpm --filter @ora/runtime typecheck`
  - Result: exited 0.
- `git diff --check -- apps/runtime/src/providers/registry.ts apps/runtime/src/providers/provider-health.ts apps/runtime/test/provider-health.test.ts tasks/TASK-20260425-2054-ora-long-run-recovery-hardening.md`
  - Result: exited 0.

### Functional Verification (Feature Works)
- [x] Repeated transient provider failures trip fast-fail.
- [x] Provider success resets the guard.
- [x] Existing runtime retry/fallback tests still pass.

**Output**:
- `provider-health.test.ts` asserts two transient 503/server-busy failures open the circuit and the next call is not invoked.
- `provider-health.test.ts` asserts advancing the fake clock lets a successful half-open probe close the circuit.
- Runtime test output included existing `runtime-smoke.test.ts`, including provider retry/fallback coverage.

## Comparison

### Reference
- DeerFlow `LLMErrorHandlingMiddleware`: retry/backoff, transient classification, and circuit breaker.
- Ora existing `RecoveryCoordinator`: per-run retry/fallback/degraded artifact behavior.

### Comparison Points
- [x] Cross-run continuous provider failure protection.
- [x] Per-run recovery event compatibility.
- [x] Deterministic kernel and LangGraph provider-call coverage.

### Findings
- Consistency: Ora now matches DeerFlow's provider-level intent: repeated transient provider failures can trip a short-lived circuit instead of every call repeating the same network failure.
- Differences: DeerFlow emits middleware retry events directly from the LLM middleware; Ora keeps per-run recovery events in `RecoveryCoordinator` and keeps the provider guard internal.
- Conclusion: This first optimization closes the highest-leverage provider outage gap while leaving richer loop/todo/context middleware parity as follow-ups.

## Checkpoints

### Checkpoint 1: Provider Guard
- Requirement: repeated transient/busy provider failures open a short-lived circuit and produce a clear fast-fail error.
- Verification method: focused unit test.
- Status: [x] Pass / [ ] Fail
- Evidence: `provider-health.test.ts` checks `ProviderCircuitOpenError` and `fetchCalls === 1` after the circuit opens.

### Checkpoint 2: Recovery Reset
- Requirement: after recovery timeout, a successful half-open probe closes the circuit and clears failure count.
- Verification method: focused unit test with fake clock.
- Status: [x] Pass / [ ] Fail
- Evidence: `provider-health.test.ts` advances the fake clock, returns a successful model response, and asserts `state: "closed"` with `failureCount: 0`.

### Checkpoint 3: Registry Coverage
- Requirement: both `invoke` and `invokeStream` use provider health guard through the provider registry.
- Verification method: focused provider registry test or runtime smoke test.
- Status: [x] Pass / [ ] Fail
- Evidence: provider registry tests cover both `registry.invoke()` and `registry.invokeStream()` with injected health guard.

### Checkpoint 4: No Regression
- Requirement: existing runtime recovery tests still pass.
- Verification method: run relevant vitest files.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/runtime test -- provider-health.test.ts` ran 12 runtime test files and 121 tests successfully.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: harden Ora long-running provider failure behavior using DeerFlow-inspired provider health protection.
- Done: provider health guard, registry wrapping for invoke/invokeStream, focused tests, runtime typecheck.
- In-progress: none.
- Active files: task journal, provider registry, new provider health test/source.
- Next actions (top 3; exact file/function): none for this pass.
- Blockers/Risks: dirty worktree contains prior unrelated Ora changes; follow-up DeerFlow parity items remain open.
- Verification status: passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, pnpm TypeScript monorepo, 2026-04-25 CST.

### Commands run + outputs
- `pnpm --filter @ora/runtime test -- provider-health.test.ts`
  - Output: `Test Files  12 passed (12)`; `Tests  121 passed (121)`.
- `pnpm --filter @ora/runtime typecheck`
  - Output: exited 0.
- `git diff --check -- apps/runtime/src/providers/registry.ts apps/runtime/src/providers/provider-health.ts apps/runtime/test/provider-health.test.ts tasks/TASK-20260425-2054-ora-long-run-recovery-hardening.md`
  - Output: exited 0.
- `bash skills/long-task-protocol/scripts/todo_scan.sh --task /Users/quintenchen/developer/ora/tasks/TASK-20260425-2054-ora-long-run-recovery-hardening.md`
  - Output: script ignored `--task` and reported existing generated sidecar TODOs under `apps/desktop/src-tauri/resources/runtime-sidecar/...`; not task-authored source.
- `rg -n "TODO|FIXME" tasks/TASK-20260425-2054-ora-long-run-recovery-hardening.md apps/runtime/src/providers/provider-health.ts apps/runtime/src/providers/registry.ts apps/runtime/test/provider-health.test.ts`
  - Output: only allowed `TODO(FOLLOWUP)` entries in Open Issues plus the `## TODO` section header; no code TODO/FIXME in touched source/test files.
