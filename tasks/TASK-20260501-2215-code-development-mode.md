# TASK-20260501-2215-code-development-mode

**Created:** 2026-05-01 22:15 CST
**Status:** Done

---

## Goal
Implement an Ora built-in `Code Development` mode that is genuinely useful for project code-writing work. The mode is a user-visible system preset based on `agent_teams`, with four distinct roles: Orchestrator, Builder, Reviewer, and Debugger. It is readable through runtime mode list/get paths, passes shared ModeSpec validation, and remains read-only as a system preset.

## Scope / Out of scope
- In scope:
  - Add `CODE_DEVELOPMENT_MODE_ID` to shared primitives.
  - Add a `createCodeDevelopmentModeSpec()` built-in preset in shared modes.
  - Register the preset in `MVP_MODES`.
  - Update shared contract tests and runtime preset visibility/read-only tests.
  - Rebuild shared dist before downstream typechecks.
- Out of scope:
  - No new ModeSpec schema fields.
  - No runtime executor changes.
  - No desktop UI redesign.
  - No external dependency or service.

## Constraints
- Compatibility: shared public contract changes require `@ora/shared` build before runtime/desktop typechecks because consumers use `packages/shared/dist`.
- Performance: no runtime execution path change; preset metadata only.
- Risk: `agent_teams` does not allow a `debug` template, so Debugger uses a `check` template node with id `debug`.
- Tool/Environment limits: keep changes surgical and test-focused.

## Plan
1. Update `/Users/quintenchen/developer/ora/packages/shared/src/primitives.ts` with `CODE_DEVELOPMENT_MODE_ID`.
2. Update `/Users/quintenchen/developer/ora/packages/shared/src/modes.ts` with a valid `agent_teams` Code Development preset and register it in `MVP_MODES`.
3. Update `/Users/quintenchen/developer/ora/packages/shared/test/contracts.test.ts` contract coverage for preset count/order/shape.
4. Add `/Users/quintenchen/developer/ora/apps/runtime/test/modes.test.ts` runtime visibility/read-only coverage and update runtime bootstrap expected mode order.
5. Run focused tests, shared typecheck/build, downstream typechecks, and scan.
6. Record verification evidence and DONE gate results here.

## Active Files
- `/Users/quintenchen/developer/ora/packages/shared/src/primitives.ts`
- `/Users/quintenchen/developer/ora/packages/shared/src/modes.ts`
- `/Users/quintenchen/developer/ora/packages/shared/test/contracts.test.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/test/modes.test.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/test/runtime-smoke.test.ts`
- `/Users/quintenchen/developer/ora/tasks/TASK-20260501-2215-code-development-mode.md`

## Decisions
- Decision: Implement as a built-in `agent_teams` preset instead of a repository-local `.ora/modes` config.
  - Why: User explicitly chose Ora built-in mode and 4-role full flow.
  - Alternatives: local mode config, single-agent mode, new family/schema.
  - Tradeoffs: avoids executor/schema churn, but Debugger must reuse `check` template.
- Decision: Add a public constant in `primitives.ts`.
  - Why: Existing built-in mode IDs are centralized there.
  - Alternatives: local const in `modes.ts`.
  - Tradeoffs: requires shared rebuild, but improves discoverability and consistency.
- Decision: Update existing shared contract suite rather than adding a separate shared mode test file.
  - Why: `contracts.test.ts` already asserts `MVP_MODES` order/count, validation, bootstrap mode count, and canonical system agent roster.
  - Alternatives: add `packages/shared/test/modes.test.ts` and still patch existing brittle assertions.
  - Tradeoffs: fewer test files, but the shared contract suite remains broad.

## Progress Log
- 2026-05-01 22:15 CST - Task created.
  Next: Fill in Goal, Scope, Plan, and list Active Files.
- 2026-05-01 22:16 CST - Filled task journal with implementation scope, decisions, active files, and verification plan.
  Next: Update shared primitives, add shared preset, add tests.
- 2026-05-01 22:23 CST - Added `CODE_DEVELOPMENT_MODE_ID`, implemented the built-in Code Development `agent_teams` preset, updated shared contract assertions, and added runtime visibility/read-only tests.
  Next: Run focused tests, shared build/typecheck, downstream typechecks, and scan.
