# TASK-20260425-0010-agent-web-search-roadmap

**Created:** 2026-04-25 00:10 CST
**Status:** In Progress

---

## Goal
- Make Ora agents able to search the web even when the selected LLM provider does not offer native browsing/search. The implementation should evolve in three iterations: first enable the existing `web.search` and `web.fetch` runtime tools for every mode by default; then replace the current DuckDuckGo HTML scraping implementation with a stable Search Provider abstraction backed by configured providers or runtime env keys; finally support MCP-based search servers so users can plug in custom web, internal search, RAG, or enterprise knowledge sources.

## Scope / Out of scope
- In scope:
  - Phase 1: all built-in and cloned/custom modes should include `web.search` and `web.fetch` in effective run `toolIds` unless explicitly disabled later by policy.
  - Phase 2: runtime search should go through a typed Search Provider abstraction with provider selection, secrets, error handling, and tests.
  - Phase 3: runtime search should support MCP server discovery and invocation for search-like tools/resources.
  - UI/runtime surfaces should make it clear that web search is a runtime capability, not a provider-native capability.
  - Verification must cover run config, tool execution, and agent behavior with a provider that has no native browsing.
- Out of scope:
  - Full browser automation or visual web browsing.
  - Real-time citation UX redesign beyond exposing search/fetch tool events already available in Trails.
  - Company-specific RAG implementation; Phase 3 should provide the integration point, not ship a proprietary connector.
  - Replacing provider chat/completion APIs.

## Constraints
- Compatibility:
  - Existing modes without network needs must keep working; default network tools should not break deterministic/local-smoke paths.
  - Existing `toolIds` mode semantics must remain backward compatible.
  - LangGraph-enabled paths currently bypass `RuntimeToolExecutor`; either keep web-search modes on `runtime-kernel` or explicitly share the tool loop with LangGraph nodes before claiming support there.
- Performance:
  - Search/fetch results must be bounded by result count and bytes to avoid bloating model context.
  - Add timeouts/retries for network providers; avoid blocking the desktop UI on slow search.
- Risk:
  - Search results are untrusted input; prompts must preserve the trust boundary and avoid treating search snippets as instructions.
  - External network requests may leak user query text; provider selection and settings should make this explicit.
  - HTML scraping is brittle; Phase 2 exists to retire the current DuckDuckGo HTML parser.
- Tool/Environment limits:
  - Provider may only be a plain chat/completions model with no native tool calling.
  - Current runtime tool protocol is model-authored JSON: `{"tool":"web.search","args":{...}}`.
  - Search provider credentials should use runtime env vars or provider config secrets, not hardcoded keys.

## Plan
1. Phase 1 - Enable web tools everywhere by default.
   - `packages/shared/src/index.ts`: update built-in mode defaults / mode normalization so every mode includes `web.search` and `web.fetch`.
   - `apps/desktop/src/lib/useRunActions.ts`: ensure effective run `toolIds` include mode tools plus project-safe tools plus default web tools.
   - `apps/runtime/src/run-store.ts`: ensure runtime-side config resolution preserves/adds default web tools for direct runtime calls, not only desktop calls.
   - Tests: assert all modes and started runs include `web.search` and `web.fetch`.
2. Phase 2 - Introduce stable Search Provider abstraction.
   - `apps/runtime/src/harness/runtime-tool-executor.ts`: replace direct DuckDuckGo implementation with `SearchProvider` interface dispatch.
   - Add provider modules such as `search-providers/brave.ts`, `tavily.ts`, `serpapi.ts`, `kagi.ts`, plus a fallback provider if intentionally retained.
   - `packages/shared/src/index.ts`: add config/schema for search provider IDs, env names, limits, and safe result shape.
   - Runtime config/env: support provider selection through `providerConfig`, runtime env vars, or dedicated search settings.
   - Tests: mock each provider response and verify normalized results, error handling, limits, and fallback behavior.
3. Phase 3 - Support MCP search servers.
   - `apps/runtime/src/harness/runtime-tool-executor.ts`: add a search adapter that can discover/call MCP tools/resources exposed by configured servers.
   - MCP config path handling: document and test how search server IDs are configured.
   - `packages/shared/src/index.ts`: represent MCP search capability and policy metadata.
   - Tests: use a fake MCP server exposing a search tool and verify agent can search through it.
4. Cross-phase UX and docs.
   - Desktop: expose that web search/fetch is enabled in mode capability/tool lists.
   - Docs/task notes: document how to configure stable search providers and MCP search.
   - Trails: verify `tool.called` displays `web.search`, `web.fetch`, and MCP search events clearly.

