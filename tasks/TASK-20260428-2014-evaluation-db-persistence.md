# TASK-20260428-2014-evaluation-db-persistence

**Created:** 2026-04-28 20:14 CST
**Status:** Completed
**Source of Truth:** This file is the canonical implementation journal for moving Evaluation history into runtime database storage while keeping `/evals` as source assets.

## Goal

Ensure historical Evaluation results are reflected by the Evaluation feature from persisted runtime data, not by Markdown files under `/evals`.

`/evals` should remain a file-based source for datasets, specs, run notes, and baseline documentation. Actual imported datasets, evaluation runs, attempts, stream events, baselines, feedback records, and blueprints should persist in the runtime database when Ora runs with SQLite storage.

## Assumptions

- Ora production/local app runtime uses `ORA_RUNTIME_STORE_DIR` ending in `runtime.db`, which currently selects `SqliteRuntimePersistence`.
- Directory-backed runtime stores are still useful for tests and lightweight development; they can keep the existing JSON-file EvaluationStore behavior.
- The first fix should store typed Evaluation JSON payloads in SQLite tables with indexed metadata, not redesign the Evaluation domain schemas.

## Plan

1. Add SQLite-backed persistence inside `LocalEvaluationStore` for database paths.
   - Verify: create a SQLite runtime store, import/run/list/get evaluation records across store reload.
2. Wire `LocalRunStore` to pass the runtime database path into EvaluationStore when SQLite persistence is active.
   - Verify: no `evaluation-store` directory is created for `.db` runtime mode.
3. Keep `/evals` as import/spec assets and CLI source paths.
   - Verify: existing eval import/run APIs still accept file/content input.
4. Add focused tests and run targeted runtime checks.

## TODO

- [x] SQLite-backed EvaluationStore tables and load/save paths.
- [x] Runtime wiring for `.db` mode.
- [x] Integration test proving evaluation history survives reload from SQLite DB.
- [x] Verification and closeout.

## Progress Log

- 2026-04-28 20:14 CST - Task created after product correction: `/evals` files are source assets, but Evaluation history belongs in database storage.
- 2026-04-28 20:17 CST - Added SQLite tables for Evaluation manifest, datasets, runs, baselines, feedback records, and blueprints; `.db` runtime mode now stores Evaluation history in the runtime database instead of a sibling `evaluation-store` directory.
- 2026-04-28 20:20 CST - Added legacy migration from sibling JSON `evaluation-store` into SQLite, preserving old file-backed Evaluation history when a runtime switches to `runtime.db`.
- 2026-04-28 20:21 CST - Added integration coverage for fresh SQLite persistence and legacy JSON-to-SQLite migration; runtime verification passed.

## Verification

- `pnpm --filter @ora/runtime exec vitest run test/runtime-integration.test.ts -t "persists evaluation history in sqlite"`
  - Result: passed.
- `pnpm --filter @ora/runtime exec vitest run test/runtime-integration.test.ts -t "sqlite storage|legacy file-backed"`
  - Result: passed for the matched SQLite persistence test; followed by full runtime suite below.
- `pnpm --filter @ora/runtime typecheck`
  - Result: passed.
- `pnpm --filter @ora/runtime test -- runtime-integration.test.ts runtime-smoke.test.ts`
  - Result: passed; runtime package suite ran 14 files, 221 tests.
- `git diff --check`
  - Result: passed.

## Final State

- `/evals` remains the place for checked-in dataset/spec/run-note assets.
- In SQLite runtime mode, Evaluation history is stored in `runtime.db` tables:
  - `evaluation_manifest`
  - `evaluation_datasets`
  - `evaluation_runs`
  - `evaluation_baselines`
  - `evaluation_feedback`
  - `evaluation_blueprints`
- Directory-backed stores retain JSON persistence for tests and lightweight development.
- If a legacy sibling `evaluation-store` directory exists next to `runtime.db`, its typed JSON records are copied into SQLite on startup and remain available after the legacy directory is removed.
