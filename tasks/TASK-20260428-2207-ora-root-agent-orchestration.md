# TASK-20260428-2207-ora-root-agent-orchestration

**Created:** 2026-04-28 22:07 Asia/Shanghai
**Status:** Planned

---

## Goal
- Build a true root agent named `ora` for Ora. `ora` is the first agent that receives every user message, the initiator of Auto Mode Router decisions, the owner of user clarification, the user-facing observer during delegated work, and the final agent that responds back to the user after mode-internal work completes.
- Treat this task file as the single source of truth for the implementation. Chat summaries are non-authoritative once this file exists.

## Product Principle
- `ora` is not a mode and not a renamed `orchestrator`.
- `ora` is independent of ModeSpec orchestration. It sits above mode execution:
  - user -> `ora`
  - `ora` -> clarification if required
  - `ora` -> mode selection when Auto is enabled
  - `ora` -> optional Mode Lead or first worker/stage
  - while delegated work runs, `ora` remains an active user-facing observer and can post short visible observations at stage boundaries
  - Mode Lead / mode agents -> `ora`
  - `ora` -> final user-facing answer
- Existing mode-internal parent roles become optional **Mode Leads**:
  - complex modes may keep a professional lead, such as `orchestrator`, `team_lead`, `router`, or a shared-state seeding lead.
  - simple modes do not need a lead; `single_agent` is Ora-only.
  - Mode Lead is not the user relationship layer. It is a mode-scoped professional coordinator that returns work to Ora.
- The user selected the deeper product shape: `ora` should be a real conversation hub, not only an event label or UI marker.

## Current State
- Auto Mode Router currently lives in `apps/runtime/src/mode-selection.ts` as a provider call with system text `"You are Ora's agent mode router."`.
- Clarification preflight currently lives in `apps/runtime/src/harness/runtime-clarifications.ts` and is triggered from `apps/runtime/src/harness/runtime-kernel.ts` when `clarification_interrupt` and `clarificationPreflight` are enabled.
- Multi-agent execution currently runs inside one runtime/kernel/session context. Mode families add explicit communication records through `agentMessages`, `emitAgentMessage`, message bus events, shared state writes, and stage prompts.
- `single_agent` is currently implemented as `ModeSpec.id = "single_agent"`, `family = "orchestrator_subagent"`, one enabled `synthesize` node owned by `solo_agent`, and a single-owner topology of `run -> solo_agent`. In the new root-agent model this is conceptually wrong: `ora` itself is the single agent, so `solo_agent` should be removed or treated only as a legacy alias during migration.
- Built-in/custom agent management already has a catalog and override model:
  - system agent catalog: `apps/runtime/src/agent-catalog.ts`
  - system overrides: `.ora/agent-overrides`
  - custom agents: `.ora/agents/<name>/`
  - direct global override semantics are already established for built-in agents.
- There is a dirty worktree at task creation. This task must not revert or overwrite unrelated ongoing changes.

## Scope / Out of Scope

### In Scope
- Add `ora` as a first-class built-in system agent in the shared/runtime agent model.
- Make `ora` visible and manageable in the existing Agents page catalog path, using the current global system-agent override mechanism.
- Move Auto Mode Router behavior under `ora`'s entry decision responsibility while preserving existing evaluation metadata.
- Move clarification preflight ownership under `ora`, including pending clarification identity, event attribution, and progress attribution.
- Add runtime root-agent envelope behavior:
  - dynamic topology node for `ora`
  - `run -> ora` control edge
  - `ora -> optional Mode Lead / first worker` handoff edge or equivalent runtime edge
  - structured `agentMessages` showing `ora` handoff, active observations, and mode return
  - final user answer authored by `ora`
- Add user-visible Ora observer behavior during delegated modes:
  - observations appear in the main conversation while the run is active
  - observations trigger at stage boundaries, not continuous polling
  - observations are recorded in runtime state and Trails as evidence
- Preserve current ModeSpec schemas and mode editing behavior unless a schema change is strictly required.
- Add focused tests for catalog, router, clarification, topology, agentMessages, finalization, and Evaluation compatibility.

### Out of Scope
- Do not replace every mode-internal parent role with `ora`.
- Do not create a new coordination family.
- Do not make `ora` a ModeSpec node that Mode Studio users reorder or delete.
- Do not add a separate provider/model setting for `ora` in v1; reuse current run provider/model configuration.
- Do not redesign the Agents page beyond whatever is needed to show/manage `ora`.
- Do not implement direct user-to-subagent chat or manual @mention routing in this task.
- Do not implement long-term learning from routing decisions in this task.

## Constraints
- Simplicity:
  - Prefer a root-agent envelope around existing mode execution over reworking all mode families.
  - Keep the mode layer concrete: snapshots still persist the selected concrete `modeId` / `pattern`.
- Compatibility:
  - Existing manual mode runs should keep choosing the requested mode.
  - Existing Auto Router evaluation observations must remain readable.
  - Existing snapshots without `ora` metadata must still parse.
  - Existing built-in system agent overrides must keep working.
- Runtime truth:
  - If the UI shows `ora` as parent, runtime state must include structured evidence: topology, events, `agentMessages`, metadata, or output fields.
  - Do not fake `ora` only in desktop view models.
- Worktree safety:
  - Preserve existing dirty files.
  - Keep edits surgical and avoid unrelated formatting/refactors.

## Design Decisions

### Decision 1: `ora` is a root agent above modes
- Chosen: `ora` is outside ModeSpec and above every selected mode.
- Why: The user explicitly wants an independent main agent that承接所有用户对话的起点, including Auto Router and clarification, even when mode execution itself contains parent/subagent structures.
- Rejected alternative: rename `orchestrator`, `team_lead`, or `router` to `ora`.
- Tradeoff: Runtime envelope work is needed, but existing mode semantics stay stable.

