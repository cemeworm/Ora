# TASK-20260426-1951-ora-approval-natural-language

**Created:** 2026-04-26 19:51 CST
**Status:** Done

---

## Goal
- Turn approval-required chat cards into user-readable decision prompts. Runtime actions should carry a natural-language approval request generated from the agent/tool intent, and the desktop card should present that request without leaking internal tool ids, risk-policy phrasing, or agent ids to ordinary users.

## Scope / Out of scope
- In scope: shared action schema, runtime tool-call approval metadata, desktop view model/card rendering, focused tests.
- Out of scope: changing approval policy, changing Skills installation behavior, broad Trails/debug redesign.

## Constraints
- Compatibility: existing snapshots without approval request metadata must remain parseable and display a readable fallback.
- Performance: approval summary generation must be local string shaping around an already requested tool call, not an additional model round trip.
- Risk: the worktree already has unrelated changes; only touch files required by this task.
- Tool/Environment limits: use focused checks and avoid rebuilding generated sidecar bundles unless verification requires it.

## Plan
1. Extend shared action records and desktop types with optional approval request copy.
2. Teach runtime tool-call actions to derive/store a natural-language approval request from tool id + args, preserving agent-provided text when present.
3. Render approval cards from the new request fields and add regression coverage for schema/runtime/desktop text.

## Active Files
- packages/shared/src/actions.ts
- apps/runtime/src/capabilities.ts
- apps/runtime/src/harness/runtime-tool-executor.ts
- apps/runtime/src/harness/runtime-kernel.ts
- apps/desktop/src/types.ts
- apps/desktop/src/lib/viewModel.ts
- apps/desktop/src/components/ApprovalRequestCard.tsx
- packages/shared/test/contracts.test.ts
- apps/runtime/test/runtime-tool-executor.test.ts
- apps/runtime/test/runtime-smoke.test.ts
- apps/desktop/src/components/ApprovalRequestCard.test.tsx
- apps/desktop/src/lib/viewModel.test.ts

## Decisions
- Decision: store user-facing approval copy on the action record, not only in the React card.
  - Why: approvals can be rendered in chat, Trails, persisted snapshots, and resumed sessions from one runtime truth.
  - Alternatives: frontend-only templating; rejected because it would keep runtime events semantically developer-oriented.
  - Tradeoffs: small schema expansion, but old snapshots stay compatible through optional fields.

## Progress Log
- 2026-04-26 19:51 CST - Task created and scoped from the approved plan.
  Next: extend schema/types, wire runtime action metadata, then patch desktop approval card/tests.
- 2026-04-26 20:00 CST - Implemented optional action-level approval copy, runtime tool-call approval copy generation, desktop card rendering, and focused schema/runtime/desktop tests.
  Next: run focused tests and typechecks, then record verification evidence.
- 2026-04-26 20:05 CST - Verification passed after rebuilding shared dist for downstream package type resolution and fixing runtime approval-resume type seams already present in the dirty file.
  Next: none; final response should summarize scope and verification.

## Open Issues
- None.

## TODO
- None.

## Retrospective
- No reusable pitfall worth promoting. Local note: runtime/desktop packages typecheck against `@ora/shared/dist`, so shared source schema changes need `pnpm --filter @ora/shared build` before downstream typechecks.

### Item 1
- Pitfall: shared source changes were not visible to runtime typecheck until shared dist was rebuilt.
- Symptom: runtime typecheck reported missing `ActionApprovalRequestCopy` exports from `@ora/shared`.
- Root Cause: downstream packages resolve `@ora/shared` through `packages/shared/dist/index.d.ts`.
- Reusable Guardrail: after shared schema/type additions, run `pnpm --filter @ora/shared build` before runtime/desktop typecheck.
- Evidence: `pnpm --filter @ora/shared build` passed; runtime typecheck passed afterward.
- Scope: local_only
- Suggested Writeback Target: none
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [ ] Lint checks pass

**Output**:
- `pnpm --filter @ora/shared build` -> passed.
- `pnpm --filter @ora/shared typecheck` -> passed.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm --filter @ora/shared test -- contracts.test.ts` -> 1 file passed, 76 tests passed.
- `pnpm --filter @ora/runtime test -- runtime-tool-executor.test.ts runtime-smoke.test.ts` -> 12 files passed, 177 tests passed.
- `pnpm --filter @ora/desktop test -- ApprovalRequestCard.test.tsx viewModel.test.ts` -> 3 files passed, 5 tests passed.
- Lint was not run; this repo/package task used focused typecheck and tests.

### Functional Verification (Feature Works)
- [x] Core functionality verification: runtime smoke test pauses `skills.create` with Chinese approval copy on the pending action.
- [x] Edge cases verification: shared contract accepts legacy actions with no `approvalRequest`.
- [x] Error handling verification: desktop card static render test confirms no `pending gate`, `High-risk action requires`, `agent:`, `solo_agent`, or `skills create` leaks into the user-facing card.

**Output**:
- Runtime snapshot action contains `approvalRequest.title = 需要你确认安装技能`.
- Desktop card HTML contains natural approval copy and omits internal action metadata.

## Comparison (If Applicable)

### Reference
- Existing inline approval chat flow from `ApprovalRequestCard` / `ChatMessages`.

### Comparison Points
- [x] Keep approval UI inline in chat.
- [x] Preserve runtime-owned pending approval state.
- [x] Move ordinary-user copy out of runtime/debug phrasing.

### Findings
- Consistency: approval remains inline in chat and still resumes/cancels through the existing controls.
- Differences: action metadata now carries user-facing approval copy; debug details remain outside the ordinary card.
- Conclusion: consistent with the existing inline approval architecture while fixing content tone.

## Checkpoints

### Checkpoint 1: Action Schema Compatibility
- Requirement: action schema carries optional user-facing approval copy while legacy actions remain valid.
- Verification method: shared contract test.
- Status: [x] Pass / [ ] Fail
- Evidence: `contracts.test.ts` passed.

### Checkpoint 2: Runtime and desktop render natural approval text
- Requirement: runtime pending tool action stores natural approval copy; desktop card does not expose internal ids/risk prose.
- Verification method: runtime smoke test plus server-rendered component test.
- Status: [x] Pass / [ ] Fail
- Evidence: runtime and desktop focused tests passed.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: natural-language approval cards sourced from runtime action metadata.
- Done: schema, runtime metadata, desktop rendering, i18n copy, focused tests, typechecks.
- In-progress: none.
- Active files: shared actions, runtime capabilities/tool executor/kernel, desktop types/viewModel/ApprovalRequestCard, focused tests.
- Next actions (top 3; exact file/function): none.
- Blockers/Risks: dirty worktree has unrelated changes; keep edits surgical.
- Verification status: passed focused tests and typechecks; lint not run.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, zsh, 2026-04-26.

### Commands run + outputs
- `pnpm --filter @ora/shared build` -> passed.
- `pnpm --filter @ora/shared typecheck` -> passed.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm --filter @ora/shared test -- contracts.test.ts` -> 76 tests passed.
- `pnpm --filter @ora/runtime test -- runtime-tool-executor.test.ts runtime-smoke.test.ts` -> 177 tests passed.
- `pnpm --filter @ora/desktop test -- ApprovalRequestCard.test.tsx viewModel.test.ts` -> 5 tests passed.
- `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task tasks/TASK-20260426-1951-ora-approval-natural-language.md` -> PASS; no blocking TODO matches or task-journal TODO entries.
