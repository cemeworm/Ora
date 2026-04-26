# TASK-20260426-2213 - Ora Clarify-First Runtime Guard

## Goal
Add a runtime-level clarify-first path for materially ambiguous user requests where proceeding would likely answer the wrong target, take the wrong action, or create a costly mistake.

## Scope
- Reuse the existing runtime clarification interrupt contract: `pendingClarifications` plus `runs.resume.patch.clarifications`.
- Trigger the guard before tool use or answer generation when `clarification_interrupt` is active.
- Render the clarification as normal assistant-side chat content.
- Treat the next user composer submit as the clarification answer when a selected run is waiting for clarification.
- Preserve existing approval behavior and unrelated dirty worktree changes.

## Success Criteria
- The reported `跨境扫码付` prompt interrupts before `web.search`.
- The clarification question asks for role and scale/constraint details without inventing `交易量不大`.
- Resume with a clarification answer clears pending clarifications and continues the original run.
- Ordinary preference/style ambiguity does not interrupt.
- Desktop chat shows the clarification in the conversation and resumes the selected run from the next input.

## Plan
- [x] Add runtime preflight guard and regression coverage.
- [x] Add resumed clarification context to model-visible messages.
- [x] Add desktop in-chat clarification rendering and composer resume wiring.
- [x] Run targeted verification.

## Active Files
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/test/runtime-smoke.test.ts`
- `apps/desktop/src/lib/useRunActions.ts`
- `apps/desktop/src/lib/viewModel.ts`
- `apps/runtime/test/desktop-composer-state.test.ts`

## Progress Log
- 2026-04-26 22:13 CST - Task journal created from approved plan. Existing dirty worktree includes runtime kernel, desktop state/view model, and unrelated desktop component changes; implementation must preserve them.
  Next: add the narrow runtime preflight guard, then wire desktop resume behavior and tests.
- 2026-04-26 22:22 CST - Corrected implementation direction after user rejected hardcoded `hasHighConsequenceDomain` / referent / decision regex rules in `runtime-kernel.ts`. The guard is now model-driven: tools disabled, strict JSON contract, no domain case table in runtime code.
  Next: rerun targeted runtime, composer, and desktop typecheck verification; then record DONE evidence.
- 2026-04-26 22:24 CST - Verification passed after scoping preflight behind desktop-provided `metadata.clarificationPreflight` so low-level provider/tool-loop fixtures do not consume an extra model response. Runtime source no longer contains the rejected hardcoded names or payment case strings.
  Next: final response with concise implementation summary and residual risk.
- 2026-04-26 22:35 CST - User reported `run-0028` still searched before clarification. DB inspection showed desktop did pass `clarificationPreflight: true`, so the miss was inside the runtime preflight decision rather than the desktop switch. A brief provider/tool-choice hardening attempt was rejected as the wrong boundary and was fully reverted. Current fix keeps the policy in runtime/mode: the preflight now asks for material missing variables that would change the outcome/action and treats a non-empty missing-variable decision as a clarification interrupt. No provider-layer clarification rules remain.
  Next: rerun targeted runtime and desktop verification.

## Verification
- `rg -n "hasHighConsequenceDomain|hasAmbiguousSelfReference|asksForConcreteDecision|跨境扫码付|清算通道方|月交易额" apps/runtime/src/harness/runtime-kernel.ts || true`
  - PASS: no output; rejected hardcoded guard names and payment-specific case strings are absent from runtime source.
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts`
  - PASS: 12 files, 187 tests passed.
- `pnpm --filter @ora/runtime test -- desktop-composer-state.test.ts`
  - PASS: 12 files, 187 tests passed.
- `pnpm --filter @ora/desktop typecheck`
  - PASS: `tsc --noEmit`.
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts`
  - PASS after `run-0028` follow-up: 12 files, 187 tests passed.
- `pnpm --filter @ora/runtime test -- desktop-composer-state.test.ts`
  - PASS after `run-0028` follow-up: 12 files, 187 tests passed.
- `pnpm --filter @ora/desktop typecheck`
  - PASS after `run-0028` follow-up: `tsc --noEmit`.
- Open-task scan over the task journal plus touched runtime/desktop files
  - PASS after closing this plan: no open task items remain in touched files.

## Open Issues
- None yet.

## Retrospective
- Status: candidate_for_skill
  Evidence: The first pass implemented the behavior with hardcoded domain/referent/action regex in `runtime-kernel.ts`, which the user correctly rejected as not matching a native AI agent design.
  Lesson: clarification policy should be model-driven or mode-configured; runtime code may define the decision contract and interruption mechanics, but should not encode business-domain case tables for open-ended agent judgment.
  Suggested writeback target: Ora runtime/mode guidance for future clarify-first or safety preflight work.

## Compressed State
- Implementing clarify-first as a model-driven runtime preflight, not a finance-specific or regex-based prompt patch.
- Existing `clarification_interrupt` already supports `pendingClarifications`, `clarification.required`, and resume patches.
- Desktop composer now submits the next user input as a clarification resume patch when the selected run has a pending clarification.
- The clarification preflight is enabled by desktop run metadata and still requires the mode's `clarification_interrupt` atom.
- Existing unrelated dirty worktree changes remain present and were not reverted.
