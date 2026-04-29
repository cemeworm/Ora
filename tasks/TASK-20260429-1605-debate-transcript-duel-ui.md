# TASK-20260429-1605-debate-transcript-duel-ui

**Created:** 2026-04-29 16:05 CST
**Status:** Done

---

## Goal
Optimize Ora desktop debate mode's Stage Transcript presentation from a vertical ordered list into a debate-like left/right duel layout: affirmative turns on the left, negative turns on the right, round/stage information on a center axis, and moderator synthesis visually separated and emphasized.

## Scope / Out of scope
- In scope:
  - Update `apps/desktop/src/components/StageTranscript.tsx` to render debate transcript groups with a dedicated responsive duel layout.
  - Preserve existing generic Stage Transcript rendering for non-debate groups.
  - Reuse existing transcript metadata: `stance`, `speakerLabel`, `stageLabel`, `sequence`, `status`.
  - Verify desktop typecheck/tests and record evidence.
- Out of scope:
  - Changing runtime debate execution, prompts, or the `transcript` schema.
  - Introducing judge/scoring/regeneration logic.
  - Adding persistent UI preferences or complex card-to-card interaction/highlighting.
  - Refactoring `AssistantTurnCard` beyond what is strictly needed.

## Constraints
- Compatibility: preserve `TurnAgentConversationMessage.transcript` contract and existing 9-entry debate transcript order.
- Simplicity: frontend-only presentation change; keep all new helpers local to `StageTranscript.tsx` unless a strong need appears.
- Risk: avoid misclassifying non-debate transcript groups; use conservative debate detection.
- Responsive: desktop should feel like left/right debate; narrow screens must remain readable with a single-column fallback.
- Tool/Environment limits: use surgical edits and focused verification commands.

## Plan
1. Modify `apps/desktop/src/components/StageTranscript.tsx` to detect debate transcript groups and route them to a dedicated `DebateTranscriptBody` renderer. Done.
2. Implement responsive duel layout helpers inside `StageTranscript.tsx`: center axis, stance cards, and moderator summary card while preserving streaming/status indicators. Done.
3. Keep non-debate groups on the existing `StageTranscriptEntry` vertical list path. Done.
4. Run focused desktop verification, update this task journal with evidence, TODO scan, checkpoints, and retrospective. Done.

## Active Files
- `tasks/TASK-20260429-1605-debate-transcript-duel-ui.md`
- `apps/desktop/src/components/StageTranscript.tsx`

## Decisions
- Decision: Implement debate-specific rendering in `StageTranscript.tsx` instead of changing runtime/schema.
  - Why: existing transcript metadata already contains enough information for left/right layout.
  - Alternatives: add `visualPosition` to runtime transcript; create separate full component file.
  - Tradeoffs: local component grows slightly, but avoids schema churn and keeps change surgical.
- Decision: Use conservative detection for debate layout.
  - Why: Stage Transcript is generic and may be reused by other modes.
  - Alternatives: infer debate from presence of affirmative/negative stances alone.
  - Tradeoffs: group id based detection is safer; fallback inference is limited to labels containing `debate` or `辩论` plus both side stances.
- Decision: Keep mobile as a single-column card flow.
  - Why: three-column debate layouts are cramped on narrow screens.
  - Alternatives: horizontal scrolling or compressed columns.
  - Tradeoffs: mobile is less theatrical but more readable.

## Progress Log
- 2026-04-29 16:05 CST - Task journal created from approved plan `/Users/quintenchen/.workbuddy/plans/quantum-forging-einstein.md`.
  Next: Patch `StageTranscript.tsx`, run focused desktop verification, then update evidence and mark DONE if gates pass.
- 2026-04-29 16:08 CST - Implemented debate-specific UI branch in `StageTranscript.tsx`: conservative debate detection, `DebateTranscriptBody`, responsive left/right rows, center round axis, and moderator/neutral summary row.
  Next: Run desktop typecheck/test/lint and TODO scan.
