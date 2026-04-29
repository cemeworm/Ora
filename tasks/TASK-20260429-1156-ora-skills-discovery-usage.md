# TASK-20260429-1156-ora-skills-discovery-usage

**Created:** 2026-04-29 11:56 CST
**Status:** Done

---

## Goal
- Improve Ora runtime skills discovery and usage so zero-config agents can see enabled skills by default, prefer matching skills before ad-hoc reasoning, and load full skill instructions only when needed. The implementation follows the analysis in `Ora Runtime Skills 发现与使用逻辑剖析计划` and uses DeerFlow's `<skill_system><available_skills>...</available_skills></skill_system>` pattern as the main reference, while preserving Ora's current selected-skill full-content injection behavior.

## Scope / Out of scope
- In scope:
  - Add an always-on enabled skill catalog to runtime agent prompts. **Done**
  - Strengthen skill-first / progressive-loading instructions. **Done**
  - Keep selected skill snippets working as-is. **Done**
  - Add tests proving zero-config skill discoverability and disabled-skill exclusion. **Done**
  - Verify runtime typecheck and relevant tests. **Done**
- Out of scope:
  - Rewriting the entire skill registry or installation flow.
  - Turning all MCP tools into native provider tools.
  - Injecting full content of every enabled skill by default.
  - Changing desktop UI for selecting skills.

## Constraints
- Compatibility:
  - Existing `skillIds` semantics continue: explicitly selected skills still inject full `SKILL.md` body via `promptSnippets()`.
  - Disabled skills do not appear in selected snippets or the new catalog.
  - Existing modes/custom agents without `skillIds` continue to run.
- Performance:
  - Prompt catalog remains lightweight: name, description, location/category metadata only; no full skill body unless selected or fetched with `skills.get`.
- Risk:
  - Prompt bloat avoided; full skill content is still progressive-loaded.
  - Prompt rules are stronger but explicitly avoid unrelated/trivial skill use.
- Tool/Environment limits:
  - Work stayed inside `/Users/quintenchen/developer/ora`.
  - Changes were surgical and limited to runtime prompt/tool/test files plus this task journal.

## Plan
1. `apps/runtime/src/harness/prompt-context.ts`
   - Added an `available_skills` prompt section.
   - Added XML-like lightweight formatting for enabled skill descriptors.
   - Added DeerFlow-inspired skill-first / progressive-loading usage rule.
2. `apps/runtime/src/harness/runtime-kernel.ts`
   - Passed `skillRegistry.list({ enabledOnly: true })` into `buildAgentPromptContext()` for every agent runtime context.
   - Kept `skillRegistry.promptSnippets(skillIds)` unchanged for selected full-content snippets.
3. `apps/runtime/src/harness/runtime-tool-executor.ts`
   - Strengthened the `skills.list/get` prompt hint into an explicit `Skill-first rule`.
4. Tests:
   - Updated `apps/runtime/test/runtime-prompt-context.test.ts` for section order, catalog formatting, and disabled-skill exclusion.
   - Added `apps/runtime/test/skills.test.ts` zero-config catalog test covering enabled skill visibility, disabled skill exclusion, and selected full-body non-injection.
   - Updated `apps/runtime/test/runtime-tool-executor.test.ts` for the stronger prompt wording.
5. Verification:
   - Runtime tests passed.
   - Runtime typecheck passed.
   - Changed-file TODO scan passed; repo-wide TODO scan still reports pre-existing generated/template noise outside touched implementation files.