## Active Files
- `tasks/TASK-20260425-0010-agent-web-search-roadmap.md`
- Expected implementation files:
  - `packages/shared/src/index.ts`
  - `apps/desktop/src/lib/useRunActions.ts`
  - `apps/runtime/src/run-store.ts`
  - `apps/runtime/src/harness/runtime-tool-executor.ts`
  - `apps/runtime/test/runtime-tool-executor.test.ts`
  - `apps/runtime/test/runtime-smoke.test.ts`
  - `apps/runtime/test/desktop-composer-state.test.ts` if desktop run-config behavior changes
  - Search provider modules/tests to be created during Phase 2

## Decisions
- Decision: Treat web search as an Ora runtime tool, not as provider-native browsing.
  - Why: The user explicitly needs agents to search when the current provider has no native browsing/search capability.
  - Alternatives: Require provider-native web search; call external search outside the agent loop; use browser automation.
  - Tradeoffs: Runtime tools are portable across providers, but require prompt/tool-loop reliability and strict untrusted-input handling.
- Decision: Enable `web.search` and `web.fetch` for all modes first.
  - Why: This is the fastest path to useful behavior and aligns with existing runtime tool support.
  - Alternatives: Enable only research modes; require users to manually add tools to each mode.
  - Tradeoffs: Broad enablement increases network-capability surface area, so policy/UX should make the capability visible.
- Decision: Replace DuckDuckGo HTML scraping with a Search Provider abstraction in Phase 2.
  - Why: HTML scraping is brittle and has unclear operational reliability.
  - Alternatives: Keep DuckDuckGo HTML indefinitely; integrate only one paid provider directly.
  - Tradeoffs: Abstraction adds code, but makes provider choice and credential handling explicit.
- Decision: Add MCP search support as Phase 3, not Phase 1.
  - Why: MCP is the right long-term extension point, but default web search should work without requiring users to configure a server.
  - Alternatives: MCP-only search.
  - Tradeoffs: Shipping built-in search plus MCP adds two integration paths, but supports both easy defaults and enterprise/private search.

## Progress Log
- 2026-04-25 00:10 CST - Task created
- 2026-04-25 00:15 CST - Filled the task journal with the three-phase web search roadmap, implementation files, checkpoints, and verification plan.
  Next: 1. Implement Phase 1 default `web.search`/`web.fetch` enablement. 2. Add run/mode tests for default tool IDs. 3. Verify a no-native-browsing provider can trigger `web.search`.

## Open Issues
- [ ] Confirm whether every mode should always enable web tools, or whether a future per-mode/network-off policy should be added after Phase 1.
- [ ] Choose Phase 2 default stable provider order: Brave, Tavily, SerpAPI, Kagi, or user-selected only.
- [ ] Decide where search provider secrets live: existing provider config, dedicated runtime settings, or env-only.
- [ ] Decide whether LangGraph mode support must be included in Phase 1 or explicitly deferred until the tool loop is shared.

## TODO
- [ ] Phase 1: make `web.search` and `web.fetch` effective defaults for all modes/runs.
- [ ] Phase 1: add tests proving default web tools are present in built-in modes, cloned/custom modes, and runtime run config.
- [ ] Phase 1: verify an agent can call `web.search` with a provider that has no native search.
- [ ] Phase 2: define `SearchProvider` interface and normalized search result schema.
- [ ] Phase 2: implement at least one stable provider behind env/config.
- [ ] Phase 2: retire or demote DuckDuckGo HTML scraping to explicit fallback/test-only behavior.
- [ ] Phase 3: support MCP search server discovery/call path.
- [ ] Phase 3: document MCP search setup for custom/internal/RAG search.

## Retrospective
### Item 1
- Pitfall: Provider capability and runtime capability can be conflated.
- Symptom: A provider without native browsing is assumed unable to power a search-capable agent.
- Root Cause: Search can live in Ora's tool loop, but the UI/config language may imply it belongs to the provider.
- Reusable Guardrail: When adding agent capabilities, classify them as provider-native, runtime-tool, MCP, or UI-only before implementation.
- Evidence: Current code already implements `web.search`/`web.fetch` in `RuntimeToolExecutor`, independent of provider type.
- Scope: Ora agent capability design.
- Suggested Writeback Target: none yet.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [ ] Code compiles/runs without errors
- [ ] Unit tests pass
- [ ] Lint checks pass

