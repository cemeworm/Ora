# TASK-20260424-0108-deerflow-mode-atoms

**Created:** 2026-04-24 01:08 CST
**Status:** Complete

---

## Goal
- 把 DeerFlow harness 里值得借鉴的 orchestration / capability 逻辑，先沉淀成 Ora 可组合的“原子能力”，让 Ora 的多模式体系不只是五个固定 family，而是 family + runtime atoms + stage atoms 的组合。

## Scope / Out of scope
- In scope:
  - 在 shared contracts 中引入原子能力注册表与 mode/node 级挂载点。
  - 在 runtime bootstrap 与 mode validation 中接入 atoms。
  - 在 desktop Mode Studio 中显示模式激活的 atoms，并让 atoms 成为运行时真相的一部分。
  - 为后续 runtime kernel / event / memory / subagent 深化实现预留清晰契约。
- Out of scope for the first implementation slice:
  - 完整实现所有 atom 的真实运行时行为。
  - 新增 Docker/provisioner sandbox。
  - 开放用户自定义 atom 实现代码。

## Assumptions
- 保留 Ora 现有五个 coordination families，不改为 DeerFlow 的单 lead-agent 架构。
- 首个里程碑先打通 contract/bootstrap/UI 真相链路，再逐步把 atoms 变成真正的 runtime hooks。
- Mode Studio 继续保持约束式编辑，atoms 只能从 runtime 内建注册表选择。

## Constraints
- 当前 worktree 已有用户在多个 runtime/desktop/shared 文件上的未提交改动；本任务只做与 atoms 直接相关的外科式修改，不回退其他变更。
- 必须先创建并持续维护这个 task 文件，作为本任务唯一真相源。

## Plan
1. 为 shared contracts 新增 atoms registry、mode/runtime atom 挂载点、bootstrap 输出。
   Verify: `pnpm --filter @ora/shared test`
2. 让 runtime bootstrap / modes.validate / 预设 modes 暴露 atoms 真相。
   Verify: `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts`
3. 让 desktop runtime client 和 Mode Studio 读取并展示 atoms。
   Verify: `pnpm --filter @ora/desktop typecheck`
4. 如果前面稳定，再补一小步 runtime 行为绑定，优先做 validation/preview 层而不是完整执行器。
   Verify: targeted runtime tests

## Active Files
- [packages/shared/src/index.ts](/Users/quintenchen/developer/Ora/packages/shared/src/index.ts:1)
- [packages/shared/test/contracts.test.ts](/Users/quintenchen/developer/Ora/packages/shared/test/contracts.test.ts:1)
- [apps/runtime/src/json-rpc.ts](/Users/quintenchen/developer/Ora/apps/runtime/src/json-rpc.ts:1)
- [apps/runtime/test/runtime-smoke.test.ts](/Users/quintenchen/developer/Ora/apps/runtime/test/runtime-smoke.test.ts:1)
- [apps/desktop/src/lib/runtimeClient.ts](/Users/quintenchen/developer/Ora/apps/desktop/src/lib/runtimeClient.ts:1)
- [apps/desktop/src/components/ModesView.tsx](/Users/quintenchen/developer/Ora/apps/desktop/src/components/ModesView.tsx:1)
- [tasks/TASK-20260424-0108-deerflow-mode-atoms.md](/Users/quintenchen/developer/Ora/tasks/TASK-20260424-0108-deerflow-mode-atoms.md:1)

## Progress Log
- 2026-04-24 01:08 CST - Task created after comparing Ora runtime kernel/mode system with DeerFlow harness lead-agent, middleware, subagent, memory queue, and deferred tool discovery structure.
  Next: add shared atoms contracts and thread them through bootstrap + mode validation.
- 2026-04-24 01:16 CST - Landed the first contract/bootstrap/UI slice. Shared contracts now define a built-in runtime atom registry, `ModeSpec.runtimeAtoms`, runtime bootstrap atom output, and validation for family/scope mismatches. Runtime bootstrap smoke coverage now asserts atoms are exposed, and Mode Studio reads runtime atoms and shows active mode/stage atoms in the summary and node inspector surfaces.
  Next: start binding the first real runtime behaviors behind these atoms, with `clarification_interrupt`, `memory_capture`, and delegated task lifecycle as the highest-value follow-up slice.
- 2026-04-24 01:20 CST - Bound the first real atom behavior in runtime execution: node-level `artifact_publish` now emits `artifact.exported` and appends an artifact ref into the run snapshot when a compatible stage opts in. Added smoke coverage with a custom `message_bus` mode to verify atom-driven artifact output.
  Next: bind a second behavior atom that changes execution flow or state, likely `clarification_interrupt` or `memory_capture`.
- 2026-04-24 01:24 CST - Upgraded `memory_capture` from immediate per-node writes to a queued lifecycle closer to DeerFlow's memory queue model. Runs now emit `memory.queued`, flush queued records near run finalization, then emit `memory.updated` and `memory.flushed`. Desktop event labeling was updated to stay exhaustive after the new event types were added.
  Next: implement the first atom that changes control flow rather than just post-processing state, with `clarification_interrupt` the best candidate.
- 2026-04-24 01:40 CST - Bound `clarification_interrupt` to a real stage-bound interruption path. A mode-level `clarification_interrupt` atom now respects node-level `config.clarificationQuestion` / optional `config.clarificationKey`, emits `clarification.required`, parks the node in `blocked`, stores `pendingClarifications` on the run snapshot, and lets `runs.resume` clear them via `patch.clarifications` while recording `clarification.resolved`.
  Next: choose the next high-value control/runtime atom, likely `subagent_delegate` task lifecycle or `tool_error_boundary`.
