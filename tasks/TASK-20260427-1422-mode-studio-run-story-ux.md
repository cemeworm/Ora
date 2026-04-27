# TASK-20260427-1422-mode-studio-run-story-ux

**Created:** 2026-04-27 14:22 CST
**Status:** Done

---

## Goal
- Upgrade Mode Studio from a flat configuration surface into a run-story workbench. The first view should explain what a selected mode is good for, how it runs from input to final answer, which agents/capabilities/safety policies participate, and keep deep configuration available without making it the first thing users see.

## Scope / Out of scope
- In scope:
  - Desktop-only Mode Studio UX in `apps/desktop/src/components/ModesView.tsx`.
  - Local display helpers derived from existing `ModeSpec`, runtime atom metadata, profiles, policies, and enabled stage order.
  - Chinese/English copy additions in `apps/desktop/src/lib/i18n.ts`.
  - Verification through desktop typecheck/build and code-level checks for the requested three modes.
- Out of scope:
  - Shared schema/RPC/runtime atom changes.
  - Changing mode execution semantics, builder persistence, or runtime selection behavior.
  - Full run simulator or live trace playback.

## Constraints
- Compatibility: preserve saved `ModeSpec` shape, existing builder Apply boundary, and current ReactFlow canvas model.
- Performance: keep story derivation synchronous and local to desktop render state.
- Risk: avoid hiding existing advanced controls completely; move them behind grouped sections.
- Tool/Environment limits: no new packages or external services.

## Plan
1. Patch `ModesView.tsx` with run-story helpers/components, a gallery workbench layout, a selection-first node/capability inspector, and grouped advanced edit sections.
2. Patch `i18n.ts` with Mode Studio story/group/contract copy while keeping user-authored mode text render-time only.
3. Run `pnpm --filter @ora/desktop typecheck`, `pnpm --filter @ora/desktop build`, and targeted static checks for the three requested modes.

## Active Files
- `/Users/quintenchen/developer/ora/tasks/TASK-20260427-1422-mode-studio-run-story-ux.md`
- `/Users/quintenchen/developer/ora/apps/desktop/src/components/ModesView.tsx`
- `/Users/quintenchen/developer/ora/apps/desktop/src/lib/i18n.ts`

## Decisions
- Decision: keep `ModeSpec` as the only mode truth and derive the story locally.
  - Why: prior Mode Studio work already made `ModeSpec` the runtime/editor contract.
  - Alternatives: add a separate UX schema or runtime preview endpoint.
  - Tradeoffs: less semantic precision than a simulator, but no runtime/schema churn.
- Decision: default to run-story and contract panels before advanced editing.
  - Why: the user's screenshot complaint is about not understanding value or operation.
  - Alternatives: only restyle existing cards or add more labels.
  - Tradeoffs: some controls move lower in the inspector, but the page becomes scannable.

## Progress Log
- 2026-04-27 14:22 CST - Task created
  Next: Fill in Goal, Scope, Plan, and list Active Files
- 2026-04-27 14:24 CST - Filled goal, scope, plan, decisions, and active files. Visual thesis: quiet operational workbench with narrative sequencing, compact status contracts, and configuration grouped behind clear sections. Next: patch Mode Studio components, then i18n copy, then verification.
- 2026-04-27 14:36 CST - Implemented the run-story gallery, canvas selection inspector, grouped mode-level inspector, stage explanation panel, and Mode Studio i18n copy. Typecheck/build/browser smoke passed; mobile narrow viewport could not reach the hidden sidebar item through the current app shell, so desktop-width smoke is the functional UI evidence for this slice. Next: none.

## Open Issues
- None.

## TODO
- [x] Patch Mode Studio run-story layout and grouped inspector.
- [x] Patch Mode Studio i18n copy.
- [x] Run verification and record evidence.

## Retrospective
- No reusable pitfall worth promoting. The only local issue was that the narrow mobile app shell hides the sidebar navigation used to reach Mode Studio in the browser smoke script; the desktop Mode Studio surface itself verified correctly.

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Targeted static/browser checks pass
- [x] TODO scan pass with existing unrelated noise only

**Output**:
- `pnpm --filter @ora/desktop typecheck`: passed, `tsc --noEmit` exited 0.
- `pnpm --filter @ora/desktop build`: passed, `tsc && vite build` completed. Existing Vite large chunk warning remained.
- `bash /Users/quintenchen/developer/ora/skills/long-task-protocol/scripts/todo_scan.sh`: exited 0; output only existing noise in `.ora/skills/private/think/SKILL.md`, runtime DB binaries, skill template TODOs, and bundled `runtime-sidecar` files.

