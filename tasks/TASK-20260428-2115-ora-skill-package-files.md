# TASK-20260428-2115-ora-skill-package-files

**Created:** 2026-04-28 21:15 CST
**Status:** Done

---

## Goal
Upgrade Ora managed skills from `SKILL.md`-only records into directory-backed skill packages. `SKILL.md` remains the required entrypoint, while package-relative supporting files such as `scripts/*.py`, `scripts/*.sh`, `agents/*.yaml`, templates, and assets can be discovered, preserved, and installed through the runtime skill APIs.

## Scope / Out of scope
- In scope: shared skill file metadata schemas, runtime file-store support for package file enumeration/create/update/rename/copy, focused runtime tests, and light desktop/mock compatibility for richer skill details.
- Out of scope: executing skill scripts, dependency sandboxing for those scripts, archive import/export UI, binary file editing in the desktop text editor.

## Constraints
- Compatibility: existing clients that only send `content` must keep working; existing `.ora/skills/private|public|custom/<name>/SKILL.md` data remains valid.
- Performance: package file enumeration is on-demand and bounded by local skill directories; no file watcher.
- Risk: package-relative paths must reject traversal, absolute paths, hidden path segments, and overwriting `SKILL.md` through the supporting-file channel.
- Tool/Environment limits: workspace currently has unrelated uncommitted desktop/runtime changes; avoid touching them unless required by this skill package upgrade.

## Plan
1. Extend `packages/shared/src/capabilities.ts` skill schemas with supporting file metadata and create/update payload support -> verify via shared/runtime typecheck/tests.
2. Update `apps/runtime/src/skills.ts` to treat each skill as a package directory: enumerate files, preserve files on rename, copy packaged public skill resources before user edits, and write optional supporting files safely -> verify with runtime tests.
3. Update desktop mock/runtime surfaces only as needed for schema compatibility and package-file visibility -> verify with targeted typecheck/tests.