### Decision 2: `ora` is a manageable system agent
- Chosen: expose `ora` through the existing system-agent catalog and override path.
- Why: Ora already treats built-in agents as first-class manageable entities; `ora` is more important than ordinary built-ins and should not be hidden.
- Rejected alternative: hard-code `ora` prompt only in router/clarification modules.
- Tradeoff: Catalog and reserved-id checks need to understand a global system agent that may not appear in any ModeSpec profile.

### Decision 3: Auto Router becomes an `ora` entry decision
- Chosen: keep `resolveModeSelection(...)` as the mode-resolution seam, but route the model prompt and metadata through `ora`.
- Why: It keeps the current start-run flow simple while making router authorship true.
- Rejected alternative: start the full runtime kernel before resolving mode.
- Tradeoff: `ora`'s entry call happens before the selected mode's kernel execution, so the implementation must deliberately bridge its decision metadata into the later snapshot.

### Decision 4: Clarification belongs to `ora`
- Chosen: intent clarification questions are generated and attributed as `ora`.
- Why: User clarification is part of the main assistant relationship, not an internal node's responsibility.
- Rejected alternative: leave clarification under `intent_guard` with only copy changes.
- Tradeoff: Pending clarification records and desktop labels may need small compatibility updates.

### Decision 5: Final response comes from `ora`
- Chosen: after mode execution returns structured output, call `ora` once to produce the final user-facing answer.
- Why: If `ora` is the user-facing parent, the mode should return work product to `ora`, not directly to the user.
- Rejected alternative: use the mode output directly and mark it as from `ora`.
- Tradeoff: Adds one model call per completed run. This is acceptable for the selected "true conversation hub" product shape.

### Decision 6: Root entry is one `ora` controller call, not separate router and clarification calls
- Chosen: introduce one root-entry controller that calls `ora` first for every run and returns a structured decision: `clarify`, `proceed`, or `route`.
- Why: The selected product intent says every user message first reaches `ora`. If router and clarification remain separate helpers, manual `single_agent` and manual multi-agent modes can still bypass the first Ora hop.
- Rejected alternative: only wrap Auto Router and clarification with `ora` labels.
- Tradeoff: Manual runs gain an entry call. This is the cost of making `ora` a real conversation hub instead of a metadata label.

### Decision 7: `single_agent` is Ora-only, not `ora -> solo_agent`
- Chosen: keep `single_agent` as the simplest selectable mode id / Auto fallback, but make its runtime owner `ora` itself. Remove `solo_agent` as a distinct future-facing system agent.
- Why: Once `ora` is the true root conversation agent, a separate Solo Agent is redundant and confusing. Single Agent should mean "Ora handles this directly without delegating to another mode-internal agent."
- Required code consequence: change the built-in `single_agent` preset, runtime topology, deterministic output, browser mock, and tests so `single_agent` uses `ora` directly. Existing `solo_agent` override ids should migrate or alias to `ora` for compatibility, but `solo_agent` should not remain visible as a first-class built-in agent.
- Tradeoff: This is a slightly larger migration than `ora -> solo_agent -> ora`, but the resulting mental model is much cleaner: `ora` is the only single-agent identity; other agents exist only when a multi-agent mode is selected.

### Decision 8: Mode Lead is optional and professional, not a mandatory second parent
- Chosen: complex modes may keep a Mode Lead, while simple modes and some peer patterns can skip it.
- Why: A Mode Lead is useful when the mode needs professional orchestration, worker assignment, bus routing, or shared-state seeding. It is not useful for Single Agent, and it should not be mechanically inserted into every mode.
- Rejected alternative: make Ora the only coordinator for all modes.
- Rejected alternative: preserve a visible three-layer hierarchy for every mode.
- Tradeoff: The runtime needs explicit per-mode lead rules, but the product mental model becomes cleaner: Ora is the front agent; Mode Lead is an optional specialist coordinator.

### Decision 9: Ora remains an active observer during delegated runs
- Chosen: after handoff to a Mode Lead or worker flow, Ora can publish short user-visible observations at stage boundaries.
- Why: This makes Ora feel present and close to the user instead of disappearing until the final handoff returns.
- Trigger cadence: stage-boundary based, including handoff accepted, key worker/stage completion, risk/blocker/clarification, and pre-return/final-return.
- Rejected alternative: continuous timed observation stream.
- Rejected alternative: Trails-only observation.
- Tradeoff: Adds model/event work and needs noise guards, but gives the desired "front agent watching with the user" experience.

## Target Runtime Flow

```text
User message
  |
  v
ora root-entry controller
  |-- if material ambiguity -> clarification.required from ora -> interrupted
  |
  |-- if modeSelection=auto -> select concrete modeId
  |
  |-- if modeSelection=manual -> proceed with requested concrete modeId
  |
  v
Create/execute selected mode run
  |-- if selected mode is single_agent -> Ora executes directly -> final assistant response
  |
  |-- otherwise:
  v
ora handoff message to optional Mode Lead or first worker
  |
  v
Mode internal orchestration
  |-- at stage boundaries -> Ora posts short user-visible observations
  |
  v
Mode output / artifacts / agent messages
  |
  v
ora finalizer
  |
  v
Final assistant response to user
```

## Data Model / Interfaces

### Shared constants and types
- Add a shared root-agent constant:
  - `ORA_ROOT_AGENT_ID = "ora"`
  - `ORA_ROOT_AGENT_LABEL = "Ora"`
- Add `ora` to reserved system agent checks so a custom agent cannot be created with the same id/name.
- Keep `ModeSpec` unchanged.
- Keep `CoordinationPatternSchema` unchanged.

