# TASK-20260428-1559-file-backed-system-agents

**Created:** 2026-04-28 15:59 Asia/Shanghai
**Status:** Done

---

## Goal
- Promote Ora built-in agents to the same file-backed spec shape as custom agents for local user edits: directory per agent with `config.yaml` and `SOUL.md`. Keep the canonical built-in roster and mode wiring intact, but remove the special-case single JSON override write path for new built-in edits.

## Scope / Out of scope
- In scope:
  - Change runtime built-in override persistence from new `.json` writes to `<agentId>/config.yaml` + `<agentId>/SOUL.md` under the existing `agent-overrides` root.
  - Preserve legacy `.json` read/reset compatibility for existing installs and old alias ids.
  - Update runtime tests so built-in override edits prove the directory spec is written and injected.
  - Update desktop browser fallback behavior to mirror runtime semantics where feasible.
- Out of scope:
  - Changing canonical built-in agent ids or mode `ownerAgentId`.
  - Moving custom agents out of `.ora/agents`.
  - Creating repo-shipped per-agent markdown files in this slice.
  - Redesigning the Agents page.

## Constraints
- Compatibility:
  - Existing `.ora/agent-overrides/<id>.json` files must still load.
  - Reset must remove both new directory specs and legacy json overrides, including legacy alias ids.
  - Custom agent name collision rules with built-ins must remain.
- Performance:
  - Catalog and override lookup stay local filesystem reads; no new persistence layer.
- Risk:
  - Runtime and desktop fallback can diverge if only one side learns the new structure. Patch both runtime and fallback behavior.
- Tool/Environment limits:
  - Worktree already has unrelated dirty evaluation files. Do not revert or rewrite unrelated changes.

## Plan
1. Patch `apps/runtime/src/custom-agents.ts` `SystemAgentOverrideFileStore` to read/write directory specs and still read legacy `.json`.
2. Patch desktop browser fallback copy in `apps/desktop/src/lib/runtimeClient.ts` enough to preserve reset/update/catalog semantics.
3. Update focused runtime tests to assert built-in overrides write `config.yaml` + `SOUL.md`, legacy json aliases still work, and reset cleans both shapes.
4. Run focused runtime tests plus typecheck/build checks that cover touched contracts, then record evidence.

## Active Files
- `/Users/quintenchen/developer/ora/tasks/TASK-20260428-1559-file-backed-system-agents.md`
- `/Users/quintenchen/developer/ora/apps/runtime/src/custom-agents.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/test/custom-agents.test.ts`
- `/Users/quintenchen/developer/ora/apps/desktop/src/components/AgentsView.tsx`

## Decisions
- Decision: Use the existing `agent-overrides` root but change each new built-in override to a directory spec.
  - Why: This keeps reset/upgrade semantics and the accepted global override model while making built-in/custom local edits structurally consistent.
  - Alternatives: Store built-ins in `.ora/agents`; rejected because built-in ids are reserved and custom agents should remain separate user-created personas.
  - Tradeoffs: There is still a conceptual distinction between built-in and custom sources, but the local editable spec shape is unified.

## Progress Log
- 2026-04-28 15:59 - Task created. Existing worktree has unrelated dirty evaluation files; keep this slice narrowly scoped.
  Next: Patch runtime store, patch desktop fallback, update focused tests.
- 2026-04-28 16:02 - Runtime system-agent overrides now write directory specs with `config.yaml` and `SOUL.md`, while still reading legacy json. AgentsView built-in editor now labels the editor as SOUL/file-backed override.
  Next: Run focused tests/typechecks and record evidence.
- 2026-04-28 16:04 - Verification passed and task closed.
  Next: None.

## Open Issues
- None.

## TODO
- [x] Patch runtime system-agent file-backed spec persistence.
- [x] Patch desktop product copy to expose file-backed SOUL semantics.
- [x] Add/update focused tests.
- [x] Run verification and close task.

## Retrospective
- No reusable pitfalls were found. The only failed loop was a local test setup variable missing after adding filesystem assertions; it was fixed immediately and does not need skill writeback.

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- N/A Lint checks are not planned unless focused verification reveals formatting/type issues.

