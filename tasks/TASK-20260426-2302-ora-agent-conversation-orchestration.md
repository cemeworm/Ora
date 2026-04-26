# TASK-20260426-2302-ora-agent-conversation-orchestration

**Created:** 2026-04-26 23:02 Asia/Shanghai
**Status:** DONE

---

## Goal
- Build Ora's multi-agent content-area orchestration view for non-subagent agent modes. When agent mode involves multiple agents, the assistant turn should show the agents collaborating through visible @mentions, replies, routing, handoffs, and status in the main content area, backed by structured runtime records rather than UI-only inference. Reuse Ora's existing custom agents and mode management so users can assemble teams from saved agents.

## Scope / Out of scope
- In scope:
  - Add a structured `AgentConversationMessage` contract to shared runtime state.
  - Emit agent conversation records for `generator_verifier`, `agent_teams`, `message_bus`, and `shared_state`.
  - Exclude `orchestrator_subagent` and subagent delegate stages from this content-area collaboration surface.
  - Render agent @mentions/replies inside assistant turns before the final answer.
  - Add an Agents-page team composer that saves custom multi-agent modes using existing mode storage.
  - Bind mode nodes to existing custom agents via `node.config.customAgentId` and inject those persona overlays during runtime calls.
- Out of scope:
  - User manually @mentioning an agent mid-run.
  - Independent per-agent provider/model switching beyond the existing persona/model hint.
  - New persistent team file format separate from custom `ModeSpec`.
  - Replacing Trails, topology, or Langfuse graph views.

## Constraints
- Compatibility:
  - Existing snapshots without `agentMessages` must parse with a default empty array.
  - Existing modes without `node.config.customAgentId` must run unchanged.
  - Single Agent, DeerFlow-like Harness, and Orchestrator-Subagent user experience must remain unchanged.
- Performance:
  - Agent conversation records should be derived from the same runtime execution; no additional LLM calls only for UI.
  - Content-area rendering should stay bounded to current turn records.
- Risk:
  - Avoid fabricating collaboration from plain `message.delta` where structured records are absent.
  - Keep `message.published` / `message.routed` bus stats behavior intact.
- Tool/Environment limits:
  - Use `apply_patch` for manual edits.
  - Run targeted typecheck/tests before DONE.

## Plan
1. Shared contract:
   - Update `packages/shared/src/runtime.ts` with `AgentConversationMessageSchema`, `AgentConversationMessageKindSchema`, `AgentConversationMessageStatusSchema`, `agent.message` event type, and `StateSnapshot.agentMessages`.
   - Export the new type through existing shared exports if needed.
   - Add shared contract tests.
2. Runtime emission and persona binding:
   - Update `apps/runtime/src/patterns/driver-registry.ts` interfaces to support `emitAgentMessage` and per-node custom agent IDs.
   - Update `apps/runtime/src/harness/runtime-kernel.ts` to collect `agentMessages`, emit `agent.message`, and pass `customAgentId` persona overlays to `callAgent`.
   - Generate structured collaboration records for `generator_verifier`, `agent_teams`, `message_bus`, and `shared_state`; leave subagent patterns untouched.
   - Add runtime tests covering message shape and custom agent binding.
3. Desktop data model:
   - Update `apps/desktop/src/types.ts` with UI-facing agent conversation message types.
   - Update `apps/desktop/src/lib/runtimeClient.ts` exports/mock parsing if required.
   - Update `apps/desktop/src/lib/viewModel.ts` so assistant turn attachments include `agentMessages`.
   - Add view model tests.
4. Content-area UI:
   - Add `AgentConversationTimeline` component or a small local section inside `AssistantTurnCard`.
   - Render avatars, agent names, @mention chips, reply previews, topic/correlation metadata, and status icons.
   - Show only when the turn has non-empty `agentMessages`.
   - Add component tests if current test setup supports it.
5. Agents team composer:
   - Extend `RuntimeClient` with mode create/list helpers if not already exposed to `AgentsView`.
   - Add Teams tab to `AgentsView` that chooses a multi-agent family, assigns existing custom agents to role slots, and saves a custom mode with `node.config.customAgentId`.
   - Ensure saved mode can be selected for chat through existing mode flow.