### System agent catalog
- `buildAgentCatalog(...)` should include one global system agent item for `ora` independent of ordinary mode-profile discovery. `single_agent` may also reference `ora` directly or be special-cased as root-only, but catalog visibility must not depend on that preset.
- `ora` catalog shape:
  - `source: "system"`
  - `id: "ora"`
  - `label: "Ora"`
  - `role`: root conversation agent, auto-router initiator, clarification owner, handoff parent, final responder
  - `toolPolicyId`: use an existing broad/default policy if available
  - `toolIds`: same default mode tool ids unless a narrower default is already established by product policy
  - `skillIds`: empty by default
  - `memoryNamespaces`: `["session", "project"]` initially
  - `usages`: synthetic usages for "Global entry", "Auto Mode Router", "Clarification", "Final Response"
- `systemAgentOverlaysForMode(...)` alone is insufficient because `ora` is not mode-scoped. Add a separate root-agent overlay resolver or include `ora` in kernel options explicitly.

### Run metadata
- Add optional metadata under `RunConfig.metadata` without breaking existing schemas:
  - `oraEntry`: object containing `agentId`, `decision`, `status`, `selectedModeId`, `reason`, `clarificationQuestion`, and optional `handoffSummary`
  - `autoModeRouter.entryAgentId = "ora"` for Auto runs
- Preserve existing `metadata.autoModeRouter` fields:
  - `selectedModeId`
  - `confidence`
  - `reason`
  - `status`
  - `detail`
- Evaluation code should continue reading the old fields, with optional new `entryAgentId`.

### Root entry decision contract
- Add an internal parsed shape for the first `ora` call:
  - `decision`: `"clarify" | "proceed" | "route"`
  - `selectedModeId`: required for `route`, optional for `proceed`
  - `confidence`: number from 0 to 1 when routing
  - `reason`: short operator-readable reason
  - `handoffSummary`: compact instruction to pass to the selected mode parent
  - `clarificationQuestion`: required when `decision = "clarify"`
- Manual mode behavior:
  - `ora` may return `clarify` or `proceed`.
  - It must not override the manually selected mode unless the run config explicitly uses Auto.
- Auto mode behavior:
  - `ora` may return `clarify` or `route`.
  - low-confidence or invalid route falls back to `single_agent`, preserving existing Auto Router semantics.
- Compatibility:
  - continue writing `metadata.autoModeRouter` for Auto runs so existing Evaluation logic keeps working.
  - write `metadata.oraEntry` for both manual and Auto runs.

### Snapshot output
- Current readers use `snapshot.output.text` for the assistant response.
- New successful output should keep:
  - `text`: final `ora` response shown to the user
  - `modeOutput`: original selected-mode output before finalization for delegated modes; optional diagnostic root-output metadata for `single_agent`
  - `ora`: finalizer metadata, including `agentId`, handoff/return message ids, and optional finalizer stop reason
- Existing `assistantTextForRun(...)`, desktop view model, memory update, evaluation feedback, and Trails should continue to read `output.text`.

### Topology
- Dynamically inject `ora` into runtime snapshots, not ModeSpec:
  - node: `{ id: "ora", label: "Ora", kind: "agent", agentId: "ora" }`
  - edge: `{ id: "run-ora", source: "run", target: "ora", kind: "control", label: "entry" }`
  - edge from `ora` to selected mode parent, using kind `delegation` and label `handoff`
- Parent target rules:
  - if the selected mode is `single_agent`, there is no child parent target; the runtime topology is `run -> ora`
  - if the selected mode has a configured Mode Lead, target that lead
  - if the selected mode has no Mode Lead, target the first worker/stage owner
  - otherwise target the first non-run agent node
- Topology status should reflect:
  - `ora` running during entry/finalization
  - mode parent and internal nodes as existing code already does
  - `ora` done when final response completes
  - `ora` blocked when clarification interrupts

### Agent conversation messages
- Emit structured messages rather than UI-only labels:
  - `ora -> Mode Lead / first worker`: `kind: "handoff"`, content contains compact assignment/handoff from user request and selected mode reason
  - `Mode Lead / worker -> ora`: `kind: "reply"` or `handoff`, content contains the mode output summary
  - `ora` active observation: use `kind: "status"` for v1 unless a new `"observation"` kind is needed; content is user-visible and short
  - `single_agent` should not emit fake self-handoff messages; the assistant body and root-agent events are enough
  - optional `ora -> user` should remain the assistant turn output, not necessarily an `agentMessage`
- Message ids should use the existing `agentMessages` collection and `agent.message` event stream.
- Do not truncate stored `agentMessages.content`; truncation remains display-only.

### Ora active observation contract
- Observations are user-facing interim messages, not final answers.
- V1 should reuse structured runtime state:
  - `fromAgentId: "ora"`
  - `toAgentIds: []`
  - `kind: "status"` or new `"observation"` if UI needs a distinct visual treatment
  - `status: "done"`
  - `content`: one compact natural-language observation in the user's language
  - metadata should include `observedAgentId`, `observedNodeId`, and `basedOnSeq` when available
- Trigger points:
  - after delegated handoff is accepted
  - after a key stage or worker completes
  - when a stage blocks, degrades, asks clarification, or surfaces a material risk
  - before or when Mode Lead returns work to Ora
- Noise guard:
  - do not emit one observation per low-level event
  - cap observations per run or per stage family
  - do not claim final conclusions before Mode Lead returns

## Impact Inventory by Current Mode

### `single_agent`
- Current behavior:
  - Built-in `single_agent` is a single-owner `orchestrator_subagent` mode with one `respond` node owned by `solo_agent`.
  - Shared topology projection and runtime deterministic helpers collapse it to `run -> solo_agent`.
  - Runtime driver uses the direct-solo branch and tells the model to produce the final answer directly.