**Output**:
- `pnpm --filter @ora/runtime test -- custom-agents.test.ts` -> passed after fixing the test setup variable; final run: `Test Files 14 passed (14); Tests 215 passed (215)`.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `git diff --check` -> passed.

### Functional Verification (Feature Works)
- [x] Built-in override update writes `<agentId>/config.yaml` and `<agentId>/SOUL.md`.
- [x] Legacy json overrides still read through canonical aliases.
- [x] Reset removes new directory specs and legacy json files.

**Output**:
- `custom-agents.test.ts` now asserts `agents.updateSystemOverride` for `solo_agent` writes `agent-overrides/solo_agent/config.yaml` and `agent-overrides/solo_agent/SOUL.md`, does not write `solo_agent.json`, injects the SOUL text, and removes the directory on reset.
- Existing legacy override test still writes `agent-overrides/research_subagent.json`, verifies it maps to canonical `researcher`, injects the legacy SOUL, and reset removes the legacy json.

## Comparison (If Applicable)

### Reference
- Current custom agent file-backed store: `.ora/agents/<name>/config.yaml` + `SOUL.md`.

### Comparison Points
- [x] Built-in override file shape matches custom agent local spec shape.
- [x] Built-in and custom remain separate stores to preserve reserved id semantics.
- [x] Runtime injection still uses the same prompt-context sections.

### Findings
- Consistency: New built-in overrides now use the same local artifact pattern as custom agents: directory + `config.yaml` + `SOUL.md`.
- Differences: Built-ins remain under `agent-overrides` and use `agent_id` / `label` / `role` config fields, while custom agents remain under `agents` and use `name` / `description`; this preserves reserved-id and reset semantics.
- Conclusion: The special single-json override path is now legacy read compatibility, not the new write path.

## Checkpoints

### Checkpoint 1: Runtime file-backed built-in spec
- Requirement: New built-in overrides are persisted as directory specs.
- Verification method: Runtime test filesystem assertions.
- Status: [x] Pass / [ ] Fail
- Evidence: Runtime test asserts `agent-overrides/solo_agent/config.yaml` and `SOUL.md` exist after update and `solo_agent.json` is not written.

### Checkpoint 2: Compatibility
- Requirement: Existing legacy json override ids still apply and reset.
- Verification method: Existing legacy override test updated to check cleanup across both shapes.
- Status: [x] Pass / [ ] Fail
- Evidence: Runtime legacy test still passes for `research_subagent.json` mapping to canonical `researcher` and reset cleanup.

### Checkpoint 3: Focused verification
- Requirement: Runtime tests and typecheck/build checks pass for touched seams.
- Verification method: Focused commands.
- Status: [x] Pass / [ ] Fail
- Evidence: Runtime custom-agent test suite, runtime typecheck, desktop typecheck, and diff check passed.

## Compressed State (<= 20 lines)
- Objective: Make built-in agent local overrides file-backed with `config.yaml` + `SOUL.md`, matching custom agent structure.
- Done: Runtime built-in override store writes directory specs, reads legacy json, resets both shapes; AgentsView labels built-in edits as file-backed SOUL overrides; focused tests pass.
- In-progress: None.
- Active files: `apps/runtime/src/custom-agents.ts`, `apps/runtime/test/custom-agents.test.ts`, `apps/desktop/src/components/AgentsView.tsx`, this task file.
- Next actions (top 3; exact file/function): None.
- Blockers/Risks: Existing unrelated dirty evaluation files and runtimeClient/contracts changes were observed and left untouched.
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
- `pnpm --filter @ora/runtime test -- custom-agents.test.ts`
  - First run failed because the updated test referenced `dir` before defining it.
  - Final run passed: `Test Files 14 passed (14); Tests 215 passed (215)`.
- `pnpm --filter @ora/runtime typecheck`
  - Passed.
- `pnpm --filter @ora/desktop typecheck`
  - Passed.
- `git diff --check`
  - Passed.
