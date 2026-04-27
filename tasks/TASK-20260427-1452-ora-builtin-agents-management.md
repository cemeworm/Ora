# TASK-20260427-1452-ora-builtin-agents-management

**Created:** 2026-04-27 14:52 CST
**Status:** Verification Complete

---

## Goal
- Make the Agents page a unified management surface for both built-in runtime agents and user custom agents. Built-in agents must be visible, editable through global user overrides, resettable to system defaults, and show which modes use them; custom-agent behavior must remain compatible.

## Scope / Out of scope
- In scope:
  - Shared RPC/schema additions for agent catalog and built-in overrides.
  - Runtime file-backed override store and effective profile resolution.
  - Desktop runtime client and Agents page UI for built-in/custom tabs, edit/reset, usage display.
  - Mode Studio read-only/effective profile display where practical.
  - Focused shared/runtime/desktop tests.
- Out of scope:
  - Per-mode built-in overrides.
  - Direct mutation of system preset source files.
  - Replacing custom agents as the mode-specific variant mechanism.

## Constraints
- Compatibility: preserve `agents.list/get/create/update/delete/checkName/generateDraft` behavior for custom agents.
- Performance: catalog should derive from existing mode lists and small override files; no expensive runtime scans beyond current stores.
- Risk: global overrides must not accidentally mutate `MVP_MODES` singletons or saved custom modes.
- Tool/Environment limits: broad edits must stay surgical; use existing app-shell UI style.

## Plan
1. `packages/shared/src/capabilities.ts`, `packages/shared/src/rpc.ts`, contract tests: add catalog/override schemas and RPC method names.
2. `apps/runtime/src/custom-agents.ts`, `apps/runtime/src/run-store.ts`, runtime tests: add file-backed system-agent override store, catalog derivation, mode/profile override application, and prompt/capability propagation.
3. `apps/desktop/src/lib/runtimeClient.ts`, `apps/desktop/src/components/AgentsView.tsx`, desktop tests: expose new methods, render Built-in/Custom management surface, keep custom flows.
4. Mode Studio effective profile display: show override-aware labels/roles where data is available without changing mode profile IDs.
5. Verification: run targeted shared/runtime/desktop tests and TODO scan. DONE.

## Active Files
- `packages/shared/src/capabilities.ts`
- `packages/shared/src/rpc.ts`
- `packages/shared/test/contracts.test.ts`
- `apps/runtime/src/custom-agents.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/test/custom-agents.test.ts`
- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/components/AgentsView.tsx`
- `apps/desktop/src/components/ModesView.tsx`

## Decisions
- Decision: Built-in agent edits are global overrides keyed by stable built-in profile id/name.
  - Why: user explicitly wants same-named agents shared globally; different variants should be custom agents.
  - Alternatives: per-mode overrides or scope selector.
  - Tradeoffs: simpler mental model and UI, but changing a common role can affect multiple modes.
- Decision: Custom agent binding takes precedence over built-in override.
  - Why: mode-specific variants remain custom agents; this avoids global override unexpectedly replacing explicit bindings.
  - Alternatives: merge both overlays.
  - Tradeoffs: precedence is clearer, but users must inspect mode bindings to understand exact runtime behavior.

## Progress Log
- 2026-04-27 14:52 CST - Task created and implementation plan locked from user-approved plan.
  Next: Add shared schemas/RPC methods; implement runtime override/catalog store; then wire desktop UI.
- 2026-04-27 15:04 CST - Added shared catalog/override schemas, RPC methods, runtime override file store, effective profile resolution, and runtime prompt/capability propagation.
  Next: Wire desktop client/UI; add focused tests; verify facade parity.
- 2026-04-27 15:09 CST - Desktop unified Agents gallery implemented with Built-in/Custom tabs, built-in edit/reset, usage display, and browser fallback mock parity. Rust facade gained the new methods. Verification passed.
  Next: Final response.

## Open Issues
- None.

## TODO
- [x] Add shared schemas and contract tests.
- [x] Add runtime override store/catalog/effective mode resolution.
- [x] Update runtime tests.
- [x] Update desktop runtime client and Agents UI.
- [x] Update/extend desktop tests.
- [x] Run verification and TODO scan.

## Retrospective
- No reusable pitfall worth promoting. The main local reminder is that `agents.*` changes must still be mirrored across shared RPC, Node runtime, desktop browser fallback, and Rust facade.

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint/type checks pass

**Output**:
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm --filter @ora/shared test -- contracts.test.ts` -> 1 file, 79 tests passed.
- `pnpm --filter @ora/runtime test -- custom-agents.test.ts` -> 13 files, 203 tests passed.
- `pnpm --filter @ora/desktop test -- runtimeClient.test.ts` -> 8 files, 28 tests passed.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` -> 20 tests passed.

### Functional Verification (Feature Works)
- [x] Core functionality verification (catalog/update/reset/run prompt propagation via runtime tests)
- [x] Edge cases verification (custom name collision and custom binding precedence through existing + new tests)
- [x] Error handling verification (unknown system agent/update/reset checks and create collision)

**Output**:
- Runtime catalog includes built-in `builder`/`solo_agent` when no custom agents exist.
- `agents.updateSystemOverride` changes effective mode profile labels/capabilities and injects override SOUL into provider system prompt.
- `agents.resetSystemOverride` clears the overridden flag.
- Desktop browser fallback exposes the same catalog/update/reset behavior.
- `curl -I http://127.0.0.1:1420` -> HTTP 200 from existing dev server.

