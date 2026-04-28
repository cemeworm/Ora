# TASK-20260428-2347-evaluation-studio-planner-workbench

**Created:** 2026-04-28 23:47 CST
**Status:** Completed

## Goal
Implement the Evaluation Studio workbench redesign: history-first UI, planner conversation as the first step for new evaluations, evaluator specs for heuristic / LLM judge / human annotation, runtime planner and annotation APIs, and persistence-compatible scoring/export updates.

## Scope / Out of scope
- In scope: shared evaluation contracts, runtime persistence/API/scoring, desktop runtime client, EvaluationView workbench UI, focused integration/contract verification.
- Out of scope: external eval platform integrations, arbitrary JavaScript/Python evaluators, multi-user annotation assignment.

## Constraints
- Compatibility: Existing datasets, blueprints, eval specs, runs, baselines, exports, and router eval tests must keep working.
- Performance: v1 keeps existing sequential run execution and adds evaluator scoring without adding background services.
- Risk: LLM judge failures are captured as evaluator errors, not whole-run crashes.
- Tool/Environment limits: No new dependencies; use existing provider invocation and runtime store paths.

## Plan
1. Add shared evaluator, annotation, and planner-turn contracts.
2. Add runtime planner turn, annotation persistence/list/submit, evaluator scoring, and export evidence.
3. Add desktop runtime client calls and browser fallback behavior.
4. Replace the linear EvaluationView with a history-first workbench.
5. Run shared/runtime/desktop verification and record evidence.

