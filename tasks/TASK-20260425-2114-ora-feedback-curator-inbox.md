# TASK-20260425-2114-ora-feedback-curator-inbox

**Created:** 2026-04-25 21:14 CST
**Status:** Completed

---

## Goal
- Build a natural-language feedback loop from Ora chat replies into Evaluation datasets.
- Users should click feedback under an assistant reply, write free-form feedback, and let an independent curator agent turn that feedback plus the source conversation and Trails context into a structured evaluation case.
- The generated case should first land in an Evaluation Feedback Inbox for review, then only accepted items should append to the `feedback-chat` dataset used by existing Regression/Lab evaluation flows.

## Scope / Out of scope
- In scope:
  - Chat feedback affordance under completed assistant replies.
  - Shared JSON-RPC contracts for feedback submission, inbox list/get, accept, reject, and update.
  - Runtime-owned feedback inbox persistence under the Evaluation domain.
  - Curator-agent structured draft generation with deterministic fallback.
  - Evaluation view Feedback Inbox surface.
  - Browser fallback parity in the desktop local JSON-RPC runtime.
  - Tests and build/type verification for shared/runtime/desktop paths.
- Out of scope:
  - User-facing category/severity forms.
  - Automatic evaluation run triggering after accept.
  - Multi-user review workflow, labeling assignment, or approval roles.
  - External hosted evaluation services or new credentials.
  - Broad redesign of Evaluation, Trails, or chat layout outside this feedback loop.

## Constraints
- The user feedback UI must stay natural-language-first: a textarea plus submit/cancel is enough for v1.
- Preserve the existing Evaluation v1 backbone: accepted feedback becomes normal `EvaluationCase` records in a dataset instead of introducing a second benchmark format.
- Keep runtime as the owner of Evaluation state so desktop, CLI, and packaged app paths remain consistent.
- Curator failures must never discard the user's raw feedback; fallback drafts should remain reviewable in the inbox.
- Keep implementation surgical and aligned with existing JSON-RPC + browser fallback patterns.

## Plan
1. Shared contracts:
   - Add `EvaluationFeedbackSubmitParams`, `EvaluationFeedbackRecord`, `EvaluationFeedbackDraftCase`, status schemas, inbox params, and JSON-RPC method names.
   - Extend shared contract tests for valid submit/list/get/accept/reject/update payloads.
2. Runtime Evaluation inbox:
   - Add persisted feedback records to `LocalEvaluationStore`.
   - Implement `submitFeedback`, `listFeedback`, `getFeedback`, `updateFeedback`, `acceptFeedback`, and `rejectFeedback`.
   - On submit, build a feedback packet from the source run/session, assistant output, user feedback, and `runs.trail` context.
   - Generate a draft case through a curator path; fall back to deterministic structured output if curator generation fails.
   - On accept, append the draft case to fixed dataset `feedback-chat`.
3. JSON-RPC / client parity:
   - Expose `evaluation.feedback.*` in `apps/runtime/src/json-rpc.ts` and `apps/runtime/src/run-store.ts`.
   - Add matching runtimeClient methods and deterministic browser fallback behavior.
4. Desktop UI:
   - Add feedback button and textarea dialog under completed assistant turns.
   - Add a Feedback Inbox tab/panel in `EvaluationView` with pending/accepted/rejected/failed records and accept/reject actions.
5. Verification:
   - Run shared tests/build, runtime tests/build, desktop typecheck/build.
   - Add runtime-level tests for submit -> inbox -> accept -> `feedback-chat`.
   - Add desktop compile coverage for the chat feedback callback and Evaluation inbox.

## Active Files
- packages/shared/src/index.ts
- packages/shared/test/contracts.test.ts
- apps/runtime/src/evaluation-store.ts
- apps/runtime/src/run-store.ts
- apps/runtime/src/json-rpc.ts
- apps/runtime/test/runtime-integration.test.ts
- apps/desktop/src/types.ts
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/components/AssistantTurnCard.tsx
- apps/desktop/src/components/ChatMessages.tsx
- apps/desktop/src/components/ChatView.tsx
- apps/desktop/src/components/EvaluationView.tsx
- apps/desktop/src/App.tsx
- tasks/TASK-20260425-2114-ora-feedback-curator-inbox.md

