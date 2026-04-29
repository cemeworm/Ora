# TASK-20260429-1712-debate-session-switch-transcript

**Created:** 2026-04-29 17:12 CST
**Status:** Done

---

## Goal
- Fix a desktop UI state-loss bug where Debate mode, while still running, loses previously generated structured debate stages after the user switches to another session and then switches back.

## Scope / Out of scope
- In scope: preserve structured debate `agentMessages[*].transcript` across streaming snapshots, hydrate snapshots, and session switches; prevent background run streams from replacing the current active snapshot; add focused regression tests.
- Out of scope: redesigning the Debate UI, changing backend persistence schema, broad refactors of session loading, or changing non-debate collaboration timeline behavior beyond safer snapshot merging.

## Constraints
- Compatibility: keep existing `OraStateSnapshot`, `OraRunEventStream`, and `adaptChatMessages()` public behavior stable.
- Performance: merge snapshots with map-based de-duping by stable ids/seq; avoid expensive deep diffing.
- Risk: overly broad merging could retain stale list items; prefer incoming item replacement on id collision while preserving missing historical items.
- Tool/Environment limits: implement surgically in desktop app files and verify with targeted tests.

## Plan
1. `apps/desktop/src/lib/state.tsx`: introduce snapshot merge helper and use it in `mergeRunStreamSnapshot()` so narrower incoming snapshots do not erase existing `agentMessages` / transcript stages.
2. `apps/desktop/src/lib/state.tsx`: harden `APPLY_RUN_STREAM` so streams unrelated to the active session/run do not replace `activeSnapshot` or current turn selection.
3. `apps/desktop/src/App.tsx`: merge `state.activeSnapshot` and `getRunState()` snapshots into `turnSnapshots` rather than replacing by `updatedAt`.
4. `apps/desktop/src/lib/state.test.ts` and existing view/component tests: add targeted regression coverage for debate transcript preservation and stream isolation.
5. Run relevant test commands and record evidence.

## Active Files
- `/Users/quintenchen/developer/ora/tasks/TASK-20260429-1712-debate-session-switch-transcript.md`
- `/Users/quintenchen/developer/ora/apps/desktop/src/lib/state.tsx`
- `/Users/quintenchen/developer/ora/apps/desktop/src/App.tsx`
- `/Users/quintenchen/developer/ora/apps/desktop/src/lib/state.test.ts`
- `/Users/quintenchen/developer/ora/apps/desktop/src/lib/viewModel.test.ts`
- `/Users/quintenchen/developer/ora/apps/desktop/src/components/AssistantTurnCard.test.tsx`

## Decisions
- Decision: preserve accumulated same-run snapshots by merging stable lists instead of replacing whole snapshots.
  - Why: the observed symptom matches a narrower streaming/hydrate snapshot overwriting prior `agentMessages` that carry `transcript` metadata.
  - Alternatives: only delay `SELECT_SESSION` hydration, or change `StageTranscript` fallback rendering.
  - Tradeoffs: merge logic adds state complexity but fixes the actual data-loss path and benefits other streaming UI state.

## Progress Log
- 2026-04-29 17:12 CST - Task created.
  Next: Fill in Goal, Scope, Plan, and list Active Files.
- 2026-04-29 17:14 CST - Filled task journal with goal, scope, constraints, plan, active files, and implementation decision.
  Next: Implement `state.tsx` snapshot merging; update `App.tsx` snapshot cache writes; add regression tests.
- 2026-04-29 17:20 CST - Implemented same-run snapshot merging in `state.tsx`, guarded `APPLY_RUN_STREAM` from unrelated stream replacement, and changed `App.tsx` snapshot cache writes to merge instead of replace.
  Next: Run targeted tests; run typecheck; record verification evidence.
- 2026-04-29 17:23 CST - Added state regression tests for narrow debate snapshot preservation, streamed snapshot preservation, and unrelated background stream isolation. Targeted desktop tests and typecheck passed.
  Next: Record DONE gate evidence; update working memory; report changed files.
- 2026-04-29 17:30 CST - Ran post-implementation review pass; tightened sessionId safeguards in same-run snapshot merge, `APPLY_RUN_STREAM`, and `activeSessionTurnSnapshots`; added 2 additional isolation regression tests. Full workspace test script passed.
  Next: none.
- 2026-04-29 17:36 CST - User reproduced the issue again. New diagnosis: running `getRunState()` / latestSnapshot can contain historical `agent.message` events without the corresponding `agentMessages` projection, so StageTranscript still sees only later live messages. Reopened task for event-to-agentMessages projection fix.
  Next: Update runtime `applyStreamingRunEvent`; add desktop snapshot event recovery; add regression tests.
