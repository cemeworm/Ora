# TASK-20260423-2350-mode-spec-studio-v1

**Created:** 2026-04-23 23:50 CST
**Status:** In Progress

---

## Goal
- Move Ora's work-mode model from fixed pattern-only selection toward `ModeSpec`-driven selection, persistence, validation, and desktop editing, while keeping execution constrained to runtime-owned family interpreters and template registries.

## Scope / Out of scope
- In scope:
  - Shared `ModeSpec` contracts, validation, preset generation, and `modeId` plumbing.
  - Runtime mode CRUD/clone/validate/list support plus run-time mode resolution and snapshot freezing.
  - Desktop mode selection and Mode Studio v1 for cloning presets and editing constrained stage graphs.
  - Verification that built-in presets still execute and that custom mode edits affect runtime behavior.
- Out of scope:
  - Fully free-form graph authoring.
  - Cross-family mixed execution in one mode.
  - User-authored arbitrary runtime code or scripts from the editor.

## Assumptions
- v1 remains a constrained graph editor: runtime owns legal node templates and final validation.
- Built-in five modes remain system presets and cannot be edited in place.
- `pattern` remains for compatibility, but new runs should resolve through `modeId -> ModeSpec`.

## Current Progress
- Done:
  - Shared schema now includes `ModeSpec`, node/edge/stop-policy/capability/editor-constraint schemas, preset generation, and validation helpers in [packages/shared/src/index.ts](/Users/quintenchen/developer/Ora/packages/shared/src/index.ts:1094).
  - Runtime has a file-backed mode store with `list/get/create/update/delete/validate/cloneFromPreset` in [apps/runtime/src/modes.ts](/Users/quintenchen/developer/Ora/apps/runtime/src/modes.ts:22).
  - JSON-RPC exposes `modes.*` methods and bootstrap now returns modes in [apps/runtime/src/json-rpc.ts](/Users/quintenchen/developer/Ora/apps/runtime/src/json-rpc.ts:17).
  - Run creation resolves `modeId` into a frozen `modeSpec` snapshot in [apps/runtime/src/run-store.ts](/Users/quintenchen/developer/Ora/apps/runtime/src/run-store.ts:946).
  - Runtime execution already routes through family interpreters keyed by `modeSpec.family` in [apps/runtime/src/patterns/driver-registry.ts](/Users/quintenchen/developer/Ora/apps/runtime/src/patterns/driver-registry.ts:667).
  - Desktop state/runtime client/chat surfaces already consume `modes.list` and `selectedModeId`, and Mode Studio v1 exists in [apps/desktop/src/components/ModesView.tsx](/Users/quintenchen/developer/Ora/apps/desktop/src/components/ModesView.tsx:1).
  - Mode Studio now derives family template and stop-policy constraints from shared runtime metadata instead of maintaining a second desktop-local family rule table.
- Not done:
  - Need a follow-up decision on whether desktop should expose richer edge editing or keep the current reorder-only v1.

## Active Files
- [packages/shared/src/index.ts](/Users/quintenchen/developer/Ora/packages/shared/src/index.ts:1094)
- [apps/runtime/src/modes.ts](/Users/quintenchen/developer/Ora/apps/runtime/src/modes.ts:22)
- [apps/runtime/src/run-store.ts](/Users/quintenchen/developer/Ora/apps/runtime/src/run-store.ts:946)
- [apps/runtime/src/session/session-manager.ts](/Users/quintenchen/developer/Ora/apps/runtime/src/session/session-manager.ts:1)
- [apps/runtime/src/json-rpc.ts](/Users/quintenchen/developer/Ora/apps/runtime/src/json-rpc.ts:17)
- [apps/runtime/src/patterns/driver-registry.ts](/Users/quintenchen/developer/Ora/apps/runtime/src/patterns/driver-registry.ts:667)
- [apps/desktop/src/components/ModesView.tsx](/Users/quintenchen/developer/Ora/apps/desktop/src/components/ModesView.tsx:1)
- [apps/runtime/test/runtime-smoke.test.ts](/Users/quintenchen/developer/Ora/apps/runtime/test/runtime-smoke.test.ts:120)
- [apps/runtime/test/sqlite-checkpointer.test.ts](/Users/quintenchen/developer/Ora/apps/runtime/test/sqlite-checkpointer.test.ts:160)
- [tasks/TASK-20260423-2350-mode-spec-studio-v1.md](/Users/quintenchen/developer/Ora/tasks/TASK-20260423-2350-mode-spec-studio-v1.md:1)

## Plan
1. Fix LangGraph-enabled session startup so `SessionManager` can resolve built-in/custom modes even when called directly.
   Verify: `pnpm --filter @ora/runtime test -- sqlite-checkpointer.test.ts`
2. Decide and codify the intended preset ordering for `modes.list` / bootstrap, then align implementation or tests.
   Verify: `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts`
3. Re-run shared/runtime/desktop verification and record the resulting state here.
   Verify: `pnpm --filter @ora/shared test && pnpm --filter @ora/runtime test && pnpm --filter @ora/desktop typecheck`

## Progress Log
- 2026-04-23 23:50 CST - Task created after inspecting the current branch state. Confirmed that the main `ModeSpec` architecture slice is already present across shared/runtime/desktop, but runtime verification still fails on unresolved mode resolution in `SessionManager` and on preset ordering expectations in bootstrap tests.
  Next: patch runtime session startup and stabilize mode ordering semantics.