**Examples**:
- Database: `SELECT * FROM table WHERE field_name IS NOT NULL LIMIT 5;`
- API: `curl "url" | jq '.results[0].field_name'`
- UI: Manual test steps and results
- Bug fix: Verification bug is fixed

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: previous custom-agent workspace work and Mode Studio profile binding surface.

### Comparison Points
- [x] Comparison point 1: custom `agents.*` RPC compatibility remains.
- [x] Comparison point 2: Mode Studio still uses `customAgentId` for mode-specific variants.
- [x] Comparison point 3: system presets remain read-only; overrides live in files.

### Findings
- Consistency: follows existing shared -> runtime -> desktop -> Rust facade method-family pattern.
- Differences: built-in agents are catalog projections from mode profiles rather than `.ora/agents` records.
- Conclusion: design matches the approved global override model without collapsing custom agents and runtime roles.

## Checkpoints

### Checkpoint 1: Catalog
- Requirement: built-in agents appear even when custom agents are empty.
- Verification method: shared schema tests, runtime catalog test, desktop runtime client test.
- Status: Pass
- Evidence: runtime `custom-agents.test.ts` and desktop `runtimeClient.test.ts` passed.

### Checkpoint 2: Override Execution
- Requirement: global built-in override changes effective mode profiles and runtime prompt/capability context.
- Verification method: runtime run test captures provider system prompt and enabled tools.
- Status: Pass
- Evidence: runtime `applies and resets global built-in agent overrides during execution` passed.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: unified Agents page for built-in and custom agents, with global built-in overrides and mode usage.
- Done: shared schemas/RPC, runtime override store/catalog/effective mode resolution, kernel overlay, desktop UI/client/mock, Rust facade, tests.
- In-progress: none.
- Active files: shared capabilities/rpc/contracts; runtime custom-agents/run-store/json-rpc; desktop runtimeClient/AgentsView/ModesView.
- Next actions (top 3; exact file/function): none.
- Blockers/Risks: existing unrelated Mode Studio story diffs are present in the worktree and left untouched.
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
- Environment: cwd `/Users/quintenchen/developer/ora`, macOS desktop workspace, existing Vite server on `127.0.0.1:1420`.

### Commands run + outputs
- `pnpm --filter @ora/shared test -- contracts.test.ts` -> 1 file, 79 tests passed.
- `pnpm --filter @ora/runtime test -- custom-agents.test.ts` -> 13 files, 203 tests passed.
- `pnpm --filter @ora/desktop test -- runtimeClient.test.ts` -> 8 files, 28 tests passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` -> 20 tests passed.
- `bash skills/long-task-protocol/scripts/todo_scan.sh` -> broad repo scan found existing TODOs in unrelated skill templates/generated sidecar artifacts; targeted active-file scan after journal cleanup is the DONE gate for this task.
- `rg -n "\[ \]|TODO\(|TODO:" <task+active files>` -> no matches.