6. Verification and closure:
   - Run targeted shared/runtime/desktop tests and typechecks.
   - Run TODO scan.
   - Record outputs, checkpoints, changed files, retrospective, and residual risks before marking DONE.

## Active Files
- tasks/TASK-20260426-2302-ora-agent-conversation-orchestration.md
- packages/shared/src/runtime.ts
- packages/shared/src/modes.ts
- packages/shared/test/contracts.test.ts
- apps/runtime/src/harness/runtime-kernel.ts
- apps/runtime/src/patterns/driver-registry.ts
- apps/runtime/test/runtime-integration.test.ts
- apps/desktop/src/types.ts
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/lib/state.tsx
- apps/desktop/src/lib/state.test.ts
- apps/desktop/src/lib/viewModel.ts
- apps/desktop/src/lib/viewModel.test.ts
- apps/desktop/src/components/AssistantTurnCard.tsx
- apps/desktop/src/components/AgentsView.tsx

## Decisions
- Decision: Store collaboration as structured runtime records, not inferred UI.
  - Why: The user wants real orchestration presentation; durable records also support replay, tests, and future search.
  - Alternatives: Derive bubbles from `message.delta` / bus events only.
  - Tradeoffs: More contract/runtime work now; much less fragile later.
- Decision: Reuse custom `ModeSpec` for team definitions.
  - Why: Ora already has mode storage, validation, topology, and run selection.
  - Alternatives: Add a new team JSON store.
  - Tradeoffs: Keeps persistence smaller; team composer must write mode-compatible node config.
- Decision: v1 covers all non-subagent multi-agent families.
  - Why: User selected "所有多agent" and explicitly excluded subagent.
  - Alternatives: Start with Teams+Bus only.
  - Tradeoffs: Broader tests and UI conditions, but avoids a confusing partial launch.

## Progress Log
- 2026-04-26 23:02 - Task created from approved plan and user-selected scope.
  Next: Add shared contract fields; wire runtime collection; add first tests.
- 2026-04-26 23:08 - Added shared `AgentConversationMessage` contract, `agent.message` event, `StateSnapshot.agentMessages`, runtime collection/emission, non-subagent multi-agent pattern records, and per-node custom agent overlay plumbing. Shared contract test and runtime typecheck pass after rebuilding shared.
  Next: Add desktop attachment types; adapt view model; render timeline in assistant turns.
- 2026-04-26 23:17 - Added desktop turn attachment types, view-model adaptation, assistant-turn agent conversation timeline, Agents-page team composer, browser mock agent messages, runtime integration tests, and desktop view model test. Runtime tests and desktop typecheck pass.
  Next: Run final shared/runtime/desktop verification; run TODO scan; close checkpoints and retrospective.
- 2026-04-26 23:22 - Check pass found live stream snapshots needed to merge `agent.message` events before final snapshot arrival. Added stream merge support and state test. Full check script passes.
  Next: Update final evidence and report completion.
- 2026-04-27 00:12 - UX follow-up: Agent conversation long replies could not be read comfortably because the inline card had no dedicated full-view path and long content could sit behind the floating composer. Added bounded inline scrolling, stronger wrapping, and an `Open full` transcript dialog in `AssistantTurnCard`.
  Next: None.
- 2026-04-27 00:21 - UX follow-up: Agent message bodies still ended in `...` because runtime emitted compacted summaries into `agentMessages.content`. Changed runtime emission to store full raw agent content, kept truncation only for inline reply previews, and added desktop recovery for already-persisted compacted messages by hydrating from `message.delta` events.
  Next: None.

## Open Issues
- None.

## TODO
- [x] Add shared agent conversation contract and tests.
- [x] Emit runtime agent conversation messages for non-subagent multi-agent patterns.
- [x] Inject per-node custom agent persona overlays.
- [x] Adapt desktop view model and render content-area timeline.
- [x] Add Agents team composer and mode save flow.
- [x] Run verification gates and close task.

