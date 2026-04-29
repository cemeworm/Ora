# TASK-20260429-1950-fix-packaged-app-loading

**Created:** 2026-04-29 19:50 CST
**Status:** In Progress

---

## Goal
- Diagnose and fix the packaged DMG/App issue where Ora opens but the main content stays on a loading spinner, as shown in the user screenshot. Follow diagnose-before-fix: do not change code until a specific root cause is supported by evidence.

## Scope / Out of scope
- In scope:
  - Reproduce or inspect the packaged app startup behavior.
  - Trace the frontend loading condition and Tauri/runtime startup path.
  - Identify whether the DMG is incomplete or the app fails at runtime after packaging.
  - Apply the smallest fix after root cause is proven.
  - Repackage and verify the app no longer stalls at loading.
- Out of scope:
  - Broad UI redesign or unrelated feature changes.
  - Developer ID signing/notarization unless directly causing this local loading failure.

## Constraints
- Compatibility: macOS/darwin; packaged app is Tauri v2, arm64, product `Ora`.
- Performance: Prefer targeted logs/static tracing over repeated blind rebuilds.
- Risk: Do not alter user data; use workspace-local build artifacts and app logs only.
- Tool/Environment limits: GUI inspection may be limited; use executable logs, app support files, and deterministic code tests where possible.

## Plan
1. Trace the exact frontend condition that renders the central loading spinner.
2. Run or inspect the packaged app logs to see which startup/IPC/runtime step never completes.
3. Form one-sentence root cause with file/function/condition and independent evidence.
4. Apply minimal fix and add a regression guard if feasible.
5. Rebuild DMG/App and verify packaged startup behavior and artifact integrity.

## Active Files
- `/Users/quintenchen/developer/ora/apps/desktop/src`
- `/Users/quintenchen/developer/ora/apps/desktop/src-tauri/src`
- `/Users/quintenchen/developer/ora/apps/desktop/src-tauri/target/release/bundle/macos/Ora.app`
- `/Users/quintenchen/developer/ora/apps/desktop/src-tauri/target/release/bundle/dmg/Ora_0.1.0_aarch64.dmg`
- `/Users/quintenchen/developer/ora/tasks/TASK-20260429-1950-fix-packaged-app-loading.md`

## Decisions
- Decision: Start with root-cause diagnosis rather than rebuilding immediately.
  - Why: The previous packaging checks proved files existed, but did not verify the app's runtime readiness path.
  - Alternatives: Rebuild blindly; not acceptable because the same symptom can recur without understanding the stalled condition.
  - Tradeoffs: Slightly slower upfront, but avoids symptom patches.

## Progress Log
- 2026-04-29 19:50 CST - Task created.
  Next: Fill in Goal, Scope, Plan, and list Active Files.
- 2026-04-29 19:55 CST - User screenshot shows sidebar rendered but main content stuck on spinner after opening packaged DMG/App. Started diagnose-before-fix workflow and read previous packaging record/memory.
  Next: Locate spinner condition; capture packaged app runtime logs; state root-cause hypothesis only after evidence.

## Open Issues
- Root cause unknown. Current suspicion category: packaged runtime startup/IPC readiness path, but no evidence yet.

## TODO
- [ ] Locate frontend loading spinner condition.
- [ ] Capture packaged app startup/runtime logs.
- [ ] Prove root cause with at least two pieces of evidence.
- [ ] Fix minimally and add regression guard.
- [ ] Repackage and verify.

## Retrospective
- Pending.

## Functional Verification

### Code Verification (Code Correctness)
- [ ] Code compiles/runs without errors
- [ ] Relevant tests pass
- [ ] Lint/typecheck status recorded

**Output**: Pending.

### Functional Verification (Feature Works)
- [ ] Packaged app no longer stays on loading spinner
- [ ] Runtime resources are still bundled
- [ ] DMG/App regenerated and verified

**Output**: Pending.

## Comparison (If Applicable)

### Reference
- Previous packaging task: `tasks/TASK-20260429-1808-package-app.md`.

### Comparison Points
- [ ] Previous artifact integrity checks vs actual runtime startup readiness.
- [ ] Dev app behavior vs packaged app behavior.
- [ ] App bundle resource paths vs runtime path assumptions.

### Findings
- Consistency: Pending.
- Differences: Pending.
- Conclusion: Pending.

## Checkpoints

### Checkpoint 1: Root cause identified
- Requirement: State exact file/function/condition causing the spinner.
- Verification method: Static trace plus runtime evidence/log/test.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending.

### Checkpoint 2: Minimal fix verified in code
- Requirement: Fix only the root cause and keep behavior intact.
- Verification method: Typecheck/test and regression guard if feasible.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending.

### Checkpoint 3: Packaged app verified
- Requirement: Rebuilt DMG/App opens past loading or has equivalent automated proof.
- Verification method: Packaged app launch/log/behavior check plus artifact checks.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Fix packaged Ora app stuck on central loading spinner after opening from DMG.
- Done: Created task journal; read previous packaging record and memory; screenshot confirms shell/sidebar loads while main area remains spinner.
- In-progress: Diagnosing exact loading condition and packaged runtime failure.
- Active files: desktop frontend, Tauri Rust shell, packaged Ora.app/DMG, this task journal.
- Next actions (top 3; exact file/function):
  1. Search `apps/desktop/src` for spinner/loading condition.
  2. Run packaged `Ora.app/Contents/MacOS/ora-desktop` with logs to capture startup failure.
  3. Trace Tauri command/runtime path from frontend invoke to Rust sidecar spawn.
- Blockers/Risks: GUI launch verification may need logs if headless capture is insufficient.
- Verification status: Pending.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [ ] Code Verification output (compilation/tests/lint)
- [ ] Functional Verification output (feature verification)
- [ ] Retrospective Evidence (if applicable)
- [ ] Comparison Evidence (if applicable)
- [ ] Checkpoints Evidence (if applicable)

### Environment
- Environment: macOS/darwin, workspace `/Users/quintenchen/developer/ora`.

### Commands run + outputs
- Pending.
