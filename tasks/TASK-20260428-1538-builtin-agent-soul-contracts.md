# TASK-20260428-1538-builtin-agent-soul-contracts

**Created:** 2026-04-28 15:38 Asia/Shanghai
**Status:** Done

---

## Goal
- Strengthen the existing 11 canonical Ora built-in system agents so each `systemPrompt` / SOUL describes a mature responsibility contract for its role. Keep the current canonical roster, mode usage, topology, owner ids, override semantics, and execution behavior unchanged.

## Scope / Out of scope
- In scope:
  - Update `CANONICAL_AGENT_SOULS` in `packages/shared/src/modes.ts`.
  - Add focused shared contract coverage that proves all canonical built-in agents keep concrete responsibility, boundary, and evidence/output guidance.
  - Run focused shared verification and record evidence here.
- Out of scope:
  - Adding, removing, or renaming built-in agents.
  - Changing mode `profiles`, `ownerAgentId`, node topology, runtime driver behavior, or desktop UI layout.
  - Changing custom agent storage or global override semantics.

## Constraints
- Compatibility:
  - Built-in roster must remain exactly `builder`, `generator`, `orchestrator`, `release_reviewer`, `researcher`, `responder`, `reviewer`, `router`, `solo_agent`, `team_lead`, `verifier`.
  - Existing system-agent override behavior must continue to apply on top of canonical prompts.
- Performance:
  - Prompt text changes only; no runtime persistence or catalog algorithm changes.
- Risk:
  - Prompts can become too verbose or conflict with stage instructions. Keep each role contract concise and complementary to mode/node prompts.
- Tool/Environment limits:
  - Use focused local tests/typechecks; no manual UI inspection required because the visible card content derives from shared catalog data.

## Plan
1. Update `packages/shared/src/modes.ts` `CANONICAL_AGENT_SOULS` with concise role contracts: responsibility, boundary/non-responsibility, output/evidence expectations, and uncertainty behavior.
2. Add focused assertions in `packages/shared/test/contracts.test.ts` covering canonical agent count and prompt contract signals without hardcoding fragile full prose.
3. Verify with `pnpm --filter @ora/shared build` and focused shared tests; update this journal with outputs and checkpoints.

## Active Files
- `/Users/quintenchen/developer/ora/tasks/TASK-20260428-1538-builtin-agent-soul-contracts.md`
- `/Users/quintenchen/developer/ora/packages/shared/src/modes.ts`
- `/Users/quintenchen/developer/ora/packages/shared/test/contracts.test.ts`

## Decisions
- Decision: Strengthen only canonical agent prompts, not mode topology.
  - Why: The current architecture already uses canonical built-in ids with global same-id overrides; better prompts improve role accountability without changing execution semantics.
  - Alternatives: Keep current prompts; add mode-specific overlays; create more agents.
  - Tradeoffs: Prompt-only strengthening is less precise than per-mode overlays, but it avoids splitting canonical agent identity and keeps the Agents page meaningful.

## Progress Log
- 2026-04-28 15:38 - Task created with Option 2 scope.
  Next: Patch canonical prompts, add focused contract coverage, run shared verification.
- 2026-04-28 15:41 - Patched canonical prompt contracts and added shared roster/contract-signal test coverage.
  Next: Record verification outputs, mark checkpoints, and close the task.
- 2026-04-28 15:44 - Verification passed and task closed.
  Next: None.

## Open Issues
- None.

## TODO
- [x] Patch canonical built-in agent prompts.
- [x] Add focused contract test coverage.
- [x] Run focused verification and record outputs.

## Retrospective
- No reusable pitfalls were found. This was a narrow shared-contract prompt update with straightforward verification.

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- N/A Lint checks are not planned unless focused verification reveals formatting/type issues.

**Output**:
- `pnpm --filter @ora/shared build` -> passed.
- `pnpm --filter @ora/shared test -- contracts.test.ts` -> `Test Files 1 passed (1); Tests 81 passed (81)`.

### Functional Verification (Feature Works)
- [x] Canonical roster remains unchanged.
- [x] Every canonical built-in agent prompt includes concrete responsibility, boundary, and evidence/output guidance.
- [x] No mode topology or owner ids are intentionally changed.

