# TASK-20260427-0206-mode-studio-guided-builder-agent

**Created:** 2026-04-27 02:06 CST
**Status:** Done

---

## Goal
- Build a Mode Studio guided builder agent experience. Users describe the kind of mode they want, receive proactive guidance about topology, agent roster, agent style, tools/skills, safety, and verification, then get a validated Mode + Agents draft. Nothing is persisted until the user explicitly applies the draft.

## Scope / Out of scope
- In scope:
  - Shared schemas for guided builder requests, guidance choices, draft bundles, and apply params.
  - Runtime JSON-RPC for generating, refining, validating, and applying Mode Studio draft bundles.
  - Desktop runtime client support, including browser mock behavior.
  - Mode Studio UI panel that guides users with natural-language chat, suggestion chips, draft preview, validation, and explicit Apply.
  - Tests/typechecks for shared, runtime, and desktop paths.
- Out of scope:
  - Main chat entrypoint integration.
  - Direct autonomous writes during builder chat.
  - Per-agent provider routing beyond existing profile/model hint behavior.
  - Replacing ModeSpec or inventing a second workflow model.

## Constraints
- Compatibility: Preserve existing modes/agents APIs and saved ModeSpec shape.
- Performance: Builder calls should be one provider request per generate/refine in v1, plus local validation.
- Risk: Avoid mutating saved modes/agents until explicit Apply; invalid drafts must block Apply.
- Tool/Environment limits: Use existing provider invocation and stores; no new external services.

## Plan
1. Shared contracts
   - Add Mode Studio builder schemas/types in `packages/shared/src`.
   - Add JSON-RPC methods for `modeStudio.context`, `modeStudio.generateDraft`, `modeStudio.refineDraft`, `modeStudio.validateDraft`, and `modeStudio.applyDraft`.
2. Runtime implementation
   - Implement context gathering, provider prompt/parse/repair, heuristic fallback for local-smoke, validation, and apply flow in runtime store.
   - Wire JSON-RPC handlers.
3. Desktop client and UI
   - Extend `RuntimeClient` and browser mock.
   - Add a guided builder panel to `ModesView` that can generate/refine draft bundles, hydrate the existing canvas draft, show guidance chips/validation, and Apply.
4. Verification
   - Add shared/runtime tests.
   - Run shared tests/build, runtime targeted tests/typecheck, and desktop typecheck.

## Active Files
- `tasks/TASK-20260427-0206-mode-studio-guided-builder-agent.md`
- `packages/shared/src/capabilities.ts`
- `packages/shared/src/rpc.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/components/ModesView.tsx`
- `apps/runtime/test/mode-studio-builder.test.ts`
- `packages/shared/test/contracts.test.ts`

## Decisions
- Decision: Draft-first builder with explicit Apply.
  - Why: User selected this path; it protects saved modes/agents while still enabling agent-guided configuration.
  - Alternatives: Stepwise approval writes, direct save after validation.
  - Tradeoffs: Slightly more UI/state plumbing, much lower risk of accidental writes.
- Decision: Keep ModeSpec as the only mode structure truth.
  - Why: Existing Mode Studio, validation, runtime execution, and presets already converge on ModeSpec.
  - Alternatives: Separate builder workflow model.
  - Tradeoffs: The builder must translate natural language into existing templates/policies rather than arbitrary graphs.
- Decision: Proactive guidance is part of the builder result.
  - Why: User wants the assistant to actively guide choices like agent style, multiple agents, division of labor, and parallelism.
  - Alternatives: Passive one-shot generator.
  - Tradeoffs: More schema/UI surface, better UX for ambiguous requirements.

## Progress Log
- 2026-04-27 02:06 CST - Task created
  Next: Fill in Goal, Scope, Plan, and list Active Files
- 2026-04-27 02:06 CST - Filled implementation plan, decisions, constraints, active files, and checkpoints.
  Next: Inspect existing agent draft/runtime client patterns; implement shared schemas/RPC; wire runtime builder methods.
- 2026-04-27 02:08 CST - SAVEPOINT before broad shared/runtime/desktop edits. Confirmed existing agent draft generation, JSON-RPC method switch, runtime client methods, and Mode Studio draft hydration points.
  Next: Add shared builder schemas; wire runtime JSON-RPC; implement deterministic draft generation/apply helpers.
- 2026-04-27 02:19 CST - Implemented shared builder contracts, runtime builder/apply methods, JSON-RPC wiring, desktop client/mock support, Mode Studio builder panel, and shared/runtime tests. Fixed validation issues around required draft validation payloads, runtime atom family compatibility, and generated agent name normalization.
  Next: Final diff review; report changed files and verification evidence.

## Open Issues
- None.

## TODO
- None.

## Retrospective
- Record 0-3 highest-value pitfalls from this task.
- Leave reusable operational lessons here even when they later get promoted into a skill.

