# TASK-20260427-0046-agent-natural-language-creation-wizard

**Created:** 2026-04-27 00:46 CST
**Status:** DONE

---

## Goal
- Replace the current manual custom-agent creation flow with a natural-language creation wizard. When the user clicks New agent, Ora should guide them through a short conversation, generate a complete custom agent draft using the currently selected provider/model, show the generated fields for review/editing, and only write `.ora/agents/<name>/config.yaml` plus `SOUL.md` after explicit user confirmation.

## Scope / Out of scope
- In scope:
- Add a draft-generation JSON-RPC contract and runtime method.
- Generate custom-agent drafts from natural-language conversation using the current provider/model.
- Add an Agents-page wizard that makes conversation the primary creation path and keeps final confirmation explicit.
- Preserve existing edit, delete, chat, select persona, and team-composer behavior.
- Out of scope:
- New custom-agent persistence format.
- Auto-creating agents without user confirmation.
- Manual `@mention` interactions or runtime multi-agent orchestration changes.
- Offline/local-rule fallback for draft generation in this pass.

## Constraints
- Compatibility:
- Existing `agents.create`, `agents.update`, and `.ora/agents/<name>` file semantics must remain unchanged.
- Existing dirty workspace edits are treated as user/previous-agent work and must not be reverted.
- Performance:
- Draft generation should be a single provider call per user wizard turn and must not create runs, checkpoints, sessions, or normal chat history.
- Risk:
- Generated JSON may be invalid or collide with existing agent names; runtime must validate and return a user-facing issue rather than writing malformed data.
- Tool/Environment limits:
- Use `apply_patch` for manual edits.
- Keep the task file as the only authoritative state for this implementation.

## Plan
1. Shared contract: add `agents.generateDraft` schemas/types and JSON-RPC method support in `packages/shared/src/capabilities.ts`, `packages/shared/src/rpc.ts`, and shared exports/tests.
2. Runtime generation: implement `agents.generateDraft` in `apps/runtime/src/custom-agents.ts`, wire it through `LocalRunStore` and `json-rpc.ts`, validate/repair generated drafts, and cover vague input, draft-ready output, name collision, and provider failure.
3. Desktop client/model: expose `runtimeClient.generateAgentDraft(...)` and update browser mock behavior so development mode can exercise the wizard without Tauri.
4. Agents UI: replace create-mode primary surface in `apps/desktop/src/components/AgentsView.tsx` with a conversation-first wizard, draft preview, editable confirmation fields, and existing `createAgent` final save.
5. Verification: run targeted shared/runtime/desktop tests and typechecks, then update checkpoints, retrospective, and DONE gates.

## Active Files
- tasks/TASK-20260427-0046-agent-natural-language-creation-wizard.md
- packages/shared/src/capabilities.ts
- packages/shared/src/rpc.ts
- packages/shared/test/contracts.test.ts
- apps/runtime/src/run-store.ts
- apps/runtime/src/json-rpc.ts
- apps/runtime/test/custom-agents.test.ts
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/components/AgentsView.tsx

## Decisions
- Decision: Use a conversation-first wizard with final editable confirmation.
  - Why: Matches the user request that Ora should guide natural-language generation instead of making users fill every field themselves.
  - Alternatives: Hide the form entirely or add a side helper next to the form.
  - Tradeoffs: Keeps a clear confirmation/review step while making manual editing secondary.
- Decision: Use current provider/model through a dedicated `agents.generateDraft` RPC method.
  - Why: Provides high-quality draft generation without polluting normal chat/session/run history.
  - Alternatives: Reuse normal chat runs or use local frontend heuristics only.
  - Tradeoffs: Requires a small runtime API, but keeps persistence and run state clean.
- Decision: Reuse existing `agents.create` for persistence.
  - Why: Avoids a second source of truth for custom agents.
  - Alternatives: Add a separate wizard draft store.
  - Tradeoffs: Unsaved wizard state remains local UI state until confirmation.

## Progress Log
- 2026-04-27 00:46 CST - Task created
  Next: Fill in Goal, Scope, Plan, and list Active Files
- 2026-04-27 00:50 CST - Filled task record from the approved plan and user-selected defaults: conversation-first wizard, current-model generation, explicit confirmation, existing custom-agent persistence.
  Next: Add shared draft schemas/RPC method; implement runtime generation; build desktop wizard.
- 2026-04-27 00:57 CST - Implemented the first full pass: shared `agents.generateDraft` contracts, runtime draft generation/validation, desktop runtime client/browser mock support, and a conversation-first create-agent wizard in `AgentsView`. Shared tests/typecheck, runtime tests/typecheck, and desktop tests pass; desktop typecheck is blocked by pre-existing `SettingsView.tsx` undefined symbols unrelated to this task.
  Next: Run final TODO scan; update checkpoints/verification; optionally start dev server for manual UI review.
- 2026-04-27 01:00 CST - Re-ran desktop verification after a small browser-mock naming polish. Desktop tests and typecheck pass. Browser verification confirms guided creation opens, generates `researcher-hk` from a Chinese market-research prompt, fills editable fields, and enables the final create button.
  Next: None.

## Open Issues
- None.

## TODO
- [x] Add shared `agents.generateDraft` contract and tests.
- [x] Implement runtime draft generation and tests.
- [x] Add desktop runtime client/browser mock support.
- [x] Replace create-agent primary UI with natural-language wizard.
- [x] Run verification and close checkpoints.

