# TASK-20260502-1652-github-packages-publish

**Created:** 2026-05-02 16:52 CST
**Status:** Done

---

## Goal
- Publish Ora's shared TypeScript package to GitHub Packages npm registry for repository `https://github.com/cemeworm/Ora.git`, using the GitHub owner scope `@cemeworm` and a minimal release workflow that fits the existing pnpm + release-please setup.

## Scope / Out of scope
- In scope:
  - Rename publishable package from `@ora/shared` to `@cemeworm/shared`.
  - Remove `private: true` from `packages/shared/package.json`.
  - Add `publishConfig.registry`, `files`, and repository metadata for safe npm publishing.
  - Update internal workspace dependencies/imports from `@ora/shared` to `@cemeworm/shared` where they affect build/runtime.
  - Add GitHub Actions workflow to publish on GitHub Release `published`.
  - Run focused build/typecheck/test/publish dry-run verification and record evidence.
- Out of scope:
  - Publishing desktop/runtime app packages.
  - Switching to Changesets or redesigning release strategy.
  - Actually publishing from local machine.
  - Changing package public APIs or schemas.

## Constraints
- Compatibility: Preserve existing runtime/desktop package behavior after package rename.
- Performance: No runtime behavior change expected.
- Risk: GitHub Packages scope must match owner `cemeworm`; version `0.1.0` cannot be republished if already published.
- Tool/Environment limits: Prefer GitHub Actions `GITHUB_TOKEN` over local credentials; no repository `.npmrc` unless needed.

## Plan
1. Update `/Users/quintenchen/developer/ora/packages/shared/package.json` to `@cemeworm/shared`, remove `private`, add `publishConfig`, `files`, and repository metadata.
2. Update workspace package dependencies and source imports from `@ora/shared` to `@cemeworm/shared` in build-relevant files, excluding historical `tasks/*.md` logs.
3. Add `/Users/quintenchen/developer/ora/.github/workflows/publish-packages.yml` to publish `@cemeworm/shared` on release published.
4. Run focused verification: install lockfile check, package build/typecheck/test, publish dry-run, downstream/root build/typecheck/test, TODO scan.
5. Update this task journal with changed files, outputs, residual risks, and compressed state.

## Active Files
- `/Users/quintenchen/developer/ora/tasks/TASK-20260502-1652-github-packages-publish.md`
- `/Users/quintenchen/developer/ora/packages/shared/package.json`
- `/Users/quintenchen/developer/ora/apps/desktop/package.json`
- `/Users/quintenchen/developer/ora/apps/runtime/package.json`
- `/Users/quintenchen/developer/ora/.github/workflows/publish-packages.yml`
- `/Users/quintenchen/developer/ora/pnpm-lock.yaml`
- Runtime/desktop source, test, Vite/Vitest/TS config files importing or aliasing `@ora/shared`.

## Decisions
- Decision: Use package scope `@cemeworm`.
  - Why: GitHub repository owner is `cemeworm`, so GitHub Packages npm scope should match for reliable permissions.
  - Alternatives: Keep `@ora`, publish to npmjs.org, introduce Changesets.
  - Tradeoffs: Renaming requires internal import/dependency updates, but avoids likely GitHub Packages namespace/403 issues.
- Decision: Do not add repository `.npmrc` initially.
  - Why: `publishConfig.registry` plus `actions/setup-node` registry/scope auth is sufficient for publish workflow.
  - Alternatives: Commit `.npmrc` with scope registry.
  - Tradeoffs: Consumer projects still need their own `.npmrc` to install from GitHub Packages.
- Decision: Add package-level `repository` metadata.
  - Why: GitHub Packages recommends package metadata point at the GitHub repository; `directory` identifies the workspace package.
  - Alternatives: Rely only on Actions package association.
  - Tradeoffs: Slight metadata addition, no runtime impact.

## Progress Log
- 2026-05-02 16:52 CST - Task created.
  Next: Fill in Goal, Scope, Plan, and list Active Files.
- 2026-05-02 16:55 CST - Filled task journal from approved plan; ready to edit package metadata, imports, and publish workflow.
  Next: update package metadata; rename build-relevant imports; add publish workflow.
- 2026-05-02 16:58 CST - SAVEPOINT before broad package rename from `@ora/shared` to `@cemeworm/shared` across build-relevant files.
  Next: batch replace package references outside historical task logs; update package publish metadata; create publish workflow.
- 2026-05-02 17:01 CST - Updated `packages/shared/package.json`, renamed build-relevant imports/dependencies to `@cemeworm/shared`, and created `publish-packages.yml`.
  Next: inspect git diff; run install/build/typecheck/test/publish dry-run; record verification evidence.
- 2026-05-02 17:04 CST - Verification passed: frozen install, shared build/typecheck/test, downstream typechecks, publish dry-run, root typecheck/test/build.
  Next: run TODO scan; update final DONE state; report summary.
