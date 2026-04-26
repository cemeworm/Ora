# TASK-20260426-1520-ora-reactive-project-feedback-loop

**Created:** 2026-04-26 15:20 CST
**Status:** Done

---

## Goal
- Turn the idea from Fred Liang's "From Event-Driven AI to Reactive Organizations" into an Ora-native product and architecture plan: Ora should evolve from a local agent executor into a project feedback loop layer that connects runs, Trails, Evaluation feedback, recovery events, approvals, and project context into calibrated project-level signals.
- This task file is the single source of truth for the plan. Chat discussion is non-authoritative unless copied back here.

## Source / Inspiration
- Source article: https://www.f.cv/blog/from-event-driven-ai-to-reactive-organizations
- Relevant thesis:
  - Event-driven AI handles isolated triggers.
  - Reactive organizations interpret overlapping signals across tools, timelines, and teams.
  - The hard part is calibration: knowing which signals matter, which should override others, and when humans should review.
- Ora translation:
  - Do not build a broad "organization nervous system" first.
  - Start with Ora's existing local workspace signals and make them continuously judgeable.
  - Keep evidence links back to concrete runs, trace events, eval cases, feedback records, and project files.

## Assumptions
- Ora remains a packaged local Mac app with runtime-owned state and managed local services where possible.
- The first useful version should use internal Ora signals only:
  - chat run snapshots
  - Trails / `runs.trail`
  - topology and event stream
  - tool failures and recovery events
  - approval / cancellation / interruption events
  - Evaluation run results
  - Evaluation Feedback Inbox records
  - project folder/file context already known to Ora
- External sources such as GitHub, Linear, Slack, sales calls, support tickets, and analytics are valuable later, but they are not required for v1.
- The right abstraction is not a new agent mode by itself. The first product shape should be a project-level feedback surface plus runtime APIs, with Mode Studio later managing calibration rules.

## Scope / Out of scope
- In scope:
  - Define an Ora `Project Signals` / `Feedback Loop` product surface that answers:
    - What changed?
    - Where is this project drifting?
    - Which signals matter together?
    - What should be adjusted now?
  - Add runtime-owned shared contracts for normalized project signals, signal clusters, insights, calibration rules, and proposed interventions.
  - Derive v1 signals from existing Ora internal sources before adding external integrations.
  - Add a desktop view under Agent or Trails-adjacent project context that shows evidence-backed insights.
  - Let users accept, dismiss, or convert insights into follow-up actions such as Evaluation cases, Mode Studio rule updates, project notes, or run retries.
  - Keep Evaluation as the structured benchmark and feedback dataset backbone.
  - Keep Trails as the per-run evidence and diagnostic backbone.
  - Make Mode Studio the eventual place for editing calibration rules and escalation behavior.
- Out of scope:
  - Broad external integrations in v1.
  - A full company-wide operating system.
  - Autonomous code or settings changes without explicit user confirmation.
  - Replacing Trails, Evaluation, or Mode Studio with a new product silo.
  - Heavy multi-user governance, roles, assignments, or hosted collaboration features.

## Product Shape

### Working Name
- `Project Signals` for the user-facing surface.
- `feedback-loop` for the runtime/internal domain.

### First User Story
- As a user working inside an Ora project, I want Ora to notice repeated run failures, low-quality outcomes, approval bottlenecks, and feedback patterns across recent work, then show me a small evidence-backed set of project-level insights and recommended next actions.

### Primary Surface
- Location option A: `Agent -> Signals`
  - Pros: aligns with Evaluation already living under Agent.
  - Cons: slightly separates signals from the run evidence in Trails.
- Location option B: Trails drawer gets a `Project` or `Signals` tab.
  - Pros: close to run evidence.
  - Cons: Trails is currently scoped to chat-run state; project-level history could make the drawer too dense.
- Recommendation: Add `Agent -> Signals` as the project-level surface and link every insight back into Trails for run-level evidence.

### Core Views
- `Overview`
  - Small project health summary.
  - Counts and trend hints: repeated failures, pending feedback, eval regressions, unresolved approvals, degraded artifacts.
- `Signals`
  - Normalized signal list with source, severity, confidence, recency, and evidence links.
- `Insights`
  - Clustered interpretation across signals.
  - Example: "Tool repair is recurring in browser-search runs; 4 of the last 7 affected runs later needed manual feedback."