## Retrospective
### Item 1
- Pitfall: Browser mock fallbacks can produce embarrassing UX even when real provider generation is the primary path.
- Symptom: Manual browser verification initially produced the custom-agent name `agent-agent-agent` for a Chinese request.
- Root Cause: The browser mock slugifier replaced each Chinese text chunk with `agent` rather than using intent keywords.
- Reusable Guardrail: When adding mock generation for user-facing AI flows, verify at least one realistic non-English prompt and tune deterministic mock output to look plausible.
- Evidence: Browser verification was rerun after adding Chinese keyword fallbacks and produced `researcher-hk`.
- Scope: local_only
- Suggested Writeback Target: none
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm --filter @ora/shared test` -> 1 file passed, 77 tests passed.
- `pnpm --filter @ora/shared typecheck` -> passed.
- `pnpm --filter @ora/shared build` -> passed.
- `pnpm --filter @ora/runtime test -- test/custom-agents.test.ts` -> runtime suite ran, 12 files passed, 195 tests passed.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/desktop test` -> 5 files passed, 14 tests passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.

### Functional Verification (Feature Works)
- [x] Core functionality verification (specify method)
- [x] Edge cases verification
- [x] Error handling verification

**Output**:
- Runtime tests cover vague prompts returning `needs_input`, valid draft generation, duplicate-name handling, and provider failure without creating a custom agent.
- Browser verification on `http://127.0.0.1:1422/`: opened Agents, clicked `新建智能体`, confirmed the guided creation screen rendered with the initial assistant prompt, draft input, editable draft fields, and disabled confirm button.
- Browser verification generated a draft from `帮我创建一个香港市场研究智能体，输出要带来源、风险和下一步建议。`; browser mock filled `researcher-hk`, description, model hint, SOUL, and enabled `创建智能体`.

## Comparison (If Applicable)

### Reference
- Existing custom-agent editor and `agents.create` file-backed persistence.
- Existing provider invocation path used by runtime agent execution.

### Comparison Points
- [x] Reuses existing custom-agent create/update/delete contracts.
- [x] Keeps draft generation out of normal run/session history.
- [x] Preserves final user confirmation before writing files.

### Findings
- Consistency: The final write path still uses `agents.create`, so persisted files remain compatible.
- Differences: Create mode now starts as a guided conversation; edit mode keeps the field editor.
- Conclusion: The implementation adds a draft layer without changing custom-agent storage semantics.

## Checkpoints

### Checkpoint 1: Shared/API Contract
- Requirement: Desktop and runtime agree on request/response shapes for `agents.generateDraft`.
- Verification method: Shared contract tests and runtime typecheck.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/shared test` passed 77 tests; `pnpm --filter @ora/shared typecheck` passed; `pnpm --filter @ora/runtime typecheck` passed.

### Checkpoint 2: Runtime Generation
- Requirement: Runtime can ask for missing information, return a valid draft, and reject/repair invalid names without creating files.
- Verification method: Runtime tests for vague input, draft-ready output, name collision, and provider failure.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/runtime test -- test/custom-agents.test.ts` ran with the runtime suite and passed 195 tests, including new custom-agent draft coverage.

### Checkpoint 3: Desktop Wizard
- Requirement: New-agent flow is natural-language guided, shows an editable generated draft, and creates only after confirmation.
- Verification method: Desktop static render/unit tests plus manual browser/dev verification if feasible.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/desktop test` passed 14 tests; browser verification confirmed guided chat renders, draft generation fills `researcher-hk`, editable fields are present, and `创建智能体` becomes enabled only after a valid draft exists.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Add natural-language guided custom-agent creation with final confirmation.
- Done: Created task journal; added shared RPC contract; implemented runtime generation; added desktop runtime client/browser mock; replaced create-agent primary UI with guided wizard.
- In-progress: None.
- Active files: shared capabilities/rpc/contracts, runtime run-store/json-rpc/tests, desktop runtimeClient/AgentsView, task journal.
- Next actions (top 3; exact file/function): None.
- Blockers/Risks: Repo has unrelated dirty files outside this task; preserve them.
- Verification status: Shared/runtime/desktop tests and typechecks pass; browser verification pass; TODO scan has unrelated existing TODOs in templates/bundled assets.

## Verification

### Evidence Requirements
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: macOS desktop workspace, pnpm monorepo, Vite dev server on `http://127.0.0.1:1422/`.

### Commands run + outputs
- `pnpm --filter @ora/shared test` -> passed, 77 tests.
- `pnpm --filter @ora/shared typecheck` -> passed.
- `pnpm --filter @ora/shared build` -> passed.
- `pnpm --filter @ora/runtime test -- test/custom-agents.test.ts` -> passed, 195 tests across runtime suite.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/desktop test` -> passed, 14 tests.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `bash skills/long-task-protocol/scripts/todo_scan.sh --task tasks/TASK-20260427-0046-agent-natural-language-creation-wizard.md` -> command accepted but script performs repo-wide scan; output only unrelated existing TODOs in `.ora/runtime.db`, skill templates, and bundled sidecar assets.
- Browser: `http://127.0.0.1:1422/` -> Agents -> New agent -> generated draft for Chinese market-research prompt; `researcher-hk` appeared and `创建智能体` became enabled.