- 2026-05-02 17:06 CST - TODO scan and `git diff --check` completed; task DONE with only mirrored follow-up risks.
  Next: user reviews diff and commits/pushes when ready.

## Open Issues
- [ ] TODO(FOLLOWUP): Confirm whether GitHub package `@cemeworm/shared@0.1.0` has never been published; otherwise release-please must bump before first publish.
- [ ] TODO(FOLLOWUP): `scripts/build-desktop.sh` is untracked in the working tree but was not created by this task; decide separately whether to keep or remove it.

## TODO
- [x] Update package metadata for `@cemeworm/shared`.
- [x] Rename build-relevant internal references from `@ora/shared` to `@cemeworm/shared`.
- [x] Add GitHub Packages publish workflow.
- [x] Run verification and paste outputs.
- [ ] TODO(FOLLOWUP): Confirm package version availability on GitHub Packages before first real release.
- [ ] TODO(FOLLOWUP): Triage pre-existing untracked `scripts/build-desktop.sh` separately.
- [x] Run TODO scan before DONE.

## Retrospective

### Item 1
- Pitfall: GitHub Packages npm scope mismatch can make a correct package config fail at publish time.
- Symptom: `npm publish` / `pnpm publish` may fail with `403 Forbidden` even though token and registry look correct.
- Root Cause: Scoped npm package name should align with GitHub user/org namespace used by the repository and package permissions.
- Reusable Guardrail: Before configuring GitHub Packages, confirm the actual GitHub repo owner and derive package name, workflow `scope`, and consumer `.npmrc` from that owner.
- Evidence: User confirmed repo `https://github.com/cemeworm/Ora.git`; implementation uses `@cemeworm/shared` and `scope: "@cemeworm"`.
- Scope: GitHub Packages npm publishing tasks.
- Suggested Writeback Target: Existing package publishing guidance if one is created later; current long-task protocol is sufficient for this repo task.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Package build passes
- [x] Package typecheck passes
- [x] Package tests pass
- [x] Downstream typechecks pass
- [x] Root build/typecheck/test pass

**Output**:

```text
pnpm install --frozen-lockfile
Exit Code: 0
Scope: all 4 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 820ms using pnpm v10.11.0

pnpm --filter @cemeworm/shared build
Exit Code: 0
> @cemeworm/shared@0.1.0 build /Users/quintenchen/developer/ora/packages/shared
> tsc -p tsconfig.json

pnpm --filter @cemeworm/shared typecheck
Exit Code: 0
> @cemeworm/shared@0.1.0 typecheck /Users/quintenchen/developer/ora/packages/shared
> tsc -p tsconfig.json --noEmit

pnpm --filter @cemeworm/shared test
Exit Code: 0
✓ test/contracts.test.ts (90 tests)
Test Files 1 passed (1); Tests 90 passed (90)

pnpm --filter @ora/runtime typecheck
Exit Code: 0
> @ora/runtime@0.1.0 typecheck /Users/quintenchen/developer/ora/apps/runtime
> tsc -p tsconfig.json --noEmit

pnpm --filter @ora/desktop typecheck
Exit Code: 0
> @ora/desktop@0.1.0 typecheck /Users/quintenchen/developer/ora/apps/desktop
> tsc --noEmit

pnpm typecheck
Exit Code: 0
Scope: 3 of 4 workspace projects
packages/shared typecheck: Done
apps/runtime typecheck: Done
apps/desktop typecheck: Done

pnpm test
Exit Code: 0
packages/shared: 1 file passed, 90 tests passed
apps/desktop: 12 files passed, 94 tests passed
apps/runtime: 24 files passed, 342 tests passed

pnpm build
Exit Code: 0
packages/shared build: Done
apps/runtime build: Done
apps/desktop build: vite built successfully

git diff --check
Exit Code: 0
Stdout: empty
```

### Functional Verification (Feature Works)
- [x] Publish dry-run proves package tarball can be prepared for registry publish.
- [x] Workflow YAML is present and configured with `packages: write` and `@cemeworm` scope.
- [x] Old build-relevant `@ora/shared` references are removed outside `tasks/**` historical logs.

**Output**:

```text
pnpm --filter @cemeworm/shared publish --dry-run --no-git-checks
Exit Code: 0
+ @cemeworm/shared@0.1.0
npm notice Publishing to https://npm.pkg.github.com/ with tag latest and default access (dry-run)
npm notice package size: 254.2 kB
npm notice unpacked size: 3.6 MB
npm notice total files: 53

rg "@ora/shared" /Users/quintenchen/developer/ora --glob '!node_modules/**' --glob '!target/**' --glob '!build/**' --glob '!dist/**' --glob '!*.map' --glob '!tasks/**'
Exit Code: 1
Stdout: empty (no build-relevant old refs remain)

.github/workflows/publish-packages.yml
- on: release types [published]
- permissions: contents read, packages write
- setup-node registry-url: https://npm.pkg.github.com
- setup-node scope: "@cemeworm"
- publish: pnpm --filter @cemeworm/shared publish --no-git-checks
- env NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Comparison (If Applicable)

### Reference
- Existing `.github/workflows/ci.yml` and `.github/workflows/build.yml` setup-node/pnpm patterns.
- GitHub Packages npm registry documentation.

### Comparison Points
- [x] Uses same Node 22 and pnpm 10 setup style as existing workflows.
- [x] Uses GitHub Packages-required scoped package name and registry URL.
- [x] Keeps release-please version flow unchanged.

### Findings
- Consistency: New workflow matches existing Actions style (`checkout`, `pnpm/action-setup@v4`, `actions/setup-node@v4`, pnpm commands).
- Differences: New workflow publishes npm package on release published; existing `build.yml` builds desktop artifacts on the same event.
- Conclusion: Consistent with existing CI/release setup and does not require release-please or Changesets changes.

## Checkpoints

### Checkpoint 1: Package metadata publishability
- Requirement: `packages/shared/package.json` is publishable as `@cemeworm/shared` with GitHub Packages registry and package file whitelist.
- Verification method: Inspect file and run `pnpm --filter @cemeworm/shared publish --dry-run --no-git-checks`.
- Status: [x] Pass / [ ] Fail
- Evidence: Dry-run exit code 0; tarball generated as `cemeworm-shared-0.1.0.tgz`; registry `https://npm.pkg.github.com/`.

### Checkpoint 2: Internal consumers still resolve shared package
- Requirement: Runtime and desktop packages resolve renamed workspace dependency/import path.
- Verification method: `pnpm --filter @ora/runtime typecheck`, `pnpm --filter @ora/desktop typecheck`, root `pnpm typecheck`, root `pnpm test`, root `pnpm build`.
- Status: [x] Pass / [ ] Fail
- Evidence: All listed commands exit code 0.

### Checkpoint 3: CI publish workflow exists
- Requirement: GitHub Release published triggers npm publish with `packages: write` and `NODE_AUTH_TOKEN`.
- Verification method: Inspect `.github/workflows/publish-packages.yml`.
- Status: [x] Pass / [ ] Fail
- Evidence: Workflow contains release published trigger, `permissions.packages: write`, `scope: "@cemeworm"`, and `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Publish `packages/shared` to GitHub Packages for `cemeworm/Ora`.
- Done: Task journal created; shared package renamed to `@cemeworm/shared`; publish metadata added; internal refs renamed; publish workflow created; verification and TODO scan completed.
- In-progress: None.
- Active files: task journal, `packages/shared/package.json`, runtime/desktop package manifests/imports/configs, publish workflow, `pnpm-lock.yaml`.
- Next actions (top 3; exact file/function): user reviews diff; confirm package version availability; commit/push to GitHub.
- Blockers/Risks: Need confirm `@cemeworm/shared@0.1.0` has not already been published; untracked `scripts/build-desktop.sh` is unrelated.
- Verification status: PASS.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: macOS/darwin, Node 22.17.0, pnpm workspace using pnpm v10.11.0.

### Changed files evidence
- Key metadata/workflow files:
  - `packages/shared/package.json`
  - `.github/workflows/publish-packages.yml`
  - `apps/desktop/package.json`
  - `apps/runtime/package.json`
  - `pnpm-lock.yaml`
- Build-relevant import/config rename files:
  - `apps/desktop/src/**`, `apps/desktop/tsconfig.json`, `apps/desktop/vite.config.ts`
  - `apps/runtime/src/**`, `apps/runtime/test/**`, `apps/runtime/vitest.config.ts`
- Task journal:
  - `tasks/TASK-20260502-1652-github-packages-publish.md`
- Unrelated pre-existing/unowned working tree item observed:
  - `scripts/build-desktop.sh` is untracked and not created by this task.

### Commands run + outputs
- See Code Verification and Functional Verification sections above.

### TODO scan output

```text
bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"
Exit Code: 0
Output included only pre-existing unrelated/template/generated hits outside this task's actionable code path, including:
- `./.ora/skills/private/think/SKILL.md` instructional text mentioning TODO placeholders.
- `.workbuddy/memory/*.md` historical notes mentioning TODO/FOLLOWUP.
- `packages/shared/src/modes.ts` prompt text requiring long-task TODO scan evidence.
- `skills/skill-creator/scripts/init_skill.py` template TODO placeholders.
- `apps/desktop/src-tauri/resources/runtime-sidecar/...` generated/vendor sidecar TODO comments.

This task journal contains only mirrored `TODO(FOLLOWUP)` residual risks under Open Issues.
```
