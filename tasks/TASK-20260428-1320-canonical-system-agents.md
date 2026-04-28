# TASK-20260428-1320-canonical-system-agents

**Created:** 2026-04-28 13:20 Asia/Shanghai
**Status:** Done

---

## Goal
- Consolidate Ora built-in system agents so modes reuse a small canonical roster instead of creating near-duplicate agent identities per mode. Preserve the direct global override model, keep only necessary compatibility for old override ids, and make the remaining agents valuable through stronger `systemPrompt` / SOUL-style instructions.

## Scope / Out of scope
- In scope:
  - Update built-in mode `profiles`, `ownerAgentId`, and topology agent ids in `packages/shared/src/modes.ts`.
  - Strengthen canonical system agent prompts for the reduced roster.
  - Add minimal override-id migration/aliasing for old built-in ids.
  - Update Mode Studio role planning and draft generation so new modes reuse canonical agent identities by default.
  - Add/update focused tests that prove catalog consolidation, override aliasing, and Mode Studio reuse.
- Out of scope:
  - Broad Agents page redesign.
  - Preserving duplicate built-in agent product concepts that only existed because mode presets were split.
  - Creating new custom agents unless the user explicitly asks for specialized divergent behavior.

## Constraints
- Compatibility:
  - Existing built-in override files with old ids should still affect the new canonical agent.
  - Existing custom agents and custom modes should remain file-backed and valid.
- Performance:
  - Catalog building should stay simple and local; no new runtime persistence layer.
- Risk:
  - The main risk is accidentally changing mode execution semantics by changing owner ids. Verification must cover catalog and runtime/mode contracts.
- Tool/Environment limits:
  - Use focused local tests/typechecks; do not rely on manual UI inspection unless needed.

## Plan
1. Update `packages/shared/src/modes.ts` canonical profile definitions, owner ids, topology nodes, and Mode Studio preset role ids.
2. Add minimal alias/migration support in runtime agent override handling and reserved-id checks.
3. Update Mode Studio draft generation to prefer canonical system agents and only create custom agents for truly custom personas.
4. Verify with shared/runtime/desktop focused tests and record outputs.

## Active Files
- `/Users/quintenchen/developer/ora/packages/shared/src/modes.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/custom-agents.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/agent-catalog.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/mode-studio-draft.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/mode-studio-store.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/mode-studio-builder-run.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/patterns/driver-registry.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/run-deterministic-patterns.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/run-snapshots.ts`
- `/Users/quintenchen/developer/ora/apps/desktop/src/lib/runtimeClient.ts`
- `/Users/quintenchen/developer/ora/apps/desktop/src/lib/runtimeClient.test.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/test/custom-agents.test.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/test/mode-studio-builder.test.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/test/runtime-smoke.test.ts`
- `/Users/quintenchen/developer/ora/packages/shared/test/contracts.test.ts`

## Decisions
- Decision: Reduce built-in agent identities around canonical responsibilities rather than per-mode labels.
  - Why: The catalog already deduplicates by `profile.id`; reusing ids makes Agents page usage meaningful and lowers management noise.
  - Alternatives: Keep all ids and add grouping UI; this preserves the underlying duplication and weakens global override semantics.
  - Tradeoffs: Some mode-specific labels disappear from the system-agent roster, but stage prompts still carry mode-specific behavior.
- Decision: Keep minimal old-id aliasing for override migration only.
  - Why: Ora is not formally launched, so product code should stay clean, but old local override files should not silently stop working.
  - Alternatives: Full legacy product compatibility layer; rejected as unnecessary.
  - Tradeoffs: Alias code is small runtime plumbing and should not leak into the UI as separate agents.

## Progress Log
- 2026-04-28 13:20 - Task created.
  Next: Inspect current tests, patch canonical modes, then add alias and Mode Studio updates.
- 2026-04-28 13:37 - Patched the first pass of canonical agent consolidation across shared mode presets, runtime override aliases, Mode Studio local draft generation, and desktop fallback parity.
  Next: Run shared/runtime/desktop checks, fix failing expectations, then update verification evidence.
- 2026-04-28 13:46 - Verification passed. Visible built-in roster is 11 canonical agents: `builder`, `generator`, `orchestrator`, `release_reviewer`, `researcher`, `responder`, `reviewer`, `router`, `solo_agent`, `team_lead`, `verifier`.
  Next: None; task is complete.

## Open Issues
- None.

## Task Checklist
- [x] Patch canonical built-in mode roster and prompts.
- [x] Patch minimal old-id alias/migration support.
- [x] Patch Mode Studio role/draft generation to reuse canonical agents.
- [x] Run focused verification and update this journal.

## Retrospective

### Item 1
- Pitfall: Runtime checks can report stale shared exports when they start before `@ora/shared` finishes rebuilding.
- Symptom: `@ora/runtime typecheck` initially reported missing shared exports and missing schema fields that existed in source.
- Root Cause: Runtime typecheck was started in parallel with shared build and read old `packages/shared/dist`.
- Reusable Guardrail: After changing shared contracts, rebuild `@ora/shared` before runtime/desktop typecheck or tests.
- Evidence: The first runtime typecheck failed with missing `SYSTEM_AGENT_ID_ALIASES`; after `pnpm --filter @ora/shared build`, runtime and desktop typechecks passed.
- Scope: Ora shared/runtime/desktop contract work.
- Suggested Writeback Target: Existing Ora memory already records this shared-build ordering pitfall; no new skill writeback needed.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- N/A Lint checks not run; focused typecheck and tests covered the changed contracts.