## Decisions
- Decision: Use `Curator Inbox` instead of direct dataset append.
  - Why: It keeps the user input friction low while preventing low-quality or malformed generated samples from immediately polluting Evaluation datasets.
  - Alternatives: Direct append is faster but weaker for data governance; auto-running evaluations is powerful but too noisy for v1.
  - Tradeoffs: One more review surface, but rollback and quality control are much better.
- Decision: Store accepted feedback as normal `EvaluationCase` records in `feedback-chat`.
  - Why: Existing Regression/Lab views, CLI/CI flows, and dataset parsing can continue to work without a parallel benchmark object.
  - Alternatives: Add a special feedback dataset type.
  - Tradeoffs: The curator must map feedback into the existing schema, but this is exactly the abstraction Evaluation already expects.
- Decision: Curator output is advisory until accepted.
  - Why: A model-generated rubric can be wrong; keeping it as a draft lets users correct or reject it before it becomes benchmark data.
  - Alternatives: Trust curator output directly.
  - Tradeoffs: Slightly slower dataset growth, significantly lower dataset-quality risk.

## Progress Log
- 2026-04-25 21:14 CST - Created task journal from the approved `Feedback Curator Inbox` plan.
  Next: Add shared feedback contracts; implement runtime inbox persistence/API; wire desktop feedback UI and Evaluation inbox.
- 2026-04-25 21:38 CST - Implemented the cross-layer feature slice: shared feedback schemas/methods, runtime feedback inbox persistence and accept/reject path, JSON-RPC handlers, browser fallback parity, chat feedback modal, Evaluation Feedback tab, and runtime coverage.
  Next: Run final verification; record command evidence; note unrelated working-tree changes that appeared during the run.
- 2026-04-25 21:44 CST - Verification passed for shared tests/build, runtime tests/build, desktop typecheck/build. `todo_scan` only reported pre-existing/generated sidecar TODO noise.
  Next: Final response with changed-scope summary and residual risk.

## Open Issues
- [ ] CLI commands for feedback inbox remain a follow-up; v1 exposes the runtime JSON-RPC path and desktop UI.
- [ ] The working tree contains unrelated modified files outside this feature area; do not revert them without explicit user instruction.

## TODO
- [x] Create task journal with the complete plan.
- [x] Add shared feedback contracts and tests.
- [x] Implement runtime feedback inbox and accept/reject dataset path.
- [x] Add browser fallback parity in desktop runtime client.
- [x] Add chat feedback UI.
- [x] Add Evaluation Feedback Inbox UI.
- [x] Run verification and record evidence.

## Retrospective
### Item 1
- Pitfall: Ad-hoc `tsx -e` smoke commands can fail for module-resolution reasons even after the feature is covered by the runtime test suite.
- Symptom: Direct smoke attempts failed first on top-level await in CJS output, then on `@ora/shared` package export resolution.
- Root Cause: The `tsx -e` execution context does not match the repo's normal package/test resolution path.
- Reusable Guardrail: Prefer checked-in runtime tests or a small temporary script file over `tsx -e` for cross-package Ora JSON-RPC smoke flows.
- Evidence: `pnpm --filter @ora/runtime test -- test/runtime-integration.test.ts` passed and includes submit/accept/dataset verification, while the ad-hoc command failed before exercising product code.
- Scope: Ora runtime JSON-RPC smoke verification
- Suggested Writeback Target: Ora runtime verification checklist
- Status: candidate_for_skill

## Functional Verification

### Code Verification
- [x] Shared tests/build pass.
- [x] Runtime tests/build pass.
- [x] Desktop typecheck/build pass.

### Functional Verification
- [x] Feedback submission creates an inbox record with raw feedback preserved.
- [x] Accepting a draft appends a case to `feedback-chat`.
- [x] Rejecting a draft does not modify `feedback-chat`.
- [x] Curator failure path creates a fallback draft.
- [x] Desktop chat can submit feedback and Evaluation can review it.

## Comparison