- 2026-05-01 22:25 CST - First shared contract test run failed on expected built-in mode count; updated stale expectation from 9 to 10 user-visible modes.
  Next: Re-run shared contract tests and downstream verification.
- 2026-05-01 22:30 CST - Verification passed: shared contracts, shared typecheck/build, runtime tests, runtime typecheck, desktop typecheck, workspace typecheck, and diff check.
  Next: Close journal, record retrospective, and report results.
- 2026-05-01 22:33 CST - Promoted the built-in mode count/order assertion pitfall into the `ora-shared-contract-change` skill.
  Next: Report results.
- 2026-05-01 22:34 CST - Tightened Code Development mode requirements so long-task-protocol is explicitly required in description, recommended use, Orchestrator triage instructions/prompt, and final handoff DONE gates; shared contract tests now assert the requirement.
  Next: None.

## Open Issues
- None.

## TODO
- [x] Add shared mode id and preset.
- [x] Add shared/runtime tests.
- [x] Run verification commands and scan.

## Retrospective

### Item 1
- Pitfall: Adding a built-in mode changes multiple existing count/order assertions outside the new focused tests.
- Symptom: `pnpm --filter @ora/shared test -- contracts.test.ts` initially failed because `RuntimeBootstrapSchema` still expected 9 user-visible modes; runtime smoke also expected the old mode order.
- Root Cause: Built-in mode list is asserted in shared contracts and runtime bootstrap smoke tests, not only where mode definitions live.
- Reusable Guardrail: When adding an Ora built-in mode, search for `MVP_MODES`, `bootstrap.modes`, `visibility !== "internal"`, and expected mode id arrays before running verification.
- Evidence: Fixed `/packages/shared/test/contracts.test.ts` and `/apps/runtime/test/runtime-smoke.test.ts` after failing tests.
- Scope: recurring for built-in mode additions.
- Suggested Writeback Target: `ora-shared-contract-change` skill Pitfalls section.
- Status: promoted_to_skill

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Typechecks pass

**Output**:
- `pnpm --filter @ora/shared test -- contracts.test.ts` -> 1 passed file, 90 passed tests.
- `pnpm --filter @ora/shared typecheck` -> exit 0.
- `pnpm --filter @ora/shared build` -> exit 0.
- Follow-up requirement verification: `pnpm --filter @ora/shared test -- contracts.test.ts && pnpm --filter @ora/shared typecheck && pnpm --filter @ora/shared build` -> exit 0; shared contracts still 90 passed tests.
- `pnpm --filter @ora/runtime test -- test/modes.test.ts test/runtime-smoke.test.ts` -> 23 passed files, 319 passed tests.
- `pnpm --filter @ora/runtime typecheck` -> exit 0.
- `pnpm --filter @ora/desktop typecheck` -> exit 0.
- `pnpm -r --if-present typecheck` -> shared/runtime/desktop typechecks all Done.
- `git diff --check` -> exit 0.

### Functional Verification (Feature Works)
- [x] Shared preset resolves by id.
- [x] ModeSpec validation passes.
- [x] Runtime store lists/gets preset.
- [x] Runtime store rejects update/delete for system preset.

**Output**:
- Shared contract tests assert `CODE_DEVELOPMENT_MODE_ID` appears in `MVP_MODES`, has `family: "agent_teams"`, `systemPreset: true`, `visibility: "user"`, persistent completion policy, team runtime policy, `long-task-protocol` requirement metadata/instructions, valid 4 profiles, valid 5 nodes, valid stages, role-lanes transcript layout, and mode-scoped runtime atoms.
- Runtime tests assert `LocalRunStore.listModes()` and `getMode()` expose `code_development`, and `updateMode()` / `deleteMode()` reject it as a system preset.

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: `createOraSelfBuilderModeSpec()` and `createModeStudioBuilderModeSpec()` in `packages/shared/src/modes.ts`.

### Comparison Points
- [x] Uses `agent_teams` family and allowed templates only.
- [x] Keeps system preset read-only.
- [x] Uses shared build before downstream checks.