## Active Files
- `packages/shared/src/evaluation.ts`
- `packages/shared/test/contracts.test.ts`
- `apps/runtime/src/evaluation-store.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/test/runtime-integration.test.ts`
- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/lib/runtimeClient.test.ts`
- `apps/desktop/src/components/EvaluationView.tsx`

## Decisions
- Decision: Keep evaluator specs embedded in `EvaluationObjective` / `EvaluationBlueprint.evaluatorPlan`.
  - Why: The current evaluation store already owns local datasets, runs, scoring, and persistence.
  - Alternatives: New evaluator service or external platform adapter.
  - Tradeoffs: Lower migration risk and no new dependency; less reusable than a standalone evaluator engine.
- Decision: LLM judge uses the existing provider invocation path and strict JSON parsing.
  - Why: It matches Ora provider config semantics and keeps judge failures observable.
  - Tradeoffs: Judge provider config is v1-simple and inherited from run config unless overridden.
- Decision: Human annotation is a local queue.
  - Why: It satisfies the requested human-in-the-loop path without adding users/permissions/assignment.
  - Tradeoffs: No multi-reviewer arbitration in v1.

## Progress Log
- 2026-04-28 23:47 CST - Task created and implementation scope mapped across shared/runtime/desktop.
- 2026-04-29 00:02 CST - Added shared evaluator/planner/annotation contracts and runtime methods.
- 2026-04-29 00:06 CST - Added runtime planner fallback/provider path, heuristic/LLM/human evaluator scoring, annotation persistence, submit flow, and export evidence.
- 2026-04-29 00:08 CST - Replaced EvaluationView with a history-first planner workbench and added desktop fallback coverage.
- 2026-04-29 00:10 CST - Verification passed; repo-wide TODO helper remains noisy due historical/generated files, so touched-file fallback scan was used.

## Open Issues
- None.

## TODO
- None.

## Retrospective
### Item 1
- Pitfall: Repo-wide TODO scan is too noisy for this Ora workspace.
- Symptom: It reports historical task journals, generated sidecar bundles, runtime DB binaries, and target artifacts.
- Root Cause: The helper scans broad repository paths instead of task-owned source paths.
- Reusable Guardrail: Pair the mandated helper with a touched-file `rg --pcre2 "TODO(?!\(FOLLOWUP\))|FIXME|XXX|\[ \]"` fallback and record both.
- Evidence: Repo-wide scan emitted unrelated historical/generated/binary matches; touched-file scan had no source TODO/FIXME/XXX matches after this journal was closed.
- Scope: local_only
- Suggested Writeback Target: none
- Status: local_only

## Functional Verification
### Code Verification
- `pnpm --filter @ora/shared typecheck && pnpm --filter @ora/shared build && pnpm --filter @ora/shared test -- contracts.test.ts`
  - Passed: 85 shared contract tests.
- `pnpm --filter @ora/runtime typecheck && pnpm --filter @ora/runtime exec vitest run test/runtime-integration.test.ts -t "LLM judge|planner turn|human annotation|scores auto mode routing"`
  - Passed: 4 targeted runtime tests.
- `pnpm --filter @ora/desktop typecheck && pnpm --filter @ora/desktop test -- runtimeClient.test.ts`
  - Passed: desktop typecheck and 58 tests.
- `git diff --check`
  - Passed.

### Functional Verification
- Planner turn creates and persists blueprint with `llm_judge` and `human_annotation` evaluator specs.
- Human annotation evaluator creates pending annotation tasks; submit updates run score evidence and clears pending count.
- LLM judge evaluator parses structured provider JSON and records score/rationale/failure tags.
- Desktop browser fallback mirrors planner, compile, run, annotation list, and submit flows.

## Comparison
- Reference sources: Langfuse scores/annotation queues, Phoenix LLM eval structured output, Promptfoo assertions/rubrics, Opik regression loop.
- Consistency: Ora now has unified evaluator result evidence, deterministic heuristics, LLM judge JSON scoring, local human review queue, and failure-to-regression-loop UI.
- Differences: Ora remains local-first and does not integrate external projects, auth, hosted queues, or arbitrary scorer code.
- Conclusion: The implementation follows the requested product patterns while staying native to Ora runtime persistence.

## Checkpoints
### Checkpoint 1: Contracts
- Requirement: Shared schemas support evaluator specs, planner turns, annotation tasks, and old blueprint compatibility.
- Verification method: shared contract tests.
- Status: Pass.
- Evidence: 85 shared tests passed.

### Checkpoint 2: Runtime
- Requirement: Planner, heuristic/LLM/human evaluators, annotation persistence, and export evidence work through JSON-RPC.
- Verification method: runtime typecheck and targeted integration tests.
- Status: Pass.
- Evidence: runtime typecheck passed; 4 targeted runtime tests passed.

### Checkpoint 3: Desktop
- Requirement: Evaluation Studio is history-first and exposes planner/detail/annotation flows.
- Verification method: desktop typecheck and runtime client fallback tests.
- Status: Pass.
- Evidence: desktop typecheck passed; runtime client suite passed.

## Compressed State
- Objective: Implement Evaluation Studio planner workbench and evaluator specs.
- Done: Shared schemas, runtime APIs/persistence/scoring/export, desktop client fallback, and UI workbench implemented.
- Active files: shared evaluation contracts/tests; runtime evaluation-store/json-rpc/run-store/tests; desktop EvaluationView/runtimeClient/tests.
- Next actions: none.
- Blockers/Risks: repo-wide TODO helper is noisy; no live browser screenshot run was performed.
- Verification status: Passed focused typechecks/tests and diff check.

## Verification
### Environment
- Workspace: `/Users/quintenchen/developer/Ora`
- Date: 2026-04-29 CST

### Commands run + outputs
- Shared: `pnpm --filter @ora/shared typecheck && pnpm --filter @ora/shared build && pnpm --filter @ora/shared test -- contracts.test.ts` -> pass, 85 tests.
- Runtime: `pnpm --filter @ora/runtime typecheck && pnpm --filter @ora/runtime exec vitest run test/runtime-integration.test.ts -t "LLM judge|planner turn|human annotation|scores auto mode routing"` -> pass, 4 targeted tests.
- Desktop: `pnpm --filter @ora/desktop typecheck && pnpm --filter @ora/desktop test -- runtimeClient.test.ts` -> pass, 58 tests.
- Whitespace: `git diff --check` -> pass.
- Repo TODO helper: `bash /Users/quintenchen/.codex/skills/long-task-protocol/scripts/todo_scan.sh` -> exited 0 but emitted unrelated historical/generated/binary TODO noise.
- Touched-file TODO fallback: `rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX|\\[ \\]" <task active files>` -> no source/test matches after closing this journal.
