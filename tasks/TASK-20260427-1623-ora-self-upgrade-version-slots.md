# TASK-20260427-1623-ora-self-upgrade-version-slots

**Created:** 2026-04-27 16:23 CST
**Status:** Implemented with Follow-up

---

## Goal
- Implement Ora self-upgrade v1 as a stable host plus versioned package slots: Ora can build a candidate package into an app-data slot, verify it, promote/switch/rollback the active slot, expose package management through runtime/Rust APIs, add a built-in `ora_self_builder` mode, and show a compact version selector next to the Ora sidebar title.

## Scope / Out of scope
- In scope: shared package contracts, runtime package manager, JSON-RPC package APIs, Rust fallback/sidecar package APIs, active-slot sidecar resolution, package tools, built-in self-builder mode, desktop runtime client fallback, sidebar version selector, focused tests.
- Out of scope: signed Tauri updater, overwriting the running `.app`, remote release channels, unattended background restarts, native host ABI migration beyond compatibility checks.

## Constraints
- Compatibility: Existing runtime bootstrap, sidecar packaging, browser fallback, and current mode selection must continue working.
- Performance: Package list and active status must read small JSON files only; build steps may be long but must capture bounded logs.
- Risk: Candidate packages must not promote unless verification passes and host/runtime ABI are compatible.
- Tool/Environment limits: Generated runtime-sidecar artifacts remain untracked; shell commands must avoid destructive git or filesystem operations.

## Plan
1. Shared contracts: add package slot schemas/types and JSON-RPC method names in `packages/shared/src`.
2. Runtime manager: implement slot store, active pointer atomic writes, build/verify/promote/switch/rollback/prune APIs, package tools, and tests in `apps/runtime`.
3. Modes: add `ora_self_builder` built-in mode with package tools and high-risk approval posture.
4. Desktop bridge: add RuntimeClient package methods and local fallback; wire sidebar version dropdown with stable dimensions.
5. Tauri host: add Rust package fallback APIs and make bundled sidecar command prefer the active package slot when valid.
6. Verification: run focused shared/runtime/desktop/Rust checks and update this journal with evidence.

## Active Files
- packages/shared/src/packages.ts
- packages/shared/src/rpc.ts
- packages/shared/src/capabilities.ts
- packages/shared/src/modes.ts
- packages/shared/src/primitives.ts
- apps/runtime/src/package-manager.ts
- apps/runtime/src/json-rpc.ts
- apps/runtime/src/harness/runtime-tool-executor.ts
- apps/runtime/test/package-manager.test.ts
- apps/runtime/test/runtime-tool-executor.test.ts
- apps/runtime/test/runtime-smoke.test.ts
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/lib/state.tsx
- apps/desktop/src/App.tsx
- apps/desktop/src/components/Sidebar.tsx
- apps/desktop/src/components/ModesView.tsx
- apps/desktop/src-tauri/src/commands/sidecar.rs

## Decisions
- Decision: Version slots live in app-data-style storage and are switched by an active pointer, not by replacing the running app bundle.
  - Why: This makes rollback simple and avoids self-overwriting a live Tauri process.
  - Alternatives: Direct Tauri updater install, git worktree switching, OS-level containers.
  - Tradeoffs: v1 can switch frontend/runtime package assets and sidecar path, but native host changes still require a later signed host update.
- Decision: Package mutation APIs are explicit `packages.*` APIs plus `package.*` tools instead of generic shell-only automation.
  - Why: The operation needs manifest validation, logs, compatibility gates, and active pointer safety.
  - Alternatives: Let self-builder call arbitrary shell commands only.
  - Tradeoffs: More surface area, but safer and easier to test.

## Progress Log
- 2026-04-27 16:23 CST - Task created and scoped from the approved Ora Self-Upgrade With Version Slots plan.
  Next: add shared package contracts, implement runtime package manager, wire JSON-RPC/package tools.
- 2026-04-27 16:37 CST - Implemented shared package contracts, runtime package manager, package tools, `ora_self_builder` mode, desktop runtime client methods, sidebar version selector, Rust fallback `packages.*` methods, and active-slot sidecar resolution.
  Next: run full verification, record formatter limitation, decide whether frontend dynamic slot loading needs a separate custom-protocol follow-up.