- Required future behavior:
  - Keep `single_agent` as a mode id and Auto fallback because it is still a useful execution strategy.
  - Remove `solo_agent` from future-facing built-in system agents.
  - Runtime topology becomes `run -> ora`, with no child handoff.
  - `ora` both executes and authors the final response for Single Agent mode.
  - `snapshot.output.text` is the direct Ora answer.
  - `snapshot.output.modeOutput` is optional for this mode; if present, it should be diagnostic metadata for the root execution, not a separate agent result.
  - Auto fallback to `single_agent` means "Ora handles this directly."
- Required code updates:
  - `createSingleAgentModeSpec()` should use `ora` as the profile/owner or be special-cased as a root-only mode; do not keep `solo_agent` as the visible owner.
  - `modeUsesSingleOwnerTopology(...)`, `primaryOwnerAgentId(...)`, deterministic `patternOutput(...)`, runtime mock snapshots, and browser fallback should map `single_agent` to `ora`.
  - `executeOrchestratorSubagent(...)` direct-solo path should either be bypassed for `single_agent` or run as `ora`, not as `solo_agent`.
  - `SYSTEM_AGENT_ID_ALIASES` should map old `solo_agent` overrides to `ora` during migration.
  - desktop labels should show `Ora`, not `Solo Agent`.
- Acceptance tests:
  - Manual Single Agent run has topology `run -> ora`.
  - No visible `solo_agent` appears in `profiles`, topology, active agents, or agent catalog after migration.
  - `snapshot.output.text` comes from `ora` directly.
  - Auto fallback to `single_agent` records `selectedModeId: "single_agent"` and `oraEntry.agentId: "ora"`.
  - a legacy `solo_agent` system override still affects `ora` or is migrated/reset through the alias path.

### `orchestrator_subagent`
- Current behavior:
  - `run -> orchestrator`, then orchestrator stages dispatch researcher/reviewer and synthesize.
- Required future behavior:
  - `ora` delegates the selected task to `orchestrator`.
  - `orchestrator` remains the optional professional Mode Lead.
  - while research/review stages complete, `ora` can post short observations to the user about what it is seeing.
  - final synthesis returns to `ora`, then `ora` responds to the user.
- Acceptance tests:
  - topology includes `run -> ora -> orchestrator`.
  - Ora observation appears after a meaningful stage boundary without replacing the final answer.
  - existing researcher/reviewer edges remain unchanged.
  - mode output is preserved separately from final `ora` response.

### `agent_teams`
- Current behavior:
  - `team_lead` triages, `builder` builds, `reviewer` checks, and `team_lead` records handoff.
- Required future behavior:
  - `ora` hands work to `team_lead`.
  - `team_lead` remains the optional professional Mode Lead and persistent-worker coordinator.
  - Ora can post stage-boundary observations after triage, build, check, or blocker events.
  - team handoff returns to `ora` before the user-facing response.
- Acceptance tests:
  - topology includes `run -> ora -> team_lead`.
  - Ora emits bounded visible observations during team execution.
  - builder/reviewer worker memory behavior is unchanged.
  - `ora` is not used as the worker memory namespace.

### `message_bus`
- Current behavior:
  - `router` publishes/routes events to topics, researcher handles, responder publishes response.
- Required future behavior:
  - `ora` hands the initial user request to the bus `router`.
  - `router` remains the optional professional Mode Lead for event routing; do not confuse it with Auto Mode Router.
  - Ora can observe routing and responder readiness at stage boundaries.
  - `responder` output returns to `ora`.
- Acceptance tests:
  - topology includes `run -> ora -> router`.
  - Ora observations do not inflate bus topic counts or masquerade as bus events.
  - bus stats and topic counts are unchanged.
  - Auto Mode Router metadata and message-bus `router` events remain distinguishable.

### `shared_state`
- Current behavior:
  - `orchestrator` seeds shared board, researcher/reviewer update/validate board.
- Required future behavior:
  - `ora` hands work to the shared-state seeding agent.
  - shared board remains mode-internal state, not root-agent memory.
  - the seeding agent is treated as a Mode Lead only for board initialization/convergence, not as the user-facing parent.
  - Ora can observe meaningful board updates or convergence risks.
  - convergence result returns to `ora`.
- Acceptance tests:
  - topology includes `run -> ora -> orchestrator`.
  - Ora observations reference board progress without hiding board evidence from Trails.
  - shared board writes still attribute to mode agents, not `ora`.
  - final `ora` response references the converged result without hiding board evidence from Trails.

### `generator_verifier`
- Current behavior:
  - `generator` drafts and `verifier` checks; there is no explicit parent agent.
- Required future behavior:
  - Do not add a Mode Lead by default.
  - Ora hands work to `generator`, observes verifier completion, then produces or wraps the final response.
  - If a future custom generator/verifier mode declares a lead, use that explicit lead; otherwise keep the peer pipeline simple.
- Acceptance tests:
  - topology includes `run -> ora -> generator -> verifier`.
  - no artificial `orchestrator` or `team_lead` appears.
  - Ora observation appears after verification result when the run is long enough or material enough.

### Mode Studio internal modes
- Current behavior:
  - Mode Studio builder uses internal agent-team mode and returns structured draft bundles.
- Required future behavior:
  - Do not route hidden/internal Mode Studio builder runs through the user-facing `ora` finalizer unless the run is surfaced as a normal chat turn.
  - If Mode Studio asks a user clarification, the visible clarification can still be attributed to `ora` only when the user-facing runtime path is used.
- Acceptance tests:
  - existing Mode Studio builder tests keep passing.
  - no extra `ora` final answer wraps structured Mode Studio draft JSON.

## Structural Impact Checklist

- Shared contracts:
  - Add root-agent constants and optional metadata only; avoid ModeSpec/family schema churn.
- Runtime start path:
  - `resolveModeSelection(...)` must evolve into or call a root-entry decision path, not remain a router-only helper.
