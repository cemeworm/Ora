# TASK-20260426-2220-ora-evaluation-guided-workflow

**Created:** 2026-04-26 22:20 CST
**Status:** Completed

---

## Goal
- Rework the desktop Evaluation surface into a guided 4-step workflow: prepare samples, choose evaluation target, run evaluation, and review/solidify results. Keep the existing runtime-owned `evaluation.*` APIs and scoring behavior unchanged, while making the first-screen product flow understandable for ordinary Ora users.

## Scope / Out of scope
- In scope:
  - Product-flow and layout rewrite in `apps/desktop/src/components/EvaluationView.tsx`.
  - Keep feedback inbox, dataset import, run start, result analysis, baseline promotion, and JSON/CSV export usable.
  - Use existing UI primitives already present in the desktop app.
  - Desktop type/build and runtime regression verification.
- Out of scope:
  - New shared/runtime JSON-RPC contracts.
  - Changes to evaluation scoring, dataset parsing, CLI behavior, or storage schema.
  - Broad redesign of sidebar, chat, Trails, Mode Studio, or Settings.

## Constraints
- Compatibility: Preserve all existing runtime client calls and object shapes.
- Performance: Keep data loading at the current index/detail level; do not add polling or heavy derived queries.
- Risk: The worktree already has unrelated dirty files, including existing edits around Evaluation UI primitives. Avoid reverting or normalizing unrelated changes.
- Tool/Environment limits: Verification will use pnpm commands available in this repo.

## Plan
1. `apps/desktop/src/components/EvaluationView.tsx`: replace internal-object-first layout with a guided shell, step cards, contextual CTA, dataset/feedback preparation, target selection, run start, and review surfaces.
2. `apps/desktop/src/components/EvaluationView.tsx`: preserve feedback inbox, result tables, case drilldown, export, and baseline promotion in the new flow.
3. `tasks/TASK-20260426-2220-ora-evaluation-guided-workflow.md`: keep implementation state, verification evidence, checkpoints, and retrospective current.

## Active Files
- apps/desktop/src/components/EvaluationView.tsx
- tasks/TASK-20260426-2220-ora-evaluation-guided-workflow.md

## Decisions
- Decision: Use a guided app-workbench layout, not a wizard that hides completed steps.
  - Why: Users need an obvious next step, but advanced users still need to inspect runs, feedback, and baselines without losing context.
  - Alternatives: Full modal wizard; keep current tabbed workbench and only add copy.
  - Tradeoffs: More component structure in one file, but no runtime/API expansion and less risk than a new route.
- Decision: Keep advanced controls collapsed in the target step.
  - Why: Baseline/model/repetition are useful but not the first mental model for ordinary users.
  - Alternatives: Remove them entirely or leave them in the always-visible sidebar.
  - Tradeoffs: Slightly more interaction for experts, much cleaner first screen.

## Progress Log
- 2026-04-26 22:20 CST - Task journal created and filled from the approved plan.
  Next: Refactor `EvaluationView.tsx`; run desktop type/build and runtime tests; record verification evidence.
- 2026-04-26 22:29 CST - Reworked `EvaluationView.tsx` into a 4-step guided workbench with sample preparation, target selection, run confirmation, and review/solidification surfaces. Existing runtime client calls stayed on the current `evaluation.*` APIs.
  Next: Run verification and browser smoke check; close journal.
- 2026-04-26 22:34 CST - Verification passed: desktop typecheck/build, runtime tests, and Chrome smoke checks for Step 1 and Step 2 on `http://127.0.0.1:1421/`.
  Next: Final response with scope, verification, and residual risk.

## Open Issues
- [ ] TODO(FOLLOWUP): Full narrow-width visual QA should be repeated in a dedicated browser automation pass if this page gets more dense result data.

## TODO
- None.

## Retrospective
- No retrospective items yet.

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [ ] Lint checks pass

**Output**:
- `pnpm --filter @ora/desktop typecheck` PASS after fixing one TS narrowing issue in the feedback-tab branch.
- `pnpm --filter @ora/desktop build` PASS. Vite built 2083 modules; emitted the existing chunk-size warning for large bundles.
- `pnpm --filter @ora/runtime test` PASS: 12 files, 187 tests.
- Lint was not run separately because this repo's requested verification plan for this task was typecheck/build/runtime tests.

### Functional Verification (Feature Works)
- [x] Core functionality verification (specify method)
- [x] Edge cases verification
- [x] Error handling verification