- 2026-04-23 23:53 CST - Patched `SessionManager` to resolve built-in mode presets when callers do not pass a resolved spec/definition pair, while still requiring explicit resolved data for custom `modeId` direct calls. Also stabilized `ModeSpecFileStore.list()` so system presets return in canonical built-in order before custom modes sorted by `updatedAt`.
  Next: keep the task open for the next product-facing iteration, likely desktop editor deduplication against shared/runtime family metadata.
- 2026-04-23 23:54 CST - Removed the duplicated `FAMILY_RULES` table from desktop Mode Studio. The editor now reads `getModeFamilyRule()` and `getPatternDefinition()` from shared contracts to populate allowed templates, required stages, family-compatible stop policies, and capability flags when switching families.
  Next: decide whether Mode Studio v1 should stay reorder-only for topology editing or gain limited explicit edge controls.
- 2026-04-24 00:00 CST - Tightened the product boundary in Mode Studio itself: the editor now explicitly explains that v1 is a constrained linear DAG editor, exposes a save-time execution preview with enabled stages plus auto-derived edges, and surfaces family guidance / stop-policy behavior directly from shared metadata.
  Next: decide whether to keep the current reorder-only topology model or open a small, runtime-safe edge editing surface in a follow-up.
- 2026-04-24 00:05 CST - Moved prompt-template metadata into shared family+template definitions so runtime and desktop consume the same source of truth. `Mode Studio` now shows dynamic prompt placeholders and variable hints based on the actual runtime fallback template for each family/template pair, and stages without runtime prompt support are marked accordingly.
  Next: decide whether to expose the full default prompt template more explicitly in the UI or keep the current placeholder-plus-hint presentation.
- 2026-04-24 00:08 CST - Added a dedicated read-only “Default runtime prompt” preview to each stage card in Mode Studio, so users can compare the actual family/runtime fallback template against their optional override instead of inferring it from placeholder text.
  Next: decide whether this preview should remain inline on every stage card or collapse behind a disclosure once the editor gets denser.
- 2026-04-24 00:12 CST - Further compressed the gallery copy so the remaining right-column explanation cards read like product data cards instead of self-explanatory UI copy. `Family guidance` became a shorter `Details` card, `Guardrails` became a compact `Rules` badge row, and the hero copy tightened from “Best for” to the shorter “Use”.
  Next: decide whether the inline default prompt preview should stay expanded and whether v1 ever needs explicit edge editing.

## Open Issues
- [ ] Decide whether Mode Studio v1 should continue rebuilding edges as a linear DAG on every stage edit, or whether limited explicit edge editing is needed before broader rollout.
- [ ] Decide whether the inline default prompt preview should always stay expanded per stage or move behind a disclosure once the stage editor grows denser.

## TODO
- [x] Audit current implementation progress across shared/runtime/desktop.
- [x] Create a dedicated task file as the single source of truth for this workstream.
- [x] Fix `SessionManager` mode resolution for LangGraph-enabled direct runs.
- [x] Stabilize `modes.list` ordering semantics and associated runtime smoke tests.
- [x] Re-run verification and update this task with evidence.

## Verification
- Initial verification snapshot:
  - `pnpm --filter @ora/shared test`
    - PASS: 60/60 tests
  - `pnpm --filter @ora/runtime test`
    - FAIL before fix:
    - `apps/runtime/test/sqlite-checkpointer.test.ts`
      - `Runtime kernel requires a resolved mode definition.`
    - `apps/runtime/test/runtime-smoke.test.ts`
      - bootstrap `modes` order differed from the expected canonical preset order
  - `pnpm --filter @ora/desktop typecheck`
    - PASS
- Post-fix verification:
  - `pnpm --filter @ora/runtime test -- sqlite-checkpointer.test.ts runtime-smoke.test.ts`
    - PASS: targeted runtime regressions cleared
  - `pnpm --filter @ora/shared test`
    - PASS: 60/60 tests
  - `pnpm --filter @ora/runtime test`
    - PASS: 61/61 tests
  - `pnpm --filter @ora/desktop typecheck`
    - PASS
  - `pnpm --filter @ora/runtime test`
    - PASS again after the desktop shared-rule dedup follow-up
  - `pnpm --filter @ora/desktop typecheck`
    - PASS again after the desktop shared-rule dedup follow-up
  - `pnpm --filter @ora/desktop typecheck`
    - PASS after Mode Studio v1 boundary/preview UI update
  - `pnpm --filter @ora/runtime test`
    - PASS after Mode Studio v1 boundary/preview UI update
  - `pnpm --filter @ora/shared test`
    - PASS after adding shared runtime prompt-template metadata and contract coverage
  - `pnpm --filter @ora/runtime test`
    - PASS after switching runtime fallback prompts to shared template metadata
  - `pnpm --filter @ora/desktop typecheck`
    - PASS after wiring Mode Studio prompt placeholders and variable hints to shared template metadata
  - `pnpm --filter @ora/desktop typecheck`
    - PASS after adding inline read-only default runtime prompt previews to stage cards
  - `pnpm --filter @ora/desktop typecheck`
    - PASS after compressing remaining explanation cards into shorter product-style data cards

## Compressed State
- Objective: finish the ModeSpec + Mode Studio v1 integration so runtime and desktop both treat mode specs as first-class, validated execution presets.
- Done: schema, presets, validation, runtime CRUD/bootstrap plumbing, snapshot freezing, and desktop editor shell are already in place.
- In progress: the next likely slice is product polish and deduplication, not runtime correctness.
- Next actions: decide whether v1 needs richer edge controls beyond linear reorder and whether the inline default prompt preview should stay always visible or become collapsible.