- Runtime kernel:
  - inject `ora` topology before the initial `topology.updated` event where possible, so desktop does not briefly show a parentless mode graph.
  - finalizer must run after mode execution and before `run.done`.
  - observer messages must be emitted during execution and preserved in `agentMessages` / event stream.
- Prompting:
  - `ora` prompt owns entry, clarification, route/handoff, and final response.
  - `ora` observer prompt owns short stage-boundary observations and must not claim final conclusions early.
  - mode agents own execution only.
- Output consumers:
  - `assistantTextForRun(...)`, memory updates, evaluation output readers, desktop assistant body, and Trails should keep reading `output.text`.
  - diagnostic views can inspect `output.modeOutput`.
- Streaming:
  - decide whether `ora` finalizer streams as the final assistant body. If streaming is deferred, record that v1 streams mode progress/observations but final text appears at `run.done`.
- Continuation:
  - clarification/approval resume must preserve the root `ora` frame and not restart with a parentless mode run.
- Browser/mock runtime:
  - mock snapshots must inject `ora` topology and representative agentMessages, or desktop tests will diverge from real runtime.

## Implementation Plan

### Phase 0: Preparation and guardrails
1. Read current dirty diffs for files that will be touched:
   - shared capabilities/runtime contracts
   - runtime mode selection
   - runtime clarification/kernel
   - agent catalog/custom-agent reserved ids
   - desktop view model / Trails only if needed
2. Confirm whether the current continuation-runtime task changes the same files and avoid overwriting it.
3. Update this task file with a SAVEPOINT before broad edits.

### Phase 1: Add `ora` as a system agent
1. Add shared constants for the root agent.
2. Add `ora` to reserved system-agent id logic.
3. Update agent catalog construction to include a global `ora` item.
4. Ensure system-agent overrides can read/write/reset `ora` using existing RPCs.
5. Add shared/runtime tests:
   - catalog includes `ora`
   - `ora` has synthetic usages
   - custom agent creation rejects `ora`
   - override changes affect root-agent prompt context

### Phase 2: Root-agent prompt/context builder
1. Add a small runtime helper for root-agent context:
   - resolve root profile
   - apply system override
   - build root-agent system prompt
   - include workspace/memory/clarification context where relevant
2. Reuse `buildAgentPromptContext(...)` instead of introducing a parallel prompt format.
3. Keep root prompt sections deterministic and testable.
4. Add tests for override injection and section order if new helper is separately exported.

### Phase 3: `ora` root-entry controller and Auto Router compatibility
1. Add a root-entry helper that calls `ora` before mode execution and returns `clarify`, `proceed`, or `route`.
2. Refactor `routeAutoMode(...)` into this root-entry path or make it a compatibility wrapper around root-entry routing.
3. Add `entryAgentId: "ora"` to router metadata and `metadata.oraEntry` to all root-agent runs.
4. Preserve fallback behavior:
   - no candidates -> fallback
   - malformed output -> fallback
   - unknown mode -> fallback
   - confidence below threshold -> fallback
4. Keep `single_agent` as fallback when available.
5. Tests:
   - Auto success records `entryAgentId`
   - Auto fallback records `entryAgentId`
   - manual mode runs `ora` entry but does not override the selected mode
   - existing evaluation observation extraction still works

### Phase 4: `ora` clarification ownership
1. Route clarification decisions through root-entry `ora` rather than a separate hidden clarification preflight.
2. Replace `intent_guard` visible identity with `ora` ownership while preserving stable clarification keys if needed for resume compatibility.
3. Ensure `pendingClarifications` show:
   - `nodeId: "ora"` or compatible root clarification node id
   - `nodeLabel: "Ora"`
   - question from `ora` prompt
4. Ensure `clarification.required` and `clarification.resolved` events are attributed to `ora`.
5. Ensure resume path reads both previous `intent_guard` ids and new `ora` ids if needed for compatibility.
6. Tests:
   - ambiguous request interrupts with `ora` pending clarification
   - answer resumes without repeating clarification
   - clarification context is injected into later mode/finalizer prompt

### Phase 5: Runtime root-agent envelope and optional Mode Lead
1. Add runtime helper to inject `ora` into snapshot topology after concrete mode resolution.
2. Add helper to compute selected mode target:
   - `single_agent`: no target, Ora-only
   - explicit/known Mode Lead modes: target lead
   - peer modes: target first worker/stage owner
3. Before mode execution, emit `ora` handoff:
   - topology update
   - `agent.message`
   - progress narration if current UX expects one
4. Execute existing delegated modes unchanged; special-case `single_agent` as Ora-only root execution.
5. After delegated mode execution, emit return-to-`ora` message.
6. Tests:
   - `agent_teams` topology contains `run -> ora -> team_lead`
   - `orchestrator_subagent` topology contains `run -> ora -> orchestrator`
   - `message_bus` topology contains `run -> ora -> router`
   - `generator_verifier` topology contains `run -> ora -> generator -> verifier` without an extra lead
   - `single_agent` topology contains `run -> ora` and no `solo_agent`
   - multi-agent modes include `ora` handoff and return messages
   - `single_agent` does not fabricate a handoff to itself

### Phase 6: Ora active observer
1. Add a stage-boundary observer helper that emits user-visible Ora observations during delegated runs.
2. Trigger observations on:
   - delegated handoff accepted
   - key stage/worker completion
   - blocker/degradation/clarification/material risk
   - pre-return or return-to-Ora
3. Reuse `agentMessages` with `fromAgentId: "ora"` and `kind: "status"` unless a distinct observation kind is required by UI tests.
4. Render observations in the active assistant turn as lightweight interim Ora messages.
5. Keep noise bounded:
   - no per-low-level-event observations
   - no repeated observations with the same observed node and phase
   - no final-answer claims before return-to-Ora
