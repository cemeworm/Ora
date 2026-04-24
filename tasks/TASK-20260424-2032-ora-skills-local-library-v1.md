# TASK-20260424-2032-ora-skills-local-library-v1

**Created:** 2026-04-24 20:32 CST
**Status:** Done

---

## Goal
Implement Ora Skills local library v1: public/bundled plus custom/user skills, dynamic runtime loading, CRUD/toggle JSON-RPC methods, selected enabled skill prompt injection, and a desktop Skills management entry below Agents.

## Scope / Out of scope
- In scope: shared schemas, runtime file-backed skill store, runtime JSON-RPC skill methods, run prompt integration, desktop Skills view, sidebar navigation, focused tests.
- Out of scope: `.skill` archive import, supporting file management for `references/`, `templates/`, `scripts/`, `assets/`, LLM security scanning.

## Constraints
- Compatibility: preserve existing `skills.list` registry shape while adding fields with defaults.
- Performance: scan small local skill directories on demand; no long-running background watcher.
- Risk: public skills are read-only; custom skills require valid frontmatter and only inject when enabled and selected.
- Tool/Environment limits: root `pnpm typecheck` needs `pnpm --filter @ora/shared build` first because runtime consumes the package `dist` types.

## Plan
1. Extend shared skill contracts and JSON-RPC method enum.
2. Add runtime skill store and wire it into bootstrap/list/get/create/update/delete/checkName/setEnabled plus prompt injection.
3. Add desktop `SkillsView`, runtime client methods, state refresh action, and sidebar/nav regression entry.
4. Add shared/runtime tests and run verification.

## Active Files
- `packages/shared/src/index.ts`
- `apps/runtime/src/skills.ts`
- `apps/runtime/src/harness/capability-registries.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/patterns/system-prompt.ts`
- `apps/desktop/src/components/SkillsView.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/Sidebar.tsx`
- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/lib/state.tsx`
- `apps/desktop/src/types.ts`
- `apps/runtime/test/skills.test.ts`
- `packages/shared/test/contracts.test.ts`
- `scripts/desktop-nav-regression.swift`

## Decisions
- Decision: custom skills live under `.ora/skills/custom/<name>/SKILL.md`; enabled state lives in `.ora/skills/state.json`.
  - Why: mirrors existing `.ora/agents` and `.ora/modes` local-first storage while keeping public bundled skills read-only.
  - Alternatives: edit repo `skills/` directly, or make all skills in-memory only.
  - Tradeoffs: no file watcher in v1; list/get reads latest file state on demand.
- Decision: only selected and enabled skills inject into prompts.
  - Why: avoids global prompt pollution while making capability loading explicit.
  - Alternatives: inject all enabled skills globally.
  - Tradeoffs: users must attach skills through mode/run config before they affect execution.

## Progress Log
- 2026-04-24 20:32 CST - Task created
  Next: Fill in Goal, Scope, Plan, and list Active Files
- 2026-04-24 20:44 CST - Implemented shared/runtime/desktop skill library v1 and fixed verification issues.
  Next: Final response with verification evidence.

## Open Issues
- None.

## TODO
- None.

## Retrospective
- Record 0-3 highest-value pitfalls from this task.
- Leave reusable operational lessons here even when they later get promoted into a skill.

### Item 1
- Pitfall: runtime typecheck can read stale `@ora/shared/dist` exports after shared schema changes.
- Symptom: `pnpm typecheck` failed with missing exported skill symbols even though shared tests passed.
- Root Cause: runtime imports `@ora/shared` through package exports/types, not directly from `packages/shared/src`.
- Reusable Guardrail: after shared contract changes, run `pnpm --filter @ora/shared build` before workspace typecheck.
- Evidence: first `pnpm typecheck` failed; rerun after shared build passed.
- Scope: Ora workspace TypeScript package boundary.
- Suggested Writeback Target: repo developer notes or build/typecheck runbook.
- Status: candidate_for_skill

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm --filter @ora/shared test` -> 1 file passed, 67 tests passed.
- `pnpm --filter @ora/runtime test` -> 9 files passed, 83 tests passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm --filter @ora/shared build` -> passed.
- `pnpm typecheck` -> passed after shared build.
- `pnpm lint` -> passed.
- `git diff --check` -> passed.
- `bash skills/long-task-protocol/scripts/todo_scan.sh --task tasks/TASK-20260424-2032-ora-skills-local-library-v1.md` -> only reports pre-existing generated/runtime artifacts under `.ora/runtime.db` and `apps/desktop/src-tauri/resources/runtime-sidecar/`.

### Functional Verification (Feature Works)
- [x] Core functionality verification: runtime tests cover public load, custom create/update/reload/toggle/delete, and prompt injection.
- [x] Edge cases verification: disabled selected skills are skipped and write a warning into run config metadata.
- [x] Error handling verification: public skills reject delete/edit but allow enable toggles.

**Output**: Paste verification results
Runtime test evidence is in `apps/runtime/test/skills.test.ts`.

**Examples**:
- Database: `SELECT * FROM table WHERE field_name IS NOT NULL LIMIT 5;`
- API: `curl "url" | jq '.results[0].field_name'`
- UI: Manual test steps and results
- Bug fix: Verification bug is fixed

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: _______

### Comparison Points
- [ ] Comparison point 1: _______
- [ ] Comparison point 2: _______
- [ ] Comparison point 3: _______

### Findings
- Consistency: _______
- Differences: _______
- Conclusion: _______

## Checkpoints

### Checkpoint 1: _______
- Requirement: _______
- Verification method: _______
- Status: [ ] Pass / [ ] Fail
- Evidence: _______

### Checkpoint 2: _______
- Requirement: _______
- Verification method: _______
- Status: [ ] Pass / [ ] Fail
- Evidence: _______

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Ship Ora Skills local library v1.
- Done: Shared contracts, runtime file-backed store, dynamic JSON-RPC methods, run prompt integration, desktop SkillsView/sidebar entry, tests.
- In-progress: None.
- Active files: see Active Files above.
- Next actions: optional UI dogfood in Tauri app; optional `.skill` import in future.
- Blockers/Risks: Root typecheck requires fresh shared dist after schema changes.
- Verification status: shared tests, runtime tests, desktop typecheck, shared build, and root typecheck passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [ ] Code Verification output (compilation/tests/lint)
- [ ] Functional Verification output (feature verification)
- [ ] Retrospective Evidence (if applicable)
- [ ] Comparison Evidence (if applicable)
- [ ] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, pnpm workspace, local Node/TypeScript toolchain.

### Commands run + outputs
- `pnpm --filter @ora/shared test` -> passed, 67 tests.
- `pnpm --filter @ora/runtime test` -> passed, 83 tests.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm --filter @ora/shared build` -> passed; needed to refresh ignored `packages/shared/dist`.
- `pnpm typecheck` -> passed.
- `pnpm lint` -> passed.
- `git diff --check` -> passed.
- `bash skills/long-task-protocol/scripts/todo_scan.sh --task tasks/TASK-20260424-2032-ora-skills-local-library-v1.md` -> third-party/generated TODO noise only.
