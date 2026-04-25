# TASK-20260425-0010-agent-web-search-roadmap

**Created:** 2026-04-25 00:10 CST
**Status:** Done

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
  - `apps/runtime/src/json-rpc.ts`
  - `apps/runtime/src/run-store.ts`
  - `apps/runtime/src/harness/search-providers/*`
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
- 2026-04-25 00:25 CST - SAVEPOINT: Inspected shared mode defaults, desktop run config, runtime config resolution, runtime tool executor, and MCP helper path. Agent team findings confirm built-in modes lack default web tools, runtime direct calls can drop mode tools when `toolIds: []` is supplied, and `web.search` is hardcoded to DuckDuckGo HTML.
  Next: 1. Add shared default web tool constants and runtime run-config normalization. 2. Introduce `SearchProvider` modules for stable providers plus fallback. 3. Add MCP search adapter/tests and update verification evidence.
- 2026-04-25 00:44 CST - Implemented all three phases and post-implementation review fixes. Added default web tools, search provider abstraction, Brave/Tavily/SerpAPI/Kagi/DuckDuckGo/MCP providers, MCP high-risk approval classification, LangGraph/runtime-kernel routing for web-tool runs, env docs, and tests. Verification passed.
  Next: 1. Optional future UI polish for a dedicated network-tools settings panel. 2. Optional real-provider smoke checks with live API keys. 3. Optional provider host allow-list extension if custom enterprise search endpoints are needed.

## Open Issues
- [x] Confirm whether every mode should always enable web tools, or whether a future per-mode/network-off policy should be added after Phase 1.
  - Decision: enable by default and support explicit `metadata.disableDefaultWebTools: true` for network-off policy/test paths.
- [x] Choose Phase 2 default stable provider order: Brave, Tavily, SerpAPI, Kagi, or user-selected only.
  - Decision: explicit `searchProvider.id`, then `ORA_SEARCH_PROVIDER`, then first available key in Brave/Tavily/SerpAPI/Kagi order, then DuckDuckGo fallback.
- [x] Decide where search provider secrets live: existing provider config, dedicated runtime settings, or env-only.
  - Decision: env-only for search provider API keys; no hardcoded secrets and no custom API-keyed base URLs.
- [x] Decide whether LangGraph mode support must be included in Phase 1 or explicitly deferred until the tool loop is shared.
  - Decision: web-tool-capable `runs.start` routes through `runtime-kernel` even when SessionManager/LangGraph is enabled; tests that specifically exercise LangGraph opt out of default web tools.

## TODO
- [x] Phase 1: make `web.search` and `web.fetch` effective defaults for all modes/runs.
- [x] Phase 1: add tests proving default web tools are present in built-in modes, cloned/custom modes, and runtime run config.
- [x] Phase 1: verify an agent can call `web.search` with a provider that has no native search.
- [x] Phase 2: define `SearchProvider` interface and normalized search result schema.
- [x] Phase 2: implement at least one stable provider behind env/config.
- [x] Phase 2: retire or demote DuckDuckGo HTML scraping to explicit fallback/test-only behavior.
- [x] Phase 3: support MCP search server discovery/call path.
- [x] Phase 3: document MCP search setup for custom/internal/RAG search.

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
### Item 2
- Pitfall: Runtime defaults can accidentally expand data-egress boundaries.
- Symptom: Adding default network tools everywhere can make explicit custom `toolIds` behave more broadly than callers expect.
- Root Cause: Defaults were applied as effective runtime policy, not only preset metadata.
- Reusable Guardrail: When default-enabling network tools, add a clear opt-out policy and tests for the opt-out path.
- Evidence: Security review flagged forced network tools; implementation now supports `metadata.disableDefaultWebTools: true` and tests it.
- Scope: Runtime tool policy.
- Suggested Writeback Target: none yet.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm lint`
  - Output: `Scope: 3 of 4 workspace projects`
  - Result: pass
- `pnpm typecheck`
  - Output: `packages/shared typecheck: Done`, `apps/runtime typecheck: Done`, `apps/desktop typecheck: Done`
  - Result: pass
- `pnpm test`
  - Output: `packages/shared test: Tests 70 passed (70)`; `apps/runtime test: Test Files 11 passed (11), Tests 109 passed (109)`
  - Result: pass
- `pnpm build`
  - Output: `packages/shared build: Done`, `apps/runtime build: Done`, `apps/desktop build: Done`
  - Result: pass; Vite reported the existing >500 kB chunk warning.

### Functional Verification (Feature Works)
- [x] Phase 1 core functionality: start a run using a provider with no native search and verify the agent emits/executes `web.search`.
- [x] Phase 1 edge cases: mode with existing custom `toolIds` keeps those tools and gains web tools without duplicates.
- [x] Phase 1 error handling: network failure yields a failed/degraded `tool.called` event without crashing the run.
- [x] Phase 2 core functionality: configured stable provider returns normalized results for `web.search`.
- [x] Phase 2 edge cases: missing API key, empty query, provider timeout, malformed provider response.
- [x] Phase 3 core functionality: fake MCP search server returns results through MCP adapter.

**Output**:
- `apps/runtime/test/runtime-smoke.test.ts`: `executes web.search for a provider without native browsing` verifies a plain OpenAI-compatible mock provider emits `{"tool":"web.search"}` and receives normalized Brave search results.
- `apps/runtime/test/runtime-smoke.test.ts`: `adds default web tools to cloned modes and effective runtime configs` verifies cloned/custom mode propagation, deduping, and `metadata.disableDefaultWebTools`.
- `apps/runtime/test/runtime-tool-executor.test.ts`: stable provider tests cover Brave, Tavily, SerpAPI, Kagi normalization; missing key; timeout; malformed response; DuckDuckGo fallback; MCP search adapter.

## Comparison (If Applicable)

### Reference
- Existing runtime tool loop and network tools:
  - `apps/runtime/src/harness/runtime-tool-executor.ts`
  - `apps/runtime/src/harness/runtime-kernel.ts`
  - `packages/shared/src/index.ts`

### Comparison Points
- [x] Tool registration matches `MVP_TOOLS` and implemented runtime tool IDs.
- [x] Mode/run config propagation matches existing `toolIds` handling.
- [x] Search/fetch events remain visible through existing `tool.called` and Trails UI.

### Findings
- Consistency: Phase 1 should reuse existing tool IDs and executor behavior.
- Differences: Phase 2 introduces provider-specific configuration and result normalization through new `SearchProvider` modules; DuckDuckGo is now explicit fallback.
- Conclusion: Tool registration still matches `MVP_TOOLS`; run config uses the same `toolIds` field plus `searchProvider`; existing `tool.called` events carry `web.search`, provider output, and MCP search output.

## Checkpoints

### Checkpoint 1: Phase 1 Default Web Tools
- Requirement: Every effective mode/run includes `web.search` and `web.fetch` by default.
- Verification method: Unit/contract tests over built-in modes, cloned/custom modes, and `runs.start`/`runs.startStreaming` config.
- Status: [x] Pass / [ ] Fail
- Evidence: `packages/shared/test/contracts.test.ts` asserts all MVP modes contain default web tools; runtime smoke test asserts cloned/custom mode and effective run config behavior.

### Checkpoint 2: Phase 1 Agent Can Search Without Provider-Native Browsing
- Requirement: A plain chat provider can trigger `web.search` through Ora runtime tool protocol and answer from the result.
- Verification method: Mock provider emits `{"tool":"web.search","args":{"query":"..."}}`; assert `tool.called` success and final answer consumes tool result.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/runtime/test/runtime-smoke.test.ts` mock OpenAI-compatible provider emits a JSON `web.search` call and final output consumes the search result.