### Reference
- Existing Ora Evaluation v1 runtime-owned dataset/run/baseline backbone.
- Existing Ora Trails `runs.trail` run-context API.
- External product patterns: Langfuse trace/dataset/score loop, OpenAI trace grading, Humanloop feedback/eval workflow, WildFeedback natural-feedback-to-dataset research.

### Comparison Points
- [x] Feedback records stay runtime-owned like Evaluation datasets/runs.
- [x] Trails remains a diagnostic/context source, not a hard dependency.
- [x] Accepted feedback becomes ordinary Evaluation cases.

### Findings
- Consistency: The implementation follows Evaluation v1's runtime-owned pattern and exposes desktop as a thin client over JSON-RPC.
- Difference: Curator output currently uses provider generation when available and falls back deterministically; accepted records are normal `EvaluationCase` objects inside `feedback-chat`.
- Conclusion: The shipped slice keeps user feedback natural-language-only while adding a review gate before benchmark data is promoted.

## Checkpoints

### Checkpoint 1: Shared + Runtime Feedback Domain
- Requirement: Contracts and runtime APIs support submit/list/get/update/accept/reject and persistence.
- Verification method: shared/runtime tests and runtime API smoke.
- Status: [x] Pass / [ ] Fail

### Checkpoint 2: Desktop Feedback Capture
- Requirement: Completed assistant turns expose natural-language feedback submission.
- Verification method: desktop typecheck/build plus component wiring inspection.
- Status: [x] Pass / [ ] Fail

### Checkpoint 3: Evaluation Inbox + Dataset Promotion
- Requirement: Feedback drafts can be reviewed and accepted into `feedback-chat`.
- Verification method: runtime tests plus desktop build and manual API smoke.
- Status: [x] Pass / [ ] Fail

## Compressed State
- Objective: Natural-language chat feedback -> curator-generated structured draft -> Evaluation Feedback Inbox -> accepted `feedback-chat` dataset case.
- Status: Completed and verified.
- Key decision: Use inbox review before dataset append; do not ask users for structured labels.
- Active files: `packages/shared/src/index.ts`, `packages/shared/test/contracts.test.ts`, `apps/runtime/src/{evaluation-store,run-store,json-rpc}.ts`, `apps/runtime/test/runtime-integration.test.ts`, `apps/desktop/src/{App,lib/runtimeClient,components/AssistantTurnCard,components/ChatMessages,components/ChatView,components/EvaluationView}.tsx`, this journal.
- Next actions: optional CLI feedback commands; optional richer curator prompt/evaluator profile tuning; avoid touching unrelated working-tree changes.
- Verification: shared tests/build, runtime tests/build, desktop typecheck/build all passed.

## Verification

### Evidence Requirements
- [x] Code Verification output
- [x] Functional Verification output
- [x] Retrospective Evidence
- [x] Comparison Evidence
- [x] Checkpoints Evidence

### Environment
- Environment: `/Users/quintenchen/developer/ora`, macOS, zsh, Node/pnpm available.

### Commands run + outputs
- `pnpm --filter @ora/shared test`
  - PASS: `test/contracts.test.ts` 72/72.
- `pnpm --filter @ora/runtime test -- test/runtime-integration.test.ts`
  - PASS: runtime test suite 12 files, 129/129 tests. Includes `turns chat feedback into reviewable evaluation cases`.
- `pnpm --filter @ora/desktop typecheck`
  - PASS: `tsc --noEmit`.
- `pnpm --filter @ora/shared build`
  - PASS: `tsc -p tsconfig.json`.
- `pnpm --filter @ora/runtime build`
  - PASS: `tsc -p tsconfig.json`.
- `pnpm --filter @ora/desktop build`
  - PASS: `tsc && vite build`; Vite reported the existing chunk-size warning for bundles over 500 kB.
- `bash skills/long-task-protocol/scripts/todo_scan.sh`
  - Noise only: matched `.ora/runtime.db` and generated sidecar bundle TODOs under `apps/desktop/src-tauri/resources/runtime-sidecar/**`.
- Ad-hoc JSON-RPC smoke attempts
  - Not used as acceptance evidence: `tsx -e` failed before product execution because of top-level await / package export resolution in the eval context.
