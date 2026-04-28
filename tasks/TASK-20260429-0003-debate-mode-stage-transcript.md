# TASK-20260429-0003-debate-mode-stage-transcript

**Created:** 2026-04-29 00:03 CST
**Status:** Done

---

## Goal
Implement a reusable Stage Transcript content surface and use debate mode as its first concrete mode preset. Debate should let the user watch a structured argument unfold in the main assistant content area while keeping the runtime model explicit: one reusable Debate Agent invoked multiple times with different prompt overlays, plus a moderator/lead role for framing and synthesis.

## Scope / Out of scope
- In scope:
  - Generic Stage Transcript component for structured multi-stage agent output.
  - Debate mode preset on existing mode/orchestration machinery.
  - One Debate Agent profile whose "soul" is designed for firm, adversarial, honest argumentation.
  - Virtual speaker labels and metadata for debate seats such as `正方主辩` and `反方第一副辩`, even when the same underlying debate agent is used.
  - Mock/runtime-client support and focused tests proving ordering, grouping, and backward compatibility.
- Out of scope:
  - Adding a new `CoordinationPattern` for debate in v1.
  - Creating separate real agents for each debate seat.
  - Building a debate-only split arena UI that cannot generalize to review panels, research panels, or judging workflows.
  - Implementing voting, scoring, judge panels, audience interaction, or tournament formats in v1.

## Constraints
- Compatibility: existing `agentMessages`, assistant turns, collaboration timeline, and mode presets must keep working.
- Simplicity: do not introduce a parallel transcript storage model; extend `AgentConversationMessage` with one typed optional transcript presentation object.
- Reuse: Stage Transcript must be generic enough for debate, review panel, research panel, and evaluation judging flows.
- Runtime risk: debate mode should stay a preset over existing orchestration paths first; schema/runtime pattern changes are deferred until the interaction proves useful.
- UX: debate process should be visible in the main content area, not hidden only inside the current collapsible `协作轨迹`.
- Visibility: v1 guarantees stage-level visibility, not token-level streaming for every speaker; active work can appear in process steps and completed speeches appear as transcript entries.

## Debate Semantics
- Runtime roles:
  - Moderator/lead agent frames the proposition, restates rules, dispatches debate turns, and writes final synthesis.
  - One reusable Debate Agent handles every side/speaker turn through per-turn prompt overlays.
- Debate Agent soul:
  - Firmly defends the assigned stance for the current turn.
  - Attacks weak assumptions, missing evidence, and contradictions in the opposing side.
  - Responds to prior arguments instead of giving isolated generic speeches.
  - Does not concede casually; concessions must be narrow, explicit, and strategically integrated.
  - Separates claims, evidence, rebuttal, and burden-of-proof pressure.
  - Stays intellectually honest: no fabricated facts, no knowingly invalid arguments, no personal attacks.
- Required speaking order:
  1. `正方主辩`
  2. `反方主辩`
  3. `正方第一副辩`
  4. `反方第一副辩`
  5. `正方第二副辩`
  6. `反方第二副辩`
  7. `正方主辩` final statement
  8. `反方主辩` final statement
  9. Moderator synthesis

## Plan
1. Add a typed optional `transcript` object to shared `AgentConversationMessage` and preserve it through runtime emit, stream merge, desktop runtime types, and view-model projection.
2. Implement generic Stage Transcript grouping/rendering from `message.transcript`, not from inferred strings, `agentId`, `nodeId`, or `topic`.
3. Filter transcript messages out of the existing `AgentConversationTimeline` so debate process is not shown twice.
4. Add a built-in debate mode preset that keeps `family: "orchestrator_subagent"` but uses a mode-specific debate execution path instead of relying on the generic four-slot orchestrator driver.
5. Implement the debate execution path as a deterministic sequence: moderator framing, eight Debate Agent speeches using per-turn prompt overlays, then moderator synthesis.
6. Update mock runtime/client data so the full debate sequence can be seen without provider calls.
7. Add focused tests for transcript schema preservation, transcript grouping/order, same-agent virtual speaker rendering, mock debate sequence, and non-debate collaboration regression.