## Retrospective
- Item 1
  - Pitfall: Shared package changes may not be visible to runtime/desktop until `@ora/shared` is rebuilt.
  - Symptom: Runtime typecheck initially reported missing exported members for the newly-added contract.
  - Root Cause: Runtime resolved `@ora/shared` through built package output, not only source aliases.
  - Reusable Guardrail: After changing `packages/shared/src`, run `pnpm --filter @ora/shared build` before dependent package checks.
  - Evidence: Runtime typecheck passed after shared build.
  - Scope: local_only
  - Suggested Writeback Target: none
  - Status: local_only
- Item 2
  - Pitfall: Desktop package test binaries can be missing even when root pnpm store has the package.
  - Symptom: `pnpm --filter @ora/desktop test -- viewModel.test.ts` failed with `vitest: command not found`.
  - Root Cause: Desktop package node_modules links had not been materialized.
  - Reusable Guardrail: Run `pnpm install --filter @ora/desktop...` when desktop-local scripts cannot resolve declared devDependencies.
  - Evidence: Lockfile stayed unchanged and desktop tests/typecheck passed after install.
  - Scope: local_only
  - Suggested Writeback Target: none
  - Status: local_only
- Item 3
  - Pitfall: Long agent-to-agent replies need their own reading surface, not only inline transcript rendering.
  - Symptom: Agent conversation content was only partially visible in the chat area when messages were long and the bottom composer overlapped the viewport.
  - Root Cause: `AgentConversationTimeline` rendered directly in `AssistantTurnCard` without a bounded internal scroll area or full transcript dialog.
  - Reusable Guardrail: Any content-area orchestration transcript should provide both an inline scan view and a full-height reading view.
  - Evidence: `AssistantTurnCard` now caps inline transcript height, enables internal scroll, wraps long content, and opens a full transcript dialog.
  - Scope: local_only
  - Suggested Writeback Target: none
  - Status: local_only
- Item 4
  - Pitfall: A transcript UI cannot fix data that was already truncated before it reached the UI.
  - Symptom: Each agent message body still ended with `...` even after adding scroll/full-view affordances.
  - Root Cause: `apps/runtime/src/patterns/driver-registry.ts` used `compact()` when constructing `agentMessages.content`, so the stored record itself was incomplete.
  - Reusable Guardrail: Store full agent transcript content in structured state; perform display-only truncation exclusively in view components.
  - Evidence: Runtime now uses `agentMessageContent()` for full content, runtime regression test verifies a long suffix remains visible, and desktop view model hydrates historical compacted records from `message.delta` when possible.
  - Scope: local_only
  - Suggested Writeback Target: none
  - Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm --filter @ora/shared typecheck` -> passed.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm --filter @ora/shared test` -> 1 file passed, 76 tests passed.
- `pnpm --filter @ora/runtime test` -> 12 files passed, 190 tests passed.
- `pnpm --filter @ora/desktop test` -> 4 files passed, 9 tests passed.

### Functional Verification (Feature Works)
- [x] Runtime snapshots expose agent messages for all non-subagent multi-agent patterns.
- [x] Assistant turn renders agent @mentions/replies when `agentMessages` exist.
- [x] Agents team composer saves a custom mode with custom agent bindings.
- [x] Existing single/subagent flows remain unchanged.

**Output**:
- Runtime integration test verifies `generator_verifier`, `agent_teams`, `message_bus`, and `shared_state` produce `agentMessages` and `agent.message` events.
- Runtime integration test verifies `orchestrator_subagent` produces no content-area `agentMessages`.
- Runtime integration test verifies mode node `config.customAgentId` injects the saved custom agent SOUL/persona overlay.
- Desktop view model test verifies agent message labels and @targets adapt into assistant turn attachments.
- Desktop state test verifies streamed `agent.message` events merge into the active snapshot before final completion.
- Vite dev server started on `http://127.0.0.1:1421/`; default `1420` was already in use.
- Agent conversation bodies now store full raw content instead of compacted summaries; historical compacted messages are restored from matching `message.delta` events when possible.

## Comparison

