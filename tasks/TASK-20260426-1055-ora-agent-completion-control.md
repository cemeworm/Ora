# TASK-20260426-1055-ora-agent-completion-control

**Created:** 2026-04-26 10:55 CST
**Status:** Verified

---

## Goal
- Fix Ora agent runs that keep doing unnecessary analysis, reasoning, and tool calls after enough information has already been gathered.
- Create a unified completion-control mechanism so run-level budgets, mode stop policies, provider tool calls, repeated tools, and final answer emission all agree on when to stop.
- Preserve useful multi-step behavior for genuinely complex tasks while making simple or already-satisfied tasks terminate decisively.

## Why This Matters
- Users currently see too many steps in one turn: repeated `web.search`, repeated tool repair / tool loops, repeated verifier attempts, and multiple intermediate assistant bodies before checkpoint.
- The runtime has several local stopping mechanisms, but no single run-level controller that decides "the task is complete; do not analyze or call tools again."
- This makes Ora feel less reliable, wastes provider/search budget, and obscures the final answer behind unnecessary process noise.

## Current Evidence
- `apps/runtime/src/harness/runtime-kernel.ts`
  - Runtime tool loop uses fixed `RUNTIME_TOOL_LOOP_LIMIT = 4`.
  - `config.budget.maxToolCalls` exists but is not the primary run-level counter for the tool loop.
  - Each `callAgent` gets its own tool loop, so total run tool calls can exceed the apparent budget.
  - After a tool result, the next provider call again uses `toolChoice: "auto"` whenever native tools exist.
- `apps/runtime/src/patterns/driver-registry.ts`
  - Generator-Verifier stops on verifier `pass` or `modeSpec.stopPolicy.maxIterations`, but the verifier/generator calls themselves can each run tool loops.
  - `single_agent` still uses a multi-node `decompose -> synthesize` flow, so even simple tasks can become two provider invocations.
- `packages/shared/src/index.ts`
  - Default modes automatically include `web.fetch`, `web.search`, `skills.list`, and `skills.get`.
  - Default resource budgets define `maxToolCalls`, but runtime behavior is not fully governed by that field.
- `apps/desktop/src/lib/useRunActions.ts`
  - Desktop run creation re-adds default web tools and project-safe tools, making network/local tools available on ordinary chat turns.
- `apps/runtime/src/harness/runtime-tool-executor.ts`
  - Tool prompt asks the model to answer normally after a tool result "unless another tool call is required"; this is advisory, not enforced.
  - JSON fallback extraction stops only when model text is not parseable as a tool call.

## Root Cause
- Ora lacks a unified run-level completion controller. Mode stop policy, resource budget, provider finish reason, tool-loop limit, repeated-tool detection, and final answer readiness are separate mechanisms, so the model can keep requesting tools until a local loop bound is exhausted instead of stopping when the task is effectively complete.

## Scope / Out of Scope
- In scope:
  - Enforce run-level `maxToolCalls` across all nodes and agents in one run.
  - Add repeated-tool detection for semantically identical tool calls.
  - Add a post-tool "answer now" / `toolChoice: "none"` path when enough information has been gathered or budget is near exhaustion.
  - Add final-answer readiness rules that prevent intermediate analysis/tool output from being treated as final.
  - Reduce unnecessary default steps for simple Single Agent tasks where possible.
  - Add observability so Trails explains why a run stopped.
- Out of scope:
  - Removing provider-native tool calling.
  - Removing JSON fallback tool calls.
  - Rebuilding the whole mode editor UX.
  - Changing search provider implementations beyond repeated-call/cache behavior.
  - Repackaging sidecar artifacts unless the implementation changes packaged runtime files.

## Architecture Decisions
- Decision: introduce a run-level completion controller inside the runtime kernel rather than scattering more prompts across modes.
  - It should own tool-call budget, repeated-tool policy, forced-final-answer mode, and stop reasons.
  - It should emit structured lifecycle evidence into events/snapshots for Trails.
- Decision: keep mode stop policies, but treat them as one input to the controller, not the only stop condition.
  - Generator-Verifier still owns verifier pass/fail.
  - The run controller decides when further tools are disallowed or wasteful.
- Decision: default to conservative stopping.
  - If repeated tool calls or budget pressure happen, force a final answer from existing context instead of letting the model search indefinitely.
  - Do not fake success: if the answer is incomplete because budget stopped the run, surface that clearly.