### Checkpoint 3: Phase 2 Stable Search Provider Abstraction
- Requirement: `web.search` dispatches through a configured `SearchProvider` abstraction, not direct DuckDuckGo HTML scraping.
- Verification method: Mock Brave/Tavily/SerpAPI/Kagi response fixtures normalize to the shared result schema; missing key/timeouts are handled.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/runtime/test/runtime-tool-executor.test.ts` covers Brave/Tavily/SerpAPI/Kagi normalization, env provider selection, missing keys, timeouts, malformed provider responses, and DuckDuckGo fallback.

### Checkpoint 4: Phase 3 MCP Search Server Support
- Requirement: Ora can discover/call an MCP search server and pass results back through the same agent tool loop.
- Verification method: Fake MCP server exposes search tool/resource; runtime test verifies `mcp.call` or search adapter result and final answer.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/runtime/test/runtime-tool-executor.test.ts` fake stdio MCP server exposes a search tool; `web.search` with `searchProvider.id: "mcp"` returns normalized MCP results and is classified high risk.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Make Ora agents web-search-capable independent of provider-native browsing.
- Done: Implemented Phase 1/2/3, addressed security/architecture review findings, and passed verification.
- In-progress: None.
- Active files: `.env.example`, `packages/shared/src/index.ts`, `apps/desktop/src/lib/useRunActions.ts`, `apps/runtime/src/json-rpc.ts`, `apps/runtime/src/run-store.ts`, `apps/runtime/src/harness/runtime-tool-executor.ts`, `apps/runtime/src/harness/search-providers/*`, runtime/shared tests, this task journal.
- Next actions (top 3; exact file/function):
  1. Optional: add a dedicated UI settings surface for `searchProvider`.
  2. Optional: run live provider smoke checks with real Brave/Tavily/SerpAPI/Kagi keys.
  3. Optional: add a reviewed enterprise provider path if custom hosted search endpoints are needed.
- Blockers/Risks: None blocking. Custom API-keyed base URLs intentionally not supported to prevent key exfiltration.
- Verification status: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: Ora repo at `/Users/quintenchen/developer/Ora`, macOS/Tauri desktop + runtime workspace, 2026-04-25 CST.

### Commands run + outputs
- `python3 skills/long-task-protocol/scripts/create_journal.py "agent-web-search-roadmap"`
  - Output: `tasks/TASK-20260425-0010-agent-web-search-roadmap.md`
- `pnpm lint`
  - Output: `Scope: 3 of 4 workspace projects`
- `pnpm typecheck`
  - Output: `packages/shared typecheck: Done`; `apps/runtime typecheck: Done`; `apps/desktop typecheck: Done`
- `pnpm test`
  - Output: `packages/shared test: Tests 70 passed (70)`; `apps/runtime test: Test Files 11 passed (11), Tests 109 passed (109)`
- `pnpm build`
  - Output: `packages/shared build: Done`; `apps/runtime build: Done`; `apps/desktop build: Done`; Vite chunk-size warning only.
- `bash skills/long-task-protocol/scripts/todo_scan.sh`
  - Output: only existing binary/generated sidecar matches under `.ora/runtime.db`, `apps/runtime/.ora/runtime.db`, and `apps/desktop/src-tauri/resources/runtime-sidecar/*`; no new source TODOs from this implementation.