### Reference
- AutoGen multi-agent conversation: agents send/receive messages and auto-reply.
  - Source: https://microsoft.github.io/autogen/0.2/docs/Use-Cases/agent_chat
  - Relevance: Validates treating agent collaboration as first-class conversation records.
- AutoGen Group Chat: participants publish messages turn-by-turn in a shared group conversation.
  - Source: https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/design-patterns/group-chat.html
  - Relevance: Supports the content-area timeline model where agent utterances are visible in sequence.
- Microsoft Agent Framework group chat orchestration: orchestrator synchronizes each agent with complete conversation history before each turn.
  - Source: https://learn.microsoft.com/en-us/agent-framework/user-guide/workflows/orchestrations/group-chat
  - Relevance: Supports preserving routing/reply context explicitly rather than inferring it from final answer text.
- CrewAI collaboration and flows: crews collaborate through delegated tasks/questions while flows provide controlled orchestration/state.
  - Sources: https://docs.crewai.com/en/concepts/collaboration and https://docs.crewai.com/concepts/Flow
  - Relevance: Supports keeping "team composition" separate from "execution pattern" while reusing Ora's existing mode system.
- OpenAI Agents SDK orchestration and handoffs: manager-style orchestration, agents-as-tools, and handoffs are distinct primitives.
  - Sources: https://openai.github.io/openai-agents-js/guides/multi-agent/ and https://openai.github.io/openai-agents-python/handoffs/
  - Relevance: Supports excluding subagent/tool-style delegation from the visible peer-agent conversation surface.
- Langfuse/LangSmith observability: graph/trace as debug references.
  - Relevance: Debug graphs remain complementary to the user-facing content timeline.

### Comparison Points
- [x] Agent conversation is represented as first-class messages, consistent with AutoGen/ChatDev style.
- [x] Handoff/routing is structured, consistent with LangGraph/OpenAI SDK patterns.
- [x] Debug graph remains complementary, consistent with Langfuse/LangSmith.

### Findings
- Consistency: Implemented structured messages and content-area rendering consistent with the references.
- Differences: Ora will render the collaboration in the content area instead of only as an external graph/trace.
- Conclusion: The implementation follows AutoGen-style visible agent messages while keeping LangGraph/OpenAI-style structured routing and handoff state.

## Checkpoints

### Checkpoint 1: Runtime Contract
- Requirement: `StateSnapshot` includes structured `agentMessages`; legacy snapshots default to empty array.
- Verification method: Shared contract tests and runtime snapshot tests.
- Status: Pass
- Evidence: `pnpm --filter @ora/shared test` passed; `StateSnapshotSchema` default tested; runtime tests parse final snapshots.

### Checkpoint 2: Runtime Behavior
- Requirement: Four non-subagent multi-agent patterns emit correct @mention/reply records without extra LLM calls.
- Verification method: Runtime tests over representative runs.
- Status: Pass
- Evidence: `pnpm --filter @ora/runtime test` passed with new coverage for all four target patterns.

### Checkpoint 3: Desktop Rendering
- Requirement: Assistant turn content shows agent collaboration records with status, @mentions, reply previews, and final answer.
- Verification method: View model tests, component/typecheck, and manual/browser verification if feasible.
- Status: Pass
- Evidence: `pnpm --filter @ora/desktop test`, `pnpm --filter @ora/desktop typecheck`, and full check script passed; Vite server available on `http://127.0.0.1:1421/`. UX follow-up adds bounded inline scrolling plus `Open full` transcript dialog for long agent replies.

### Checkpoint 4: Team Composer
- Requirement: Agents page can create a custom multi-agent mode from saved custom agents.
- Verification method: Unit/component tests or manual runtime-client mock verification.
- Status: Pass
- Evidence: AgentsView creates a custom `ModeSpec` with `node.config.customAgentId`; runtime integration test verifies such bindings inject custom agent persona overlays.