6. Tests:
   - Agent Teams emits Ora observations after triage/build/check boundaries without flooding.
   - Orchestrator mode emits observations after research/review boundaries.
   - Generator/Verifier emits an observation after verifier result when appropriate.
   - Single Agent emits no fake observer handoff.

### Phase 7: `ora` finalizer
1. Add finalizer provider call after `executeModeSpec(...)` succeeds.
2. Finalizer input includes:
   - original user prompt
   - resolved clarifications
   - selected mode id/label/family
   - mode output
   - relevant artifacts / agentMessages summaries
   - instruction to answer as Ora without exposing hidden chain or internal-only metadata
3. Finalizer output becomes `snapshot.output.text`.
4. Preserve original mode output under `snapshot.output.modeOutput`.
5. Failure behavior:
   - if finalizer fails, fall back to mode output text and record `ora.finalizer.status = "fallback"`
   - do not fail an otherwise successful run solely because finalizer JSON/text parse failed
6. Tests:
   - successful finalizer replaces final text
   - finalizer failure falls back to mode output
   - memory/evaluation/session title readers still see final user-facing text
   - `single_agent` can skip the extra finalizer if the root `ora` execution already produced the final answer; if it does not skip, it must not call a second agent identity

### Phase 8: Desktop and Trails polish
1. Verify existing desktop view model can display injected `ora` topology without special casing.
2. Add label mapping if `ora` appears as raw lowercase in agent timelines.
3. Ensure Agents page shows `Ora` in system agents and allows existing override/reset flows.
4. Ensure Trails topology and agent flow show `Ora` as the parent entry and records active observations.
5. Add or update desktop tests only where behavior changes:
   - view model labels
   - trail agent flow labels
   - observer message rendering
   - agent catalog browser fallback if needed

### Phase 9: Evaluation and regression protection
1. Preserve `auto_router_quality` observation paths.
2. Add objective observation fields only if useful:
   - `runtime.oraEntry.status`
   - `runtime.oraEntry.selectedModeId`
   - `runtime.oraEntry.reason`
3. Re-run focused auto router tests.
4. Avoid broad evaluation schema rewrites unless required by type checks.

## Active Files
- `/Users/quintenchen/developer/ora/tasks/TASK-20260428-2207-ora-root-agent-orchestration.md`
- `/Users/quintenchen/developer/ora/packages/shared/src/capabilities.ts`
- `/Users/quintenchen/developer/ora/packages/shared/src/runtime.ts`
- `/Users/quintenchen/developer/ora/packages/shared/src/modes.ts`
- `/Users/quintenchen/developer/ora/packages/shared/src/primitives.ts`
- `/Users/quintenchen/developer/ora/packages/shared/test/contracts.test.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/agent-catalog.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/custom-agents.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/mode-selection.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/harness/prompt-context.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/harness/runtime-progress.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/harness/runtime-clarifications.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/harness/runtime-kernel.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/harness/runtime-pattern-context.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/patterns/execution-context.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/patterns/driver-registry.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/run-kernel-lifecycle.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/run-store.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/src/evaluation-store.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/test/runtime-smoke.test.ts`
- `/Users/quintenchen/developer/ora/apps/runtime/test/custom-agents.test.ts`
- `/Users/quintenchen/developer/ora/apps/desktop/src/lib/runtimeClient.ts`
- `/Users/quintenchen/developer/ora/apps/desktop/src/lib/viewModel.ts`
- `/Users/quintenchen/developer/ora/apps/desktop/src/lib/trailViewModel.ts`
- `/Users/quintenchen/developer/ora/apps/desktop/src/components/AgentsView.tsx`
- `/Users/quintenchen/developer/ora/apps/desktop/src/components/AssistantTurnCard.tsx`

## Open Issues
- The implementation must be coordinated with the existing dirty worktree, especially current changes in runtime continuation files.
- The exact finalizer prompt should be kept compact and tested for fallback behavior; do not overbuild a new final-answer schema unless tests show plain text is insufficient.
- The exact synthetic usage labels for `ora` may need minor Chinese/English UI copy alignment in desktop, but the runtime meaning is fixed.

## Task Checklist
- [ ] Phase 0: inspect dirty diffs and create SAVEPOINT.
- [ ] Phase 1: add `ora` as first-class system agent.
- [ ] Phase 2: add root-agent prompt/context helper.
- [ ] Phase 3: move Auto Router authorship under `ora`.
- [ ] Phase 4: move clarification ownership under `ora`.
- [ ] Phase 5: add root-agent runtime envelope and handoff messages.
- [ ] Phase 6: add user-visible Ora active observer messages.
- [ ] Phase 7: add `ora` finalizer and output preservation.
- [ ] Phase 8: verify desktop/Trails/Agents page surfaces.
- [ ] Phase 9: preserve evaluation observations and add regression coverage.
- [ ] Run focused verification and update this journal.
- [ ] Extract retrospective before marking Done.

## Checkpoints

### Checkpoint 1: System agent identity
- Requirement: `ora` is a first-class built-in system agent, visible in the catalog and protected from custom-agent name collision.
- Verification method: shared/runtime tests and catalog smoke.
- Pass criteria:
  - `agents.catalog` returns `ora`.
  - `ora` shows synthetic global usages.
  - `agents.updateSystemOverride` and reset work for `ora`.
  - creating custom agent `ora` is rejected.
- Status: Not started.

### Checkpoint 2: Entry decision
- Requirement: Auto Mode Router is initiated by `ora` and preserves existing routing behavior.
- Verification method: runtime tests around `resolveModeSelection(...)` and evaluation observation extraction.
- Pass criteria:
  - Auto selected metadata includes `entryAgentId: "ora"`.
  - fallback metadata includes `entryAgentId: "ora"`.
  - old `runtime.autoModeRouter.*` observation paths still work.
- Status: Not started.