### Functional Verification (Feature Works)
- [x] Core functionality verification: browser smoke opened Mode Studio and found the run-story and run-contract sections.
- [x] Edge cases verification: static mode check covered `Single Agent`, `DeerFlow-like Harness`, and `Message Bus` stage/profile/atom counts.
- [x] Error handling verification: no runtime/schema behavior changed; validation remains the existing save-time path.

**Output**:
- Browser smoke at `http://127.0.0.1:1421/` passed for `Single Agent`, `DeerFlow 式框架`, and `Message Bus`: each contained `运行故事`, `这个模式如何运行`, `运行契约`, and `运行时会保证什么`.
- Static mode check:
  - `single_agent | Single Agent | 1 | 1 | 7`
  - `deerflow_harness | DeerFlow-like Harness | 4 | 3 | 7`
  - `message_bus | Message Bus | 4 | 3 | 7`
- Screenshot captured at `/tmp/ora-mode-studio-run-story.png`.

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: existing Mode Studio canvas, runtime atom mounting, and guided builder Apply flow.

### Comparison Points
- [x] Keeps `ModeSpec` as the display/runtime source of truth.
- [x] Keeps mode-level atoms mounted on Runtime/Harness and stage atoms attached to source stages.
- [x] Keeps guided builder drafts unpersisted until explicit Apply.

### Findings
- Consistency: follows the existing Mode Studio canvas/builder architecture.
- Differences: adds local display helpers and grouped panels only.
- Conclusion: consistent with previous Mode Studio decisions and does not require schema/runtime changes.

## Checkpoints

### Checkpoint 1: Run-story first view
- Requirement: Gallery explains how the selected mode runs before detailed configuration.
- Verification method: browser smoke checks Mode Studio body text.
- Status: [x] Pass
- Evidence: browser smoke found `运行故事` and `这个模式如何运行`.

### Checkpoint 2: Grouped inspector
- Requirement: Mode-level details are grouped into Overview/Agents/Capabilities/Safety/Advanced.
- Verification method: code inspection plus typecheck/build.
- Status: [x] Pass
- Evidence: `InspectorSectionTabs` gates read-only and edit inspectors; desktop typecheck/build passed.

### Checkpoint 3: Existing execution contracts unchanged
- Requirement: no shared schema/RPC/runtime atom changes.
- Verification method: changed-file diff and desktop-only build.
- Status: [x] Pass
- Evidence: changed implementation files are `ModesView.tsx` and `i18n.ts`; task journal only otherwise.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: make Mode Studio explain how a mode runs before showing configuration detail.
- Done: run-story gallery, selectable canvas inspector, grouped mode inspector, stage explanation panel, and i18n copy implemented.
- In-progress: none.
- Active files: task journal, `ModesView.tsx`, `i18n.ts`.
- Next actions (top 3; exact file/function): none.
- Blockers/Risks: narrow mobile app shell hides sidebar navigation in browser smoke; desktop Mode Studio verified.
- Verification status: passed typecheck, build, TODO scan, static three-mode check, and desktop browser smoke.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, zsh, CST.

### Commands run + outputs
- `pnpm --filter @ora/desktop typecheck`
  - PASS: `tsc --noEmit` exited 0.
- `pnpm --filter @ora/desktop build`
  - PASS: build completed; existing large chunk warning remained.
- Static mode check using `packages/shared/dist/index.js`
  - PASS: `single_agent | Single Agent | 1 | 1 | 7`
  - PASS: `deerflow_harness | DeerFlow-like Harness | 4 | 3 | 7`
  - PASS: `message_bus | Message Bus | 4 | 3 | 7`
- Browser smoke at `http://127.0.0.1:1421/`
  - PASS: `Single Agent: run story ok`
  - PASS: `DeerFlow 式框架: run story ok`
  - PASS: `Message Bus: run story ok`
- Narrow viewport browser attempt
  - LIMITATION: sidebar `模式` item is hidden at `375px`, so the scripted mobile navigation could not reach Mode Studio.
- `bash /Users/quintenchen/developer/ora/skills/long-task-protocol/scripts/todo_scan.sh`
  - PASS with existing output noise only:
    - `.ora/skills/private/think/SKILL.md`
    - `.ora/runtime.db`
    - `skills/skill-creator/scripts/init_skill.py`
    - bundled `apps/desktop/src-tauri/resources/runtime-sidecar/*`