- `Actions`
  - Proposed interventions requiring user confirmation.
  - Examples:
    - add accepted feedback to `feedback-chat`
    - create an Evaluation dataset slice from repeated failures
    - recommend a Mode Studio recovery-policy tweak
    - open the relevant Trails trace
    - retry a run from checkpoint

## Runtime Domain Proposal

### Shared Contracts
- Add schemas in `packages/shared/src/index.ts`:
  - `ProjectSignalSourceSchema`
    - `run_event`
    - `trail_observation`
    - `evaluation_result`
    - `evaluation_feedback`
    - `recovery_event`
    - `approval_event`
    - `project_file`
  - `ProjectSignalSeveritySchema`
    - `info`
    - `warning`
    - `critical`
  - `ProjectSignalSchema`
    - `id`
    - `projectId`
    - `source`
    - `sourceRef`
    - `title`
    - `summary`
    - `severity`
    - `confidence`
    - `createdAt`
    - `updatedAt`
    - `evidence`
    - `metadata`
  - `ProjectInsightSchema`
    - `id`
    - `projectId`
    - `title`
    - `summary`
    - `status`
    - `signalIds`
    - `recommendedActions`
    - `confidence`
    - `createdAt`
    - `updatedAt`
  - `FeedbackLoopCalibrationRuleSchema`
    - `id`
    - `projectId`
    - `name`
    - `enabled`
    - `sourceFilters`
    - `severityThreshold`
    - `humanReviewRequired`
    - `actionPolicy`
  - `ProjectSignalActionSchema`
    - `kind`
    - `label`
    - `payload`
    - `requiresConfirmation`

### JSON-RPC Methods
- Add runtime methods:
  - `feedbackLoop.signals.list`
  - `feedbackLoop.insights.list`
  - `feedbackLoop.insights.get`
  - `feedbackLoop.insights.dismiss`
  - `feedbackLoop.actions.preview`
  - `feedbackLoop.actions.apply`
  - `feedbackLoop.rules.list`
  - `feedbackLoop.rules.update`

### Runtime Ownership
- Add `apps/runtime/src/feedback-loop-store.ts`.
- Store derived signals and insights under the runtime data directory, alongside Evaluation state.
- Keep derivation deterministic for v1:
  - collect signal candidates from existing run store and Evaluation store
  - cluster by source type, run mode, node/tool id, failure type, and feedback metadata
  - create conservative insights only when evidence count and confidence threshold pass
- Avoid model-generated conclusions in v1 unless clearly marked as advisory. Deterministic summaries are enough to prove the product loop.

## Signal Sources V1

### Runs / Trails
- Use `StateSnapshot.events` and `runs.trail`:
  - `run.failed`
  - `run.cancelled`
  - `run.interrupted`
  - `recovery.detected`
  - `recovery.retry_scheduled`
  - `recovery.applied`
  - `recovery.exhausted`
  - `node.skipped`
  - `artifact.degraded`
  - `approval.required`
  - `approval.resolved`
  - high warning/error counts from trail observations
- Evidence link target:
  - run id
  - event id / seq
  - Trails tab hint
  - topology node id when available

### Evaluation
- Use Evaluation datasets/runs/baselines/feedback:
  - low score or regression against baseline
  - repeated failures in the same dataset slice
  - pending feedback inbox records
  - accepted feedback growth in `feedback-chat`
- Evidence link target:
  - evaluation run id
  - dataset id
  - case id
  - feedback record id

### Project Context
- Use project metadata and file refs only when already available in Ora.
- V1 should not recursively analyze the whole filesystem.
- Project file evidence should be opt-in or derived from files explicitly touched/read during runs.

## Calibration Rules V1
- Keep rules small and explicit:
  - minimum evidence count before insight creation
  - severity thresholds
  - source recency window
  - whether human review is required
  - allowed action kinds
- Default rules:
  - `repeated_recovery_exhausted`
    - Trigger: at least 2 `recovery.exhausted` events in recent runs for the same mode/node/tool.
    - Action: suggest opening Trails and creating an Evaluation case.
  - `feedback_pending_review`
    - Trigger: pending feedback records exist for the project.
    - Action: open Evaluation Feedback Inbox.
  - `eval_regression`
    - Trigger: latest Evaluation run falls below baseline by configured threshold.
    - Action: open Evaluation run detail and suggest adding failed slice to Regression watch.
  - `approval_bottleneck`
    - Trigger: repeated unresolved or delayed approvals.
    - Action: suggest reviewing Mode Studio approval/recovery policy.

