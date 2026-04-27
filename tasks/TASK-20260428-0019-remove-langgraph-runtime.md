# TASK-20260428-0019-remove-langgraph-runtime

**Created:** 2026-04-28 00:19 CST
**Status:** Done

---

## Goal
- Fully remove the legacy LangGraph pattern runtime and SessionManager execution stack now that JSON-RPC runs use the runtime-kernel/ModeSpec path. Also remove the unused LangGraph/checkpointer dependencies and tests so future work cannot accidentally revive a second pattern runtime.

## Scope / Out of scope
- In scope:
  - Delete LangGraph graph implementations, graph state/adapter, HITL helper, SessionManager, SQLite checkpointer, exports, and tests.
  - Simplify JSON-RPC run/evaluation/control methods to call `LocalRunStore` directly.
  - Remove `@langchain/langgraph` and `@langchain/langgraph-checkpoint` from runtime dependencies and update the lockfile.
  - Update remaining tests that named SessionManager/LangGraph but now validate runtime-kernel behavior.
- Out of scope:
  - Rebuilding packaged sidecar artifacts unless package verification requires it.
  - Changing runtime-kernel behavior beyond removing the legacy executor.

## Constraints
- Compatibility: Public JSON-RPC methods must remain stable.
- Performance: Removing legacy graph stack must not add provider calls.
- Risk: Existing pending LangGraph checkpoints will no longer be resumable; acceptable per current request to complete removal.
- Tool/Environment limits: Keep edits targeted and verify with runtime type/tests.

## Plan
1. Remove SessionManager and graph/checkpointer files plus exports/imports.
2. Simplify `json-rpc.ts` to direct store-backed runtime-kernel paths.
3. Update tests and dependency manifests/lockfile.
4. Run typecheck, lint-if-present, focused/full runtime tests, and TODO/diff checks.

## Active Files
- tasks/TASK-20260428-0019-remove-langgraph-runtime.md
- apps/runtime/src/json-rpc.ts
- apps/runtime/src/index.ts
- apps/runtime/package.json
- pnpm-lock.yaml
- apps/runtime/test/session-thread.test.ts
- apps/runtime/test/custom-agents.test.ts
- apps/runtime/test/sqlite-checkpointer.test.ts
- apps/runtime/test/graph-adapter.test.ts
- apps/runtime/test/runtime-prompt-context.test.ts
- apps/desktop/src-tauri/src/commands/sidecar.rs
- apps/runtime/src/session/session-manager.ts
- apps/runtime/src/patterns/{agent-teams,generator-verifier,hitl,message-bus,orchestrator-subagent,registry,shared-state,system-prompt}.ts
- apps/runtime/src/graph/{event-adapter,ora-state}.ts
- apps/runtime/src/persistence/sqlite-checkpointer.ts

## Decisions
- Decision: Delete rather than rename the LangGraph/checkpointer stack.
  - Why: After the previous cleanup, no production JSON-RPC path should depend on it; leaving an adapter-shaped shell would preserve confusing architecture.
  - Alternatives: Keep a deprecated compatibility adapter; rename SessionManager to KernelCheckpointAdapter.
  - Tradeoffs: Cleaner runtime architecture at the cost of no compatibility for old pending LangGraph checkpoints.

## Progress Log
- 2026-04-28 00:19 CST - Task created.
  Next: Fill in Goal, Scope, Plan, and list Active Files.
- 2026-04-28 00:20 CST - Dependency search confirmed LangGraph references are contained to runtime graph/session/checkpointer stack, related tests/exports, package deps, and generated sidecar artifacts.
  Next: Delete legacy stack and update JSON-RPC/tests/manifests.
- 2026-04-28 00:25 CST - Deleted SessionManager, graph state/event adapter, graph pattern implementations, HITL helper, SQLite checkpointer, graph tests, and obsolete exports. Simplified JSON-RPC runs/evaluation/control paths to `LocalRunStore`.
  Next: Remove package dependencies, refresh lockfile, rebuild sidecar, and verify.
- 2026-04-28 00:31 CST - Removed `@langchain/core`, `@langchain/langgraph`, and `@langchain/langgraph-checkpoint`; refreshed `pnpm-lock.yaml`; rebuilt packaged sidecar; verified no source/test/sidecar references to LangGraph/SessionManager/checkpointer remain.
  Next: None.

## Open Issues
- None.

## TODO
- None.