## Compressed State (<= 20 lines)
- Objective: Add structured multi-agent conversation records and content-area @mention/reply rendering for all non-subagent multi-agent modes, plus an Agents team composer.
- Done: Created task journal; added shared/runtime contract and events; emitted agent messages for all target patterns; wired per-node custom agent overlays; added desktop adaptation/rendering and stream merging; added Agents team composer; added mock messages and tests.
- In-progress: None.
- Active files: shared runtime/tests, runtime kernel/driver/run-store/tests, desktop types/state/viewModel/runtimeClient/AssistantTurnCard/AgentsView.
- Next actions (top 3; exact file/function): none.
- Blockers/Risks: Component tests cover view model rather than full DOM interaction; browser mock includes representative agent messages for manual UI verification.
- Verification status: DONE; shared/runtime/desktop tests and typechecks passed; Vite dev server running on port 1421.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/Ora`, zsh, pnpm workspace.

### Commands run + outputs
- `git status --short` -> no output; worktree clean at task start.
- `pnpm --filter @ora/shared test -- contracts.test.ts` -> 1 file passed, 76 tests passed.
- `pnpm --filter @ora/shared build` -> passed.
- `pnpm --filter @ora/runtime typecheck` -> passed after shared build.
- `pnpm --filter @ora/runtime test -- runtime-integration.test.ts` -> 12 files passed, 190 tests passed.
- `pnpm install --filter @ora/desktop...` -> lockfile unchanged; restored desktop package vitest links.
- `pnpm --filter @ora/desktop test -- viewModel.test.ts` -> 4 files passed, 8 tests passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm --filter @ora/shared typecheck` -> passed.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `bash skills/long-task-protocol/scripts/todo_scan.sh` ->
  - `Binary file ./.ora/runtime.db matches`
  - Pre-existing TODO template hits in `skills/skill-creator/scripts/init_skill.py`
  - Pre-existing bundled/generated hits in `apps/desktop/src-tauri/resources/runtime-sidecar/...`
  - `Binary file ./apps/runtime/.ora/runtime.db matches`
  - No TODOs introduced in changed source files.
- `pnpm --filter @ora/shared test` -> 1 file passed, 76 tests passed.
- `pnpm --filter @ora/runtime test` -> 12 files passed, 190 tests passed.
- `pnpm --filter @ora/desktop test` -> 4 files passed, 9 tests passed.
- `pnpm --filter @ora/desktop typecheck` after Agent conversation full-view fix -> passed.
- `pnpm --filter @ora/desktop test` after Agent conversation full-view fix -> 4 files passed, 9 tests passed.
- `git diff --check` after Agent conversation full-view fix -> passed.
- `curl -I --max-time 2 http://127.0.0.1:1421/` -> HTTP 200.
- `pnpm --filter @ora/runtime typecheck` after full-content fix -> passed.
- `pnpm --filter @ora/desktop typecheck` after full-content fix -> passed.
- `pnpm --filter @ora/runtime test -- runtime-integration.test.ts` after full-content fix -> 12 files passed, 191 tests passed.
- `pnpm --filter @ora/desktop test -- viewModel.test.ts` after historical hydration fix -> 4 files passed, 9 tests passed.
- `git diff --check` after full-content fix -> passed.
- `pnpm --filter @ora/desktop test -- state.test.ts viewModel.test.ts` -> 4 files passed, 9 tests passed.
- `bash /Users/quintenchen/.codex/skills/check/scripts/run-tests.sh` -> root test script passed: shared 76 tests, runtime 190 tests, desktop 9 tests.
- `pnpm --filter @ora/desktop dev` -> failed because port 1420 was already in use.
- `pnpm --filter @ora/desktop exec vite --host 127.0.0.1 --port 1421` -> Vite ready at `http://127.0.0.1:1421/`.

### Changed Files
- `packages/shared/src/runtime.ts`
- `packages/shared/test/contracts.test.ts`
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/patterns/driver-registry.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/test/runtime-integration.test.ts`
- `apps/desktop/src/types.ts`
- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/lib/state.tsx`
- `apps/desktop/src/lib/state.test.ts`
- `apps/desktop/src/lib/viewModel.ts`
- `apps/desktop/src/lib/viewModel.test.ts`
- `apps/desktop/src/components/AssistantTurnCard.tsx`
- `apps/desktop/src/components/AgentsView.tsx`
- `tasks/TASK-20260426-2302-ora-agent-conversation-orchestration.md`