## UX Principles
- Do not present signals as magic truth.
- Every insight must show evidence.
- Every action must require confirmation.
- Keep the first screen dense and operational, not a landing page.
- Avoid duplicating Trails. Project Signals summarizes across runs; Trails explains one run.
- Avoid duplicating Evaluation. Project Signals routes evaluation-related issues into Evaluation rather than replacing scorecards.

## Implementation Plan
1. Planning and contracts
   - File targets:
     - `tasks/TASK-20260426-1520-ora-reactive-project-feedback-loop.md`
     - `packages/shared/src/index.ts`
     - `packages/shared/test/contracts.test.ts`
   - Objective:
     - Lock schema names, JSON-RPC method names, and first-pass fixtures.
   - Verification:
     - shared contract tests parse signals, insights, rules, and methods.
2. Runtime store and deterministic derivation
   - File targets:
     - `apps/runtime/src/feedback-loop-store.ts`
     - `apps/runtime/src/run-store.ts`
     - `apps/runtime/src/evaluation-store.ts`
     - `apps/runtime/src/json-rpc.ts`
     - `apps/runtime/test/runtime-integration.test.ts`
   - Objective:
     - Build internal signal extraction from runs, Trails-compatible snapshots, Evaluation runs, and feedback records.
   - Verification:
     - runtime test creates failed/recovered runs plus feedback/eval records, then verifies generated signals and insights.
3. Desktop runtime client and browser fallback
   - File targets:
     - `apps/desktop/src/lib/runtimeClient.ts`
     - `apps/desktop/src/types.ts`
   - Objective:
     - Add client methods and deterministic local fallback data for browser/dev mode.
   - Verification:
     - desktop typecheck catches JSON-RPC shape drift.
4. Desktop surface
   - File targets:
     - `apps/desktop/src/App.tsx`
     - `apps/desktop/src/components/ProjectSignalsView.tsx`
     - optionally `apps/desktop/src/components/EvaluationView.tsx`
     - optionally `apps/desktop/src/components/TrailsTabs.tsx`
   - Objective:
     - Add an Agent-level Signals view with evidence links into Trails/Evaluation.
   - Verification:
     - desktop build and browser smoke.
5. Mode Studio calibration follow-up
   - File targets:
     - `apps/desktop/src/components/ModeStudio*`
     - `apps/desktop/src/lib/modeCanvas.ts`
     - `apps/runtime/src/modes.ts`
   - Objective:
     - Expose calibration/recovery rule editing only after the read-only Signals surface proves useful.
   - Verification:
     - Mode Studio can edit rules without changing unrelated mode semantics.

## Active Files
- tasks/TASK-20260426-1520-ora-reactive-project-feedback-loop.md
- packages/shared/src/index.ts
- packages/shared/test/contracts.test.ts
- apps/runtime/src/feedback-loop-store.ts
- apps/runtime/src/run-store.ts
- apps/runtime/src/json-rpc.ts
- apps/runtime/test/runtime-integration.test.ts
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/types.ts
- apps/desktop/src/App.tsx
- apps/desktop/src/components/Sidebar.tsx
- apps/desktop/src/components/ProjectSignalsView.tsx

## Planned Files
- packages/shared/src/index.ts
- packages/shared/test/contracts.test.ts
- apps/runtime/src/feedback-loop-store.ts
- apps/runtime/src/run-store.ts
- apps/runtime/src/evaluation-store.ts
- apps/runtime/src/json-rpc.ts
- apps/runtime/test/runtime-integration.test.ts
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/types.ts
- apps/desktop/src/App.tsx
- apps/desktop/src/components/ProjectSignalsView.tsx
- apps/desktop/src/components/EvaluationView.tsx
- apps/desktop/src/components/TrailsTabs.tsx

## Decisions
- Decision: Start with internal Ora signals only.
  - Why: Ora already owns runs, Trails, Evaluation, feedback, recovery, and project context; this gives a real closed loop without external integration drag.
  - Alternatives: Start with GitHub/Linear/Slack ingestion.
  - Tradeoffs: Narrower scope, but stronger local product proof and easier packaged-app behavior.
- Decision: Add a project-level `Signals` surface instead of stuffing project history into Trails.
  - Why: Trails should remain run-level evidence; Signals should summarize across runs and route users to the right evidence surface.
  - Alternatives: Add a new Trails tab; add a dashboard landing page.
  - Tradeoffs: One more Agent-level view, but clearer ownership.
