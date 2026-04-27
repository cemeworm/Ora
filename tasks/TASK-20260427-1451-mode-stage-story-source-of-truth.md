# TASK-20260427-1451-mode-stage-story-source-of-truth

**Created:** 2026-04-27 14:51 CST
**Status:** Done

---

## Goal
- Move Mode Studio stage explanations out of desktop template-switch logic and into two real sources of truth: shared runtime template metadata for defaults, and generated per-node story metadata saved by the Mode Studio builder for custom/generated modes.

## Scope / Out of scope
- In scope:
  - Shared `ModeNodeRuntimeTemplateDefinition.display.story` metadata for every existing family/template entry.
  - Runtime Mode Studio builder writes optional `node.config.story` summaries into generated draft nodes.
  - Desktop Mode Studio reads story data from `node.config.story`, then shared metadata, then shared description fallback.
  - Focused shared/runtime/desktop tests and typechecks.
- Out of scope:
  - New RPC methods, runtime atoms, or required `ModeSpec` schema migration.
  - Live provider calls every time Mode Studio renders.
  - Changing execution semantics or prompt override behavior.

## Constraints
- Compatibility: `ModeSpec.nodes[].config` stays an open record; old modes without `config.story` must render via shared defaults.
- Performance: all display lookup remains synchronous in desktop.
- Risk: generated custom story must not overwrite user-authored stage prompts or change runtime behavior.
- Tool/Environment limits: no new packages or services.

## Plan
1. Patch `packages/shared/src/modes.ts` to add `display.story` to runtime template metadata and fallback behavior.
2. Patch `apps/runtime/src/run-store.ts` so Mode Studio generated/refined drafts save per-node `config.story` summaries.
3. Patch `apps/desktop/src/components/ModesView.tsx` to remove the template switch and read `config.story -> display.story -> description`.
4. Update tests/copy as needed and run the requested verification chain.

## Active Files
- `/Users/quintenchen/developer/ora/tasks/TASK-20260427-1451-mode-stage-story-source-of-truth.md`
- `/Users/quintenchen/developer/ora/packages/shared/src/modes.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/run-store.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/test/mode-studio-builder.test.ts`
- `/Users/quintenchen/developer/ora/apps/desktop/src/components/ModesView.tsx`
- `/Users/quintenchen/developer/ora/apps/desktop/src/lib/i18n.ts`

## Decisions
- Decision: generation-time per-node story, not render-time provider generation.
  - Why: user selected stable/auditable generated descriptions.
  - Alternatives: live provider generation on every render.
  - Tradeoffs: story can drift after manual edits, but old/manual modes still have shared metadata fallback.
- Decision: keep the optional story convention inside `node.config`.
  - Why: avoids a required ModeSpec migration and matches the plan.
  - Alternatives: add first-class schema fields to `ModeNodeSpec`.
  - Tradeoffs: needs a small type guard/helper in consumers.

## Progress Log
- 2026-04-27 14:51 CST - Task created
  Next: Fill in Goal, Scope, Plan, and list Active Files
- 2026-04-27 14:53 CST - Filled task journal and confirmed current code facts: shared template metadata exists but lacks `display.story`; desktop currently uses `nodeStoryDescription(...)` switch; runtime builder sets node owner/prompt but not story. Next: patch shared metadata, runtime builder story config, and desktop story resolver.
- 2026-04-27 15:06 CST - Implemented shared `display.story`, generated `node.config.story`, desktop story resolver, i18n copy, and focused tests. Verification chain passed.

## Open Issues
- None.

## TODO
- [x] Add shared runtime template story metadata.
- [x] Persist Mode Studio builder per-node story metadata.
- [x] Remove desktop template-switch story logic.
- [x] Run verification and record evidence.