- 2026-04-29 18:01 CST - Implemented second-pass fix: runtime live snapshots now project `agent.message` events into `agentMessages`; desktop snapshots normalize `agentMessages` from historical events; hydrate/select turn paths receive normalized snapshots; added desktop/runtime regression tests. Targeted tests, typechecks, full workspace tests, and TODO scan completed.
  Next: manual UI smoke test if desired.

## Open Issues
- Existing repo TODO scan reports historical/generated TODO matches outside this task; none were introduced by this fix.

## TODO
- [x] Implement same-run snapshot merge helper.
- [x] Guard `APPLY_RUN_STREAM` against unrelated active snapshot replacement.
- [x] Update `App.tsx` turn snapshot cache writes to merge instead of replace.
- [x] Add first-pass regression tests.
- [x] Run first-pass targeted tests and record output.
- [x] Project `agent.message` events into runtime liveSnapshot.agentMessages while streaming.
- [x] Recover desktop snapshot.agentMessages from snapshot.events as a fallback.
- [x] Add event-only snapshot recovery regression tests.
- [x] Re-run targeted/full verification and record output.

## Retrospective

### Item 1
- Pitfall: Treating `stream.snapshot` as authoritative replacement can erase locally accumulated streaming substructures.
- Symptom: Debate UI shows only the latest/partial structured stage after switching sessions during a running debate.
- Root Cause: Same-run snapshots from hydrate/stream paths may be narrower than the in-memory `turnSnapshots` version that already contains previous `agentMessages[*].transcript` entries.
- Reusable Guardrail: For streaming UI state, merge same-run snapshots by stable list keys (`seq`, `id`) and only let scalar fields come from the newest snapshot.
- Evidence: New regression tests in `apps/desktop/src/lib/state.test.ts` preserve both 正方 and 反方 transcript messages when the incoming snapshot only carries one side.
- Scope: local_only
- Suggested Writeback Target: none unless this pattern recurs in other streaming snapshot reducers.
- Status: local_only

### Item 2
- Pitfall: Runtime event logs and derived snapshot projections can drift while a run is still streaming.
- Symptom: Running session snapshots contain historical `agent.message` events but `agentMessages` is empty/incomplete; UI components that read projections miss earlier debate stages after session reload/switch.
- Root Cause: `applyStreamingRunEvent()` appended events to liveSnapshot but did not project `agent.message` payloads into `liveSnapshot.agentMessages`; desktop snapshot normalization also did not reconstruct projections from historical events.
- Reusable Guardrail: Any persisted/live snapshot field derived from events must either be updated at event-application time or normalized from events on read/merge.
- Evidence: `apps/runtime/test/run-streaming.test.ts` covers live projection; `apps/desktop/src/lib/state.test.ts` covers event-only snapshot recovery.
- Scope: candidate_for_skill
- Suggested Writeback Target: future streaming-state skill/guardrail if more event-derived projections are added.
- Status: candidate_for_skill

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [ ] Lint checks pass — not run; no lint script exists in `apps/desktop/package.json`.

**Output**:
- `pnpm --filter @ora/desktop typecheck` passed with `tsc --noEmit` and no stderr.
- `pnpm --filter @ora/runtime typecheck` passed with `tsc -p tsconfig.json --noEmit` and no stderr.
- `pnpm --filter @ora/desktop test -- src/lib/state.test.ts src/lib/viewModel.test.ts src/components/AssistantTurnCard.test.tsx` passed after event-recovery safeguards: 11 test files, 72 tests.
- `pnpm --filter @ora/runtime test -- run-streaming.test.ts` passed with the new run-streaming tests included: 18 test files, 257 tests.
- Full workspace verification script passed: shared 85 tests, desktop 72 tests, runtime 257 tests.

### Functional Verification (Feature Works)
- [x] Core functionality verification: reducer tests prove same-run narrower snapshots retain accumulated debate transcript messages and event-only snapshots recover transcript messages.
- [x] Edge cases verification: reducer tests prove unrelated/background streams and same-run/different-session snapshots do not replace current `activeSnapshot` or `selectedTurnRunId`.
- [x] Error handling verification: historical missing `agentMessages` projections in `getRunState()` snapshots are recovered from `agent.message` events.

**Output**:
- Regression tests added/updated in `apps/desktop/src/lib/state.test.ts`:
  - preserves accumulated debate transcript messages when a narrower snapshot arrives
  - recovers debate transcript messages from snapshot `agent.message` events
  - merges existing debate messages with later messages recovered from events
  - hydrates active snapshots with agent messages recovered from events
  - does not replace active snapshots across unrelated/different-session streams