**Output**:
- Chrome smoke check on `http://127.0.0.1:1421/` opened the Evaluation page successfully.
- Verified Step 1 empty-state rendering: visible 4-step rail, `准备样本`, import CTA, feedback inbox, empty dataset guidance, and right-side current-state panel.
- Verified Step 2 rendering by clicking `选择对象`: dataset selector, profile selector, mode cards, advanced-settings entry, and right-side status panel rendered without overlap at desktop width.
- Verified error/disabled state by source and browser inspection: run CTA remains blocked when no dataset is selected and shows the missing dataset guidance in Step 3.

## Comparison

### Reference
- Reference implementation/template/similar task: `tasks/TASK-20260423-1644-ora-evaluation-v1.md` and `tasks/TASK-20260425-2114-ora-feedback-curator-inbox.md`

### Comparison Points
- [x] Existing runtime-owned eval contracts stay unchanged.
- [x] Existing feedback inbox remains the governance gate for feedback samples.
- [x] Desktop flow becomes task-oriented rather than object-oriented.

### Findings
- Consistency: The runtime-owned Evaluation v1 backbone remains intact; the desktop view still calls `listEvaluationDatasets`, `listEvaluationRuns`, `listEvaluationBaselines`, `listEvaluationFeedback`, `importEvaluationDataset`, `startEvaluationRun`, `promoteEvaluationBaseline`, `exportEvaluationRun`, `acceptEvaluationFeedback`, and `rejectEvaluationFeedback`.
- Differences: The desktop presentation is now guided by user goals instead of always-visible internal objects. `Regression` and `Lab` moved into the review surface, while Feedback Inbox is reachable from sample preparation and review.
- Conclusion: The implementation matches the approved plan without adding shared/runtime API surface.

## Checkpoints

### Checkpoint 1: Guided Evaluation Flow
- Requirement: The Evaluation page has a visible 4-step workflow, contextual next action, dataset/feedback preparation, target selection, run action, and review surface.
- Verification method: Source inspection plus desktop type/build.
- Status: [x] Pass / [ ] Fail
- Evidence: `EvaluationView.tsx` now has `EvaluationStep`, workflow step buttons, contextual next action, Step 1/2/3/4 panes, and browser smoke evidence for Step 1 and Step 2.

### Checkpoint 2: Existing Evaluation Capabilities Preserved
- Requirement: Import, feedback accept/reject, run start, export, baseline promotion, and case detail still compile and remain reachable.
- Verification method: Source inspection plus runtime tests and desktop build.
- Status: [x] Pass / [ ] Fail
- Evidence: Existing handler paths remain wired to current runtime client methods; desktop typecheck/build and runtime tests passed.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Replace object-first Evaluation UI with a guided 4-step workflow.
- Done: `EvaluationView.tsx` refactored; task journal updated; verification passed.
- In-progress: None.
- Active files: `apps/desktop/src/components/EvaluationView.tsx`, this journal.
- Next actions (top 3; exact file/function): optional narrow-width QA; optional copy/i18n polish; optional richer seeded sample state for visual tests.
- Blockers/Risks: Worktree has unrelated dirty files; this task only intentionally touched `EvaluationView.tsx` and this journal.
- Verification status: PASS for desktop typecheck/build, runtime tests, and browser smoke.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, macOS, zsh, pnpm workspace.

### Commands run + outputs
- Commands run + outputs:
  - `pnpm --filter @ora/desktop typecheck`
    - PASS after patching the feedback-tab narrowing issue.
  - `pnpm --filter @ora/desktop build`
    - PASS: `✓ 2083 modules transformed`, `✓ built in 2.46s`.
    - Warning: existing Vite chunk-size warning for `index` and `ModesView` chunks over 500 kB.
  - `pnpm --filter @ora/runtime test`
    - PASS: `Test Files 12 passed (12)`, `Tests 187 passed (187)`.
  - `pnpm --dir apps/desktop exec vite --host 127.0.0.1 --port 1421`
    - PASS: dev server started because 1420 was already in use.
  - Chrome smoke check:
    - PASS: opened `http://127.0.0.1:1421/`, clicked Evaluation, verified Step 1 empty state and Step 2 target selection render.
  - `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task /Users/quintenchen/developer/ora/tasks/TASK-20260426-2220-ora-evaluation-guided-workflow.md`
    - PASS: `Blocking TODO matches: none`, `Blocking task-journal TODO entries: none`, `Result: PASS`.