## Active Files
- tasks/TASK-20260429-0003-debate-mode-stage-transcript.md
- packages/shared/src/modes.ts
- packages/shared/src/runtime.ts
- apps/runtime/src/patterns/execution-context.ts
- apps/runtime/src/patterns/driver-registry.ts
- apps/desktop/src/types.ts
- apps/desktop/src/components/AssistantTurnCard.tsx
- apps/desktop/src/components/StageTranscript.tsx
- apps/desktop/src/lib/state.tsx
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/lib/runtimeClient.test.ts
- apps/desktop/src/lib/viewModel.ts
- apps/desktop/src/lib/viewModel.test.ts
- apps/desktop/src/components/AssistantTurnCard.test.tsx
- apps/desktop/src/lib/state.test.ts
- apps/runtime/test/runtime-integration.test.ts
- apps/runtime/test/runtime-smoke.test.ts
- packages/shared/test/contracts.test.ts

## Decisions
- Decision: Debate v1 is a mode preset, not a new coordination pattern.
  - Why: current mode and topology infrastructure can already model lead + delegated stages; adding a sixth pattern would increase schema and validation blast radius before the UX is proven.
  - Alternatives: new `debate` `CoordinationPattern`, or artifact-only debate output.
  - Tradeoffs: preset semantics are less pure, but much easier to test, roll back, and evolve.
- Decision: Use one Debate Agent with prompt overlays, not one agent per debate seat.
  - Why: the seat is a temporary speaking role, not a durable worker identity.
  - Alternatives: separate `affirmative_lead`, `negative_lead`, `affirmative_deputy_1`, etc.
  - Tradeoffs: transcript metadata must show virtual speaker identity clearly because `agentId` alone is not enough.
- Decision: Build Stage Transcript as a generic component.
  - Why: debate is only the first ritual; the same surface can display review panels, research panels, judging panels, and other staged agent exchanges.
  - Alternatives: fixed pro/con arena UI.
  - Tradeoffs: less theatrical at first, but avoids a narrow one-off component.
- Decision: Use typed `AgentConversationMessage.transcript`, not a loose metadata object or UI inference.
  - Why: `AgentConversationMessageSchema` is strict today, and desktop stream merge manually reconstructs messages; unknown fields would be dropped unless every layer preserves them deliberately.
  - Alternatives: infer from `threadId`/`nodeId`/`topic`, or add open `metadata: Record<string, unknown>`.
  - Tradeoffs: a small shared schema change is required, but the presentation contract becomes testable and reusable.
- Decision: Debate preset needs mode-specific execution behavior.
  - Why: the generic `orchestrator_subagent` driver only has `decompose/research/review/synthesize` semantics and stores outputs in four bag slots; it cannot safely represent eight ordered speeches without overwriting or hiding turns.
  - Alternatives: force the debate into four generic nodes, or add a new top-level `debate` coordination pattern.
  - Tradeoffs: mode-specific driver logic adds a special case, but avoids broad pattern/schema blast radius while preserving correct debate order.

## Open Issues
- None.

## TODO
- None.

## Progress Log
- 2026-04-29 00:03 CST - Task created with initial debate mode and Stage Transcript plan.
  Next: review architecture risks, refine transcript metadata decision, then implement.
- 2026-04-29 CST - Plan revised after architecture review. Key corrections: use typed `AgentConversationMessage.transcript`, preserve metadata through stream merge/projection, avoid `primitives.ts` unless adding a new pattern, and add mode-specific debate execution instead of forcing eight speeches through the generic four-slot orchestrator driver.
  Next: inspect projection path in detail, patch shared/runtime message contracts, then build Stage Transcript.
- 2026-04-29 CST - Implementation started. Assumptions: debate preset will be user-visible immediately, mode id will be `debate`, and Stage Transcript UI labels will use concise Chinese labels matching the existing desktop UI.
  Next: inspect snapshot-to-turn projection, identify the smallest runtime debate special case, then patch transcript contracts and tests.