- `apps/desktop/src/lib/viewModel.test.ts` now verifies event-only debate snapshots still become assistant turn agentMessages after normalization.
- `apps/runtime/test/run-streaming.test.ts` verifies runtime live snapshots project `agent.message` events into `agentMessages`, replace duplicate ids, and ignore non-agent events.

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: existing `mergeRunStreamSnapshot()` incremental event merge in `apps/desktop/src/lib/state.tsx`.

### Comparison Points
- [x] Preserve existing stream event merge behavior by `event.seq`.
- [x] Extend the same stable-key merge idea to full incoming snapshots.
- [x] Keep `StageTranscript` rendering untouched because the data source, not the visual component, was losing entries.

### Findings
- Consistency: the fix follows the existing reducer pattern of merging stream-derived state rather than replacing all accumulated state.
- Differences: full `stream.snapshot` now merges same-run historical arrays instead of direct replacement.
- Conclusion: consistent with current architecture and more robust for running-session restoration.

## Checkpoints

### Checkpoint 1: Debate transcript stages are preserved across narrower same-run snapshots
- Requirement: Existing transcript entries must survive when a later same-run snapshot only includes newer entries.
- Verification method: `state.test.ts` regression test with 正方/反方 messages.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/desktop test -- src/lib/state.test.ts src/lib/viewModel.test.ts src/components/AssistantTurnCard.test.tsx` passed.

### Checkpoint 2: Background streams do not replace the active session snapshot
- Requirement: A stream for another run/session must not change `activeSnapshot` or `selectedTurnRunId`.
- Verification method: `APPLY_RUN_STREAM` reducer regression test with unrelated `run-background` snapshot.
- Status: [x] Pass / [ ] Fail
- Evidence: same test command passed.

### Checkpoint 3: Event-only running snapshots recover structured debate messages
- Requirement: A running snapshot with historical `agent.message` events but empty/incomplete `agentMessages` must still render all structured stages.
- Verification method: desktop reducer/viewModel tests and runtime `run-streaming.test.ts`.
- Status: [x] Pass / [ ] Fail
- Evidence: targeted desktop/runtime test commands passed.

### Checkpoint 4: Type safety remains intact
- Requirement: Modified desktop and runtime TypeScript compiles.
- Verification method: `pnpm --filter @ora/desktop typecheck && pnpm --filter @ora/runtime typecheck`.
- Status: [x] Pass / [ ] Fail
- Evidence: command exited 0 with no stderr.

**All checkpoints passed before marking task DONE.**

## Compressed State (<= 20 lines)
- Objective: Fix Debate mode structured transcript loss after switching away/back during an active run.
- Done: Created task journal; implemented same-run `mergeStateSnapshot()`; routed `stream.snapshot` through merge; guarded `APPLY_RUN_STREAM`; updated `App.tsx` `turnSnapshots`; added runtime live projection from `agent.message` events; added desktop event-only snapshot recovery; added desktop/runtime regression tests.
- In-progress: none.
- Active files: `apps/desktop/src/lib/state.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/state.test.ts`, `apps/desktop/src/lib/viewModel.test.ts`, `apps/runtime/src/run-streaming.ts`, `apps/runtime/test/run-streaming.test.ts`, this task journal.
- Next actions (top 3; exact file/function): none for this task; optional manual UI smoke test can exercise Debate mode live switching.
- Blockers/Risks: repo contains pre-existing unrelated modified files and historical TODO scan matches; no known blocker in this fix.
- Verification status: targeted desktop/runtime tests passed; desktop/runtime typecheck passed; full workspace test script passed; TODO scan has pre-existing/generated matches only.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: macOS/darwin, workspace `/Users/quintenchen/developer/ora`, Node 22.17.0, pnpm workspace.

### Commands run + outputs
- `pnpm --filter @ora/desktop test -- src/lib/state.test.ts src/lib/viewModel.test.ts src/components/AssistantTurnCard.test.tsx`
  - Result: passed.
  - Output summary: `Test Files 11 passed (11)`, `Tests 69 passed (69)`, duration `3.85s`.
- `pnpm --filter @ora/desktop typecheck`
  - Result: passed.
  - Output summary: `tsc --noEmit`, exit 0, no stderr.
- `bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"`
  - Result: completed; only pre-existing/generated matches.
  - Output summary: matches in `.ora/runtime.db*`, `.ora/skills/private/think/SKILL.md`, `.workbuddy/memory/2026-04-29.md`, `skills/skill-creator/scripts/init_skill.py`, `apps/desktop/src-tauri/resources/runtime-sidecar/*`.
- `bash "${CLAUDE_SKILL_DIR:-$HOME/.workbuddy/skills/check}/scripts/run-tests.sh"`
  - Result: passed.
  - Output summary: `packages/shared` 85 tests passed; `apps/desktop` 69 tests passed; `apps/runtime` 254 tests passed.
