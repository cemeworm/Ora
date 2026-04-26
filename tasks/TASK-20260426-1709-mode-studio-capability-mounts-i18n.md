# TASK-20260426-1709-mode-studio-capability-mounts-i18n

**Created:** 2026-04-26 17:09 CST
**Status:** Complete

---

## Goal
- Make Mode Studio show runtime capabilities as mounted capabilities instead of scattered peer graph nodes.
- Make Mode Studio built-in copy follow the selected desktop language without writing translated text back into `ModeSpec`.

## Scope / Out of scope
- In scope:
  - Add a Runtime/Harness anchor to the Mode Studio canvas.
  - Render active mode-level atoms as compact attachments under that anchor.
  - Keep node-level atoms attached to their source stage.
  - Add desktop-only display/localization helpers for built-in mode, stage, atom, and policy copy.
  - Verify desktop typecheck/build.
- Out of scope:
  - Changing `ModeSpec`, runtime atom schemas, or runtime execution semantics.
  - Adding new runtime atoms or new capability behavior.
  - Translating user-authored custom mode text before saving.

## Assumptions
- `runtimeAtoms` are mode-level runtime capabilities and should not become executable stages.
- `node.config.atoms` are the only stage-level capability attachments.
- System preset labels/descriptions may be localized at render time only.
- Existing dirty files outside this slice are user-owned and must not be reverted.

## Plan
1. Update `apps/desktop/src/lib/modeCanvas.ts` so the canvas contains a runtime anchor, active mode capability attachments, stage nodes, and stage attachments.
2. Update `apps/desktop/src/components/ModesView.tsx` with explicit display helpers and a mode capability management panel.
3. Update `apps/desktop/src/lib/i18n.ts` with Mode Studio built-in translations and dynamic patterns.
4. Run `pnpm --filter @ora/desktop typecheck` and `pnpm --filter @ora/desktop build`; record evidence.

## Active Files
- `/Users/quintenchen/developer/ora/tasks/TASK-20260426-1709-mode-studio-capability-mounts-i18n.md`
- `/Users/quintenchen/developer/ora/apps/desktop/src/lib/modeCanvas.ts`
- `/Users/quintenchen/developer/ora/apps/desktop/src/components/ModesView.tsx`
- `/Users/quintenchen/developer/ora/apps/desktop/src/lib/i18n.ts`

## Decisions
- Decision: render mode atoms as Runtime/Harness attachments, not as stage DAG nodes.
  - Why: this keeps execution ordering separate from cross-cutting runtime capability.
- Decision: localize built-in data at render time only.
  - Why: translated strings should not pollute `ModeSpec` storage or runtime truth.

## Progress Log
- 2026-04-26 17:09 CST - Created the task journal and locked the implementation scope to Mode Studio canvas/display/i18n only.
  Next: patch `modeCanvas`, then `ModesView`, then i18n and verification.
- 2026-04-26 17:18 CST - Implemented the canvas and display slice. Mode Studio now renders a Runtime/Harness anchor, active mode atoms mount under that anchor, node atoms stay attached to their stage, and Mode Studio uses explicit language-aware display helpers for built-in labels/descriptions/policies.
  Next: run verification, record evidence, and close the task.
- 2026-04-26 17:23 CST - Verification passed. Desktop typecheck and build succeeded, and the fallback Vite server on port 1421 returned HTTP 200 after port 1420 was already occupied.
  Next: none.

## Open Issues
- [x] Port 1420 was already occupied during manual dev-server startup.
  - Resolution: started Vite on `http://127.0.0.1:1421/` instead and confirmed HTTP 200.

## TODO
- [x] Patch Mode Studio canvas topology rendering.
- [x] Patch explicit display/localization helpers and capability management panel.
- [x] Patch Mode Studio built-in translations.
- [x] Run verification and record outputs.

## Retrospective
- No reusable pitfall worth promoting. The only local issue was the expected dev port conflict on `1420`, resolved by using `1421`.

## Verification
- `pnpm --filter @ora/desktop typecheck`
  - PASS: `tsc --noEmit` exited 0.
- `pnpm --filter @ora/desktop build`
  - PASS: `tsc && vite build` completed.
  - Output included the existing Vite large chunk warning for `index-*.js`, but the build succeeded.
- `pnpm --filter @ora/desktop dev`
  - FAIL for manual QA server: port `1420` already in use.
- `pnpm exec vite --host 127.0.0.1 --port 1421`
  - PASS: dev server started at `http://127.0.0.1:1421/`.
- `curl -s -o /tmp/ora-mode-studio-dev.html -w '%{http_code} %{content_type}\n' http://127.0.0.1:1421/`
  - PASS: `200 text/html`.
- Local changed-file TODO scan:
  - Command: `rg -n "TODO\\(|TODO|FIXME|XXX" apps/desktop/src/lib/modeCanvas.ts apps/desktop/src/components/ModesView.tsx apps/desktop/src/lib/i18n.ts`
  - PASS: no matches.

## Compressed State
- Objective: make Mode Studio capability relationships and language rendering match the planned model.
- Current status: implementation complete and verified.
- Active files: task journal, Mode Studio canvas, ModesView, i18n.
- Done:
  1. Runtime/Harness anchor and compact active mode atom attachments.
  2. Mode capability management panel and explicit display helpers.
  3. Mode Studio built-in translations and dynamic text patterns.
- Verification: desktop typecheck/build passed; dev server available on port 1421.