- 2026-04-29 CST - Implementation completed. Added typed transcript metadata, Stage Transcript rendering, stream/view-model preservation, debate preset/runtime sequence, mock debate sequence, and focused/shared/runtime/desktop tests. Verification passed for root test, typecheck, build, and lint; repo-wide TODO helper remains noisy from historical/generated files, with no blocking TODOs in this task after closure.
  Next: none.

## Retrospective
- Record 0-3 highest-value pitfalls from this task.
- Leave reusable operational lessons here even when they later get promoted into a skill.

### Item 1
- Pitfall: A repo-wide TODO helper is too noisy to serve as the sole DONE gate in this Ora workspace.
- Symptom: `todo_scan.sh` exited 0 but emitted historical task TODOs, skill-template TODOs, runtime DB binary hits, and generated sidecar/target TODOs unrelated to this change.
- Root Cause: The helper scans broadly across repo-local historical/generated artifacts instead of only active task-owned files.
- Reusable Guardrail: Record the mandated helper output, then pair it with a task-owned file review and source/test verification evidence.
- Evidence: Current run emitted unrelated hits under historical `tasks/*`, `.ora/runtime.db`, `skills/skill-creator`, `apps/desktop/src-tauri/target/**`, and bundled sidecar assets; the active task TODO section is now `None`.
- Scope: local_only
- Suggested Writeback Target: None.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm typecheck` -> PASS (`packages/shared`, `apps/runtime`, `apps/desktop` typechecks completed).
- `pnpm test` -> PASS (`packages/shared`: 85 tests; `apps/desktop`: 60 tests; `apps/runtime`: 244 tests).
- `pnpm build` -> PASS (`packages/shared` build, `apps/runtime` build, `apps/desktop` production build). Vite emitted only the existing chunk-size warning.
- `pnpm lint` -> PASS (`pnpm -r --if-present lint`, no package lint scripts reported failures).

### Functional Verification (Feature Works)
- [x] Stage Transcript displays the required debate order in the main content area.
- [x] The same underlying Debate Agent can render as multiple virtual speakers.
- [x] Existing non-debate collaboration timeline behavior remains unchanged.
- [x] Transcript messages do not also appear in `协作轨迹`.
- [x] Moderator synthesis remains the final assistant answer, with transcript treated as visible process.

**Output**:
- `apps/runtime/test/runtime-integration.test.ts` debate case asserts 9 transcript entries in the required order and the first 8 all come from `debate_agent`.
- `apps/desktop/src/components/AssistantTurnCard.test.tsx` asserts Stage Transcript renders in the main turn and `visibleAgentMessages` filters transcript messages out of `协作轨迹`.
- `apps/desktop/src/lib/viewModel.test.ts` asserts transcript metadata survives projection and same `fromAgentId` renders multiple virtual speaker labels.
- `apps/desktop/src/lib/state.test.ts` asserts stream merge preserves `message.transcript`.
- Browser/mock support is covered by `apps/desktop/src/lib/runtimeClient.ts` deterministic `debate` snapshot and full desktop test suite.

## Comparison

### Reference
- Reference implementation/template/similar task: existing `AssistantTurnCard` collaboration timeline and current mode preset architecture in shared `modes.ts`.

### Comparison Points
- [x] Stage Transcript reuses existing assistant turn/message data rather than introducing a parallel source of truth.
- [x] Debate preset follows current mode preset validation and runtime projection patterns.
- [x] UI avoids debate-only layout assumptions so the component can serve future staged agent interactions.
- [x] Debate execution does not rely on generic orchestrator bag slots that would overwrite repeated speeches.

### Findings
- Consistency: planned direction matches existing mode-driven architecture and task-source-of-truth workflow.
- Differences: transcript needs virtual speaker metadata because one runtime agent may represent multiple debate seats.
- Conclusion: implement a generic transcript presentation layer first; keep runtime changes minimal.

## Checkpoints

### Checkpoint 1: Transcript Contract
- Requirement: transcript entries can represent stage, speaker label, stance, order, status, and content without breaking existing agent messages.
- Verification method: shared schema tests, stream merge tests, and view-model projection/grouping tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `packages/shared/test/contracts.test.ts`, `apps/desktop/src/lib/state.test.ts`, and `apps/desktop/src/lib/viewModel.test.ts` passed in `pnpm test`.

### Checkpoint 2: Debate Preset Semantics
- Requirement: debate preset uses Moderator + one Debate Agent and enforces the required speaking order.
- Verification method: shared/runtime tests or mock runtime snapshot assertions covering all eight speeches and moderator synthesis.
- Status: [x] Pass / [ ] Fail
- Evidence: `packages/shared/test/contracts.test.ts` validates the `debate` preset profiles/nodes; `apps/runtime/test/runtime-integration.test.ts` validates 8 Debate Agent speeches plus moderator synthesis.

### Checkpoint 3: Desktop Rendering
- Requirement: debate process is visible as Stage Transcript in the main assistant content area and existing non-debate turns still render correctly.
- Verification method: component tests plus browser/manual smoke if UI changes are substantial.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/desktop/src/components/AssistantTurnCard.test.tsx` validates Stage Transcript rendering and collaboration filtering; full desktop test/build passed.