- 2026-04-24 01:48 CST - Bound `subagent_delegate` to a real delegated stage lifecycle. Node-level `config.atoms: ["subagent_delegate"]` now wraps the stage execution with `task.started` / `task.progress` / `task.completed` or `task.failed`, so delegated subagent work is visible in the event stream and desktop timeline without introducing a second task store.
  Next: bind `tool_error_boundary` so capability/tool/provider failures can degrade into inspectable runtime events instead of only surfacing as terminal run errors.
- 2026-04-24 01:58 CST - Bound `tool_error_boundary` to a real provider failure boundary. When the atom is active, provider/tool invocation failures now emit failed `tool.called` / `action.updated` records, return a bounded fallback message, and let the run finish instead of hard-failing; removing the atom from a custom mode restores the old terminal failure behavior. Smoke coverage now exercises both sides with a deterministic `providerId: "missing-provider"` injection path.
  Next: no in-scope implementation work remains; close the task after recording the final verification snapshot.

## Open Issues
- [x] Decide whether atoms should live only in `capabilityFlags`-adjacent fields or become a first-class `runtimeAtoms` field on `ModeSpec`.
- Resolution: use a first-class `runtimeAtoms` field on `ModeSpec`, so mode-level orchestration atoms are explicit and do not overload capability flags.
- [x] Decide whether stage-level atoms should stay inside `ModeNodeSpec.config` or get a dedicated field in a follow-up.
- Resolution: keep stage-level atoms in `ModeNodeSpec.config` for v1 so runtime and editor can reuse the existing node contract without a second schema migration; revisit a dedicated field only if node config starts carrying unrelated runtime data.

## TODO
- [x] Add shared atom schemas, registry, and preset defaults.
- [x] Extend runtime bootstrap and runtime smoke tests for atoms.
- [x] Extend desktop runtime client types for atoms.
- [x] Show active atoms in Mode Studio gallery/editor.
- [x] Re-run verification and update this task with evidence.
- [x] Bind `clarification_interrupt` to an actual interruption path.
- [x] Bind `memory_capture` to a more DeerFlow-like queued summary/update path.
- [x] Bind the first runtime hook behavior to a selected atom (`artifact_publish`).
- [x] Bind `subagent_delegate` to delegated task lifecycle events.
- [x] Bind `tool_error_boundary` to bounded provider/tool failure handling.

## Verification
- `pnpm --filter @ora/shared test`
  - PASS: `test/contracts.test.ts` 65/65
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts`
  - PASS: runtime suite completed, 62/62 tests, including bootstrap atom checks and custom-mode artifact atom smoke
- `pnpm --filter @ora/desktop typecheck`
  - PASS
- `pnpm --filter @ora/shared test`
  - PASS again after adding `memory.queued` / `memory.flushed`
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts`
  - PASS again after queue-based `memory_capture`
- `pnpm --filter @ora/desktop typecheck`
  - PASS again after view model event labels were updated for the new memory event types
- `pnpm --filter @ora/shared test`
  - PASS again after adding `clarification.required` / `clarification.resolved` and `pendingClarifications`
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts`
  - PASS again after stage-bound clarification interrupt + resume coverage; runtime suite completed 64/64
- `pnpm --filter @ora/desktop typecheck`
  - PASS again after desktop view model and mock snapshot support for pending clarifications
- `pnpm --filter @ora/shared test`
  - PASS again after adding delegated task event types
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts`
  - PASS again after `subagent_delegate` lifecycle coverage; runtime suite completed 65/65
- `pnpm --filter @ora/desktop typecheck`
  - PASS again after desktop beat/timeline labeling support for delegated task events
- `pnpm --filter @ora/shared test`
  - PASS again after `tool_error_boundary` runtime behavior and failure-path smoke additions
- `pnpm --filter @ora/runtime test -- runtime-smoke.test.ts`
  - PASS again after tool boundary degrade-vs-fail coverage; runtime suite completed 67/67
- `pnpm --filter @ora/desktop typecheck`
  - PASS again after final runtime changes; no extra desktop type updates were required

## Compressed State
- Objective: bring DeerFlow-like orchestration primitives into Ora as composable atoms instead of a separate agent architecture.
- First milestone: contract/bootstrap/UI truth path is in place.
- Current implementation: atoms are now part of shared runtime truth, flow through runtime bootstrap, render in Mode Studio, and `artifact_publish`, queued `memory_capture`, stage-bound `clarification_interrupt`, delegated `subagent_delegate`, plus bounded `tool_error_boundary` all affect real runtime behavior.
- Latest clarification contract: node `config.clarificationQuestion` is the runtime gate; answers flow through `input.context.clarifications` on start or `runs.resume.patch.clarifications` on resume.
- Latest delegation contract: node `config.atoms: ["subagent_delegate"]` wraps that stage in `task.started` / `task.progress` / `task.completed` / `task.failed`, with no extra task persistence layer yet.
- Latest error-boundary contract: provider/tool failures become failed `tool.called` + `action.updated` records and a bounded fallback message when `tool_error_boundary` is active; removing the atom returns the previous run-failing semantics.
- Outcome: all in-scope task plan items are implemented and verified.