- Decision: Keep v1 deterministic and evidence-first.
  - Why: Calibration is the hard part; model-generated insights without auditable evidence would create the "fast confusion machine" failure mode.
  - Alternatives: Use an LLM summarizer immediately.
  - Tradeoffs: Less magical phrasing, much higher trust and testability.
- Decision: Let Mode Studio manage calibration later, not in the first slice.
  - Why: A read-only project signal loop should prove the signal model before exposing rule editing.
  - Alternatives: Build rules UI at the same time.
  - Tradeoffs: Slower to reach full configurability, lower chance of overbuilding.

## Progress Log
- 2026-04-26 15:20 CST - Created the task file as the single source of truth for turning the reactive-organization article into an Ora-native Project Signals / feedback-loop plan.
  Next: Confirm product placement; finalize shared schemas and JSON-RPC methods; implement deterministic runtime derivation.
- 2026-04-26 15:24 CST - Verified the document is readable and recorded that there are unrelated working-tree modifications outside this task file. This task currently changes only `tasks/TASK-20260426-1520-ora-reactive-project-feedback-loop.md`.
  Next: Keep implementation scoped to the planned files; do not touch unrelated modified files unless they become necessary for this feature.
- 2026-04-26 15:50 CST - Implemented the v1 Project Signals feedback loop across shared contracts, runtime derivation/RPC, desktop client/browser fallback, and a read-only Agent-level Signals surface with evidence actions. Verification passed for shared contracts/build, runtime integration/typecheck/build, desktop typecheck/build, and browser smoke on port 1421.
  Next: Treat Mode Studio calibration editing as the planned follow-up; keep external integrations out of v1 until internal signal quality is proven.
- 2026-04-26 15:59 CST - Post-implementation review found and fixed three safety/architecture issues: desktop action preview no longer immediately applies, browser fallback now requires `confirmed: true` and persists rule updates, and runtime/browser derivation now enforces calibration rule enabled/source/severity/actionPolicy fields.
  Next: Keep confirmed action UX as a two-step preview/apply pattern when future actions do more than route to evidence.

## Open Questions
- [x] Should Signals live visually under `Agent`, under the project sidebar, or as a Trails-adjacent global panel?
  - Answer: Add `Signals` as an Agent-level workspace view in the existing sidebar cluster; Trails remains run-level evidence.
- [x] What is the first project id source of truth for runs that are not yet tied to a folder-backed project?
  - Answer: Prefer the session/project join, then `input.context.projectId`, then a deterministic `local-project` fallback for unscoped history.
- [x] Should project signals be generated lazily on list calls, persisted eagerly after every run, or both?
  - Answer: Derive signals/insights lazily from runtime state in v1, while persisting insight dismiss/apply state and calibration rules.
- [x] Which action kinds should v1 actually apply versus only preview?
  - Answer: v1 previews and applies evidence-routing actions by marking them applied in Project Signals; actual external setting/code changes remain out of scope.
- [x] Should accepted insights create durable project notes, or only runtime records?
  - Answer: v1 stores runtime action state only; durable project notes are deferred until the signal model proves useful.

## TODO
- [x] Create this task file as the single source of truth.
- [x] Confirm product placement for `Project Signals`.
- [x] Finalize shared contract schema names.
- [x] Implement runtime deterministic derivation.
- [x] Implement desktop read-only Signals surface.
- [x] Add action preview/apply path for one narrow action kind.
- [x] Verify shared/runtime/desktop builds and task checkpoints.

## Retrospective
- Record 0-3 highest-value pitfalls from this task.
- Leave reusable operational lessons here even when they later get promoted into a skill.

### Item 1
- Pitfall: Implementing this on the wrong branch would miss the task file and the recent Evaluation/Feedback/Projects seams it depends on.
- Symptom: The requested task path was absent on the starting `codex/agents` branch even though `git log --all` showed it on `main`.
- Root Cause: The worktree started on an older branch while the task journal and prerequisite runtime work were already on `main`.
- Reusable Guardrail: For Ora task-file-first work, verify the task file exists on the active branch before editing; if not, locate the branch containing it and switch/create a feature branch from that base.
- Evidence: `git branch --show-current` returned `codex/agents`; `git show 7c2c1a...:tasks/TASK-20260426-1520-ora-reactive-project-feedback-loop.md` proved the file lived on `main`; implementation proceeded on `codex/reactive-project-feedback-loop`.
- Scope: local_only
- Suggested Writeback Target: none
- Status: local_only