- 2026-04-29 16:11 CST - Verification completed. Desktop typecheck, desktop tests, root lint, TODO scan, and diff review passed for active files. Remaining TODO scan hits are pre-existing template/generated/binary noise outside active files.
  Next: none.

## Open Issues
- None.

## TODO
- None.

## Retrospective
- No reusable pitfall worth promoting. This was a surgical frontend presentation change using existing transcript metadata. The main guardrail remains local to this task: keep mode-specific transcript UI in the rendering layer unless data semantics are actually missing.

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm --filter @ora/desktop typecheck` -> PASS. `tsc --noEmit` completed with exit code 0.
- `pnpm --filter @ora/desktop test` -> PASS. 11 test files passed, 64 tests passed.
- `pnpm lint` -> PASS. Workspace lint command completed with exit code 0.

### Functional Verification (Feature Works)
- [x] Debate transcript renders through a dedicated left/right duel branch on desktop.
- [x] Moderator/neutral transcript entries are visually separated through summary-style rows.
- [x] Non-debate transcript groups preserve existing list rendering.
- [x] Mobile/narrow layout remains a readable single-column card flow.

**Output**:
- `StageTranscript` now calls `isDebateTranscriptGroup(group)` and routes debate groups to `DebateTranscriptBody`; non-debate groups still map to `StageTranscriptEntry` with the existing vertical list behavior.
- `DebateTranscriptRow` places `affirmative` messages in the left desktop column and `negative` messages in the right desktop column, with `DebateRoundAxis` showing `sequence + 1`, `stageLabel`, and `TranscriptStatusIcon`.
- `DebateModeratorRow` handles `moderator` and `neutral` stances separately and renders a summary card instead of forcing them into either side.
- The mobile path uses `md:hidden` single-column cards; desktop uses `hidden md:grid` three-column rows.

## Comparison

### Reference
- Reference implementation/template/similar task: `tasks/TASK-20260429-1546-debate-mode-stance-lock.md` and approved plan `/Users/quintenchen/.workbuddy/plans/quantum-forging-einstein.md`.

### Comparison Points
- [x] Preserve v1 debate architecture: one reusable Debate Agent, 9 ordered transcript entries.
- [x] Preserve Stage Transcript schema and grouping.
- [x] Improve only frontend visual form.

### Findings
- Consistency: This task keeps the architecture decisions from stance-lock work: no new coordination pattern, no schema migration, no runtime debate changes.
- Differences: Stance-lock hardened prompt behavior; this task changes only the desktop transcript rendering layer.
- Conclusion: The implementation matches the approved minimal-frontend-change plan.

## Checkpoints

### Checkpoint 1: Debate-specific layout routing
- Requirement: Only debate transcript groups use the new duel layout; non-debate groups keep existing list layout.
- Verification method: Code inspection plus typecheck/tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `isDebateTranscriptGroup()` returns true for `group.id === "debate"`, or a debate-labeled group containing both `affirmative` and `negative`; otherwise `StageTranscript` renders existing `StageTranscriptEntry` list. Desktop typecheck/tests pass.

### Checkpoint 2: Left/right stance placement
- Requirement: `affirmative` turns render left, `negative` turns render right, `moderator`/`neutral` entries render as center/summary cards.
- Verification method: Code inspection and structural reasoning from `stance` conditions.
- Status: [x] Pass / [ ] Fail
- Evidence: `DebateTranscriptRow` checks `transcript.stance === "affirmative"` for left placement and renders non-affirmative side entries on the right after moderator/neutral are handled by `DebateModeratorRow`.

### Checkpoint 3: Existing transcript behavior preserved
- Requirement: Sequence ordering and status icon behavior remain intact.
- Verification method: Typecheck/tests and code inspection.
- Status: [x] Pass / [ ] Fail
- Evidence: `groupStageTranscriptMessages()` sorting was unchanged; `TranscriptStatusIcon` is reused in both `DebateRoundAxis` and mobile cards; desktop typecheck/tests pass.

## Compressed State (<= 20 lines)
- Objective: Make debate Stage Transcript look like a left/right debate instead of a vertical list.
- Done: Task journal created; `StageTranscript.tsx` patched; verification completed; journal marked Done.
- Changed: added conservative debate group routing, responsive duel rows, center axis, stance cards, moderator summary cards.
- Active files: `tasks/TASK-20260429-1605-debate-transcript-duel-ui.md`, `apps/desktop/src/components/StageTranscript.tsx`.
- Next actions: none.
- Blockers/Risks: no blockers; residual visual-risk requires manual UX review in a real debate run.
- Verification status: PASS for desktop typecheck, desktop tests, root lint, TODO scan review.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: macOS darwin, workspace `/Users/quintenchen/developer/ora`.

### Commands run + outputs
- `pnpm --filter @ora/desktop typecheck`
  - PASS:
    ```text
    > @ora/desktop@0.1.0 typecheck /Users/quintenchen/developer/ora/apps/desktop
    > tsc --noEmit
    ```
- `pnpm --filter @ora/desktop test`
  - PASS:
    ```text
     Test Files  11 passed (11)
          Tests  64 passed (64)
       Duration  1.48s
    ```
- `pnpm lint`
  - PASS:
    ```text
    > ora@0.0.0 lint /Users/quintenchen/developer/ora
    > pnpm -r --if-present lint
    Scope: 3 of 4 workspace projects
    ```
- `bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"`
  - Output:
    ```text
    ./.ora/skills/private/think/SKILL.md:82:**No placeholders in approved plans.** Every step must be concrete before approval. Forbidden patterns: TBD, TODO, "implement later," "similar to step N," "details to be determined." A plan with placeholders is a promise to plan later.
    Binary file ./.ora/runtime.db matches
    ./skills/skill-creator/scripts/init_skill.py:20:description: [TODO: Complete and informative explanation of what the skill does and when to use this skill. Include WHEN to use this skill - specific scenarios, file types, or tasks that trigger it.]
    ./skills/skill-creator/scripts/init_skill.py:27:[TODO: 1-2 sentences explaining what this skill enables]
    ./skills/skill-creator/scripts/init_skill.py:31:[TODO: Choose the structure that best fits this skill's purpose. Common patterns:
    ./skills/skill-creator/scripts/init_skill.py:57:## [TODO: Replace with the first main section based on chosen structure]
    ./skills/skill-creator/scripts/init_skill.py:59:[TODO: Add content here. See examples in existing skills:
    ./skills/skill-creator/scripts/init_skill.py:119:    # TODO: Add actual script logic here
    ./skills/skill-creator/scripts/init_skill.py:266:    print("1. Edit SKILL.md to complete the TODO items and update the description")
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:16241:      // TODO: use BindOncePromise here once a new version of @opentelemetry/core is available.
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:17735:      // TODO: find a reasonable mean to clean the memo;
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:18759:       * TODO: semver filter? no spec yet.
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:39005:        // TODO(murgatroid99): Find a better way to handle this
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:41341:        // TODO(murgatroid99): handle 100 and 101
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:45336:      // TODO(cjihrig): Remove these encoding headers from the default response
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:74112:        // TODO: fix export logic
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:87239:      info("TODO: Support non-isolated groups.");
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:103622:  // 						// TODO remove
    Binary file ./apps/desktop/src-tauri/resources/runtime-sidecar/bin/node matches
    ```
  - Review: matches are pre-existing outside active files, primarily templates, generated sidecar bundle, and binary files; no active-file TODO remains.
- `git diff -- apps/desktop/src/components/StageTranscript.tsx tasks/TASK-20260429-1605-debate-transcript-duel-ui.md`
  - Reviewed. Active code diff is limited to `StageTranscript.tsx`; task journal is newly added.