**Output**:
- New shared contract test asserts the built-in system agent ids remain exactly: `builder`, `generator`, `orchestrator`, `release_reviewer`, `researcher`, `responder`, `reviewer`, `router`, `solo_agent`, `team_lead`, `verifier`.
- New shared contract test asserts each canonical prompt includes `Responsibility:`, `Boundary:`, `Output:`, and at least one concrete evidence/output signal.
- This task's planned changes only touch `CANONICAL_AGENT_SOULS`, the focused contract test, and this task journal. An unrelated dirty task journal, `tasks/TASK-20260428-1525-file-change-artifact-diff.md`, was observed during closeout and intentionally left untouched.

## Comparison (If Applicable)

### Reference
- `tasks/TASK-20260428-1320-canonical-system-agents.md`

### Comparison Points
- [x] Preserve canonical built-in roster.
- [x] Preserve global override semantics.
- [x] Strengthen prompt value without adding duplicate agent concepts.

### Findings
- Consistency: The implementation keeps the 11-agent canonical roster created by the prior consolidation task.
- Differences: Prompt text is now structured as responsibility, boundary, and output guidance instead of short role descriptions.
- Conclusion: Option 2 is complete without changing runtime topology, profile ids, owner ids, or override storage.

## Checkpoints

### Checkpoint 1: Canonical roster unchanged
- Requirement: The visible system-agent roster stays at the same 11 ids.
- Verification method: Shared contract test over `MVP_MODES` built-in profiles.
- Status: [x] Pass / [ ] Fail
- Evidence: `contracts.test.ts` asserts the exact sorted 11-agent roster; focused test run passed.

### Checkpoint 2: Prompt contracts strengthened
- Requirement: Each canonical built-in agent prompt contains concrete role responsibility plus boundary and output/evidence guidance.
- Verification method: Shared contract test over each canonical prompt.
- Status: [x] Pass / [ ] Fail
- Evidence: `contracts.test.ts` asserts every canonical prompt contains `Responsibility:`, `Boundary:`, `Output:`, plus evidence/output signal words; focused test run passed.

### Checkpoint 3: Shared contracts still valid
- Requirement: Shared package builds and focused contract tests pass.
- Verification method: `pnpm --filter @ora/shared build` and `pnpm --filter @ora/shared test -- contracts.test.ts`.
- Status: [x] Pass / [ ] Fail
- Evidence: Shared build passed; shared contract test passed with 81 tests.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Strengthen canonical builtin agent SOUL/systemPrompt contracts without changing roster or runtime topology.
- Done: `CANONICAL_AGENT_SOULS` now uses responsibility/boundary/output contracts for all 11 agents; focused shared contract coverage added and passing.
- In-progress: None.
- Active files: `tasks/TASK-20260428-1538-builtin-agent-soul-contracts.md`, `packages/shared/src/modes.ts`, `packages/shared/test/contracts.test.ts`.
- Next actions (top 3; exact file/function): None.
- Blockers/Risks: None known. Lint not run because focused build/test covered this shared prompt-contract change.
- Verification status: Passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, zsh, 2026-04-28 Asia/Shanghai.

### Commands run + outputs
- `pnpm --filter @ora/shared build`
  - Passed.
- `pnpm --filter @ora/shared test -- contracts.test.ts`
  - `RUN  v2.1.9 /Users/quintenchen/developer/ora/packages/shared`
  - `✓ test/contracts.test.ts (81 tests) 28ms`
  - `Test Files  1 passed (1)`
  - `Tests  81 passed (81)`
- `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh`
  - Note: the bundled script resolved its default task file under `/Users/quintenchen/developer/quantfox`, so it is recorded as protocol evidence but not treated as Ora-local TODO evidence.
  - `Blocking TODO matches: none`
  - `Blocking task-journal TODO entries: none`
  - `Result: PASS`
- `rg -n "^- \\[ \\]" tasks/TASK-20260428-1538-builtin-agent-soul-contracts.md`
  - Exit code 1 with no matches, meaning this task journal has no unchecked task entries.
- `rg -n "^<<<<<<<|^=======|^>>>>>>>" tasks/TASK-20260428-1538-builtin-agent-soul-contracts.md packages/shared/src/modes.ts packages/shared/test/contracts.test.ts`
  - Exit code 1 with no matches, meaning this task's files have no conflict markers.
- `git diff --check`
  - Passed with no whitespace errors.
