# TASK-20260426-1055-ora-agent-completion-control

**Created:** 2026-04-26 10:55 CST
**Status:** Planned

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

## Open Issues
- Whether to introduce a new event type such as `completion.updated` / `tool.blocked`, or encode stop details in existing `run.done` / `tool.called` payloads.
- Whether Single Agent should get a new direct-response preset, or whether existing `single_agent` should skip `decompose` dynamically.
- Whether default web tools should remain enabled for all modes or be opt-in for non-research tasks.

## Progress Log
- 2026-04-26 10:55 CST - Created the authoritative task journal from runtime stop-control investigation.
  Next: inspect current uncommitted diffs, design the controller data shape, and add failing tests for budget/repeated-tool/forced-final behavior before implementing.

## Compressed State
- Ora agent runs can produce too many steps because completion control is fragmented.
- Evidence points to fixed per-agent tool loop, default broad tools, advisory-only tool prompt, Generator-Verifier retries, and no run-level controller.
- Planned fix: add run-level completion controller that enforces `maxToolCalls`, detects repeats, forces final no-tool answer, and records stop reasons.
- Important: preserve provider-native tools and JSON fallback; do not fake success when stopped by budget or repeated-tool guard.
- Current repo has related uncommitted changes; inspect before editing and do not revert unrelated work.

## Retrospective
- Pitfall: A budget field that exists in schemas but is not enforced at runtime creates false confidence.
  - Evidence: `maxToolCalls` exists in shared budgets while runtime uses a fixed per-agent loop limit.
  - Status: candidate_for_skill
- Pitfall: Prompt-only stop instructions are insufficient for long-running agents with tools.
  - Evidence: runtime only stops when model stops emitting parseable/native tool calls.
  - Status: local_only