**Output**:
- `pnpm --filter @ora/shared build` -> passed.
- `pnpm --filter @ora/runtime typecheck` -> passed after shared rebuild.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm --filter @ora/shared test -- contracts.test.ts` -> `80 passed`.
- `pnpm --filter @ora/runtime test -- custom-agents.test.ts mode-studio-builder.test.ts` -> command ran the runtime suite; `13 passed`, `212 passed`.
- `pnpm --filter @ora/desktop test -- runtimeClient.test.ts` -> command ran the desktop suite; `9 passed`, `37 passed`.
- Lint was not run because there is no focused lint requirement and type/tests covered the changed contracts.

### Functional Verification (Feature Works)
- [x] Built-in catalog shows reduced canonical system agents with multi-mode usages.
- [x] Old override ids affect the mapped canonical agent.
- [x] Mode Studio no longer creates unnecessary per-mode custom agents by default.

**Output**:
- Roster smoke: `11 builder,generator,orchestrator,release_reviewer,researcher,responder,reviewer,router,solo_agent,team_lead,verifier`.
- `apps/desktop/src/lib/runtimeClient.test.ts` asserts the browser fallback catalog exposes exactly those 11 ids and that `builder` / `reviewer` show multi-mode usages.
- `apps/runtime/test/custom-agents.test.ts` writes a legacy `research_subagent.json` override and verifies it appears as canonical `researcher`, affects runtime prompts, and is removed by reset.
- `apps/runtime/test/mode-studio-builder.test.ts` verifies local Mode Studio drafts now have empty `agentDrafts`, canonical profile ids, and no `customAgentId` bindings by default.

## Comparison (If Applicable)

### Reference
- Previous built-in/custom agent management model from `tasks/TASK-20260427-1452-ora-builtin-agents-management.md`.

### Comparison Points
- [x] Preserve global same-id override semantics.
- [x] Preserve visible mode usage in Agents page.
- [x] Reduce duplicate built-in ids instead of grouping them after the fact.

### Findings
- Consistency: The implementation keeps the prior catalog split and global override semantics.
- Differences: The built-in mode presets now reuse canonical ids directly; Mode Studio local drafts no longer create custom agent drafts by default.
- Conclusion: The cleaner model is in code, with only a small alias layer for legacy override files.

## Checkpoints

### Checkpoint 1: Canonical built-in catalog
- Requirement: Built-in visible system agent count is reduced and reused across modes.
- Verification method: Runtime/desktop catalog tests.
- Status: Pass
- Evidence: Shared dist roster smoke returned 11 visible ids; desktop runtime client test asserts exact catalog ids and multi-mode usages.

### Checkpoint 2: Override alias migration
- Requirement: Old built-in override ids map to canonical ids without surfacing duplicate agents.
- Verification method: Runtime/unit test covering old id override file behavior.
- Status: Pass
- Evidence: Runtime custom-agents test covers legacy `research_subagent` override mapping to canonical `researcher` and reset deletion.

### Checkpoint 3: Mode Studio generation
- Requirement: Mode Studio drafts reuse canonical system ids and avoid creating custom agent drafts unless explicitly needed.
- Verification method: Mode Studio builder tests.
- Status: Pass
- Evidence: Runtime Mode Studio builder tests cover empty `agentDrafts`, canonical profile ids, and no default `customAgentId`.

## Compressed State (<= 20 lines)
- Objective: Consolidate built-in system agents into canonical reusable identities and strengthen prompts.
- Done: Canonical built-in roster is 11 visible ids; mode presets/topologies/owner ids updated; prompts strengthened; legacy override aliasing added; Mode Studio local drafts reuse canonical system agents; tests updated and passing.
- In-progress: None.
- Active files: shared modes/capabilities, runtime catalog/override/mode-studio/driver files, desktop fallback, focused tests.
- Next actions (top 3; exact file/function): None.
- Blockers/Risks: None known. Lint not run; typecheck and targeted suites passed.
- Verification status: Passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/typecheck)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, zsh, 2026-04-28 Asia/Shanghai.

### Commands run + outputs
- `pnpm --filter @ora/shared build`
  - Passed.
- `pnpm --filter @ora/runtime typecheck`
  - Passed after rebuilding shared.
- `pnpm --filter @ora/desktop typecheck`
  - Passed.
- `pnpm --filter @ora/shared test -- contracts.test.ts`
  - `Test Files 1 passed (1); Tests 80 passed (80)`.
- `pnpm --filter @ora/runtime test -- custom-agents.test.ts mode-studio-builder.test.ts`
  - `Test Files 13 passed (13); Tests 212 passed (212)`.
- `pnpm --filter @ora/desktop test -- runtimeClient.test.ts`
  - `Test Files 9 passed (9); Tests 37 passed (37)`.
- `node -e "...visible roster..."`
  - `11 builder,generator,orchestrator,release_reviewer,researcher,responder,reviewer,router,solo_agent,team_lead,verifier`.
- `bash skills/long-task-protocol/scripts/todo_scan.sh`
  - Reported pre-existing noise in `.ora/skills/private/think/SKILL.md`, `skills/skill-creator/scripts/init_skill.py`, generated `runtime-sidecar.cjs`, `.ora/runtime.db`, and bundled `bin/node`. No hits in the task journal or touched source files.