### Checkpoint 3: Clarification ownership
- Requirement: user clarification is asked by `ora`, not by a hidden guard node.
- Verification method: runtime clarification interrupt/resume tests.
- Pass criteria:
  - pending clarification is attributed to `ora`.
  - `clarification.required` event carries `ora` context.
  - resume answer continues the same run without repeating the question.
- Status: Not started.

### Checkpoint 4: Runtime handoff evidence
- Requirement: every delegated mode has structured evidence that `ora` handed work to the optional Mode Lead or first worker, observed progress, and received the result back.
- Verification method: runtime snapshot tests over representative modes.
- Pass criteria:
  - complex modes include `run -> ora -> Mode Lead`.
  - peer modes include `run -> ora -> first worker` without inventing a Mode Lead.
  - `single_agent` is `run -> ora` and has no handoff.
  - `agentMessages` include Ora handoff for delegated modes.
  - return-to-`ora` message is recorded before final output.
- Status: Not started.

### Checkpoint 5: Ora active observer
- Requirement: Ora posts bounded user-visible observations during delegated mode execution.
- Verification method: runtime and desktop tests over representative long-running/delegated modes.
- Pass criteria:
  - observations are authored by `ora` and visible in the active assistant turn.
  - observations are stage-boundary based, not emitted for every low-level event.
  - observations are recorded in Trails/runtime state.
  - observations do not claim final conclusions before Mode Lead / worker flow returns.
  - `single_agent` emits no fake observer handoff.
- Status: Not started.

### Checkpoint 6: Final user answer
- Requirement: successful runs answer the user through `ora`, while retaining original mode output for inspection.
- Verification method: runtime finalizer tests plus desktop/session/evaluation reader checks.
- Pass criteria:
  - `snapshot.output.text` is final `ora` answer.
  - `snapshot.output.modeOutput` contains original mode output.
  - finalizer failure falls back safely.
- Status: Not started.

### Checkpoint 7: Desktop product surface
- Requirement: Agents, Trails, topology, and assistant turns represent `Ora` coherently.
- Verification method: desktop typecheck/tests and, if needed, browser/manual visual smoke.
- Pass criteria:
  - Agents page shows manageable `Ora`.
  - Trails graph shows `Ora` as parent entry.
  - active observations render as lightweight Ora-authored interim messages.
  - assistant turn agent timeline labels `Ora` correctly.
- Status: Not started.

## Verification Plan

