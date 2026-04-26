# TASK-20260427-0134-ora-agent-mode-studio-team-system

**Created:** 2026-04-27 01:34 CST
**Status:** Done

---

## Goal
- Turn Ora custom agents into first-class reusable team members for Mode Studio. Agents should carry persona, model hint, tools, and skills; Mode Studio should compose those agents into mode profiles/stages; runtime should resolve each stage's effective persona, skills, model hint, and tools while keeping the mode as the upper-bound permission envelope.

## Scope / Out of scope
- In scope:
- Extend shared custom-agent/profile contracts with real tool and skill capability fields.
- Persist and expose agent `toolIds` / `skillIds` through runtime JSON-RPC, desktop mock runtime, and Tauri bridge paths.
- Update runtime execution so stage calls use profile-bound custom agents and per-agent effective tools/skills under the mode cap.
- Update Agents workspace and Mode Studio so users can bind saved agents to mode profiles, choose profile owners from a roster, and inspect effective capabilities.
- Add targeted tests for schema compatibility, runtime behavior, and desktop state/UI type safety.
- Out of scope:
- Replacing `ModeSpec` as the orchestration source of truth.
- Adding arbitrary free-form workflow semantics or a new graph engine.
- Implementing unbounded agent-granted permissions outside the selected mode's capabilities.
- Redesigning provider configuration beyond honoring existing agent model hints where the runtime already supports model refs.

## Constraints
- Compatibility: existing agent files without `toolIds` / `skillIds`, existing modes using `node.config.customAgentId`, and run-level `config.customAgentId` must keep working.
- Performance: capability resolution must be local and deterministic; no extra provider call should be introduced.
- Risk: per-agent tool filtering must not accidentally grant tools disabled by the mode; mode is always the upper bound.
- Tool/Environment limits: keep edits surgical across shared/runtime/desktop surfaces and preserve any unrelated worktree changes.

## Plan
1. Shared contracts: add agent/profile capability fields, defaults, and contract tests.
2. Runtime persistence/bridge: read/write agent capabilities and expose them through JSON-RPC, desktop mock, and Tauri facade.
3. Runtime execution: resolve profile-bound custom agents, effective per-agent tools/skills, persona overlays, and compatibility fallbacks.
4. Desktop UX: add real tool/skill selectors to Agents and profile-agent binding/effective-capability controls to Mode Studio.
5. Verification: run focused shared/runtime/desktop tests, typecheck/build where relevant, TODO scan, and record evidence.

## Active Files
- tasks/TASK-20260427-0134-ora-agent-mode-studio-team-system.md
- packages/shared/src/capabilities.ts
- packages/shared/src/primitives.ts
- packages/shared/src/modes.ts
- apps/runtime/src/custom-agents.ts
- apps/runtime/src/harness/runtime-kernel.ts
- apps/runtime/src/patterns/driver-registry.ts
- apps/runtime/src/json-rpc.ts
- apps/runtime/src/run-store.ts
- apps/desktop/src/components/AgentsView.tsx
- apps/desktop/src/components/ModesView.tsx
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src-tauri/src/commands/sidecar.rs
- apps/runtime/test/custom-agents.test.ts
- packages/shared/test/contracts.test.ts

## Decisions
- Decision: `ModeSpec` remains the orchestration and permission source of truth.
  - Why: Mode Studio, snapshots, topology, recovery, and routing already converge on `ModeSpec`.
  - Alternatives: make agents replace modes as the primary runtime object.
  - Tradeoffs: keeps runtime stable, but requires explicit profile binding instead of a pure agent-first graph.
- Decision: mode capabilities are the upper bound; agent capabilities are a subset or inherit mode defaults when empty.
  - Why: prevents a saved agent from silently expanding run permissions.
  - Alternatives: auto-merge agent capabilities into the mode; let agents fully override mode capabilities.
  - Tradeoffs: safer and auditable, but users may need to enable a tool/skill on the mode before an agent can use it.
