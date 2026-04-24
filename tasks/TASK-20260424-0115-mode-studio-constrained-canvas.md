# TASK-20260424-0115-mode-studio-constrained-canvas

**Created:** 2026-04-24 01:15 CST
**Status:** In Progress

---

## Goal
- Upgrade `Mode Studio` from the current list-style stage editor to a constrained canvas editor with a canvas main view and right-side inspector, while keeping execution on the existing `ModeSpec + family interpreter` runtime path.

## Scope / Out of scope
- In scope:
  - Add optional persisted node positions to `ModeNodeSpec`.
  - Generate deterministic default positions for presets and legacy modes without stored layout.
  - Replace the desktop editor main surface with `React Flow`.
  - Support drag, restricted connect/delete edge flows, add/remove/enable/disable nodes, auto layout, and right-side inspector editing.
  - Keep save/validate/execute on the existing `ModeSpec` contracts and runtime validators.
- Out of scope:
  - Arbitrary script nodes or user-authored runtime semantics.
  - Cross-family mixed graphs.
  - Persisting viewport pan/zoom state.
  - Turning Mode Studio into a fully free-form workflow engine.

## Product Constraints
- `reactflow` is the only new canvas dependency in `apps/desktop`.
- v1 persists only `node.position`, not viewport state.
- Only templates in `allowedNodeTemplates` can be added.
- Required templates cannot be removed or disabled.
- UI must block self loops, duplicate edges, edges to missing nodes, disabled-node connections, and cycles before save; runtime validation remains the final backstop.
- Disabled nodes stay on canvas, render dimmed, and keep their stored edges hidden rather than deleted.
- System presets remain read-only until cloned through `Customize`, and copied layouts should be preserved.

## Assumptions
- Existing dirty worktree changes outside this slice are user-owned and must be preserved.
- The current `Mode Studio` implementation in [apps/desktop/src/components/ModesView.tsx](/Users/quintenchen/developer/Ora/apps/desktop/src/components/ModesView.tsx:1) is the correct replacement target.
- The shared schema source of truth remains [packages/shared/src/index.ts](/Users/quintenchen/developer/Ora/packages/shared/src/index.ts:1050).
- v1 auto layout should be deterministic, DAG-based, and local to shared/desktop code without `dagre` or `elk`.

## Active Files
- [tasks/TASK-20260424-0115-mode-studio-constrained-canvas.md](/Users/quintenchen/developer/Ora/tasks/TASK-20260424-0115-mode-studio-constrained-canvas.md:1)
- [packages/shared/src/index.ts](/Users/quintenchen/developer/Ora/packages/shared/src/index.ts:1050)
- [packages/shared/test/contracts.test.ts](/Users/quintenchen/developer/Ora/packages/shared/test/contracts.test.ts:1)
- [apps/desktop/package.json](/Users/quintenchen/developer/Ora/apps/desktop/package.json:1)
- [apps/desktop/src/components/ModesView.tsx](/Users/quintenchen/developer/Ora/apps/desktop/src/components/ModesView.tsx:1)
- [apps/desktop/src/lib/runtimeClient.ts](/Users/quintenchen/developer/Ora/apps/desktop/src/lib/runtimeClient.ts:1)

## Plan
1. Extend shared contracts with optional node positions and deterministic layout helpers.
   Verify: shared contracts accept both legacy and positioned specs, and runtime validation semantics stay unchanged.
2. Replace the desktop list editor with a constrained React Flow canvas plus inspector.
   Verify: typecheck passes and the draft editor writes positions/edges/nodes back into the existing `ModeSpec` shape.
3. Run targeted verification and record the results here.
   Verify: `pnpm --filter @ora/shared test` and `pnpm --filter @ora/desktop typecheck`

## Progress Log
- 2026-04-24 01:15 CST - Created a focused task file for the constrained-canvas Mode Studio slice so this implementation has a single source of truth separate from the earlier ModeSpec Studio v1 task.
  Next: update shared schema and layout helpers before replacing the desktop editor surface.
- 2026-04-24 01:18 CST - Extended shared mode-node contracts with optional `position`, added deterministic DAG auto-layout helpers, and updated preset generation so built-in modes now ship with default node coordinates.
  Next: replace the desktop list editor with a React Flow canvas that reads and writes those positions.
- 2026-04-24 01:29 CST - Replaced the desktop stage-list editor with a constrained React Flow canvas plus right-side inspector. The editor now supports drag-to-position, restricted edge creation/deletion, hidden edges for disabled nodes, family resets with default layout regeneration, and node property editing from the inspector.
  Next: finish verification across shared, desktop, and runtime, then record evidence here.
- 2026-04-24 01:35 CST - Verification passed for the contract, desktop, and runtime slices. Added a runtime smoke assertion proving that positioned modes still validate, persist, and execute like unpositioned modes.
  Next: leave the task ready for manual product QA against the desktop app.

## Open Issues
- [ ] Confirm whether preset default positions should always be regenerated from the current plan template or whether hand-authored preset positions will be curated later.
- [ ] Confirm whether edge deletion should be available only through canvas selection or also mirrored in the inspector later.

## TODO
- [x] Create a dedicated task file for the constrained-canvas Mode Studio slice.
- [x] Add optional `position` support to shared mode-node contracts.
- [x] Add deterministic auto-layout helpers for presets and legacy modes.
- [x] Replace the desktop list editor with canvas + inspector.
- [x] Run verification and record evidence.

## Verification
- `pnpm --filter @ora/shared test`
  - PASS: `packages/shared/test/contracts.test.ts` now covers positioned presets, legacy specs without `position`, and duplicate/self-loop edge validation.
- `pnpm --filter @ora/desktop typecheck`
  - PASS: the new React Flow canvas editor and inspector compile cleanly.
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts`
  - PASS: positioned custom modes validate, persist, and execute through the existing runtime path.

## Compressed State
- Objective: ship a Dify-like constrained canvas editor without changing Ora runtime execution semantics.
- Success means users can drag, connect, and inspect mode nodes on canvas, save positions into `ModeSpec`, and still rely on the existing runtime validation and interpreters.
- Current status: implemented in shared + desktop, with runtime compatibility verified. Remaining work is manual desktop QA rather than more contract changes.