### Item 2
- Pitfall: A `requiresConfirmation` field can become decorative if the UI collapses preview and apply into one click.
- Symptom: Review found `previewProjectSignalAction()` and `applyProjectSignalAction()` called in the same button handler.
- Root Cause: The runtime contract enforced `confirmed: true`, but the desktop wrapper always supplied it and the UI never displayed a confirmation decision.
- Reusable Guardrail: For Ora actions marked `requiresConfirmation`, add a visible intermediate confirmation state and keep browser fallback validation at least as strict as runtime validation.
- Evidence: Fixed in `apps/desktop/src/components/ProjectSignalsView.tsx` with `pendingAction`; fixed in `apps/desktop/src/lib/runtimeClient.ts` by parsing `FeedbackLoopActionApplyParamsSchema`.
- Scope: local_only
- Suggested Writeback Target: none
- Status: local_only

## Functional Verification

### Code Verification
- [x] Shared tests pass.
- [x] Runtime tests pass.
- [x] Desktop typecheck/build pass.

### Functional Verification
- [x] Signals view lists derived project signals with evidence links.
- [x] Insights cluster related signals without losing source evidence.
- [x] At least one proposed action can be previewed and either dismissed or applied with confirmation.
- [x] Evaluation and Trails remain the evidence/drill-down surfaces rather than duplicated dashboards.

## Comparison

### Reference
- Article: `From Event-Driven AI to Reactive Organizations`.
- Existing Ora Trails: `runs.trail`, topology, trace observations, recovery events.
- Existing Ora Evaluation: datasets, runs, baselines, feedback inbox, accepted feedback as `EvaluationCase`.
- Existing Ora Mode Studio: runtime-owned modes and policies should eventually host calibration rules.

### Comparison Points
- [x] Event-driven reaction vs project-level signal interpretation.
- [x] Trails as per-run evidence vs Signals as cross-run interpretation.
- [x] Evaluation as benchmark/data backbone vs Signals as routing and prioritization layer.
- [x] Mode Studio as agent-mode editor vs future calibration/rule editor.

### Findings
- Consistency: The proposed loop reuses Ora's existing runtime-owned state and desktop-thin-client pattern.
- Differences: It introduces a new project-level domain, but keeps v1 read-only/deterministic to avoid broad autonomous behavior.
- Conclusion: The plan is a reasonable next layer after Trails and Evaluation, as long as v1 stays evidence-backed and internally scoped.

## Checkpoints

### Checkpoint 1: Contract Shape
- Requirement: Shared contracts and JSON-RPC methods model signals, insights, rules, and action previews without requiring external integrations.
- Verification method: shared contract tests.
- Status: Pass
- Evidence: `pnpm --filter @ora/shared test -- contracts.test.ts` passed with 76 tests; `pnpm --filter @ora/shared build` passed.

### Checkpoint 2: Runtime Derivation
- Requirement: Runtime can derive deterministic project signals from runs, Trails-compatible events, Evaluation results, and feedback records.
- Verification method: runtime integration tests with seeded runs/eval/feedback.
- Status: Pass
- Evidence: `pnpm --filter @ora/runtime test -- runtime-integration.test.ts` passed; the added test seeds project runs with repeated `recovery.exhausted`, feedback, rules, preview, and apply.

### Checkpoint 3: Desktop Signals Surface
- Requirement: Desktop shows project-level signals and insights with evidence links to Trails/Evaluation.
- Verification method: desktop typecheck/build plus browser/manual smoke.
- Status: Pass
- Evidence: `pnpm --filter @ora/desktop typecheck` and `pnpm --filter @ora/desktop build` passed; browser smoke on `http://127.0.0.1:1421/` showed the Signals nav, Project feedback loop header, Insights, Calibration Rules, and Signals sections with no console errors.

### Checkpoint 4: Confirmed Action Path
- Requirement: At least one action kind can be previewed and applied only after user confirmation.
- Verification method: runtime test and desktop smoke.
- Status: Pass
- Evidence: Runtime integration test verified `feedbackLoop.actions.preview` returns `status: "preview"` and `feedbackLoop.actions.apply` with `confirmed: true` returns an applied insight/action result.

**All checkpoints must pass before marking task DONE.**