## Target Behavior
- Simple chat / project questions:
  - Prefer one final answer pass.
  - Do not run web search unless the model asks for it and the task plausibly needs fresh/external info.
- Tool-using tasks:
  - Execute needed tools, but count every tool attempt against a run-level budget.
  - Repeated same-tool/same-args calls return cached results or are blocked with a model-visible "already available" result.
  - After repeated calls or budget pressure, call the provider with `toolChoice: "none"` and instruct it to answer from available context.
- Generator-Verifier:
  - Stop early when verifier passes.
  - If verifier repeatedly fails due parse/format/tool loops rather than substantive missing requirements, stop with a clear `verification_failed` output instead of continuing unnecessary tool calls.
- UI/Trails:
  - Show stop reason: `completed`, `tool_budget_exhausted`, `repeated_tool_blocked`, `verification_passed`, `verification_exhausted`, or `forced_final_answer`.
  - Keep process steps visible, but only show final answer from `snapshot.output.text` / final message semantics.

## Implementation Plan

### Phase 1: Completion Controller Skeleton
- Add a small controller inside `executeRuntimeKernel` that tracks:
  - run-level tool attempts;
  - successful tool calls;
  - repeated tool keys;
  - per-agent/tool loop iterations;
  - current stop reason.
- Replace fixed-only loop behavior with `min(RUNTIME_TOOL_LOOP_LIMIT, remainingRunToolBudget)` for each `callAgent`.
- Use `config.budget.maxToolCalls` as the authoritative run-level maximum.
- Emit a structured event when the controller blocks or forces finalization, for example `run.done` metadata or a new process event if schema expansion is chosen.

### Phase 2: Repeated Tool Policy
- Define stable tool keys:
  - `web.fetch`: normalized URL.
  - `web.search`: normalized query plus effective limit/provider.
  - file tools: tool id plus normalized path/pattern.
  - skill tools: tool id plus normalized name/query.
- On duplicate:
  - return cached result when available;
  - otherwise emit a blocked/degraded result that tells the model the call was already attempted.
- Add tests proving repeated `web.search` and `web.fetch` do not hit external providers twice inside one run.

### Phase 3: Forced Final Answer Path
- After any of these conditions, make the next provider call with `toolChoice: "none"`:
  - run-level tool budget exhausted;
  - duplicate tool attempted more than once;
  - provider returned a tool call immediately after receiving the same tool result;
  - verifier/tool loop is failing due format or repair rather than new evidence.
- System instruction for forced final answer:
  - "Do not call tools. Use available context. State any uncertainty or missing evidence briefly."
- Persist forced-final status in output metadata so Trails can explain it.

### Phase 4: Mode-Level Step Reduction
- For `single_agent`, consider a direct respond node for simple tasks or allow skipping `decompose` when the prompt is already answerable.
- Keep current multi-node flow for complex/project tasks unless auto-router or mode config selects direct response.
- Add focused tests ensuring simple prompts do not always create unnecessary decompose/research/review steps.

### Phase 5: Observability And Docs
- Add Trails copy for stop reasons and repeated-tool blocks.
- Update task/report export fields if they already summarize run metrics.
- Document the completion-control contract in this task and any relevant runtime comments.

## Checkpoints

### Checkpoint 1: Budget Enforcement
- Requirement: total tool attempts across all nodes in one run never exceed `config.budget.maxToolCalls`.
- Verification: runtime smoke test with multiple nodes repeatedly requesting tools.
- Pass criteria: snapshot tool-call count and tool events are capped; final output records a budget stop reason.

### Checkpoint 2: Repeated Tool Guard
- Requirement: identical `web.search` / `web.fetch` calls do not repeatedly hit external providers inside one run.
- Verification: mocked fetch/search providers with call counters.
- Pass criteria: external call count is 1; runtime still emits process evidence for cache/block behavior.

### Checkpoint 3: Forced Final Answer
- Requirement: after budget pressure or repeated tool loops, runtime performs one final no-tools provider call.
- Verification: mocked provider first requests repeated tools, then receives `toolChoice: "none"`.
- Pass criteria: final `snapshot.output.text` is present and no further tool calls execute after forced finalization.

### Checkpoint 4: Generator-Verifier Termination
- Requirement: verifier pass stops immediately; repeated verifier/tool failures stop with a clear exhausted state.
- Verification: mocked verifier responses for pass, parse fail, and repeated tool request.
- Pass criteria: no unnecessary attempts beyond policy; output metadata identifies pass or exhaustion reason.