### Item 1
- Pitfall: Adding runtime atoms generically can invalidate otherwise valid generated modes.
- Symptom: `mode-studio-builder.test.ts` failed because `thread_workspace` was not compatible with `generator_verifier`.
- Root Cause: The first implementation added helpful-looking atoms without checking `compatibleFamilies`.
- Reusable Guardrail: Any generated or inferred runtime atom must be filtered through the atom definition's family compatibility before validation.
- Evidence: Runtime test failed, then passed after `modeStudioRuntimeAtoms` added compatibility filtering.
- Scope: Mode generation and future agent-authored mode edits.
- Suggested Writeback Target: None yet; keep local unless this recurs.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Type checks pass

**Output**:
- `pnpm --filter @ora/shared build` passed.
- `pnpm --filter @ora/shared test` passed: `test/contracts.test.ts (78 tests)`.
- `pnpm --filter @ora/runtime exec vitest run test/mode-studio-builder.test.ts` passed: `3 tests`.
- `pnpm --filter @ora/runtime typecheck` passed.
- `pnpm --filter @ora/desktop typecheck` passed.

### Functional Verification (Feature Works)
- [x] Core functionality verification: runtime test proves generate returns a validated draft bundle without persisting modes or agents.
- [x] Edge cases verification: runtime test proves vague prompts return proactive topology guidance with no generated roster.
- [x] Error handling verification: runtime Apply rejects invalid draft bundles through validation before writing.

**Output**:
- `mode-studio-builder.test.ts`: generate draft keeps store mode/agent counts unchanged.
- `mode-studio-builder.test.ts`: apply saves generated agents and mode only after explicit `applyModeStudioDraft`.
- `mode-studio-builder.test.ts`: vague prompt returns `needsInput: true`, `guidance.step: "topology"`, and suggestion choices.

**Examples**:
- Database: `SELECT * FROM table WHERE field_name IS NOT NULL LIMIT 5;`
- API: `curl "url" | jq '.results[0].field_name'`
- UI: Manual test steps and results
- Bug fix: Verification bug is fixed

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: existing `agents.generateDraft` flow and existing Mode Studio `ModeSpec` editor.

### Comparison Points
- [x] Uses explicit schemas and JSON-RPC methods like `agents.generateDraft`.
- [x] Keeps `ModeSpec` as the editor/runtime source of truth.
- [x] Defers persistence until an explicit create/update call.

### Findings
- Consistency: Builder follows existing RPC/store/client layering.
- Differences: v1 uses deterministic guided generation rather than provider JSON parsing so local mock and tests are stable.
- Conclusion: Consistent with current architecture and ready for later provider/tool-call expansion.

## Checkpoints

### Checkpoint 1: Draft generation
- Requirement: Builder can produce a validated draft without persisting it.
- Verification method: Runtime test for `generateModeStudioDraft` plus store state check.
- Status: Pass
- Evidence: `mode-studio-builder.test.ts` generate test passed.

### Checkpoint 2: Explicit apply
- Requirement: Apply persists generated agents/mode only after explicit call.
- Verification method: Runtime test for `applyModeStudioDraft`.
- Status: Pass
- Evidence: `mode-studio-builder.test.ts` apply test passed.

### Checkpoint 3: Guided UX
- Requirement: Mode Studio exposes guidance chips/questions and hydrates the draft canvas.
- Verification method: Desktop typecheck and code-level UI inspection.
- Status: Pass
- Evidence: `apps/desktop/src/components/ModesView.tsx` adds builder panel with prompt, guidance chips, Generate, Apply, and draft hydration; desktop typecheck passed.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Build a Mode Studio guided builder agent that turns natural language into validated Mode + Agents drafts with proactive guidance and explicit Apply.
- Done: Shared builder schemas/RPC, runtime context/generate/refine/validate/apply, desktop client/mock, Mode Studio builder panel, and tests.
- In-progress: None.
- Active files: task journal, `packages/shared/src/mode-studio-builder.ts`, shared rpc/index/tests, runtime run-store/json-rpc/test, desktop runtimeClient/ModesView.
- Next actions (top 3; exact file/function): None.
- Blockers/Risks: v1 deterministic generation is intentionally conservative; provider tool-call builder can reuse the schemas later.
- Verification status: Passed shared build/test, runtime typecheck/test, desktop typecheck, TODO scan.

## Verification

### Evidence Requirements
- [x] Code Verification output (compilation/tests/typecheck)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/Ora`, zsh, CST.

### Commands run + outputs
- `pnpm --filter @ora/shared build`: passed.
- `pnpm --filter @ora/shared test`: passed, `78 tests`.
- `pnpm --filter @ora/runtime exec vitest run test/mode-studio-builder.test.ts`: passed, `3 tests`.
- `pnpm --filter @ora/runtime typecheck`: passed.
- `pnpm --filter @ora/desktop typecheck`: passed.
- `bash skills/long-task-protocol/scripts/todo_scan.sh`: exited 0; output only existing/generated TODO noise in `.ora/runtime.db`, `apps/runtime/.ora/runtime.db`, `skills/skill-creator/scripts/init_skill.py`, and bundled `runtime-sidecar` files.
