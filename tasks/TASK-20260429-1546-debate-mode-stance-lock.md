# TASK-20260429-1546-debate-mode-stance-lock

**Created:** 2026-04-29 15:46 CST
**Status:** Done

---

## Goal
Fix debate mode's stance-softening behavior by enforcing per-turn stance lock and anti-equivocation prompt contracts while preserving the existing Stage Transcript architecture: one reusable Debate Agent, virtual speaker labels, 9 ordered transcript entries, and moderator synthesis as the final answer.

## Scope / Out of scope
- In scope:
  - Strengthen `debateAgentSoul` and moderator synthesis instructions in `packages/shared/src/modes.ts`.
  - Strengthen each debate turn's prompt/system contract in `apps/runtime/src/patterns/driver-registry.ts`.
  - Add runtime integration assertions proving debate prompts include stance lock and anti-equivocation constraints.
- Out of scope:
  - New `CoordinationPattern`.
  - Separate real agents for each debate seat.
  - Stage Transcript UI/schema changes.
  - Judge/scoring/regeneration pipeline.

## Constraints
- Compatibility: preserve `AgentConversationMessage.transcript` contract and 9-entry transcript order.
- Simplicity: prompt-contract-only fix; no schema or persistence migration.
- Risk: avoid making debate unusably aggressive; enforce adversarial stance without allowing fabricated facts or personal attacks.
- Tool/Environment limits: implement surgically and verify with focused runtime/shared tests plus typecheck.

## Plan
1. Update `packages/shared/src/modes.ts` debate agent and moderator instructions. Done.
2. Update `apps/runtime/src/patterns/driver-registry.ts` to add per-turn stance lock and anti-equivocation prompt language. Done.
3. Update `apps/runtime/test/runtime-integration.test.ts` with prompt contract assertions. Done.
4. Run focused tests/typecheck/TODO scan and record evidence. Done.

## Active Files
- tasks/TASK-20260429-1546-debate-mode-stance-lock.md
- packages/shared/src/modes.ts
- apps/runtime/src/patterns/driver-registry.ts
- apps/runtime/test/runtime-integration.test.ts

## Decisions
- Decision: Keep one reusable Debate Agent and strengthen per-turn prompt contract.
  - Why: matches v1 decision in `TASK-20260429-0003-debate-mode-stage-transcript.md` and avoids architecture churn.
  - Alternatives: separate real agents per side; judge/regenerate loop.
  - Tradeoffs: prompt-only enforcement is less absolute than isolated agents, but is minimal, reversible, and testable.
- Decision: Test prompt construction rather than generated prose quality.
  - Why: local/mock provider output is not a reliable semantic quality oracle.
  - Alternatives: heuristic regex over generated text.
  - Tradeoffs: structural contract tests catch regressions in enforcement language without brittle content expectations.

## Progress Log
- 2026-04-29 15:46 CST - Task created and filled from approved plan `/Users/quintenchen/.workbuddy/plans/quantum-beacon-lovelace.md`.
  Next: Patch `modes.ts`, patch `driver-registry.ts`, then add runtime integration tests.
- 2026-04-29 15:52 CST - Implemented prompt contract changes: Debate Agent soul now contains stance lock and anti-equivocation rules; per-turn prompt/system now contains explicit `STANCE LOCK`, prior-transcript usage restriction, `HARD CONSTRAINT`, and output structure; moderator synthesis now requires explicit comparative judgment.
  Next: Run focused runtime/shared tests, root tests/typecheck/lint, then update evidence.
- 2026-04-29 15:56 CST - Verification completed. Focused runtime/shared tests, root tests, typecheck, lint, and TODO scan completed. Remaining TODO scan hits are historical/generated/template noise outside this task's active files.
  Next: none.

## Open Issues
- None.

## TODO
- None.