## Retrospective
### Item 1
- Pitfall: It is easy for Mode Studio UI copy to become a second runtime model when explanation logic lives in desktop switches.
- Symptom: Adding a new runtime template requires remembering to update desktop explanation code.
- Root Cause: Display story and runtime template metadata were split across layers.
- Reusable Guardrail: Put default story on the shared template definition, and only persist generated/custom semantics in `node.config.story`.
- Evidence: `ModesView.tsx` now reads `config.story -> definition.display.story -> definition.description` without a template switch.
- Scope: Ora Mode Studio source-of-truth hygiene.
- Suggested Writeback Target: local task memory only.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm --filter @ora/shared test -- contracts.test.ts` passed: 1 file, 79 tests.
- `pnpm --filter @ora/runtime exec vitest run test/mode-studio-builder.test.ts` passed: 1 file, 3 tests.
- `pnpm --filter @ora/runtime typecheck` passed.
- `pnpm --filter @ora/desktop typecheck` passed.
- `pnpm --filter @ora/desktop build` passed; Vite emitted the existing large chunk warning.
- `bash skills/long-task-protocol/scripts/todo_scan.sh` passed with pre-existing repository noise outside this task.

### Functional Verification (Feature Works)
- [x] Core functionality verification: browser smoke checked Message Bus shows shared metadata story text in Chinese.
- [x] Edge cases verification: old/manual modes without `config.story` fall back to shared `display.story`; missing template metadata still falls back to the shared missing-template description.
- [x] Error handling verification: generated custom stories are read only when `node.config.story.summary` is a non-empty string.

**Output**:
- Browser smoke passed for `/modes`: found `运行故事`, `发布初始事件，让下游订阅者能够响应`, `将路由后的发现转成给用户的最终响应事件`, and `运行契约`.

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: existing `ModeSpec` and runtime template metadata path.

### Comparison Points
- [x] Shared metadata remains the default explanation source.
- [x] Builder-generated user semantics are persisted in mode draft config.
- [x] Desktop display no longer owns template-specific runtime understanding.

### Findings
- Consistency: matches the existing `ModeSpec`-driven mode management pattern.
- Differences: `display.story` is new required metadata on shared runtime template definitions; `node.config.story` is optional generated data.
- Conclusion: new templates only need shared metadata plus normal builder output; desktop does not need another switch edit.

## Checkpoints

### Checkpoint 1: Shared Default Story
- Requirement: every registered runtime template has default story metadata.
- Verification method: TypeScript compile plus shared contract assertions.
- Status: [x] Pass / [ ] Fail
- Evidence: `contracts.test.ts` checks story metadata; shared contracts passed.

### Checkpoint 2: Builder Generated Story
- Requirement: Mode Studio generated drafts persist per-node story config.
- Verification method: runtime builder test asserts `node.config.story.summary` and `generatedBy`.
- Status: [x] Pass / [ ] Fail
- Evidence: runtime builder test passed.

### Checkpoint 3: Desktop Reads Source Of Truth
- Requirement: desktop reads generated/shared story instead of hardcoded template switch.
- Verification method: desktop typecheck/build plus browser smoke on Message Bus.
- Status: [x] Pass / [ ] Fail
- Evidence: desktop typecheck/build passed; browser smoke found shared story copy.

## Compressed State (<= 20 lines)
- Objective: make stage explanation source-of-truth shared metadata + generated node config.
- Done: shared metadata, runtime builder persistence, desktop resolver, i18n, tests, and verification.
- In-progress: none.
- Active files: task journal, `packages/shared/src/modes.ts`, `apps/runtime/src/run-store.ts`, `apps/runtime/test/mode-studio-builder.test.ts`, `apps/desktop/src/components/ModesView.tsx`, `apps/desktop/src/lib/i18n.ts`, `packages/shared/test/contracts.test.ts`.
- Next actions (top 3; exact file/function): none for this task.
- Blockers/Risks: generated story can drift after manual edits; shared fallback covers manual modes.
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
- Environment: `/Users/quintenchen/developer/ora`, zsh, CST.

### Commands run + outputs
- Commands run + outputs:
  - `pnpm --filter @ora/shared test -- contracts.test.ts` -> passed, 79 tests.
  - `pnpm --filter @ora/runtime exec vitest run test/mode-studio-builder.test.ts` -> passed, 3 tests.
  - `pnpm --filter @ora/runtime typecheck` -> passed.
  - `pnpm --filter @ora/desktop typecheck` -> passed.
  - `pnpm --filter @ora/desktop build` -> passed with existing Vite chunk-size warning.
  - Browser smoke -> passed for shared metadata stage story and runtime contract copy.
