# TASK-20260429-1156-ora-skills-discovery-usage

**Created:** 2026-04-29 11:56 CST
**Status:** In Progress

---

## Goal
- Improve Ora runtime skills discovery and usage so zero-config agents can see enabled skills by default, prefer matching skills before ad-hoc reasoning, and load full skill instructions only when needed. The implementation should follow the analysis in `Ora Runtime Skills 发现与使用逻辑剖析计划` and use DeerFlow's `<skill_system><available_skills>...</available_skills></skill_system>` pattern as the main reference, while preserving Ora's current selected-skill full-content injection behavior.

## Scope / Out of scope
- In scope:
  - Add an always-on enabled skill catalog to runtime agent prompts.
  - Strengthen skill-first / progressive-loading instructions.
  - Keep selected skill snippets working as-is.
  - Add tests proving zero-config skill discoverability and disabled-skill exclusion.
  - Verify runtime/shared typecheck and relevant tests.
- Out of scope:
  - Rewriting the entire skill registry or installation flow.
  - Turning all MCP tools into native provider tools.
  - Injecting full content of every enabled skill by default.
  - Changing desktop UI for selecting skills unless tests reveal it is necessary.

## Constraints
- Compatibility:
  - Existing `skillIds` semantics must continue: explicitly selected skills still inject full `SKILL.md` body via `promptSnippets()`.
  - Disabled skills must not appear in selected snippets or the new catalog.
  - Existing modes/custom agents without `skillIds` must continue to run.
- Performance:
  - Prompt catalog must remain lightweight: only name, description, location/category metadata; no full skill body unless selected or fetched with `skills.get`.
- Risk:
  - Avoid prompt bloat and avoid changing agent behavior beyond skills discovery/use.
  - Prompt rules should be strong enough to guide usage but not force irrelevant skill calls on every trivial request.
- Tool/Environment limits:
  - Work inside `/Users/quintenchen/developer/ora`.
  - Use surgical edits; do not refactor adjacent runtime code.
  - This task file is the single source of truth for future iterations.

## Plan
1. `apps/runtime/src/harness/prompt-context.ts`
   - Add an `available_skills` prompt section.
   - Define lightweight formatting for enabled skill descriptors, preferably XML-like and DeerFlow-inspired.
   - Include explicit skill-first / progressive-loading usage rules.
2. `apps/runtime/src/harness/runtime-kernel.ts`
   - Pass `skillRegistry.list({ enabledOnly: true })` into `buildAgentPromptContext()` for every agent runtime context.
   - Keep `skillRegistry.promptSnippets(skillIds)` unchanged for selected full-content snippets.
3. `apps/runtime/src/harness/runtime-tool-executor.ts`
   - Strengthen the current `skills.list/get` prompt hint so agents read matching skills before answering or acting.
4. Tests:
   - Update `apps/runtime/test/runtime-prompt-context.test.ts` for section order and catalog formatting.
   - Add/update runtime integration or skills tests proving zero-config prompts still contain `<available_skills>` and disabled skills are excluded.
   - Preserve existing selected-skill injection tests.
5. Verification:
   - Run targeted tests first.
   - Run relevant typecheck: `pnpm --filter @ora/runtime typecheck` and, if shared types change, `pnpm --filter @ora/shared typecheck`.

## Active Files
- `tasks/TASK-20260429-1156-ora-skills-discovery-usage.md`
- `/Users/quintenchen/.workbuddy/plans/radiant-aurora-darwin.md`
- `apps/runtime/src/harness/prompt-context.ts`
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/harness/runtime-tool-executor.ts`
- `apps/runtime/test/runtime-prompt-context.test.ts`
- `apps/runtime/test/skills.test.ts`
- Potentially `apps/runtime/test/runtime-integration.test.ts` or `apps/runtime/test/runtime-smoke.test.ts` if a kernel-level prompt test is needed.

## Decisions
- Decision: Use always-on lightweight catalog, not full skill body injection for every enabled skill.
  - Why: DeerFlow exposes available skills structurally while using progressive loading for full instructions; this improves discoverability without prompt explosion.
  - Alternatives: Make `effectiveAgentSkillIds()` default to all enabled skill ids.
  - Tradeoffs: Catalog requires an extra `skills.get` call for full instructions, but preserves prompt budget and selected-skill behavior.
- Decision: Keep `promptSnippets(skillIds)` semantics unchanged.
  - Why: Existing tests and user-selected skill behavior rely on it.
  - Alternatives: Merge catalog and snippets into one skill system block.
  - Tradeoffs: Two skill-related sections may coexist, but they serve different purposes: catalog for discovery, snippets for selected full instructions.
- Decision: Use DeerFlow as design reference, not exact port.
  - Why: Ora's runtime has its own tool protocol and skill registry; a minimal structural parity change is enough for this iteration.
  - Alternatives: Rebuild tool/skill/MCP aggregation around a unified DeerFlow-style registry.
  - Tradeoffs: Smaller change now; MCP unification remains future work.

## Progress Log
- 2026-04-29 11:56 CST - Task created from long-task-protocol template.
  Next: Fill Goal, Scope, Plan, and Active Files.
- 2026-04-29 12:00 CST - Filled task journal from `Ora Runtime Skills 发现与使用逻辑剖析计划`; established this file as the source of truth for the implementation iteration.
  Next: 1) edit `prompt-context.ts` to add `available_skills`; 2) wire enabled skill descriptors from `runtime-kernel.ts`; 3) add tests for zero-config catalog and disabled-skill exclusion.

## Open Issues
- [ ] Decide exact placement of `available_skills` section relative to `tool_protocol`; current preference: before or adjacent to tool protocol so the usage rule is visible before tool-call mechanics.
- [ ] Decide whether kernel-level catalog behavior should be tested via `skills.test.ts`, `runtime-integration.test.ts`, or a narrower prompt-builder unit test plus one runtime test.

## TODO
- [ ] Add `available_skills` prompt section to `prompt-context.ts`.
- [ ] Wire `skillRegistry.list({ enabledOnly: true })` through `runtime-kernel.ts` into prompt context.
- [ ] Strengthen skill-first wording in `runtime-tool-executor.ts`.
- [ ] Add/update prompt-context tests.
- [ ] Add/update runtime/skills tests for zero-config enabled skill catalog and disabled-skill exclusion.
- [ ] Run targeted tests and typecheck; paste outputs under `Verification`.
- [ ] Update `Progress Log`, `Compressed State`, and `Retrospective` before DONE.

## Retrospective
- No retrospective items yet. Revisit after implementation or first failed verification loop.

## Functional Verification

### Code Verification (Code Correctness)
- [ ] Code compiles/runs without errors
- [ ] Unit tests pass
- [ ] Lint/type checks pass

**Output**: Pending implementation.

### Functional Verification (Feature Works)
- [ ] Zero-config agent prompt contains enabled skill catalog.
- [ ] Disabled skills are excluded from catalog.
- [ ] Selected skills still inject full instructions.
- [ ] Prompt instructs agents to inspect matching skills before acting.

**Output**: Pending implementation.

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: `https://github.com/bytedance/deer-flow/tree/main/backend/packages/harness/deerflow`
- Specific reference modules from prior analysis:
  - `deerflow/skills/loader.py`
  - `deerflow/agents/lead_agent/prompt.py`
  - `deerflow/agents/lead_agent/agent.py`
  - `deerflow/tools/tools.py`