## Retrospective
- No reusable pitfalls worth promoting. This was a surgical prompt-contract hardening task; the main lesson is already captured in the implementation tests: prompt behavior should be tested at the construction/contract layer instead of via brittle generated-content heuristics.

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm --filter @ora/runtime test -- runtime-integration.test.ts` -> PASS. Vitest reported 17 runtime test files passed, 254 tests passed, including `runtime-integration.test.ts` 38 tests.
- `pnpm --filter @ora/shared test` -> PASS. `contracts.test.ts` 85 tests passed.
- `pnpm typecheck` -> PASS. `packages/shared`, `apps/runtime`, and `apps/desktop` typechecks completed.
- `pnpm test` -> PASS. Shared 85 tests, desktop 64 tests, runtime 254 tests all passed.
- `pnpm lint` -> PASS. Workspace lint command completed with exit code 0.

### Functional Verification (Feature Works)
- [x] Existing transcript order remains unchanged.
- [x] Debate prompts include per-turn stance lock and anti-equivocation constraints.
- [x] Moderator synthesis prompt requires explicit comparative judgment.

**Output**:
- Existing runtime debate test still asserts 9 transcript messages in order, first 8 from `debate_agent`, all grouped under `debate`, final entry from `moderator`.
- New runtime integration test `injects stance-lock constraints into debate mode agent prompts` asserts all 8 `agent.debate_agent.invoke` prompts contain `Current virtual speaker`, `Assigned stance`, `STANCE LOCK`, the correct mandatory stance, `HARD CONSTRAINT`, prior-transcript anti-neutralization text, and stance-specific lead claim instruction.
- The same test asserts the moderator synthesis prompt contains explicit comparative judgment language, evidence/logic/burden-of-proof criteria, and the prohibition against defaulting to both-sides-valid synthesis.

## Comparison

### Reference
- Reference implementation/template/similar task: `TASK-20260429-0003-debate-mode-stage-transcript.md`.

### Comparison Points
- [x] Preserve v1 architecture: mode preset, not new coordination pattern.
- [x] Preserve one Debate Agent with virtual speaker labels.
- [x] Preserve Stage Transcript as generic content surface.

### Findings
- Consistency: The fix extends the intended per-turn prompt overlay approach rather than replacing it.
- Differences: Adds explicit stance/anti-equivocation contract that original implementation omitted.
- Conclusion: Prompt-contract strengthening is the smallest aligned fix.

## Checkpoints

### Checkpoint 1: Stance lock contract
- Requirement: Every Debate Agent turn must include the assigned stance as a hard behavioral constraint.
- Verification method: Runtime integration test inspects debate agent action prompts.
- Status: [x] Pass / [ ] Fail
- Evidence: New runtime integration assertions passed under `pnpm --filter @ora/runtime test -- runtime-integration.test.ts` and root `pnpm test`.

### Checkpoint 2: Transcript compatibility
- Requirement: Debate still emits 9 ordered transcript messages and first 8 are from `debate_agent`.
- Verification method: Existing runtime integration test.
- Status: [x] Pass / [ ] Fail
- Evidence: Existing `emits ordered debate transcript messages from one reusable debate agent` test still passes.

### Checkpoint 3: Moderator judgment contract
- Requirement: Moderator synthesis should compare evidence quality and avoid default balanced conclusion.
- Verification method: Runtime integration test inspects moderator synthesis action prompt.
- Status: [x] Pass / [ ] Fail
- Evidence: New runtime integration assertions check explicit judgment, evidence/logic/burden-of-proof criteria, and anti-equal-valid default language.

## Compressed State (<= 20 lines)
- Objective: Fix debate mode stance-softening via stronger prompt contracts.
- Done: `modes.ts` debate agent soul and synthesis prompt/instructions hardened.
- Done: `driver-registry.ts` per-turn debate prompts now include stance lock, anti-neutralization, hard constraint, and output structure.
- Done: `runtime-integration.test.ts` adds prompt contract assertions for all 8 debate turns and moderator synthesis.
- Active files: `modes.ts`, `driver-registry.ts`, `runtime-integration.test.ts`, this task.
- Verification status: PASS for focused runtime/shared tests, root test, typecheck, lint, and TODO scan review.
- Blockers/Risks: No blockers. Residual risk: prompt may feel more rigid, but that is acceptable for debate mode.
- Next actions (top 3; exact file/function): none.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: macOS darwin, workspace `/Users/quintenchen/developer/ora`.

### Commands run + outputs
- `pnpm --filter @ora/runtime test -- runtime-integration.test.ts`
  - PASS: 17 test files passed, 254 tests passed; `runtime-integration.test.ts` 38 tests passed.
- `pnpm --filter @ora/shared test`
  - PASS: 1 test file passed, 85 tests passed.
- `pnpm typecheck`
  - PASS: `packages/shared`, `apps/runtime`, and `apps/desktop` typechecks completed.
- `pnpm test`
  - PASS: shared 85 tests, desktop 64 tests, runtime 254 tests.
- `pnpm lint`
  - PASS: workspace lint completed with exit code 0.
- `bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"`
  - Output contained only pre-existing/historical/generated/template hits outside this task's active files: `.ora/skills/private/think/SKILL.md`, `.ora/runtime.db`, `skills/skill-creator/scripts/init_skill.py`, `apps/desktop/src-tauri/resources/runtime-sidecar/**`.