- 2026-04-27 16:40 CST - Verification passed for shared/runtime/desktop/Rust tests and `@ora/desktop build:bundle`; generated `dist/` and `runtime-sidecar/` outputs are ignored. `cargo fmt` could not run because `rustfmt` is not installed for the active Rust toolchain.
  Next: keep frontend custom-protocol loading as explicit follow-up, finish closeout notes.

## Open Issues
- [ ] TODO(FOLLOWUP): Implement custom protocol or host-served asset routing so the Tauri webview can boot frontend assets from the active package slot. Current v1 records `frontendDistPath` and surfaces it through package manifests, but the running webview still boots the bundled host frontend.
- [ ] TODO(FOLLOWUP): Install `rustfmt` for `stable-aarch64-apple-darwin` or run formatting in CI; local `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml` failed because `cargo-fmt` is missing.

## TODO
- [x] Add shared package contracts and package JSON-RPC methods.
- [x] Implement runtime package manager and package tool executor support.
- [x] Add `ora_self_builder` built-in mode.
- [x] Add desktop runtime client package methods and sidebar version selector.
- [x] Add Rust fallback package APIs and sidecar active-slot resolution.
- [x] Add focused tests and run verification.
- [ ] TODO(FOLLOWUP): Add dynamic frontend slot loading through a Tauri custom protocol or equivalent host asset route.

## Retrospective
- Record 0-3 highest-value pitfalls from this task.
- Leave reusable operational lessons here even when they later get promoted into a skill.

### Item 1
- Pitfall: Treating frontend asset slot selection as equivalent to runtime-sidecar slot selection.
- Symptom: Package manifest and active pointer can select a `frontendDistPath`, but Tauri still boots the configured `frontendDist` unless a custom protocol or host navigation layer is added.
- Root Cause: Runtime sidecar command resolution is host-controlled and easy to redirect; webview frontend boot is controlled earlier by Tauri app configuration.
- Reusable Guardrail: For packaged desktop self-upgrade work, distinguish host-native boot, sidecar boot, and frontend asset boot as three separate acceptance criteria.
- Evidence: Implemented active runtime-sidecar resolution in `bundled_runtime_command`; left explicit follow-up for frontend custom protocol.
- Scope: Ora desktop self-upgrade/package-slot work.
- Suggested Writeback Target: local task only unless this recurs in another packaging task.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [x] Lint checks pass

**Output**:
- `pnpm --filter @ora/shared test -- contracts.test.ts` -> 1 file passed, 80 tests passed.
- `pnpm --filter @ora/runtime test -- package-manager.test.ts runtime-tool-executor.test.ts runtime-smoke.test.ts` -> 14 files passed, 210 tests passed.
- `pnpm --filter @ora/desktop test` -> 9 files passed, 32 tests passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` -> 21 tests passed.
- `pnpm --filter @ora/desktop build:bundle` -> passed; sidecar bundle generated, desktop Vite build completed. Vite reported the existing large chunk warning.
- `pnpm -r --if-present lint` -> exited 0; no project-specific lint output beyond workspace scope.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml` -> failed because `cargo-fmt` is not installed for `stable-aarch64-apple-darwin`.
- Long-task `todo_scan.sh` -> PASS but targeted an older Quantfox task due reused script workspace resolution; direct `rg -n "TODO|\\[ \\]" tasks/TASK-20260427-1623-ora-self-upgrade-version-slots.md` found only explicit `TODO(FOLLOWUP)` entries plus checkpoint pass/fail markers.

### Functional Verification (Feature Works)
- [x] Core functionality verification (specify method)
- [x] Edge cases verification
- [x] Error handling verification

