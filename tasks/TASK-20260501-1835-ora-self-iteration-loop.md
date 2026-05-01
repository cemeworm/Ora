# TASK: Ora Self-Iteration Loop V1

> 唯一真相源 (Single Source of Truth)
> Created: 2026-05-01 18:35 CST
> Status: DONE

## Goal

把 Ora 现有的可构建、可运行、可观测、可评测能力串成第 5 步：可自行迭代。

V1 做统一闭环，覆盖 prompt、mode 编排、skill 生成/改进、evaluation case 增补。采用“低风险自动”策略：Ora 可以自动观察、生成候选方案、生成评测用例、运行评测，但所有会修改 prompt/mode/skill 的动作必须经过用户确认。

参考：
- Kairos: 后台/空闲期 curator、跨会话记忆整理、从 reactive assistant 转向 proactive agent。
- Hermes Agent: closed learning loop、从经验生成 skills、skills 在使用中改进、可搜索历史与持续用户模型。

## Scope

- In scope: shared self-iteration contracts, runtime store/RPC, Feedback Loop action integration, desktop runtime client/fallback, review surface, focused tests.
- Out of scope: always-on file/terminal watcher, direct agent tools for `selfIteration.*`, auto-applying prompt/mode/skill writes, deleting/deprecating existing capabilities.

## Plan

1. Add shared `self-iteration` contracts, RPC methods, and Feedback Loop action kinds.
2. Add runtime `LocalSelfIterationStore`, persistence paths, run-store methods, and JSON-RPC routing.
3. Generate candidates from existing Feedback Loop/Evaluation/Run/Feedback evidence, with low-risk auto policy.
4. Add desktop client + mock fallback + review surface in Project Signals.
5. Add focused shared/runtime/desktop tests and run verification.

## Active Files

- `packages/shared/src/self-iteration.ts`
- `packages/shared/src/feedback-loop.ts`
- `packages/shared/src/rpc.ts`
- `packages/shared/src/index.ts`
- `apps/runtime/src/self-iteration-store.ts`
- `apps/runtime/src/runtime-store-paths.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/components/ProjectSignalsView.tsx`
- relevant shared/runtime/desktop tests

## Decisions

- Decision: V1 uses a low-risk auto policy.
  - Why: User explicitly chose low-risk auto.
  - Tradeoff: Ora can collect evidence, draft, evaluate, and auto-add evaluation material, but cannot silently mutate prompt/mode/skill behavior.
- Decision: Self-Iteration reuses existing Feedback Loop, Evaluation Studio, Mode Studio, and Skill Registry.
  - Why: Avoids a parallel learning system and keeps the loop explainable.
  - Tradeoff: V1 candidate generation is conservative and evidence-backed rather than broad autonomous exploration.
- Decision: Runtime tools are deferred.
  - Why: Initial plan says JSON-RPC/UI first to avoid agents bypassing review.

## Progress Log

- 2026-05-01 18:35 CST - Task journal created from approved plan; workspace has unrelated dirty files from prior tasks.
  Next: 1) add shared contracts/RPC; 2) add runtime store and JSON-RPC wiring; 3) add desktop client/UI and tests.
- 2026-05-01 18:42 CST - Added shared Self-Iteration schemas/RPC/action kinds, runtime store/RPC wiring, desktop client fallback, Project Signals review surface, and focused shared/runtime/desktop tests.
  Next: 1) run typechecks; 2) run focused verification; 3) close journal with evidence.
- 2026-05-01 18:47 CST - Verification passed for shared/runtime/desktop typechecks, focused tests, and diff whitespace. TODO helper path is tied to a different workspace, so Ora touched-file fallback scan was used.
  Next: none.

## Open Issues

- V1 is explicit-scan only. Background idle/opportunistic scanning is not implemented.
- Candidate evaluation records a ready/evaluation id placeholder; it does not yet launch a real Evaluation Studio run.
- Mode candidates are Mode Studio handoffs; they do not yet create a validated Mode Studio draft bundle automatically.
- Agent-facing `selfIteration.*` runtime tools are intentionally deferred.
- No file/terminal watcher exists for Kairos-style continuous environment observation.

## Follow-up Backlog

### Phase 2: Idle / Opportunistic Curator
- Add a lightweight scheduler in the runtime process that calls `selfIteration.scan` after relevant events:
  - evaluation run completed
  - feedback accepted/submitted
  - repeated recovery/run failure insight created
  - user idle window after active run completion
- Persist last scan timestamps per project to avoid duplicate scans.
- Keep V2 behavior non-mutating except existing low-risk evaluation auto-apply.
- Add policy controls for scan cadence and pause/enable per project.

### Phase 3: Real Candidate Evaluation
- Replace `evaluateCandidate()` placeholder with a real Evaluation Studio flow.
- For evaluation candidates: verify the accepted case exists and optionally run the target config.
- For prompt/mode/skill candidates: compile or generate a targeted evaluation spec, run it, and attach the real `evaluationRunId`.
- Gate `apply` on passing evaluation unless the user explicitly confirms override.
- Store before/after score evidence in `SelfIterationCandidate.applyResult`.

### Phase 4: Mode Studio Draft Automation
- For mode candidates, call existing Mode Studio draft generation/refinement APIs.
- Attach generated `ModeStudioDraftBundle` or validation result in `proposedChange.after`.
- Keep final `modes.applyDraft` behind confirmation.
- Add tests that invalid generated mode drafts cannot be applied.

