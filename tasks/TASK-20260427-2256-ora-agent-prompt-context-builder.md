# TASK-20260427-2256-ora-agent-prompt-context-builder

**Created:** 2026-04-27 22:56 CST
**Status:** In Progress (Pass 2: kernel-first routing)

---

## Goal
- Upgrade Ora's runtime prompt construction from scattered driver strings plus ad hoc overlays into a single auditable prompt context layer. The target is DeerFlow-style composition: stable base requirements plus runtime-adjusted variables for agent profile, node/stage, memory, tools, skills, MCP/deferred tools, workspace, conversation, and orchestration state. Every agent invocation should be able to explain which prompt sections it received and why.
- Evolve Ora's run execution architecture toward a DeerFlow-style split: `runtime-kernel` is the single agent execution substrate; LangGraph, when enabled, is an optional orchestration/checkpoint shell that must not own a second, weaker tool/prompt/memory path by default.

## Scope / Out of scope
- In scope:
  - Introduce a shared prompt context builder used by `executeRuntimeKernel` before provider calls.
  - Preserve existing mode behavior while making profile, node, memory, tools, skills, MCP, workspace, and prior context explicit sections.
  - Add tests proving agent-specific profile/skill/tool overlays and memory/context sections are composed in deterministic order.
  - Record comparison against DeerFlow lead-agent prompt factory and keep this task as the single source of truth.
  - Make `runtime-kernel` the default `runs.start` execution path even when `ORA_LANGGRAPH_ENABLED=true`.
  - Keep LangGraph available as an explicit experimental orchestration route behind `config.metadata.langGraphOrchestration === true`.
  - Add routing tests so web/no-web tools no longer decide whether a run silently changes execution substrate.
- Out of scope:
  - Full rewrite of all pattern drivers in the first pass.
  - Changing provider APIs or adding real per-agent provider switching.
  - UI redesign for prompt inspection.
  - Replacing Ora's mode schema with DeerFlow's agent config format.
  - Rebuilding LangGraph nodes to call the full kernel per node in this pass.
  - Removing LangGraph/checkpointer support.

## Constraints
- Compatibility:
  - Existing `ModeSpec.nodes[].prompt` override behavior must keep working.
  - Existing custom agent/system agent overlays, skills, tool protocol, long-term memory, workspace context, and clarification context must keep their current content semantics.
  - LangGraph fallback path must not regress, but can be aligned after the runtime-kernel path has tests.
- Performance:
  - Prompt construction must be cheap string assembly; no extra model calls.
  - Avoid eager full MCP schema or skill body expansion beyond existing enabled skill snippets.
- Risk:
  - Prompt ordering changes can alter model behavior. First implementation should centralize without changing high-level wording except adding concise structured labels.
  - Runtime has two paths (`executeRuntimeKernel` and LangGraph `sessionManager`); divergence is a known risk and must be tracked.
  - Changing default routing can affect tests or users who assumed `ORA_LANGGRAPH_ENABLED=true` meant all no-web runs use LangGraph. This pass must keep an explicit opt-in path.
- Tool/Environment limits:
  - Use TypeScript-only changes and existing Vitest coverage.
  - Keep edits surgical; do not refactor unrelated driver execution.

## Plan
1. Add `apps/runtime/src/harness/prompt-context.ts`.
   - Define `AgentPromptContextInput`, `AgentPromptSection`, and `BuiltAgentPromptContext`.
   - Compose deterministic sections in this order: custom persona, system agent profile, node profile, base stage system, workspace, clarification, memory, tools, skills, deferred/MCP hints.
   - Keep the final output as a plain string for existing providers, plus section metadata for tests and future prompt inspector UI.
2. Wire `executeRuntimeKernel` to the builder.
   - Replace `systemPrompt()` + `withAgentRuntimeContext()` ad hoc joining with calls to the builder.
   - Preserve effective agent tool/skill filtering.
   - Ensure node/profile metadata is available at call time without changing driver signatures more than necessary.