- Decision: profile-level custom-agent binding is the new canonical path, while `node.config.customAgentId` remains a compatibility fallback.
  - Why: profiles represent reusable team members; nodes represent stages owned by those team members.
  - Alternatives: keep only node-level bindings.
  - Tradeoffs: better team semantics, with a small migration/precedence layer.

## Progress Log
- 2026-04-27 01:34 CST - Task created
  Next: Fill in Goal, Scope, Plan, and list Active Files
- 2026-04-27 01:36 CST - Filled the task journal with the approved full-team-system design, constraints, decisions, checkpoints, and implementation TODOs.
  Next: extend shared schemas/tests; then runtime persistence/bridge; then runtime per-agent execution.
- 2026-04-27 01:43 CST - Implemented shared custom-agent/profile capability fields, runtime file persistence, and profile-bound runtime capability resolution. Targeted tests pass for shared contracts and runtime custom-agent behavior, including mode-as-upper-bound filtering.
  Next: update desktop mock/Tauri bridge fields; update Agents workspace selectors; update Mode Studio roster binding.
- 2026-04-27 01:52 CST - Implemented desktop mock and Tauri facade parity, Agents workspace tool/skill selectors, Mode Studio team roster binding, and node owner dropdown. Verification passed across shared contracts, runtime custom-agent tests, runtime/desktop typecheck, and Tauri facade custom-agent test.
  Next: none; task is complete.

## Open Issues
- [x] Confirm after implementation whether agent model hints should actively override provider model per stage or remain prompt-visible hints only.
  - Resolution: keep model as prompt-visible hint only for this slice. Provider/model override remains a separate future design because current provider calls are run-scoped.

## TODO
- None.

## Retrospective
- Record 0-3 highest-value pitfalls from this task.
- Leave reusable operational lessons here even when they later get promoted into a skill.

### Item 1
- Pitfall: Putting raw saved-agent tool/skill preferences into persona text can undermine a mode-level permission boundary.
- Symptom: The first runtime test saw `shell.execute` in the provider system prompt even though the mode only allowed `file.read` and `web.search`.
- Root Cause: `personaOverlay()` included preferred tool/skill ids, while effective tool filtering happened later.
- Reusable Guardrail: Keep capability lists out of persona text; inject only the already-resolved effective tool/skill context for the current run stage.
- Evidence: `apps/runtime/test/custom-agents.test.ts` now asserts the profile-bound agent prompt contains `file.read` but not disabled `web.search` / `shell.execute`.
- Scope: Ora runtime capability prompts.
- Suggested Writeback Target: local task memory; no skill writeback needed.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [ ] Lint checks pass

**Output**:
- `pnpm --filter @ora/shared test` -> passed, `test/contracts.test.ts` 77/77.
- `pnpm --filter @ora/shared build` -> passed.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts` -> passed, 8/8.
- `cargo test custom_agent_lifecycle_persists_to_workspace_files` in `apps/desktop/src-tauri` -> passed, 1/1.
- Full lint not run; targeted typechecks/tests covered the edited TypeScript and Rust surfaces.

### Functional Verification (Feature Works)
- [x] Core functionality verification (specify method)
- [x] Edge cases verification
- [x] Error handling verification

**Output**:
- Shared schemas parse profile-level `customAgentId`, `toolIds`, and `skillIds`.
- Runtime file store creates, updates, reloads, and deletes custom agents with real capability fields.
- Runtime stage execution applies profile-bound saved agents and filters effective tools/skills through the mode cap.
- Desktop mock runtime and Tauri facade round-trip `toolIds` / `skillIds`.
- Agents workspace exposes real tool/skill selectors; Mode Studio exposes team roster binding and owner-agent dropdown.

**Examples**:
- Database: `SELECT * FROM table WHERE field_name IS NOT NULL LIMIT 5;`
- API: `curl "url" | jq '.results[0].field_name'`
- UI: Manual test steps and results
- Bug fix: Verification bug is fixed

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: `tasks/TASK-20260423-1756-ora-agents-workspace-management.md`, `tasks/TASK-20260424-0115-mode-studio-constrained-canvas.md`, and `tasks/TASK-20260424-1329-modeview-capability-topology.md`.

### Comparison Points
- [x] Preserve file-backed custom-agent compatibility.
- [x] Preserve Mode Studio's constrained `ModeSpec` canvas model.
- [x] Preserve shared/runtime/desktop topology truth rather than creating desktop-only semantics.

### Findings
- Consistency: The implementation keeps agents file-backed under the existing `agents.*` surface and continues saving teams as `ModeSpec` profiles/nodes.
- Differences: Agents now carry real `toolIds` / `skillIds`, and Mode Studio owns profile binding instead of relying only on AgentsView's team-mode shortcut.
- Conclusion: The change extends the prior agents and Mode Studio work without replacing the existing mode runtime contract.

## Checkpoints

### Checkpoint 1: Shared + Persistence Contracts
- Requirement: existing and new custom agents/modes parse, persist, reload, and expose capability fields.
- Verification method: shared contract tests plus runtime custom-agent tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/shared test` passed 77/77; `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts` passed 8/8; Tauri custom-agent facade test passed.