### Phase 5: Agent Runtime Tools
- Expose safe `selfIteration.list/get/scan/evaluate` runtime tools to agents.
- Keep `selfIteration.apply` as `requires_approval`.
- Ensure tool descriptors make approval copy explicit for prompt/mode/skill changes.
- Add runtime-tool-executor tests proving agents cannot bypass confirmation.

### Phase 6: Kairos-Style Environment Observation
- Design a scoped observer that can ingest file change summaries, terminal outcomes, and run context without continuously sending raw content to a model.
- Make observation opt-in per project and visible in Project Signals.
- Add privacy/resource policy: watched paths, excluded globs, scan budget, and manual pause.
- Feed observer output as `ProjectSignalSource = "project_file"` or a new source only after shared contract review.

## TODO

- [x] Shared contracts and RPC method enum.
- [x] Runtime store, candidate generators, apply/evaluate policy.
- [x] Desktop client/mock and review surface.
- [x] Focused tests and verification evidence.
- [ ] FOLLOWUP: Implement idle/opportunistic curator trigger.
- [ ] FOLLOWUP: Wire candidate evaluation to real Evaluation Studio runs.
- [ ] FOLLOWUP: Generate actual Mode Studio draft bundles for mode candidates.
- [ ] FOLLOWUP: Expose reviewed `selfIteration.*` runtime tools.
- [ ] FOLLOWUP: Design opt-in Kairos-style environment observer.

## Retrospective

- None worth promoting.

## Comparison

### Reference
- `tasks/TASK-20260428-2347-evaluation-studio-planner-workbench.md`
- `tasks/TASK-20260430-1713-ora-no-code-mode-layouts.md`
- `tasks/TASK-20260501-0131-mode-creator-skill.md`
- Kairos article saved at `/Users/quintenchen/Downloads/KAIROS-The-Hidden-Daemon-Mode-Inside-Claude-Code.md`
- Hermes README saved at `/Users/quintenchen/Downloads/Hermes-Agent-README.md`

### Expected Consistency
- Reuse existing local-first stores and JSON-RPC patterns.
- Keep approval boundaries consistent with Mode Studio and Skill Registry.
- Treat Evaluation Studio as the regression gate and low-risk auto-apply target.

## Checkpoints

### Checkpoint 1: Contracts
- Requirement: Shared schemas cover candidates, policy, runs, RPC methods, and Feedback Loop actions.
- Verification method: shared contract tests.
- Status: Pass.
- Evidence: `pnpm --filter @ora/shared test -- contracts.test.ts` passed 90 tests.

### Checkpoint 2: Runtime Loop
- Requirement: Runtime can scan, list/get/evaluate/reject/apply candidates with low-risk policy.
- Verification method: runtime focused tests.
- Status: Pass.
- Evidence: `pnpm --filter @ora/runtime test -- self-iteration-store.test.ts` passed; runtime suite reported 296 tests passed.

### Checkpoint 3: Desktop Review
- Requirement: Desktop can show candidates and drive evaluate/reject/apply through client and fallback.
- Verification method: desktop runtime client/component tests or focused typecheck.
- Status: Pass.
- Evidence: `pnpm --filter @ora/desktop test -- runtimeClient.test.ts` passed; desktop suite reported 98 tests passed; desktop typecheck passed.

## Compressed State

- Objective: Implement Ora Self-Iteration Loop V1 across shared/runtime/desktop.
- Done: shared contracts/RPC/action kinds, runtime persistent store and JSON-RPC methods, candidate generators, guarded apply/evaluate policy, desktop client/mock, Project Signals review surface, focused tests.
- Active files: listed above.
- Next actions: none.
- Risks: existing dirty worktree has unrelated prior edits; this task only owns self-iteration files and targeted integration edits.
- Verification status: passed.

## Verification

### Commands

```text
pnpm --filter @ora/shared build
-> pass

pnpm --filter @ora/shared typecheck
-> pass

pnpm --filter @ora/runtime typecheck
-> pass

pnpm --filter @ora/desktop typecheck
-> pass

pnpm --filter @ora/shared test -- contracts.test.ts
-> Test Files 1 passed; Tests 90 passed

pnpm --filter @ora/runtime test -- self-iteration-store.test.ts
-> Test Files 22 passed; Tests 296 passed

pnpm --filter @ora/desktop test -- runtimeClient.test.ts
-> Test Files 12 passed; Tests 98 passed

git diff --check
-> pass, empty output
```

### TODO Scan

```text
bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh
-> PASS, but script is hard-wired to the quantfox workspace and not authoritative for Ora.

rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX|\\[ \\]" <self-iteration touched files>
-> no source/test matches; only this task journal's completed checklist before closure.
```

### Functional Evidence

- `SelfIterationCandidateSchema`, `SelfIterationPolicySchema`, `SelfIterationRunSchema`, and `selfIteration.*` RPC methods are covered in shared contract tests.
- `LocalSelfIterationStore` scans pending feedback into Evaluation candidates and auto-applies them under low-risk policy.
- Prompt candidates require confirmation before apply; confirmed prompt apply uses the runtime callback path.
- Skill candidates are generated from successful multi-tool runs as private editable skill drafts.
- Browser fallback supports scan/list/get/evaluate/reject/apply/policy methods.
- Project Signals now has a Self-Iteration scan/review surface with candidate kind, status, risk, evaluation id, and apply/reject controls.