3. Add runtime tests.
   - Unit-test builder ordering and omission of empty sections.
   - Test profile role injection for a system profile and custom agent persona injection for a custom profile.
   - Test MCP/deferred hints appear only when relevant tools are enabled.
   - Test existing runtime smoke behavior still passes for a single-agent/custom-agent flow.
4. Align LangGraph path as follow-up after kernel tests pass.
   - Replace `withGraphPersona()` with the shared builder or a wrapper around it.
   - Ensure `sessionManager.startRun()` receives system/custom agent context, not only top-level custom overlay.
5. Optional later phase: prompt introspection.
   - Emit prompt section summaries in trace metadata or run trail for debugging.
   - Add UI affordance only after backend shape is stable.

## Kernel-First Execution Plan

### Direction
DeerFlow's useful lesson is not "use LangGraph everywhere"; it is "do not let runtime and LangGraph become competing agent executors." DeerFlow keeps agent behavior in one graph/agent factory and lets the surrounding runtime handle lifecycle, SSE, cancellation, rollback, and protocol compatibility. Ora should mirror the separation with Ora-native names:

```ts
runs.start
  -> resolve session/mode/profile/memory/custom-agent context
  -> runtime-kernel executes the agent/tool loop by default
  -> LangGraph is optional orchestration/checkpoint shell only when explicitly requested
```

### Desired End State
- `runtime-kernel` owns:
  - provider calls and streaming;
  - native tool loop and text tool protocol;
  - approvals, clarification, completion control, recovery, artifacts, memory capture, skills, MCP/deferred tools, workspace context, and prompt context;
  - agent-specific profile/custom-agent/tool/skill filtering.
- LangGraph owns only:
  - graph/checkpoint/scheduling experiments;
  - interrupt/resume semantics for experimental graph nodes;
  - future graph nodes that delegate agent execution back into the same kernel/node runtime abstraction.
- `SessionManager` should not be selected just because a run lacks web tools. Tool selection must not change the execution substrate.

### Pass 2 Implementation
1. Add explicit route predicate in `apps/runtime/src/json-rpc.ts`.
   - `shouldUseLangGraphOrchestration(config)` returns true only when `config.metadata.langGraphOrchestration === true`.
   - `ORA_LANGGRAPH_ENABLED=true` remains necessary but no longer sufficient.
   - Web tools become ordinary kernel tools, not a special routing exception.
2. Route `runs.start` through `startRunWithSnapshot()` when `SessionManager` is enabled so session transcript rebuild and mode resolution still happen in one place.
   - Default branch calls `executeRuntimeKernel(...)`.
   - Explicit branch calls `sessionManager.startRun(...)`.
   - Add `metadata.runtimeRoute` to the config passed into the chosen executor for traceability: `runtime-kernel` or `langgraph-orchestration`.
3. Apply the same routing rule to `evaluation.runs.start`.
   - Default evaluation runs use the kernel.
   - LangGraph evaluation remains available with the explicit metadata flag.
4. Update tests.
   - Existing tests that intentionally exercise `SessionManager` add `metadata.langGraphOrchestration: true`.
   - Add a regression test proving an enabled `SessionManager` no longer captures ordinary no-web runs unless the flag is present.
5. Verify.
   - Run focused runtime tests covering prompt context, session threading, sqlite checkpointer, custom agents, and runtime smoke paths.
   - Run `pnpm --filter @ora/runtime typecheck`.

### Follow-Up Passes
1. Extract a `RuntimeExecutionRouter` or `run-execution.ts` helper if routing logic grows beyond `json-rpc.ts`.
2. Add prompt-section trace emission from `BuiltAgentPromptContext.sections`.
3. Design a node-level kernel adapter for LangGraph:
   - LangGraph node receives node id/profile/context;
   - node invokes shared kernel node runtime rather than calling providers directly;
   - graph state stores the kernel-produced events/tool calls/artifacts.
4. Move graph pattern provider calls behind the node-level adapter, one pattern at a time.
5. Decide whether `SessionManager` remains an experimental shell or becomes the only graph/checkpoint backend around kernel nodes.