## Compressed State
- Objective: Build an Ora-native Project Signals feedback loop inspired by reactive organizations.
- Done: v1 implemented with shared schemas/RPC methods, deterministic runtime derivation, persisted rules/dismiss/apply state, desktop runtime client/browser fallback, and an Agent-level Signals surface.
- In-progress: none for v1.
- Active files: shared contracts/tests, runtime feedback-loop store/RPC/tests, desktop runtime client/types/App/sidebar/ProjectSignalsView, and this task journal.
- Next actions:
  - Use the read-only Signals surface in real runs and tune deterministic thresholds if needed.
  - Implement Mode Studio calibration editing as a follow-up once v1 signal quality is validated.
  - Consider project notes/external integrations only after internal Ora signals are reliable.
- Blockers/Risks: Existing unrelated working-tree changes remain outside this task; v1 does not yet mutate Mode Studio rules from the UI.
- Verification status: shared/runtime/desktop tests and builds passed; browser smoke passed.

## Verification

### Evidence Requirements
- [x] Code Verification output
- [x] Functional Verification output
- [x] Retrospective Evidence
- [x] Comparison Evidence
- [x] Checkpoints Evidence

### Environment
- Environment: `/Users/quintenchen/developer/ora`, macOS, zsh, pnpm workspace, Tauri desktop app.

### Commands run + outputs
- `date '+%Y%m%d-%H%M %Y-%m-%d %H:%M %Z'`
  - `20260426-1520 2026-04-26 15:20 CST`
- `git status --short`
  - Pre-existing working tree before this task file: `M packages/shared/src/index.ts`
  - Later status also showed additional modified files outside this task file; treat them as unrelated unless implementation requires them.
- `pnpm --filter @ora/shared test -- contracts.test.ts`
  - `Test Files  1 passed (1)`
  - `Tests  76 passed (76)`
- `pnpm --filter @ora/shared build`
  - `tsc -p tsconfig.json`
  - exit code 0
- `pnpm --filter @ora/runtime test -- runtime-integration.test.ts`
  - Initial run: `Test Files  12 passed (12)`, `Tests  149 passed (149)`
  - After review fixes: `Test Files  12 passed (12)`, `Tests  150 passed (150)`
- `pnpm --filter @ora/runtime typecheck`
  - `tsc -p tsconfig.json --noEmit`
  - exit code 0
- `pnpm --filter @ora/runtime build`
  - `tsc -p tsconfig.json`
  - exit code 0
- `pnpm --filter @ora/desktop typecheck`
  - `tsc --noEmit`
  - exit code 0
- `pnpm --filter @ora/desktop build`
  - `tsc && vite build`
  - Initial build: `ProjectSignalsView-8x5MiVVA.js   10.12 kB`
  - After review fixes: `ProjectSignalsView-Cy_r5HGS.js   11.11 kB`
  - `built in 2.21s`
- Browser smoke
  - Started Vite on `http://127.0.0.1:1421/` because `1420` was already in use.
  - Opened the app in the in-app browser, clicked `Signals`, and verified visible text: `Project feedback loop`, `Signals`, `Open insights`, `Calibration Rules`.
  - Re-ran after review fixes and verified `Signals`, `Project feedback loop`, and `Calibration Rules` still render.
  - Browser console error log: `[]`.
- Post-implementation review
  - Findings fixed: preview/apply confirmation split, browser fallback apply validation/rule persistence, calibration rule enforcement in derivation/action filtering.
  - Re-run verification: runtime tests, runtime typecheck/build, desktop typecheck/build, and browser smoke passed after fixes.
- TODO gate
  - Long-task helper output was invalid for this checkout because it scanned `/Users/quintenchen/developer/quantfox/...`; local Ora task/code scan is recorded below after journal update.
  - `rg -n "\\[ \\]|TODO\\(" tasks/TASK-20260426-1520-ora-reactive-project-feedback-loop.md packages/shared/src/index.ts packages/shared/test/contracts.test.ts apps/runtime/src/feedback-loop-store.ts apps/runtime/src/run-store.ts apps/runtime/src/json-rpc.ts apps/runtime/test/runtime-integration.test.ts apps/desktop/src/lib/runtimeClient.ts apps/desktop/src/types.ts apps/desktop/src/App.tsx apps/desktop/src/components/Sidebar.tsx apps/desktop/src/components/ProjectSignalsView.tsx`
  - exit code 1 with no matches, meaning no unchecked task boxes or code TODO markers in task-owned files.