## Retrospective
### Item 1
- Pitfall: Generated sidecar artifacts can silently retain deleted runtime dependencies.
- Symptom: Source and lockfile can be clean while the packaged `runtime-sidecar.cjs` still contains bundled legacy code.
- Root Cause: The sidecar bundle is generated from runtime sources but is not automatically rebuilt by source edits.
- Reusable Guardrail: When deleting runtime dependencies or public exports, rebuild the sidecar and scan the generated bundle for the removed symbols.
- Evidence: Ran `pnpm --filter @ora/runtime package:sidecar`, then scanned source/tests/sidecar/lockfile for LangGraph and SessionManager strings with no matches.
- Scope: Runtime packaging tasks.
- Suggested Writeback Target: None.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm --filter @ora/runtime typecheck` -> pass.
- `pnpm --filter @ora/runtime --if-present lint` -> pass, no output.
- `pnpm --filter @ora/runtime test` -> `Test Files 13 passed (13)`, `Tests 208 passed (208)`.
- `pnpm --filter @ora/desktop typecheck` -> pass.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` -> `Finished dev profile`.

### Functional Verification (Feature Works)
- [x] Core functionality verification: runtime no longer exports or imports SessionManager, LangGraph graph registry, graph state, graph event adapter, or SQLite checkpointer.
- [x] Edge cases verification: JSON-RPC still handles runs, evaluation runs, state, interrupt, resume, and cancel through `LocalRunStore`.
- [x] Error handling verification: legacy graph metadata remains harmless input metadata and cannot route to a second executor.

**Output**:
- `rg -n "LangGraph|langgraph|SessionManager|createPatternGraph|createPatternGraphWithCheckpointer|OraSqliteCheckpointer|createOraSqliteCheckpointer|@langchain|BaseCheckpointSaver|ORA_LANGGRAPH|withGraphPersona|adaptGraphEvents|langgraph-checkpoints" apps/runtime/src apps/runtime/test apps/runtime/package.json apps/desktop/src-tauri/src/commands/sidecar.rs apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs pnpm-lock.yaml` -> no matches.
- `pnpm --filter @ora/runtime package:sidecar` -> rebuilt packaged runtime bundle successfully.

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: Current `LocalRunStore.startRun` and runtime-kernel checkpoint/replay support.

### Comparison Points
- [x] New runs use runtime-kernel through `LocalRunStore`.
- [x] Run lifecycle methods no longer check a second manager first.
- [x] Runtime package dependencies no longer include LangChain/LangGraph packages.

### Findings
- Consistency: JSON-RPC, CLI, stdio, and evaluation runs all converge on store-backed runtime-kernel execution.
- Differences: Old pending LangGraph checkpoints are unsupported after this removal; normal Ora runtime checkpoints remain in snapshots.
- Conclusion: The duplicate LangGraph pattern runtime has been fully removed.

## Checkpoints

### Checkpoint 1: Runtime Stack Removed
- Requirement: No SessionManager, graph registry, graph state/adapter, graph HITL helper, or SQLite checkpointer remains in runtime source/exports.
- Verification method: File deletion plus symbol scan.
- Status: [x] Pass
- Evidence: Deleted legacy files; symbol scan returned no matches.

### Checkpoint 2: Dependencies Removed
- Requirement: Remove LangGraph/LangChain direct runtime dependencies and lockfile entries.
- Verification method: `package.json`/`pnpm-lock.yaml` scan after `pnpm install --lockfile-only`.
- Status: [x] Pass
- Evidence: `@langchain` scan returned no matches in runtime package/lockfile.

### Checkpoint 3: Packaged Runtime Clean
- Requirement: Packaged sidecar does not retain the deleted graph stack.
- Verification method: Rebuild sidecar and scan generated bundle.
- Status: [x] Pass
- Evidence: `pnpm --filter @ora/runtime package:sidecar` passed; generated bundle scan returned no matches.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Remove legacy LangGraph runtime/checkpointer stack and dependencies.
- Done: Deleted legacy stack/tests/exports; simplified JSON-RPC; removed LangChain/LangGraph deps; rebuilt sidecar; verified runtime/desktop/Rust.
- In-progress: None.
- Active files: task journal, json-rpc.ts, index.ts, runtime package/lockfile, runtime tests, desktop sidecar command, deleted legacy files.
- Next actions (top 3; exact file/function): none.
- Blockers/Risks: Existing old LangGraph checkpoints are unsupported by design after deletion.
- Verification status: Passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/Ora`, zsh, 2026-04-28 CST

### Commands run + outputs
- `pnpm install --lockfile-only` -> pass; lockfile refreshed.
- `pnpm --filter @ora/runtime package:sidecar` -> pass; shared build plus sidecar bundle completed.
- `pnpm --filter @ora/runtime typecheck` -> pass.
- `pnpm --filter @ora/runtime --if-present lint` -> pass, no output.
- `pnpm --filter @ora/runtime test` -> `Test Files 13 passed (13)`, `Tests 208 passed (208)`.
- `pnpm --filter @ora/desktop typecheck` -> pass.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` -> `Finished dev profile`.
- Removed-symbol scan over runtime source/tests/package, desktop sidecar command, generated sidecar bundle, and lockfile -> no matches.
- Task-owned TODO/FIXME/XXX scan -> no matches.
- `git diff --check` -> pass.