### Comparison Points
- [ ] DeerFlow-like always-on `<available_skills>` catalog exists in Ora prompt.
- [ ] Progressive loading rule exists: inspect/read relevant skill before applying it; load supporting files only when needed.
- [ ] Ora preserves its existing selected-skill full snippet injection.
- [ ] Ora avoids full MCP/tool registry rewrite in this iteration.

### Findings
- Consistency: Target design should be structurally consistent with DeerFlow on skill catalog visibility and progressive loading.
- Differences: Ora will keep skills as runtime tools plus prompt catalog rather than porting DeerFlow's full LangChain tool aggregation.
- Conclusion: Minimal parity target is catalog + stronger usage rule + tests.

## Checkpoints

### Checkpoint 1: Enabled skill catalog visible by default
- Requirement: Agents receive a lightweight catalog of enabled skills even when `skillIds=[]`.
- Verification method: Unit/runtime test captures built system prompt and checks `<available_skills>` plus skill name/description/location.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending.

### Checkpoint 2: Disabled skills excluded
- Requirement: Disabled skills do not appear in the new catalog and are not injected as selected snippets.
- Verification method: Test creates/disables a skill, starts or builds prompt, and checks absence from catalog/snippets.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending.

### Checkpoint 3: Skill-first instruction strengthened
- Requirement: Prompt tells agent to inspect/read matching skill before answering or acting.
- Verification method: Unit test or string assertion on `RuntimeToolExecutor.systemPrompt()` / final prompt.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending.

### Checkpoint 4: Existing selected skill behavior preserved
- Requirement: Explicitly selected enabled skill still injects full `SKILL.md` body; disabled selected skill still warns and does not inject.
- Verification method: Existing `skills.test.ts` passes; add assertion if necessary.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Make Ora agents structurally discover enabled skills and prefer matching skills before ad-hoc work.
- Done: Created source-of-truth task journal; imported analysis plan; defined scope, constraints, decisions, TODOs, and checkpoints.
- In-progress: No code changes yet.
- Active files: `prompt-context.ts`, `runtime-kernel.ts`, `runtime-tool-executor.ts`, prompt/skills tests, this task file.
- Next actions (top 3; exact file/function):
  1. `apps/runtime/src/harness/prompt-context.ts` — add `available_skills` section and formatting helper.
  2. `apps/runtime/src/harness/runtime-kernel.ts` — pass enabled skill descriptors into prompt context.
  3. `apps/runtime/test/runtime-prompt-context.test.ts` / `apps/runtime/test/skills.test.ts` — add catalog tests.
- Blockers/Risks: Need choose exact runtime test location; avoid prompt bloat and behavior overreach.
- Verification status: Pending; no implementation yet.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [ ] Code Verification output (compilation/tests/lint)
- [ ] Functional Verification output (feature verification)
- [ ] Retrospective Evidence (if applicable)
- [ ] Comparison Evidence (if applicable)
- [ ] Checkpoints Evidence (if applicable)

### Environment
- Environment: macOS / zsh / workspace `/Users/quintenchen/developer/ora`.

### Commands run + outputs
- `python3 "$HOME/.workbuddy/skills/long-task-protocol/scripts/create_journal.py" "ora-skills-discovery-usage"`
  - Output: `tasks/TASK-20260429-1156-ora-skills-discovery-usage.md`
- Implementation verification commands: pending.