### Findings
- Consistency: Code Development follows existing system preset construction style: parsed through `ModeSpecSchema`, auto-laid out, inserted into `MVP_MODES`, and verified through shared/runtime tests.
- Differences: Code Development targets generic project coding, not Ora package self-upgrade or Mode Studio draft generation. Debugger is modeled as a `check` node because `agent_teams` has no `debug` template.
- Conclusion: Consistent with existing mode architecture and intentionally avoids schema/runtime churn.

## Checkpoints

### Checkpoint 1: Shared preset contract
- Requirement: `code_development` is a valid user-visible system preset.
- Verification method: shared tests and `validateModeSpec`.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/shared test -- contracts.test.ts` -> 90 passed tests.

### Checkpoint 2: Runtime preset behavior
- Requirement: runtime lists/gets preset and rejects mutation as system preset.
- Verification method: runtime tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/runtime test -- test/modes.test.ts test/runtime-smoke.test.ts` -> 319 passed tests.

### Checkpoint 3: Downstream contract consumption
- Requirement: runtime/desktop typechecks consume rebuilt shared dist successfully.
- Verification method: shared build, runtime typecheck, desktop typecheck.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/shared build`, `pnpm --filter @ora/runtime typecheck`, `pnpm --filter @ora/desktop typecheck`, and `pnpm -r --if-present typecheck` all exit 0.

**All checkpoints passed.**

## Compressed State (<= 20 lines)
- Objective: Add Ora built-in Code Development mode as an `agent_teams` system preset.
- Done: Added `CODE_DEVELOPMENT_MODE_ID`; added `createCodeDevelopmentModeSpec()`; registered in `MVP_MODES`; made long-task-protocol an explicit mode requirement; updated shared/runtime tests.
- In-progress: None.
- Active files: primitives.ts, modes.ts, contracts.test.ts, runtime modes.test.ts, runtime-smoke.test.ts, this journal.
- Next actions (top 3; exact file/function):
  1. Optional: run `/check` for review before merging.
  2. Optional: manually open Modes UI to inspect card/canvas ordering.
  3. Optional: later wire mode `skillIds` into automatic runtime skill activation if desired.
- Blockers/Risks: None blocking. Residual risk: `skillIds` are metadata unless runtime skill activation is separately implemented.
- Verification status: Passed.

## Verification

### Evidence Requirements
- [x] Code Verification output (compilation/tests/typecheck)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence
- [x] Comparison Evidence
- [x] Checkpoints Evidence

### Environment
- Environment: macOS Darwin, workspace `/Users/quintenchen/developer/ora`, Node 22.17.0, Python 3.13.5.

### Commands run + outputs

```text
$ pnpm --filter @ora/shared test -- contracts.test.ts
1 failed initially: RuntimeBootstrapSchema expected 9 user-visible modes but received 10.
Fixed stale expectation.

$ pnpm --filter @ora/shared test -- contracts.test.ts
Test Files  1 passed (1)
Tests  90 passed (90)
Exit Code: 0

$ pnpm --filter @ora/shared typecheck
tsc -p tsconfig.json --noEmit
Exit Code: 0

$ pnpm --filter @ora/shared build
tsc -p tsconfig.json
Exit Code: 0

$ pnpm --filter @ora/shared test -- contracts.test.ts && pnpm --filter @ora/shared typecheck && pnpm --filter @ora/shared build
contracts.test.ts: 90 passed tests
typecheck: exit 0
build: exit 0

$ pnpm --filter @ora/runtime test -- test/modes.test.ts test/runtime-smoke.test.ts
Test Files  23 passed (23)
Tests  319 passed (319)
Exit Code: 0

$ pnpm --filter @ora/runtime typecheck
tsc -p tsconfig.json --noEmit
Exit Code: 0

$ pnpm --filter @ora/desktop typecheck
tsc --noEmit
Exit Code: 0

$ pnpm --filter @ora/runtime typecheck && pnpm --filter @ora/desktop typecheck
runtime typecheck: exit 0
desktop typecheck: exit 0

$ pnpm -r --if-present typecheck
packages/shared typecheck: Done
apps/runtime typecheck: Done
apps/desktop typecheck: Done
Exit Code: 0

$ bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"
Output contained only historical/generated/skill-template matches, including `.workbuddy/memory/*`, `skills/skill-creator/scripts/init_skill.py`, and bundled runtime sidecar artifacts. No new task-local source issue was introduced.

$ git diff --check
Exit Code: 0
```