## Active Files
- `packages/shared/src/capabilities.ts`
- `apps/runtime/src/skills.ts`
- `apps/runtime/test/skills.test.ts`
- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/components/SkillsView.tsx`
- `tasks/TASK-20260428-2115-ora-skill-package-files.md`

## Decisions
- Decision: keep `SKILL.md` as the only required entrypoint and model extra files as package-relative supporting files.
  - Why: matches mainstream Codex/agent skill folders such as `obsidian-wechat-source-fetch` without introducing a new manifest format.
  - Alternatives: require a separate manifest or only support script paths embedded inside markdown.
  - Tradeoffs: script execution is still a separate tool/runtime concern; this task only makes storage/discovery durable.

## Progress Log
- 2026-04-28 21:15 CST - Task created and scoped against mainstream directory-backed skills such as `obsidian-wechat-source-fetch`.
  Next: Inspect skill schemas and runtime file store.
- 2026-04-28 21:19 CST - Implemented package file schemas, runtime package preservation/copy/write behavior, UI file listing, and focused tests.
  Next: Run shared/runtime verification and typechecks.
- 2026-04-28 21:23 CST - Verification passed: shared build/test, runtime tests/typecheck, desktop typecheck, root typecheck, lint, diff check.
  Next: Final response with changed files and verification evidence.
- 2026-04-28 21:34 CST - Reopened task for phase 2: supporting files are visible as metadata but still cannot be opened or edited. Locked plan: add `skills.file.*` APIs and a Skills package file drawer styled like `ArtifactDrawer`.
  Next: Implement shared/runtime single-file APIs, then desktop drawer UI.
- 2026-04-28 21:45 CST - Implemented `skills.file.get/upsert/delete`, runtime copy-on-edit supporting file operations, browser mock support, and an ArtifactDrawer-aligned Skills package file drawer.
  Next: Final response with verification evidence.

## Open Issues
- None.

## TODO
- None.

## Retrospective
- Record 0-3 highest-value pitfalls from this task.
- Leave reusable operational lessons here even when they later get promoted into a skill.

### Item 1
- Pitfall: adding defaulted fields to Zod schemas can make TypeScript output types required, breaking existing callers even when runtime parsing is backwards-compatible.
- Symptom: `pnpm --filter @ora/shared build` and desktop typecheck failed because `files` became a required property on `SkillDescriptor` and `SkillCreateParams`.
- Root Cause: `z.array(...).default([])` changes the inferred output shape; existing code uses those inferred types as input/descriptor types.
- Reusable Guardrail: for backward-compatible shared contract extensions in Ora, prefer optional schema fields unless every caller can be migrated in the same change.
- Evidence: switching `files` to optional fixed shared build, runtime typecheck, and desktop typecheck.
- Scope: Ora shared contract changes consumed by runtime and desktop.
- Suggested Writeback Target: none for now; keep local unless this pattern recurs.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm --filter @ora/shared build` -> passed.
- `pnpm --filter @ora/shared test -- --runInBand` -> passed, 83 tests.
- `pnpm --filter @ora/runtime test -- skills.test.ts runtime-tool-executor.test.ts --runInBand` -> passed; Vitest selected the runtime suite and passed 226 tests.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm typecheck` -> passed.
- `pnpm lint` -> passed.
- `git diff --check` -> passed.
- `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task tasks/TASK-20260428-2115-ora-skill-package-files.md` -> PASS, no blocking TODOs.
- Phase 2: `pnpm --filter @ora/shared build` -> passed.
- Phase 2: `pnpm --filter @ora/shared test -- --runInBand` -> passed, 83 tests.
- Phase 2: `pnpm --filter @ora/runtime test -- skills.test.ts --runInBand` -> passed; current runtime test selection passed 235 tests.
- Phase 2: `pnpm --filter @ora/runtime typecheck` -> passed.
- Phase 2: `pnpm --filter @ora/desktop typecheck` -> passed.
- Phase 2: `pnpm typecheck` -> passed.
- Phase 2: `pnpm lint` -> passed.
- Phase 2: `git diff --check` -> passed.
- Phase 2: `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task tasks/TASK-20260428-2115-ora-skill-package-files.md` -> PASS, no blocking TODOs.

### Functional Verification (Feature Works)
- [x] Core functionality verification: runtime tests create private skills with `scripts/` and `agents/` files, reload file metadata, and preserve files on update/rename.
- [x] Edge cases verification: updating with an explicit `files` payload replaces supporting files; editing packaged public `skill-creator` copies packaged scripts/agents into the user-writable public copy.
- [x] Error handling verification: runtime rejects supporting file paths such as `../outside.sh`.
- [x] Phase 2 file editor verification: runtime tests read, create, update, and delete supporting files through `skills.file.*`; public packaged skill edits create a writable public copy and leave seed files unchanged.

**Output**:
- `apps/runtime/test/skills.test.ts` covers package creation, preservation, replacement, public package copy, and path validation.
- `apps/desktop/src/components/SkillsView.tsx` now renders package file metadata when a selected skill has supporting files.
- Phase 2: `apps/desktop/src/components/SkillsView.tsx` now opens supporting files in a right-side drawer styled after `ArtifactDrawer`.

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: `/Users/quintenchen/developer/obsidian/.agents/skills/obsidian-wechat-source-fetch`

### Comparison Points
- [x] A skill is a directory package with required `SKILL.md`.
- [x] Supporting files can live under package-relative directories such as `scripts/` and `agents/`.
- [x] Ora should discover/preserve these files without executing them as part of skill load.

### Findings
- Consistency: Ora now follows the same package shape for discovery and persistence.
- Differences: Ora does not execute scripts in this task; execution remains a separate tool/runtime concern.
- Conclusion: The storage and metadata layer now supports mainstream multi-file skill packages while keeping execution out of scope.

## Checkpoints

### Checkpoint 1: Package file model
- Requirement: shared contracts can represent skill supporting files without forcing old callers to pass them.
- Verification method: shared build/test and desktop/runtime typecheck.
- Status: [x] Pass
- Evidence: shared build/test, runtime typecheck, desktop typecheck passed.

### Checkpoint 2: Runtime persistence
- Requirement: create/update/rename/public-edit flows preserve or replace package files as intended.
- Verification method: `apps/runtime/test/skills.test.ts`.
- Status: [x] Pass
- Evidence: 8 managed skill runtime behavior tests passed inside the runtime suite.

### Checkpoint 3: Path safety
- Requirement: supporting file writes cannot escape the skill package.
- Verification method: runtime rejection test for `../outside.sh`.
- Status: [x] Pass
- Evidence: `rejects supporting file paths outside the skill package` passed.

### Checkpoint 4: Single-file editing
- Requirement: supporting files can be viewed, created, updated, and deleted without loading all file content in `skills.get`.
- Verification method: shared contracts, JSON-RPC routing, runtime tests, and desktop typecheck.
- Status: [x] Pass
- Evidence: `skills.file.get/upsert/delete` tests passed; desktop typecheck passed.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Upgrade Ora skills from `SKILL.md`-only to directory-backed packages with scripts/supporting files.
- Done: Shared schemas, runtime package storage, public package copy-on-edit, path validation, desktop file-list display, `skills.file.*` APIs, browser mock support, and ArtifactDrawer-style file drawer.
- In-progress: None.
- Active files: see Active Files above.
- Next actions (top 3; exact file/function): None for this task.
- Blockers/Risks: Script execution/dependency safety remains out of scope by design.
- Verification status: passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, pnpm workspace, zsh.

### Commands run + outputs
- `pnpm --filter @ora/shared build` -> passed.
- `pnpm --filter @ora/shared test -- --runInBand` -> passed, 83 tests.
- `pnpm --filter @ora/runtime test -- skills.test.ts runtime-tool-executor.test.ts --runInBand` -> passed, 226 tests.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm typecheck` -> passed.
- `pnpm lint` -> passed.
- `git diff --check` -> passed.
- `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task tasks/TASK-20260428-2115-ora-skill-package-files.md` -> PASS, no blocking TODOs.
- Phase 2: `pnpm --filter @ora/shared build` -> passed.
- Phase 2: `pnpm --filter @ora/shared test -- --runInBand` -> passed, 83 tests.
- Phase 2: `pnpm --filter @ora/runtime test -- skills.test.ts --runInBand` -> passed, 235 tests.
- Phase 2: `pnpm --filter @ora/runtime typecheck` -> passed.
- Phase 2: `pnpm --filter @ora/desktop typecheck` -> passed.
- Phase 2: `pnpm typecheck` -> passed.
- Phase 2: `pnpm lint` -> passed.
- Phase 2: `git diff --check` -> passed.
- Phase 2: `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task tasks/TASK-20260428-2115-ora-skill-package-files.md` -> PASS, no blocking TODOs.