**Output**: Paste command outputs

### Functional Verification (Feature Works)
- [ ] Phase 1 core functionality: start a run using a provider with no native search and verify the agent emits/executes `web.search`.
- [ ] Phase 1 edge cases: mode with existing custom `toolIds` keeps those tools and gains web tools without duplicates.
- [ ] Phase 1 error handling: network failure yields a failed/degraded `tool.called` event without crashing the run.
- [ ] Phase 2 core functionality: configured stable provider returns normalized results for `web.search`.
- [ ] Phase 2 edge cases: missing API key, empty query, provider timeout, malformed provider response.
- [ ] Phase 3 core functionality: fake MCP search server returns results through MCP adapter.

**Output**: Paste verification results

## Comparison (If Applicable)

### Reference
- Existing runtime tool loop and network tools:
  - `apps/runtime/src/harness/runtime-tool-executor.ts`
  - `apps/runtime/src/harness/runtime-kernel.ts`
  - `packages/shared/src/index.ts`

### Comparison Points
- [ ] Tool registration matches `MVP_TOOLS` and implemented runtime tool IDs.
- [ ] Mode/run config propagation matches existing `toolIds` handling.
- [ ] Search/fetch events remain visible through existing `tool.called` and Trails UI.

### Findings
- Consistency: Phase 1 should reuse existing tool IDs and executor behavior.
- Differences: Phase 2 introduces new provider-specific configuration and result normalization.
- Conclusion: Default enablement is a small config/runtime propagation change; provider abstraction and MCP support are separate later iterations.

## Checkpoints

### Checkpoint 1: Phase 1 Default Web Tools
- Requirement: Every effective mode/run includes `web.search` and `web.fetch` by default.
- Verification method: Unit/contract tests over built-in modes, cloned/custom modes, and `runs.start`/`runs.startStreaming` config.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending implementation.

### Checkpoint 2: Phase 1 Agent Can Search Without Provider-Native Browsing
- Requirement: A plain chat provider can trigger `web.search` through Ora runtime tool protocol and answer from the result.
- Verification method: Mock provider emits `{"tool":"web.search","args":{"query":"..."}}`; assert `tool.called` success and final answer consumes tool result.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending implementation.

### Checkpoint 3: Phase 2 Stable Search Provider Abstraction
- Requirement: `web.search` dispatches through a configured `SearchProvider` abstraction, not direct DuckDuckGo HTML scraping.
- Verification method: Mock Brave/Tavily/SerpAPI/Kagi response fixtures normalize to the shared result schema; missing key/timeouts are handled.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending implementation.

### Checkpoint 4: Phase 3 MCP Search Server Support
- Requirement: Ora can discover/call an MCP search server and pass results back through the same agent tool loop.
- Verification method: Fake MCP server exposes search tool/resource; runtime test verifies `mcp.call` or search adapter result and final answer.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending implementation.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Make Ora agents web-search-capable independent of provider-native browsing.
- Done: Created task journal and captured three-phase iteration plan.
- In-progress: Phase 1 default enablement not implemented yet.
- Active files: `tasks/TASK-20260425-0010-agent-web-search-roadmap.md`.
- Next actions (top 3; exact file/function):
  1. `packages/shared/src/index.ts` - add default `web.search`/`web.fetch` to mode/run defaults or normalizer.
  2. `apps/runtime/src/run-store.ts` and `apps/desktop/src/lib/useRunActions.ts` - ensure effective run config always includes default web tools.
  3. `apps/runtime/test/runtime-smoke.test.ts` / `runtime-tool-executor.test.ts` - add regression tests for default web tools and no-native-browsing search.
- Blockers/Risks: Need product decision on future opt-out policy and Phase 2 provider selection/secrets.
- Verification status: Journal created; implementation verification pending.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [ ] Code Verification output (compilation/tests/lint)
- [ ] Functional Verification output (feature verification)
- [ ] Retrospective Evidence (if applicable)
- [ ] Comparison Evidence (if applicable)
- [ ] Checkpoints Evidence (if applicable)

### Environment
- Environment: Ora repo at `/Users/quintenchen/developer/Ora`, macOS/Tauri desktop + runtime workspace, 2026-04-25 CST.

### Commands run + outputs
- `python3 skills/long-task-protocol/scripts/create_journal.py "agent-web-search-roadmap"`
  - Output: `tasks/TASK-20260425-0010-agent-web-search-roadmap.md`