## Compressed State (<= 20 lines)
- Objective: Build debate mode as first user of generic Stage Transcript.
- Current decision: v1 is a mode preset, not new `CoordinationPattern`.
- Current decision: one Debate Agent receives per-turn prompt overlays; virtual speaker labels represent debate seats.
- Current decision: use typed optional `AgentConversationMessage.transcript`; do not infer transcript presentation from IDs/topics.
- Current decision: debate preset keeps `family: "orchestrator_subagent"` but needs mode-specific execution because generic driver has only four semantic slots.
- Required order: 正方主辩, 反方主辩, 正方第一副辩, 反方第一副辩, 正方第二副辩, 反方第二副辩, 正方主辩 final, 反方主辩 final, Moderator synthesis.
- UI direction: Stage Transcript in main assistant content area, not a debate-only split arena.
- Transcript messages must be filtered out of the old collaboration timeline to avoid duplicate process display.
- Active likely files: shared runtime/modes, runtime execution-context/driver-registry, desktop state/types/AssistantTurnCard/new StageTranscript/runtimeClient/viewModel tests.
- Open issues resolved for v1 implementation: debate preset visible immediately; mode id `debate`; Stage Transcript labels in concise Chinese.
- Verification status: Passed root `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm lint`.
- Next actions (top 3; exact file/function): none.
- Blockers/Risks: No known blockers. Preview HTTP smoke passed; no interactive browser screenshot pass was run.

## Verification

### Evidence Requirements
Must provide the following evidence before Done:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/Ora`, zsh, CST.

### Commands run + outputs
- Commands run + outputs:
  - `pnpm --filter @ora/shared test` -> PASS, 1 file / 85 tests.
  - `pnpm --filter @ora/desktop test` -> PASS, 11 files / 60 tests.
  - `pnpm --filter @ora/runtime test` -> PASS, 16 files / 244 tests.
  - `pnpm typecheck` -> PASS, shared/runtime/desktop typechecks completed.
  - `pnpm test` -> PASS, shared 85 + desktop 60 + runtime 244 tests.
  - `pnpm build` -> PASS, shared/runtime TS builds and desktop Vite production build completed; Vite reported only chunk-size warning.
  - `pnpm lint` -> PASS, no lint failures from packages with lint scripts.
  - `git diff --check` -> PASS.
  - `pnpm --filter @ora/desktop preview --host 127.0.0.1 --port 4173` + `curl -I http://127.0.0.1:4173` -> PASS, HTTP 200; preview server was stopped after smoke.
  - `bash /Users/quintenchen/.codex/skills/long-task-protocol/scripts/todo_scan.sh` -> exited 0 but emitted unrelated historical/generated/binary TODO noise; active task TODO section is closed as `None`.
  - `rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX" <changed source/test files>` -> PASS, no matches.