### Code verification commands
- `pnpm --filter @ora/shared build`
- `pnpm --filter @ora/shared typecheck`
- `pnpm --filter @ora/runtime typecheck`
- `pnpm --filter @ora/desktop typecheck`
- `pnpm --filter @ora/shared test -- contracts.test.ts`
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts custom-agents.test.ts`
- Add any new targeted tests by file name once implemented.

### Functional verification scenarios
- Manual `single_agent` run:
  - `ora` asks no unnecessary clarification.
  - topology is `run -> ora`.
  - no visible `solo_agent` appears in profiles, topology, active agents, agent timeline, or catalog.
  - final answer comes directly from `ora`.
- Auto mode run:
  - `ora` selects a concrete mode or falls back.
  - selected mode executes normally.
  - evaluation metadata remains compatible.
- Ambiguous request:
  - `ora` asks the clarification.
  - resume answer is injected into the later mode and finalizer context.
- Agent Teams run:
  - `ora` hands off to `team_lead` as Mode Lead.
  - `ora` posts bounded observations after triage/build/check stage boundaries.
  - builder/reviewer messages remain mode-internal.
  - mode returns to `ora`.
- Orchestrator run:
  - `ora` hands off to `orchestrator` as Mode Lead.
  - `ora` posts observations after research/review stage boundaries.
  - final synthesis returns to `ora`.
- Generator/Verifier run:
  - no Mode Lead is invented.
  - `ora` hands off to `generator`, observes verifier result when appropriate, and finalizes.
- Router failure:
  - fallback mode is used.
  - `ora` metadata records fallback.
- Finalizer failure:
  - run still succeeds with mode output fallback and recorded finalizer fallback metadata.

### TODO scan
- Before DONE, run the long-task TODO scan or a file-scoped fallback if the repo-wide scan is noisy.
- Any remaining actionable TODO must be mirrored in Open Issues as `TODO(FOLLOWUP)`.

## Comparison

### Reference 1: Auto Mode Router
- Source: `tasks/TASK-20260426-0101-ora-auto-agent-mode-router.md`
- Compared points:
  - Auto remains a run selection strategy, not a ModeSpec.
  - Router metadata remains under `config.metadata.autoModeRouter`.
  - Fallback stays deterministic.
- Expected difference:
  - Router authorship and prompt context move under `ora`.

### Reference 2: Agent Conversation Orchestration
- Source: `tasks/TASK-20260426-2302-ora-agent-conversation-orchestration.md`
- Compared points:
  - Structured `agentMessages` are the source of truth for collaboration.
  - Stored message content must not be truncated.
  - UI should read runtime state, not infer fake collaboration.
- Expected difference:
  - `ora` adds a universal front-agent envelope above mode-specific collaboration, plus user-visible stage-boundary observations.

### Reference 3: Canonical System Agents
- Source: `tasks/TASK-20260428-1320-canonical-system-agents.md`
- Compared points:
  - Built-in agents are first-class catalog items.
  - Global same-id override semantics are preserved.
  - Custom agents cannot collide with reserved system ids.
- Expected difference:
  - `ora` is global and synthetic rather than derived from ModeSpec profiles.

## Risks
- Risk: Adding a finalizer model call increases latency and cost.
  - Mitigation: Only one finalizer call; use existing run provider/model; fallback to mode output on failure.
- Risk: Active observations can become noisy or feel like premature conclusions.
  - Mitigation: trigger only at stage boundaries, cap observations, and forbid final-answer claims before return-to-Ora.
- Risk: Injecting `ora` topology dynamically could desync Mode Studio topology.
  - Mitigation: Keep ModeSpec unchanged and inject only runtime snapshot topology.
- Risk: Current continuation-runtime changes may overlap with kernel resume paths.
  - Mitigation: inspect dirty diffs before editing; preserve continuation state handling.
- Risk: Evaluation code may assume router metadata shape.
  - Mitigation: keep existing `autoModeRouter` fields and add only optional fields.
- Risk: Existing clarification resume keys may depend on `intent_guard`.
  - Mitigation: support old and new keys during resume transition.

## Retrospective
- Not started. Fill before marking Done.

## Progress Log
- 2026-04-28 22:07 CST - Created detailed plan task for root `ora` agent orchestration. No runtime code changed.
  Next: inspect dirty diffs in overlapping runtime files; create SAVEPOINT; implement Phase 1 system-agent identity.
- 2026-04-28 22:20 CST - Re-reviewed structural impact and found the initial plan was not specific enough for current mode semantics, especially `single_agent`. Added root-entry controller decision, per-mode impact inventory, an initial `ora -> solo_agent -> ora` interpretation, structural impact checklist, and updated Phase 3/4 implementation details. This `single_agent` interpretation was superseded by the 22:30 correction below. No runtime code changed.
  Next: inspect dirty diffs in overlapping runtime files; create SAVEPOINT; implement Phase 1 system-agent identity.
- 2026-04-28 22:30 CST - User corrected the Single Agent semantics: in the new root-agent context, Ora itself is the single agent and `solo_agent` is no longer logically needed. Updated the plan so `single_agent` remains a selectable mode id / Auto fallback, but runtime ownership becomes Ora-only (`run -> ora`), with `solo_agent` kept only as a legacy alias/migration concern. No runtime code changed.
  Next: inspect dirty diffs in overlapping runtime files; create SAVEPOINT; implement Phase 1 system-agent identity and remove future-facing `solo_agent` exposure in the Single Agent path.
- 2026-04-28 22:45 CST - Added the latest plan: complex modes may keep optional professional Mode Leads, while Ora remains active after handoff by posting short user-visible observations at stage boundaries. Updated flow, data contracts, mode inventory, phases, checkpoints, verification scenarios, risks, and compressed state. No runtime code changed.
  Next: inspect dirty diffs in overlapping runtime files; create SAVEPOINT; implement Phase 1 system-agent identity, Mode Lead mapping, and observer state shape.

## Compressed State (<= 20 lines)
- Objective: Make `ora` the true root agent for all user conversations, Auto Router, clarification, mode handoff, and final response.
- Status: Planned only; no implementation yet.
- Key decisions: `ora` is the user-facing root agent; a root-entry controller calls `ora` first for every run; `single_agent` means Ora-only direct execution (`run -> ora`); complex modes may keep optional professional Mode Leads; Ora posts bounded user-visible observations during delegated runs; Ora owns final output.
- Active task file: `/Users/quintenchen/developer/ora/tasks/TASK-20260428-2207-ora-root-agent-orchestration.md`.
- Current repo state: dirty worktree exists; do not revert unrelated changes.
- Next actions (top 3; exact file/function): inspect dirty diffs in overlapping files; add `ORA_ROOT_AGENT_ID` and catalog item; define Mode Lead mapping + Ora observer message shape before runtime edits.
- Blockers/Risks: coordination with current continuation-runtime edits; finalizer and observer latency/cost; clarification key compatibility; `solo_agent` override/profile/topology compatibility needs alias or migration to `ora`; observations need strict noise guards.
- Verification status: Not started.

## Verification

### Evidence Requirements
Must provide the following evidence before DONE:
- [ ] Code Verification output.
- [ ] Functional Verification output.
- [ ] TODO scan output.
- [ ] Checkpoint evidence.
- [ ] Retrospective evidence.

### Environment
- Environment: `/Users/quintenchen/developer/ora`, zsh, 2026-04-28 Asia/Shanghai.

### Commands run + outputs
- `git status --short`
  - Dirty worktree exists at task creation, including runtime continuation files, desktop files, shared runtime contracts, and `tasks/TASK-20260428-2121-ora-continuation-runtime.md`.
- `rg --files tasks | sort | tail -n 40`
  - Confirmed existing task naming and recent related tasks.
- `rg -n "主 agent|Ora 主|ora.*agent|唯一真相源|auto.*router|clarification|handoff" tasks packages/shared/src apps/runtime/src | head -n 240`
  - Confirmed existing router, clarification, handoff, and relevant historical task references.
- `rg -n "createSingleAgentModeSpec|single_agent|solo_agent|modeUsesSingleOwner|primaryOwnerAgentId|directSoloResponse" packages/shared/src/modes.ts apps/runtime/src/patterns/driver-registry.ts apps/runtime/src/run-snapshots.ts apps/runtime/src/run-deterministic-patterns.ts apps/desktop/src/lib/runtimeClient.ts apps/desktop/src/lib/viewModel.ts`
  - Confirmed `single_agent` is a single-owner `orchestrator_subagent` mode owned by `solo_agent`, with runtime direct-solo prompt semantics.
- `git diff --check -- tasks/TASK-20260428-2207-ora-root-agent-orchestration.md`
  - Passed after impact-inventory update.
- `rg -n "emitProgressNarration|task.progress|chat_progress|agent.message|message.delta|run.done|activeAgents|AgentConversationTimeline|status" apps/runtime/src/harness apps/runtime/src/patterns apps/desktop/src/lib/viewModel.ts apps/desktop/src/components/AssistantTurnCard.tsx`
  - Confirmed existing progress and agent-message channels; new Ora observations should be structured agent-authored messages, not generic progress narration.