### Checkpoint 2: Per-Agent Runtime Capabilities
- Requirement: runtime applies profile-bound custom agents and per-agent tool/skill subsets without exceeding mode capabilities.
- Verification method: runtime tests with mocked provider/tool prompts.
- Status: [x] Pass / [ ] Fail
- Evidence: `custom-agents.test.ts` covers profile-bound `focused-builder`; prompt includes the saved persona and effective `file.read`, excludes mode-disabled agent request `shell.execute`, and includes only mode-enabled skill context.

### Checkpoint 3: Desktop Team Composition UX
- Requirement: Agents and Mode Studio expose the new binding/capability model without breaking existing flows.
- Verification method: desktop typecheck and targeted state/runtime-client tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `pnpm --filter @ora/desktop typecheck` passed after adding Agents tool/skill selectors, Mode Studio roster binding, and node owner dropdown.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: make saved agents first-class team members with persona, skills, and tools that Mode Studio can compose into modes.
- Done: shared contracts, runtime persistence/execution, desktop mock, Tauri facade, Agents workspace selectors, Mode Studio roster binding, and verification are complete.
- In-progress: none.
- Active files: shared capabilities/primitives/modes, runtime custom-agents/kernel/run-store, desktop AgentsView/ModesView/runtimeClient, Tauri sidecar, tests.
- Next actions (top 3; exact file/function): none; none; none.
- Blockers/Risks: no blocker; model hints remain prompt-visible rather than provider-overriding.
- Verification status: shared tests 77/77, runtime custom-agent tests 8/8, runtime typecheck pass, desktop typecheck pass, Tauri custom-agent test pass, TODO gate recorded with known generated/vendor noise.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: local Ora monorepo at `/Users/quintenchen/developer/Ora`, macOS/Tauri desktop app plus Node runtime.

### Commands run + outputs
- Commands run + outputs:
- `python3 skills/long-task-protocol/scripts/create_journal.py "ora-agent-mode-studio-team-system"` -> created `tasks/TASK-20260427-0134-ora-agent-mode-studio-team-system.md`.
- `pnpm --filter @ora/shared test` -> pass, 1 file / 77 tests.
- `pnpm --filter @ora/shared build` -> pass.
- `pnpm --filter @ora/runtime exec vitest run test/custom-agents.test.ts` -> pass, 1 file / 8 tests.
- `pnpm --filter @ora/runtime typecheck` -> pass.
- `pnpm --filter @ora/desktop typecheck` -> pass.
- `cargo test custom_agent_lifecycle_persists_to_workspace_files` -> pass, 1 test.
- `bash skills/long-task-protocol/scripts/todo_scan.sh` -> exits 0 but reports pre-existing/generated TODO noise in `.ora/runtime.db`, `apps/runtime/.ora/runtime.db`, `skills/skill-creator/scripts/init_skill.py`, and bundled `apps/desktop/src-tauri/resources/runtime-sidecar/**`.
- Local changed-file TODO fallback: `rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX" ...` over this task's touched source files reported only the task journal's section headings/prose, no blocking source TODO/FIXME/XXX.