## Active Files
- `tasks/TASK-20260429-1156-ora-skills-discovery-usage.md`
- `apps/runtime/src/harness/prompt-context.ts`
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/harness/runtime-tool-executor.ts`
- `apps/runtime/test/runtime-prompt-context.test.ts`
- `apps/runtime/test/skills.test.ts`
- `apps/runtime/test/runtime-tool-executor.test.ts`

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
- Decision: Place `available_skills` before `tool_protocol`.
  - Why: Agents should see the skill catalog and usage rule before the mechanics of calling tools.
  - Alternatives: Put catalog after tool protocol or merge with selected skill snippets.
  - Tradeoffs: Earlier placement gives stronger behavioral guidance without disrupting selected skill snippets.

## Progress Log
- 2026-04-29 11:56 CST - Task created from long-task-protocol template.
  Next: Fill Goal, Scope, Plan, and Active Files.
- 2026-04-29 12:00 CST - Filled task journal from `Ora Runtime Skills 发现与使用逻辑剖析计划`; established this file as the source of truth for the implementation iteration.
  Next: 1) edit `prompt-context.ts` to add `available_skills`; 2) wire enabled skill descriptors from `runtime-kernel.ts`; 3) add tests for zero-config catalog and disabled-skill exclusion.
- 2026-04-29 12:16 CST - Implemented available skills catalog, kernel wiring, stronger skill-first prompt, and runtime/prompt/tool tests. First test run exposed one stale assertion in `runtime-tool-executor.test.ts`; updated it to the new prompt wording and reran successfully.
  Next: 1) run typecheck; 2) run TODO gates; 3) update verification/checkpoints and close task.
- 2026-04-29 12:23 CST - Verification complete: runtime tests and typecheck passed; changed implementation files contain no TODO markers; repo-wide TODO scan still reports pre-existing generated/template matches outside touched files. Task closed as Done with evidence below.
  Next: none.

## Open Issues
- None for this implementation.
- Residual repository hygiene note: `todo_scan.sh` reports pre-existing TODO markers in `.ora/skills/private/think/SKILL.md`, `skills/skill-creator/scripts/init_skill.py`, generated `apps/desktop/src-tauri/resources/runtime-sidecar/*`, and binary database/sidecar files. These were not introduced or touched by this task; changed implementation files scan clean.

## TODO
- Completed; no open implementation tasks for this task.

## Retrospective

### Item 1
- Pitfall: Tests coupled to exact prompt wording can fail after intentional prompt strengthening.
- Symptom: First runtime test run failed because `runtime-tool-executor.test.ts` expected the old sentence `Use skills.list to discover enabled skills`.
- Root Cause: The assertion checked a full legacy phrase instead of behaviorally relevant tokens.
- Reusable Guardrail: When changing prompt policy text intentionally, update assertions to check stable behavioral anchors such as `Skill-first rule` and `Use skills.get` rather than old full-sentence wording.
- Evidence: First test run failed on `RuntimeToolExecutor > tells agents to answer tool-capability questions from Ora runtime tools`; second run passed after assertion update.
- Scope: local_only
- Suggested Writeback Target: None; this is a normal local test-maintenance pitfall.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint/type checks pass via TypeScript typecheck

**Output**:
- `pnpm --filter @ora/runtime test -- runtime-prompt-context.test.ts skills.test.ts runtime-tool-executor.test.ts`
  - Final output summary:
    - `Test Files  17 passed (17)`
    - `Tests  253 passed (253)`
    - `Exit Code: 0`
- `pnpm --filter @ora/runtime typecheck`
  - Final output summary:
    - `tsc -p tsconfig.json --noEmit`
    - `Exit Code: 0`

### Functional Verification (Feature Works)
- [x] Zero-config agent prompt contains enabled skill catalog.
- [x] Disabled skills are excluded from catalog.
- [x] Selected skills still inject full instructions.
- [x] Prompt instructs agents to inspect matching skills before acting.

**Output**:
- `apps/runtime/test/runtime-prompt-context.test.ts`
  - Verifies section order includes `available_skills` before `tool_protocol`.
  - Verifies `<available_skills>`, `<name>deep-research</name>`, `<location>skills/deep-research/SKILL.md</location>`.
  - Verifies disabled skill `disabled-review` is absent.
  - Verifies usage rule contains `inspect that skill before answering or acting`.
- `apps/runtime/test/skills.test.ts`
  - Verifies zero-config run system prompts include `<available_skills>`.
  - Verifies enabled private skill `<name>runtime-review</name>` and description appear.
  - Verifies disabled private skill `runtime-disabled-review` is absent.
  - Verifies unselected full skill body marker `Runtime skill injection marker` is absent, preserving progressive loading.
  - Verifies `Skill-first rule` appears in provider system prompts.
- Existing selected-skill test still passes:
  - Enabled selected skill injects `Runtime skill injection marker`.
  - Disabled selected skill does not inject and still emits disabled warning metadata.

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: `https://github.com/bytedance/deer-flow/tree/main/backend/packages/harness/deerflow`
- Specific reference modules from prior analysis:
  - `deerflow/skills/loader.py`
  - `deerflow/agents/lead_agent/prompt.py`
  - `deerflow/agents/lead_agent/agent.py`
  - `deerflow/tools/tools.py`

### Comparison Points
- [x] DeerFlow-like always-on `<available_skills>` catalog exists in Ora prompt.
- [x] Progressive loading rule exists: inspect/read relevant skill before applying it; load supporting files only when needed.
- [x] Ora preserves its existing selected-skill full snippet injection.
- [x] Ora avoids full MCP/tool registry rewrite in this iteration.

### Findings
- Consistency: Implemented structural parity with DeerFlow's most important skill-discovery behavior: always-on skill catalog plus progressive loading guidance.
- Differences: Ora still keeps skills as runtime tools plus prompt catalog rather than porting DeerFlow's full LangChain/MCP/ACP tool aggregation.
- Conclusion: Minimal parity target is complete for skill catalog visibility and skill-first usage.

## Checkpoints

### Checkpoint 1: Enabled skill catalog visible by default
- Requirement: Agents receive a lightweight catalog of enabled skills even when `skillIds=[]`.
- Verification method: Runtime test captures provider system prompt and checks `<available_skills>` plus skill name/description/location.
- Status: [x] Pass / [ ] Fail
- Evidence: `apps/runtime/test/skills.test.ts` zero-config test passed; runtime test run `253 passed`.

### Checkpoint 2: Disabled skills excluded
- Requirement: Disabled skills do not appear in the new catalog and are not injected as selected snippets.
- Verification method: Tests create and disable skills, then check absence from catalog/snippets.
- Status: [x] Pass / [ ] Fail
- Evidence: `runtime-prompt-context.test.ts` checks `disabled-review` absent; `skills.test.ts` checks `runtime-disabled-review` absent and existing disabled selected-skill behavior still passes.

### Checkpoint 3: Skill-first instruction strengthened
- Requirement: Prompt tells agent to inspect/read matching skill before answering or acting.
- Verification method: String assertions on prompt context and runtime tool prompt.
- Status: [x] Pass / [ ] Fail
- Evidence: `runtime-prompt-context.test.ts` checks `inspect that skill before answering or acting`; `runtime-tool-executor.test.ts` checks `Skill-first rule` and `Use skills.get`; tests passed.

### Checkpoint 4: Existing selected skill behavior preserved
- Requirement: Explicitly selected enabled skill still injects full `SKILL.md` body; disabled selected skill still warns and does not inject.
- Verification method: Existing `skills.test.ts` selected-skill test.
- Status: [x] Pass / [ ] Fail
- Evidence: `skills.test.ts` passed in final runtime test run.

**All checkpoints passed before marking task DONE.**

## Compressed State (<= 20 lines)
- Objective: Make Ora agents structurally discover enabled skills and prefer matching skills before ad-hoc work.
- Done: Added prompt `available_skills` catalog, runtime-kernel enabled-skill wiring, stronger `Skill-first rule`, and tests.
- Changed files: `prompt-context.ts`, `runtime-kernel.ts`, `runtime-tool-executor.ts`, `runtime-prompt-context.test.ts`, `runtime-tool-executor.test.ts`, `skills.test.ts`, this task journal.
- Behavior: Zero-config prompts now include enabled skills as lightweight XML-like catalog; selected skills still inject full instructions; disabled skills are excluded.
- Verification: Runtime tests passed (`17 passed`, `253 tests`); runtime typecheck passed.
- TODO gate: Repo-wide scan has pre-existing external noise; changed implementation files scan clean.
- Next actions (top 3; exact file/function): none.
- Blockers/Risks: None for this iteration; future MCP/tool registry unification remains out of scope.
- Verification status: Complete.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: macOS / zsh / workspace `/Users/quintenchen/developer/ora`.

### Commands run + outputs
- `python3 "$HOME/.workbuddy/skills/long-task-protocol/scripts/create_journal.py" "ora-skills-discovery-usage"`
  - Output: `tasks/TASK-20260429-1156-ora-skills-discovery-usage.md`
- First test run: `pnpm --filter @ora/runtime test -- runtime-prompt-context.test.ts skills.test.ts`
  - Output summary: failed 1 stale assertion in `runtime-tool-executor.test.ts`; expected old phrase `Use skills.list to discover enabled skills` after prompt wording intentionally changed.
- Final test run: `pnpm --filter @ora/runtime test -- runtime-prompt-context.test.ts skills.test.ts runtime-tool-executor.test.ts`
  - Output summary:
    ```text
    Test Files  17 passed (17)
    Tests  253 passed (253)
    Exit Code: 0
    ```
- Typecheck: `pnpm --filter @ora/runtime typecheck`
  - Output summary:
    ```text
    > @ora/runtime@0.1.0 typecheck /Users/quintenchen/developer/ora/apps/runtime
    > tsc -p tsconfig.json --noEmit
    Exit Code: 0
    ```
- Repo-wide TODO gate: `bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"`
  - Actual output:
    ```text
    ./.ora/skills/private/think/SKILL.md:82:**No placeholders in approved plans.** Every step must be concrete before approval. Forbidden patterns: TBD, TODO, "implement later," "similar to step N," "details to be determined." A plan with placeholders is a promise to plan later.
    Binary file ./.ora/runtime.db matches
    ./skills/skill-creator/scripts/init_skill.py:20:description: [TODO: Complete and informative explanation of what the skill does and when to use this skill. Include WHEN to use this skill - specific scenarios, file types, or tasks that trigger it.]
    ./skills/skill-creator/scripts/init_skill.py:27:[TODO: 1-2 sentences explaining what this skill enables]
    ./skills/skill-creator/scripts/init_skill.py:31:[TODO: Choose the structure that best fits this skill's purpose. Common patterns:
    ./skills/skill-creator/scripts/init_skill.py:57:## [TODO: Replace with the first main section based on chosen structure]
    ./skills/skill-creator/scripts/init_skill.py:59:[TODO: Add content here. See examples in existing skills:
    ./skills/skill-creator/scripts/init_skill.py:119:    # TODO: Add actual script logic here
    ./skills/skill-creator/scripts/init_skill.py:266:    print("1. Edit SKILL.md to complete the TODO items and update the description")
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:16241:      // TODO: use BindOncePromise here once a new version of @opentelemetry/core is available.
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:17735:      // TODO: find a reasonable mean to clean the memo;
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:18759:       * TODO: semver filter? no spec yet.
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:39005:        // TODO(murgatroid99): Find a better way to handle this
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:41341:        // TODO(murgatroid99): handle 100 and 101
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:45336:      // TODO(cjihrig): Remove these encoding headers from the default response
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:74112:        // TODO: fix export logic
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:87239:      info("TODO: Support non-isolated groups.");
    ./apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs:103622:  // 						// TODO remove
    Binary file ./apps/desktop/src-tauri/resources/runtime-sidecar/bin/node matches
    ```
  - Interpretation: These are pre-existing generated/template/local-skill matches outside touched implementation files; none were introduced by this task.
- Changed-file TODO check: `grep -RIn "TODO" "apps/runtime/src/harness/prompt-context.ts" "apps/runtime/src/harness/runtime-kernel.ts" "apps/runtime/src/harness/runtime-tool-executor.ts" "apps/runtime/test/runtime-prompt-context.test.ts" "apps/runtime/test/skills.test.ts" "apps/runtime/test/runtime-tool-executor.test.ts" || true`
  - Output: empty
  - Exit Code: 0