### Success Criteria
- With `ORA_LANGGRAPH_ENABLED=true`, a normal `runs.start` uses `runtime-kernel` unless `metadata.langGraphOrchestration === true`.
- A run with `web.search`/`web.fetch` does not require a routing carve-out.
- Existing custom agent persona, system agent override, skills, memory, MCP hints, and workspace context still appear in provider system prompts.
- LangGraph-specific tests still pass when they opt in explicitly.
- The task doc states the architectural intent clearly enough that future work does not reintroduce silent dual-track execution.

## Active Files
- `tasks/TASK-20260427-2256-ora-agent-prompt-context-builder.md`
- `apps/runtime/src/harness/prompt-context.ts`
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/patterns/system-prompt.ts`
- `apps/runtime/src/patterns/agent-teams.ts`
- `apps/runtime/src/patterns/generator-verifier.ts`
- `apps/runtime/src/patterns/message-bus.ts`
- `apps/runtime/src/patterns/orchestrator-subagent.ts`
- `apps/runtime/src/patterns/shared-state.ts`
- `apps/runtime/src/session/session-manager.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/test/runtime-prompt-context.test.ts`
- `apps/runtime/test/runtime-smoke.test.ts`

## Decisions
- Decision: Build a shared prompt context builder before broad driver rewrites.
  - Why: Ora already has most data sources, but they are joined in scattered locations. A builder gives a stable contract without changing pattern semantics first.
  - Alternatives: Move all prompts into `ModeSpec`; copy DeerFlow's single lead-agent template directly; leave current code and only document behavior.
  - Tradeoffs: This adds one abstraction now, but avoids a larger, riskier rewrite and gives tests a single target.
- Decision: Preserve stage-specific system strings for now, but place profile/node/context sections around them.
  - Why: Those strings encode behavior users already see. Removing them would be a behavior migration, not just prompt infrastructure.
  - Alternatives: Replace all stage strings with profile roles immediately.
  - Tradeoffs: Some hardcoded role copy remains temporarily, but it becomes contained and easier to migrate.
- Decision: Treat MCP/deferred tools as prompt hints, not full schema injection.
  - Why: Ora already has `mcp.listTools`, `mcp.readResource`, and `mcp.call`; full schema injection can bloat context and duplicate the deferred-tool idea.
  - Alternatives: Expand all MCP tools into the prompt up front.
  - Tradeoffs: Agents may need one discovery call, but prompt stays bounded.

## Progress Log
- 2026-04-27 22:56 CST - Task created
  Next: Fill in Goal, Scope, Plan, and list Active Files
- 2026-04-27 22:58 CST - Filled task plan from DeerFlow/Ora prompt analysis.
  Next: Add prompt-context builder; wire runtime-kernel; add builder tests.
- 2026-04-27 23:01 CST - Added `prompt-context.ts`, wired `executeRuntimeKernel` agent calls through the shared builder, and added builder tests for section ordering, profile injection, custom persona, and MCP hints.
  Next: Align LangGraph path with builder; pass graph custom/system agent contexts; rerun runtime tests.
- 2026-04-27 23:05 CST - Updated LangGraph persona construction to reuse the builder, pass agent ids from pattern nodes, and forward system/custom agent context through `SessionManager`.
  Next: Record verification evidence; keep follow-up items for per-agent provider switching, skill progressive loading, and prompt inspection.
- 2026-04-27 23:34 CST - Expanded the task with a DeerFlow-informed kernel-first execution plan: `runtime-kernel` becomes the default run substrate; LangGraph becomes explicit experimental orchestration behind `metadata.langGraphOrchestration === true`.
  Next: Implement the routing predicate in `json-rpc.ts`, update LangGraph-specific tests to opt in, and verify focused runtime suites.
- 2026-04-27 23:42 CST - Implemented kernel-first routing for `runs.start` and `evaluation.runs.start`; LangGraph orchestration now requires `metadata.langGraphOrchestration === true`, and route metadata is written as `runtimeRoute`.
  Next: Run final diff review and update verification evidence.

## Open Issues
- [ ] TODO(FOLLOWUP): Per-agent model/provider switching is not implemented in this task; `modelRef` remains prompt/catalog metadata unless a later task changes provider dispatch.
- [ ] TODO(FOLLOWUP): Existing skill snippet injection uses full enabled skill content; optimize or progressive-load later if context pressure appears.
- [ ] TODO(FOLLOWUP): Prompt section metadata is available in builder return values but not yet emitted into traces or UI.

## TODO
- [x] Add prompt context builder.
- [x] Wire runtime-kernel prompt assembly to builder.
- [x] Add unit coverage for section ordering and agent-specific overlays.
- [x] Align LangGraph path with the shared builder.
- [x] Run focused runtime tests.
- [x] Update verification evidence and compressed state.
- [x] Make runtime-kernel the default route with explicit LangGraph opt-in.
- [x] Update routing/session tests for explicit LangGraph orchestration.
- [ ] TODO(FOLLOWUP): Add prompt section trace/UI inspection.
- [ ] TODO(FOLLOWUP): Design per-agent provider dispatch using `profile.modelRef` / custom agent `model`.
- [ ] TODO(FOLLOWUP): Design progressive skill loading instead of unconditional full snippet injection.

## Retrospective
- Record 0-3 highest-value pitfalls from this task.
- Leave reusable operational lessons here even when they later get promoted into a skill.

### Item 1
- Pitfall: Prompt inputs existed but were not governed by one contract.
- Symptom: profile roles, memory namespaces, skills, MCP tools, and custom personas were represented in different structures and joined at different call sites.
- Root Cause: Runtime grew from MVP pattern drivers before prompt context became a first-class backend object.
- Reusable Guardrail: For multi-agent runtimes, introduce a typed prompt context builder before adding more prompt-affecting capabilities.
- Evidence: Analysis of `runtime-kernel.ts`, `driver-registry.ts`, `modes.ts`, and DeerFlow `lead_agent/prompt.py`.
- Scope: Ora runtime prompt orchestration.
- Suggested Writeback Target: none yet.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [ ] Lint checks pass

**Output**:
- `pnpm --filter @ora/runtime typecheck`
  - Passed with no TypeScript errors.
- `pnpm --filter @ora/runtime test -- runtime-prompt-context.test.ts session-thread.test.ts graph-adapter.test.ts`
  - Vitest ran the runtime suite: 15 test files passed, 219 tests passed.

### Functional Verification (Feature Works)
- [x] Core functionality verification: `runtime-prompt-context.test.ts` asserts deterministic section ordering, profile role/model/memory namespace injection, custom persona, system override, workspace, clarification, memory, skills, and MCP hints.
- [x] Edge cases verification: empty sections and non-MCP tool sets are omitted.
- [x] Error handling verification: existing runtime smoke tests still pass after prompt assembly changes.

**Output**:
- New builder tests passed.
- Existing runtime smoke tests passed inside the runtime suite, including approved file write and streaming run cases.

**Examples**:
- Database: `SELECT * FROM table WHERE field_name IS NOT NULL LIMIT 5;`
- API: `curl "url" | jq '.results[0].field_name'`
- UI: Manual test steps and results
- Bug fix: Verification bug is fixed

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: DeerFlow `backend/packages/harness/deerflow/agents/lead_agent/prompt.py` and `agent.py`

### Comparison Points
- [x] Prompt factory accepts runtime variables such as agent name/soul, memory, skills, deferred tools, subagents, mounts, and date.
- [x] Runtime middleware maintains prompt-adjacent behavior such as memory, summarization, tool filtering, loop detection, clarification, and subagent limits.
- [x] Ora has equivalent data sources but does not yet expose them through one typed prompt builder.

### Findings
- Consistency: Ora already has ModeSpec, profiles, custom agent personas, memory overlays, skills, tools, MCP tools, workspace context, and clarification context.
- Differences: DeerFlow centralizes prompt assembly in `apply_prompt_template()` and runtime middleware; Ora assembles sections across `driver-registry.ts`, `runtime-kernel.ts`, `system-prompt.ts`, `runtime-tool-executor.ts`, and `run-store.ts`.
- Conclusion: Add a shared builder first, then gradually align both execution paths and move more role/stage copy out of drivers.

## Checkpoints

### Checkpoint 1: Prompt Context Contract
- Requirement: Runtime prompt context has typed inputs and deterministic section ordering.
- Verification method: Unit tests for builder section output.
- Status: [x] Pass / [ ] Fail
- Evidence: `runtime-prompt-context.test.ts` passed.

### Checkpoint 2: Runtime Kernel Wiring
- Requirement: Existing runtime agent calls use the builder without losing current custom/persona/tool/skill/memory behavior.
- Verification method: Focused runtime tests plus existing smoke tests.
- Status: [x] Pass / [ ] Fail
- Evidence: runtime suite passed: 15 files, 219 tests.

### Checkpoint 3: Follow-up Truth
- Requirement: Remaining gaps are explicitly recorded as TODO(FOLLOWUP) or open issues.
- Verification method: Task journal review and TODO scan.
- Status: [x] Pass / [ ] Fail
- Evidence: follow-up TODOs recorded for prompt inspector, per-agent provider dispatch, and progressive skill loading.

### Checkpoint 4: Kernel-First Routing
- Requirement: `runtime-kernel` is the default run substrate when `SessionManager` is enabled; LangGraph orchestration requires explicit opt-in.
- Verification method: `session-thread.test.ts` regression plus LangGraph-specific checkpointer tests updated to pass `metadata.langGraphOrchestration: true`.
- Status: [x] Pass / [ ] Fail
- Evidence: focused runtime suite passed: 15 files, 220 tests.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Centralize Ora runtime prompt composition so every agent/node can carry profile, memory, tools, skills, MCP/deferred hints, workspace, and orchestration context.
- Done: Analysis completed; task plan recorded; DeerFlow comparison captured; prompt builder added; runtime-kernel and LangGraph path wired; tests passed.
- In-progress: Follow-up iteration planning for prompt inspection, per-agent model dispatch, progressive skill loading, and LangGraph node-level kernel adapter.
- Active files: task journal, `prompt-context.ts`, `runtime-kernel.ts`, `system-prompt.ts`, graph pattern files, `session-manager.ts`, `json-rpc.ts`, runtime prompt tests.
- Next actions (top 3; exact file/function): add trace emission for `BuiltAgentPromptContext.sections`; design provider dispatch around `profile.modelRef`; design LangGraph node adapter that calls shared kernel/node runtime instead of direct providers.
- Blockers/Risks: Prompt ordering behavior risk remains; per-agent model switching intentionally out of scope for pass 1.
- Verification status: `pnpm --filter @ora/runtime typecheck` passed; runtime Vitest suite passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [ ] Code Verification output (compilation/tests/lint)
- [ ] Functional Verification output (feature verification)
- [ ] Retrospective Evidence (if applicable)
- [ ] Comparison Evidence (if applicable)
- [ ] Checkpoints Evidence (if applicable)

### Environment
- Environment: local macOS workspace `/Users/quintenchen/developer/Ora`, Node/pnpm runtime package.

### Commands run + outputs
- `pnpm --filter @ora/runtime typecheck`
  - Output: `tsc -p tsconfig.json --noEmit`
  - Result: passed with no errors.
- `pnpm --filter @ora/runtime test -- runtime-prompt-context.test.ts session-thread.test.ts graph-adapter.test.ts`
  - Output summary: `Test Files 15 passed (15); Tests 219 passed (219)`
  - Note: Vitest config executed the runtime test suite, including the new prompt-context tests and existing smoke tests.
- `pnpm --filter @ora/runtime typecheck`
  - Output: `tsc -p tsconfig.json --noEmit`
  - Result: passed with no errors after Pass 2 routing changes.
- `pnpm --filter @ora/runtime test -- runtime-prompt-context.test.ts session-thread.test.ts sqlite-checkpointer.test.ts custom-agents.test.ts runtime-smoke.test.ts`
  - Output summary: `Test Files 15 passed (15); Tests 220 passed (220)`
  - Note: Added routing regression coverage proving an enabled `SessionManager` does not capture normal no-web runs unless `metadata.langGraphOrchestration === true`.