**Output**:
- Runtime package manager tests cover candidate build, failed verification promotion rejection, and rollback.
- Runtime tool executor test covers `package.buildCandidate` and `package.promote` through the approval-aware tool layer.
- Runtime smoke/shared contract tests include the new `ora_self_builder` mode and package tool registry.
- Rust test `active_package_runtime_root_requires_valid_manifest_and_assets` proves active package sidecar resolution requires compatible manifest, passed verification, and real sidecar assets.
- Desktop state/typecheck/build verifies `packageStore` bootstrap, sidebar selector wiring, and Mode Studio package-tool listing compile.

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: prior Ora runtime tool executor, prior built-in mode presets, prior desktop sidecar packaging chain.

### Comparison Points
- [x] Package tools follow the existing approval-aware RuntimeToolExecutor pattern.
- [x] `ora_self_builder` follows the built-in ModeSpec preset pattern without adding a new coordination family.
- [x] Build pipeline reuses existing `package:sidecar` / desktop bundle expectations and keeps generated outputs untracked.

### Findings
- Consistency: Package tools, built-in mode insertion, and sidecar packaging reuse existing Ora seams.
- Differences: Package slots introduce a new manifest/active-pointer domain and Rust fallback APIs.
- Conclusion: Runtime-sidecar self-upgrade v1 is implemented; dynamic frontend slot loading remains a separate host asset-routing follow-up.

## Checkpoints

### Checkpoint 1: Slot Store Safety
- Requirement: active pointer writes are atomic, incompatible packages cannot become active, rollback restores previous slot.
- Verification method: runtime package manager unit tests.
- Status: [x] Pass / [ ] Fail
- Evidence: `package-manager.test.ts` passed in runtime test suite.

### Checkpoint 2: Self-Builder Surface
- Requirement: built-in mode exposes package tools and desktop can list/promote/switch/rollback packages.
- Verification method: shared/runtime tests plus desktop typecheck.
- Status: [x] Pass / [ ] Fail
- Evidence: shared contracts, runtime tool executor/smoke, desktop tests/typecheck all passed.

### Checkpoint 3: Host Runtime Slot Resolution
- Requirement: packaged host prefers a compatible active runtime-sidecar slot and falls back safely.
- Verification method: Rust unit test or cargo test for sidecar helpers.
- Status: [x] Pass / [ ] Fail
- Evidence: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passed 21 tests including `active_package_runtime_root_requires_valid_manifest_and_assets`.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Implement Ora self-upgrade v1 with version slots, package APIs/tools, self-builder mode, sidebar selector, and sidecar active-slot resolution.
- Done: Shared package contracts, package manager, package tools, `ora_self_builder`, desktop package APIs/UI, Rust fallback package APIs, and active runtime-sidecar slot resolution.
- In-progress: None for runtime-sidecar package slot v1.
- Active files: shared package/rpc/capability/mode files, runtime package manager/tool executor, desktop runtimeClient/state/Sidebar, Rust sidecar command, tests, task journal.
- Next actions (top 3; exact file/function): implement frontend custom protocol asset boot; install/run rustfmt; optionally add a full package slot smoke that launches active slot sidecar from app data.
- Blockers/Risks: frontend slot asset loading is not implemented yet; native host updates remain out of scope.
- Verification status: Shared/runtime/desktop/Rust/build verification passed; cargo fmt unavailable locally.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: `/Users/quintenchen/developer/ora`, zsh, 2026-04-27 CST.

### Commands run + outputs
- `pnpm --filter @ora/shared test -- contracts.test.ts` -> passed, 80 tests.
- `pnpm --filter @ora/runtime test -- package-manager.test.ts runtime-tool-executor.test.ts runtime-smoke.test.ts` -> passed, 210 tests.
- `pnpm --filter @ora/desktop test` -> passed, 32 tests.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` -> passed, 21 tests.
- `pnpm --filter @ora/desktop build:bundle` -> passed; generated sidecar bundle and desktop dist stayed ignored.
- `pnpm -r --if-present lint` -> exited 0; no project-specific lint output beyond workspace scope.
- `git check-ignore -v apps/desktop/src-tauri/resources/runtime-sidecar/bin/node apps/desktop/src-tauri/resources/runtime-sidecar/app/runtime-sidecar.cjs apps/desktop/dist/index.html` -> all ignored by `.gitignore`.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml` -> failed: `cargo-fmt` is not installed for `stable-aarch64-apple-darwin`.