### Checkpoint 5: Desktop/Trails Clarity
- Requirement: UI shows final answer only from final output and displays why a run stopped.
- Verification: desktop view-model tests.
- Pass criteria: intermediate `message.delta` does not replace final body; stop reason appears in process steps or anomalies.

### Checkpoint 6: No Broad Regression
- Requirement: existing provider-native tools, JSON fallback tools, dangling repair, sessions, and checkpoint tests still pass.
- Verification:
  - `pnpm --filter @ora/runtime test`
  - `pnpm --filter @ora/runtime typecheck`
  - `pnpm --filter @ora/desktop typecheck`
- Pass criteria: all pass or any unrelated pre-existing failures are documented.

## Active Files Expected
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/harness/runtime-tool-executor.ts`
- `apps/runtime/src/patterns/driver-registry.ts`
- `apps/runtime/src/run-store.ts`
- `apps/desktop/src/lib/viewModel.ts`
- `apps/desktop/src/components/TrailsTabs.tsx`
- `packages/shared/src/modes.ts`
- `packages/shared/src/index.ts` only if new event/output schema fields are required.
- Tests:
  - `apps/runtime/test/runtime-smoke.test.ts`
  - `apps/runtime/test/desktop-composer-state.test.ts`
  - provider tests if `toolChoice: "none"` request shape needs coverage.

## Current Worktree Notes
- There are existing uncommitted changes touching runtime, desktop state/view-model, and tests.
- Some partial mitigations may already exist in the working tree:
  - `web.search` / `web.fetch` cache-key behavior.
  - UI changes around pending runs and in-progress `message.delta`.
  - native tool-call history filtering.
- Before implementing this task, inspect current diffs and avoid reverting unrelated user or previous-agent changes.

## Test Plan
- Unit / contract:
  - Shared schema tests only if schema changes.
  - Provider request tests for `toolChoice: "none"` when tools are present.
- Runtime:
  - repeated `web.search`;
  - repeated `web.fetch`;
  - budget exhausted across multiple mode nodes;
  - forced final answer after repeated tool requests;
  - Generator-Verifier pass and exhaustion paths.
- Desktop:
  - in-progress deltas remain process state;
  - final output renders as assistant body;
  - stop reasons appear in turn steps/anomalies.

## Verification
- `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts -t "multi-skill install|enforces maxToolCalls"` -> PASS, 2 passed / 43 skipped.
- `pnpm --filter @ora/shared test -- contracts.test.ts` -> PASS, 76 tests.
- `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts` -> PASS, 45 tests.
- `pnpm --filter @ora/runtime typecheck` -> PASS.
- `pnpm --filter @ora/desktop typecheck` -> PASS.
- `pnpm --filter @ora/runtime exec vitest run test/desktop-composer-state.test.ts` -> PASS, 24 tests.
- `pnpm --filter @ora/runtime package:sidecar` -> PASS, refreshed `apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs`.
- `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task /Users/quintenchen/developer/ora/tasks/TASK-20260426-1055-ora-agent-completion-control.md` -> PASS, no blocking TODO matches and no blocking task-journal TODO entries.

## Open Issues
- Resolved in this pass: use `node.updated` for node runtime loop state and keep `completion.updated` for stop-control details.
- Resolved in this pass: existing `single_agent` now defaults to a single `respond` node instead of adding another preset.
- Whether default web tools should remain enabled for all modes or be opt-in for non-research tasks.
- Forced-final no-tool native calls and standalone JSON fallback tool-call text are both coerced through final-answer repair. The runtime must not execute the rejected tool intent or render raw tool JSON as the assistant answer.

## Progress Log
- 2026-04-26 19:42 CST - Traced `session-0015 / run-0022`. The Waza install flow fetched the repo, README, 8 `SKILL.md` files, and completed 7 `skills.checkName` calls before the continuation after `skills.checkName(name="read")` failed with DeepSeek 400: `reasoning_content` in thinking mode must be passed back. Root cause: OpenAI-compatible chat serialization only emitted `reasoning_content` for assistant tool-call messages when `reasoningContent.trim()` was non-empty, so an empty-but-present DeepSeek thinking field could be dropped even though DeepSeek requires the field to be passed back for tool-call thinking turns. Patched serialization to preserve `reasoning_content` whenever it is defined and added provider regression coverage for the empty-string case.
  Verification: `pnpm --filter @ora/runtime exec vitest run test/providers/provider-registry.test.ts -t "reasoning_content"` passed; `pnpm --filter @ora/runtime exec vitest run test/providers/provider-registry.test.ts` passed 22 tests.
  Residual: `run-0022` was still marked `succeeded` after recovery forced a final "tools unavailable" answer, so truthful completion status after degraded provider continuations remains a separate completion/recovery semantics issue if we want this exact user task to surface as failed instead of succeeded.
- 2026-04-26 19:30 CST - Implemented and verified the three requested repair directions. Runtime now fails a run when completion control can only produce Ora's forced-final fallback text; `single_agent` default budget is raised to 32 tool calls so a Waza-style `fetch repo + fetch 8 SKILL.md + list/check + create 8 skills + final` flow can complete; runtime tool prompt now tells the model not to burn one `skills.checkName` per fetched file unless a conflict is likely. Added regression coverage for false-success fallback and the multi-skill install flow. Also repaired a narrow desktop `placeholderAssistantCopy()` type narrowing issue without changing pending-run copy semantics.
  Verification: focused runtime regressions, full runtime smoke, shared contracts, runtime typecheck, desktop typecheck, desktop composer state tests, sidecar packaging, and task TODO scan all passed.
  Next: if the user reruns this in the live app and `skills.create` enters approval, continue from the approval UX/state path rather than changing completion control.
- 2026-04-26 19:27 CST - Reopened after tracing `session-0015 / run-0021`. Root cause: the run fetched the Waza repo, README, and 8 `SKILL.md` files, then spent the remaining 6 calls on `skills.list` and `skills.checkName`; when the model tried `skills.create`, completion control had already forced `tool_budget_exhausted`. A second bug made this look successful because the runtime emitted `run.done(status="succeeded")` even when the final output was only Ora's forced-final fallback sentence. Patch direction: fail forced-final fallback outputs instead of marking success, give `single_agent` enough default tool budget for multi-skill installs, add a prompt nudge against per-file name-check churn, and add regressions for both false success and Waza-style multi-skill install flow.
  Next: run focused runtime/shared checks, then update this journal to Verified only if the regressions pass.
- 2026-04-26 18:05 CST - Started the DeerFlow-style runtime loop implementation pass from the accepted plan. Current target is not a full Python/LangGraph port; it is a TypeScript NodeRuntimeLoop contract inside Ora: explicit node states, middleware-style completion control, direct `single_agent` execution, and final-body semantics that only accept the last no-tool assistant text.
  Next: patch runtime loop state/guards, reduce `single_agent` to one direct loop invocation, add regressions, run the required shared/runtime/desktop checks.
- 2026-04-26 17:54 CST - Implemented the accepted DeerFlow-style runtime loop pass. `callAgent()` now routes provider/tool/finalization through a named NodeRuntimeLoop path with explicit `node.updated` states (`pending`, `running_model`, `tool_requested`, `tool_running`, `tool_result_observed`, `repairing`, `finalizing`, `completed`, `degraded`, `interrupted`, `failed`). Completion control now runs inside the loop: repeated tool calls warn before hard stop, per-tool-type frequency exhaustion forces finalization, forced-final standalone JSON tool intents get one repair pass, dangling native tool calls are repaired before the next model call, and tool exceptions are recorded as failed tool results before recovery/model continuation. `single_agent` now uses one `respond` node by default, while multi-node modes continue to use the same NodeRuntimeLoop per node. Desktop view-model/Trails consume `node.updated` as process state and keep final assistant body semantics tied to the final no-tool assistant text.
  Verification: `pnpm --filter @ora/shared build` passed; `pnpm --filter @ora/shared test -- contracts.test.ts` passed 76 tests; focused new runtime regressions passed 3 tests; `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts` passed 41 tests; `pnpm --filter @ora/runtime exec vitest run test/session-thread.test.ts` passed 10 tests; `pnpm --filter @ora/runtime exec vitest run test/desktop-composer-state.test.ts` passed 19 tests; `pnpm --filter @ora/runtime typecheck` passed; `pnpm --filter @ora/desktop typecheck` passed.
  Notes: existing runtime-smoke coverage still covers interrupt/resume/checkpoint/fork/replay paths; this pass did not add a new visual Trails redesign, only the runtime state event needed for the existing desktop surfaces.
- 2026-04-26 18:05 CST - Reproduced the new screenshot issue: final answer could still render provider DSML-style tool intent text (`<|DSML| parameter name="url"...>`) because final-answer guard only recognized JSON fallback and provider-native tool calls. Also found the noisy Steps cause: routine `node.updated` states were shown as user-facing process steps, and the repeated-tool warning emitted on the first tool call when `maxRepeatedToolCalls` was `1`. Patched runtime tool-intent extraction to share one parser for JSON and DSML/tagged parameter text, reused it for forced-final rejection, restored repeated-warning semantics so the first allowed call does not warn, and filtered routine node states out of Steps while keeping repair/degraded/interrupted/failed node states visible.
  Verification: focused DSML/JSON forced-final regressions passed; focused desktop Steps filtering regressions passed; `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts` passed 42 tests; `pnpm --filter @ora/runtime exec vitest run test/session-thread.test.ts` passed 10 tests; `pnpm --filter @ora/runtime exec vitest run test/desktop-composer-state.test.ts` passed 21 tests; `pnpm --filter @ora/runtime typecheck` passed; `pnpm --filter @ora/desktop typecheck` passed; `pnpm --filter @ora/runtime package:sidecar` passed and refreshed the ignored runtime sidecar bundle used by the desktop app.
- 2026-04-26 18:17 CST - Reproduced the follow-up screenshot issues: the session list could keep showing a stale running/waiting status even after the active snapshot had settled, and the runtime still ended early because `allowToolCallsAfterUsefulResult=false` treated the first successful `web.fetch` as enough evidence. Root cause: `markToolResultObserved()` forced finalization after any useful result in decisive mode, so README fetch / skills lookup / skill creation requests were rejected as final-answer tool calls; separately, the sidebar adapted session summaries without overlaying the active snapshot status and labeled all running states as "Awaiting reply." Patched runtime to stop forcing final solely on useful results, leaving budget/repeated/frequency guards as the hard stops. Exposed `skills.checkName`, `skills.create`, `skills.update`, and `skills.setEnabled` as runtime tools so install-style tasks can actually write private skills after fetching SKILL.md. Patched the session view model to prefer the active snapshot status for the selected session and changed the running badge copy from "Awaiting reply" to "Running."
  Verification: focused install-flow regression passed and proves `web.fetch -> web.fetch -> skills.create -> final answer` completes without force-final; focused stale-running session regression passed; `pnpm --filter @ora/shared build` passed; `pnpm --filter @ora/shared test -- contracts.test.ts` passed 76 tests; `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts` passed 43 tests; `pnpm --filter @ora/runtime exec vitest run test/session-thread.test.ts test/desktop-composer-state.test.ts test/runtime-tool-executor.test.ts` passed 44 tests; `pnpm --filter @ora/runtime typecheck` passed; `pnpm --filter @ora/desktop typecheck` passed; `pnpm --filter @ora/runtime package:sidecar` passed and refreshed the desktop sidecar bundle.
- 2026-04-26 18:48 CST - Reproduced the current screenshot root cause: after the useful-result fix, a single node could still be cut off by the old fixed `RUNTIME_TOOL_LOOP_LIMIT = 4`, so install-style tasks that legitimately need more than four distinct tool calls still finalized halfway through. Replaced that fixed per-node cap with a dynamic loop limit derived from remaining run-level `maxToolCalls`, while keeping a `64` iteration safety ceiling plus the existing budget, repeated-tool, and per-tool-type guards.
  Verification: focused regression proves one single-agent node can execute 8 distinct `web.fetch` calls and answer normally without `runtime_tool_loop_limit`; `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts` passed 44 tests; `pnpm --filter @ora/runtime exec vitest run test/desktop-composer-state.test.ts test/runtime-tool-executor.test.ts` passed 34 tests; `pnpm --filter @ora/shared build` passed; `pnpm --filter @ora/runtime typecheck` passed; `pnpm --filter @ora/desktop typecheck` passed.
- 2026-04-26 10:55 CST - Created the authoritative task journal from runtime stop-control investigation.
  Next: inspect current uncommitted diffs, design the controller data shape, and add failing tests for budget/repeated-tool/forced-final behavior before implementing.
- 2026-04-26 16:42 CST - Investigated a Trails regression where a run showed `Completion` / `Run completed` even though the visible assistant output was still a JSON fallback tool call (`{"tool":"web.fetch",...}`). Root cause: forced-final completion control only ignored provider-native tool calls; a standalone JSON fallback tool-call text was accepted as final answer text, so `executeModeSpec` returned normally and runtime emitted `run.done/succeeded`. Added regression coverage and patched runtime to reject standalone tool-call text after tools are disabled, emit `completion.updated(state="tool_call_text_rejected")`, and fail the run with a concrete error instead of showing a false completion.
  Next: run focused runtime and desktop typechecks before closing this follow-up.
- 2026-04-26 16:43 CST - Verification passed for this follow-up: regression test failed before the runtime patch and passes after it; `pnpm --filter @ora/runtime test` passed 12 files / 152 tests; `pnpm --filter @ora/runtime typecheck` passed; `pnpm --filter @ora/desktop typecheck` passed.
  Next: keep the broader completion-control task open for the remaining policy/design open issues.
- 2026-04-26 16:53 CST - Followed up on the next visible failure state: the run now correctly failed, but streaming `message.delta` / persisted assistant transcript could still show the rejected JSON fallback tool call as the chat body, and the deterministic final-answer rejection was being wrapped by recovery-policy as a generic `node_exception`. Patched desktop chat adaptation to suppress stored assistant/delta text when `completion.updated(state="tool_call_text_rejected")` exists, show the concrete snapshot error instead, and make failed action steps show the actual error. Patched runtime node recovery to rethrow `FinalAnswerIncompleteError` directly so Trails no longer shows misleading `Recovery exhausted: node_exception` for this case.
  Verification: focused runtime and desktop regressions passed, then `pnpm --filter @ora/runtime test` passed 12 files / 152 tests; `pnpm --filter @ora/runtime typecheck` passed; `pnpm --filter @ora/desktop typecheck` passed.
- 2026-04-26 17:13 CST - Reopened the failure policy after a real run showed completion-control turning a recoverable no-tools violation into a failed task. Root cause: `coerceNoToolResponse()` ignored provider-native tool calls, but standalone JSON fallback tool-call text emitted after `toolChoice: "none"` was treated as `FinalAnswerIncompleteError`; `callAgent` and `runRecoverableNode` explicitly rethrew that error, so checkpoint/recovery could not produce a usable final state. Patched runtime to treat this as a rejected tool intent, emit `completion.updated(state="tool_call_text_rejected")`, return a caveated final fallback, preserve completion metadata, and never execute the second tool.
  Verification: `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts -t "recovers when forced final output is still a JSON fallback tool call"` passed; `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts` passed 38 tests; `pnpm --filter @ora/runtime exec vitest run test/desktop-composer-state.test.ts` passed 17 tests; `pnpm --filter @ora/runtime typecheck` passed.
- 2026-04-26 17:33 CST - Followed up on the next bad outcome: the run no longer failed, but final output became the fixed fallback sentence `I need to stop using tools here...`, which is a false-success answer for the user's actual task. Root cause: `runForcedFinalProviderCall()` only made one no-tools provider call; if that response was a rejected JSON fallback tool call, `coerceNoToolResponse()` immediately replaced it with generic fallback text instead of giving the model one repair turn using the existing tool results. Patched forced-final handling to emit the rejection, append a model-visible "tool call rejected; answer from existing context" user message, retry once with `toolChoice: "none"`, and only then fall back if the retry still violates the no-tools contract.
  Verification: focused regression passed; `pnpm --filter @ora/runtime exec vitest run test/runtime-smoke.test.ts` passed 38 tests; `pnpm --filter @ora/runtime exec vitest run test/desktop-composer-state.test.ts` passed 17 tests; `pnpm --filter @ora/runtime typecheck` passed.

## Compressed State
- Latest reopened issue is `session-0015 / run-0021`: Waza install fetched all remote skill files but exhausted `maxToolCalls=16` before `skills.create`.
- False-success bug: forced-final fallback text plus `tool_budget_exhausted` still emitted `run.done(status="succeeded")`.
- Current patch makes forced-final fallback output fail the run, raises `single_agent` default tool budget to cover multi-skill installs, and nudges models away from per-file `skills.checkName` churn.
- Keep `skills.create` approval semantics unchanged; this pass is about truthful completion state and enough budget to reach create/install actions.
- Current repo has related uncommitted changes; do not revert unrelated work.

## Retrospective
- Pitfall: A budget field that exists in schemas but is not enforced at runtime creates false confidence.
  - Evidence: `maxToolCalls` exists in shared budgets while runtime uses a fixed per-agent loop limit.
  - Status: candidate_for_skill
- Pitfall: Prompt-only stop instructions are insufficient for long-running agents with tools.
  - Evidence: runtime only stops when model stops emitting parseable/native tool calls.
  - Status: local_only
