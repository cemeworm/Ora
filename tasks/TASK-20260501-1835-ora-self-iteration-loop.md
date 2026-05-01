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
- `packages/shared/src/capabilities.ts`
- `apps/runtime/src/self-iteration-store.ts`
- `apps/runtime/src/runtime-store-paths.ts`
- `apps/runtime/src/feedback-loop-store.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/src/harness/runtime-tool-executor.ts`
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/run-kernel-lifecycle.ts`
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
- Decision: Runtime tools ship only after review gates exist.
  - Why: JSON-RPC/UI review boundary landed first; agent-facing `selfIteration.apply` now remains approval-gated and cannot bypass confirmation.

## Progress Log

- 2026-05-01 18:35 CST - Task journal created from approved plan; workspace has unrelated dirty files from prior tasks.
  Next: 1) add shared contracts/RPC; 2) add runtime store and JSON-RPC wiring; 3) add desktop client/UI and tests.
- 2026-05-01 18:42 CST - Added shared Self-Iteration schemas/RPC/action kinds, runtime store/RPC wiring, desktop client fallback, Project Signals review surface, and focused shared/runtime/desktop tests.
  Next: 1) run typechecks; 2) run focused verification; 3) close journal with evidence.
- 2026-05-01 18:47 CST - Verification passed for shared/runtime/desktop typechecks, focused tests, and diff whitespace. TODO helper path is tied to a different workspace, so Ora touched-file fallback scan was used.
  Next: none.
- 2026-05-01 19:43 CST - Implemented FOLLOWUP Phase 2 idle/opportunistic curator trigger: added policy controls, persisted project last-scan timestamps, runtime event hooks for feedback accepted/submitted, evaluation completion, and run completion, plus focused cadence/pause tests.
  Next: 1) wire candidate evaluation to real Evaluation Studio runs; 2) generate Mode Studio draft bundles for mode candidates; 3) expose reviewed selfIteration runtime tools.
- 2026-05-01 20:05 CST - Implemented FOLLOWUP Phase 3 V1 real evaluation gate and Phase 4 draft handoff slice: `evaluateCandidate()` now transitions through `evaluating`, invokes a real Evaluation Studio run, attaches the real `evaluationRunId` plus pass/score metadata, fails candidates when the gate fails, and blocks failed non-evaluation applies unless an explicit override confirmation is supplied. Runtime evaluation creates or reuses an Evaluation dataset, runs a router-only Evaluation Studio spec against the candidate target mode, and mode candidates now generate a `ModeStudioDraftBundle` into `proposedChange.after`; mode apply consumes that bundle through `applyModeStudioDraft` instead of a plain handoff.
  Next: 1) add before/after score comparison for prompt/skill/mode candidate changes; 2) add explicit invalid-mode-draft self-iteration apply regression test; 3) expose reviewed `selfIteration.*` runtime tools.
- 2026-05-01 20:33 CST - Implemented FOLLOWUP score/apply evidence and reviewed runtime tools: Self-Iteration evaluation now runs before/after Evaluation Studio configs, stores score evidence in evaluation metadata, mirrors that evidence into `applyResult`, adds regression coverage for invalid generated mode drafts staying unapplied, and exposes agent-facing `selfIteration.list/get/scan/evaluate/apply` runtime tools with `selfIteration.apply` high-risk approval gating and explicit approval copy.
  Next: 1) design opt-in Kairos-style environment observer; 2) decide whether the before/after gate should eventually execute against truly patched behavior instead of V1 router-only twin configs; 3) keep prompt/mode/skill writes approval-gated.
- 2026-05-01 20:58 CST - Implemented FOLLOWUP Phase 6 opt-in Kairos-style environment observer: added `SelfIterationPolicy.environmentObserver` privacy/resource controls, metadata-only project file/run-context observation, Project Signals `project_file` signals and environment observer insight, Self-Iteration mode candidate generation from observer snapshots, browser fallback parity, and Project Signals UI controls for enable/pause/observe-now. No raw file contents are included; summaries are path/size/mtime/extension/run-status metadata only.
  Next: none for V1 follow-up; optional future work is true file-watch events and true patched-behavior A/B evaluation.
- 2026-05-01 21:20 CST - Recorded the full true patched-behavior A/B evaluation plan as the future implementation source of truth inside this journal. The plan defines patch overlay contracts, baseline-vs-candidate Evaluation configs, prompt/mode/skill overlay strategy, score comparator gates, safety boundaries, and acceptance criteria.
  Next: when implementation resumes, start with Phase 7 Step 1 prompt/mode overlays before skill overlays.

## Open Issues

- Idle/opportunistic scanning now exists for feedback acceptance/submission, evaluation completion, recovery/failure terminal runs, and idle-after-terminal-run; it is still event-driven, not a continuous file/terminal watcher.
- Candidate evaluation now launches a real Evaluation Studio gate run and records the resulting `evaluationRunId`, pass/fail status, and before/after score evidence; V1 before/after uses router-only twin configs and does not yet execute against a truly patched prompt/mode/skill behavior.
- Mode candidates now generate a Mode Studio draft bundle during evaluation and apply that bundle through existing Mode Studio validation/apply; invalid generated draft regression coverage confirms failed Mode Studio validation leaves the candidate unapplied.
- Agent-facing `selfIteration.list/get/scan/evaluate/apply` runtime tools exist; `selfIteration.apply` is high-risk, requires approval copy, and injects `confirmed: true` only after the approved execution path.
- Phase 6 implements opt-in metadata-only environment observation on Project Signals refresh/Self-Iteration scan; it is not a continuous raw file/terminal watcher by design.
- Future Phase 7 source of truth is now recorded below: true patched-behavior A/B evaluation should prove candidate behavior in an isolated overlay before any approval-gated apply.

## Follow-up Backlog

### Phase 2: Idle / Opportunistic Curator
- [x] Add a lightweight scheduler in the runtime process that calls `selfIteration.scan` after relevant events:
  - evaluation run completed
  - feedback accepted/submitted
  - repeated recovery/run failure insight created
  - user idle window after active run completion
- [x] Persist last scan timestamps per project to avoid duplicate scans.
- [x] Keep V2 behavior non-mutating except existing low-risk evaluation auto-apply.
- [x] Add policy controls for scan cadence and pause/enable per project.

### Phase 3: Real Candidate Evaluation
- [x] Replace `evaluateCandidate()` placeholder with a real Evaluation Studio flow.
- [x] For evaluation candidates: verify the accepted case exists and optionally run the target config.
- [x] For prompt/mode/skill candidates: compile or generate a targeted evaluation spec, run it, and attach the real `evaluationRunId`.
- [x] Gate `apply` on passing evaluation unless the user explicitly confirms override.
- [x] Store before/after score evidence in `SelfIterationCandidate.applyResult`.
  - Current V1 stores before/after Evaluation Studio config summaries in `proposedChange.metadata.selfIterationEvaluation.scoreEvidence` and mirrors them into `applyResult.scoreEvidence`; note that the current gate is still router-only twin configs, not a true patched-behavior A/B execution.

### Phase 4: Mode Studio Draft Automation
- [x] For mode candidates, call existing Mode Studio draft generation/refinement APIs.
- [x] Attach generated `ModeStudioDraftBundle` or validation result in `proposedChange.after`.
- [x] Keep final `modes.applyDraft` behind confirmation.
- [x] Add tests that invalid generated mode drafts cannot be applied.

### Phase 5: Agent Runtime Tools
- [x] Expose safe `selfIteration.list/get/scan/evaluate` runtime tools to agents.
- [x] Keep `selfIteration.apply` as `requires_approval`.
- [x] Ensure tool descriptors make approval copy explicit for prompt/mode/skill changes.
- [x] Add runtime-tool-executor tests proving agents cannot bypass confirmation.

### Phase 6: Kairos-Style Environment Observation
- [x] Design a scoped observer that can ingest file change summaries, terminal outcomes, and run context without continuously sending raw content to a model.
- [x] Make observation opt-in per project and visible in Project Signals.
- [x] Add privacy/resource policy: watched paths, excluded globs, scan budget, and manual pause.
- [x] Feed observer output as `ProjectSignalSource = "project_file"` after shared contract review.

### Phase 7: True patched-behavior A/B Evaluation

This section is the future implementation source of truth for upgrading V1 score evidence into real candidate-behavior proof. It is not part of the completed V1 DONE gate.

#### Goal

Turn Self-Iteration evaluation from "the candidate has an evaluation score record" into "the candidate's patched behavior was executed in isolation and compared against the current baseline on the same Evaluation dataset."

The desired evidence shape:

```text
Candidate: tighten prompt guidance
Before: passRate 0.67, overallScore 0.71, regressionCount 1
After:  passRate 0.89, overallScore 0.84, regressionCount 0
Delta:  +0.13 score, +0.22 passRate, -1 regression
Decision: improved
Apply: still requires explicit user confirmation
```

#### Current limitation

V1 already stores `scoreEvidence` with before/after config summaries, but the after config is still effectively router-only / label-based. It does not yet execute a mutated prompt, generated mode draft, or skill draft. Therefore V1 evidence proves the evaluation pipeline and review gate, not the actual behavioral improvement.

#### Principle

Evaluation may run proposed behavior, but must not persist proposed behavior.

- `evaluate` may materialize a candidate into an in-memory patch overlay.
- `evaluate` may run that overlay inside an Evaluation Studio config.
- `evaluate` must not write ModeStore, SkillRegistry, prompts, project files, or user config.
- `apply` remains the only path that mutates prompt/mode/skill behavior, and remains approval-gated.

#### Contract design

Add or formalize a patch overlay contract in `packages/shared/src/self-iteration.ts`:

```ts
type SelfIterationPatchOverlay =
  | {
      kind: "prompt";
      modeId: string;
      nodeId?: string;
      operation: "append" | "replace";
      promptPatch: string;
    }
  | {
      kind: "mode";
      modeSpec: ModeSpec;
      draftBundleId?: string;
    }
  | {
      kind: "skill";
      skillName: string;
      description: string;
      content: string;
      enabled: boolean;
    };
```

Also schema-ize score evidence instead of leaving it as loose metadata:

```ts
type SelfIterationScoreEvidence = {
  evaluationRunId: string;
  before: EvaluationConfigScoreSnapshot;
  after: EvaluationConfigScoreSnapshot;
  delta: {
    overallScore: number;
    passRate: number;
    regressionCount: number;
  };
  decision: "improved" | "neutral" | "regressed";
  gate: {
    minScoreDelta: number;
    allowRegressionIncrease: boolean;
    passed: boolean;
    reasons: string[];
  };
};
```

#### Patch materializer

Create a pure materializer, probably in `apps/runtime/src/self-iteration-store.ts` or a new focused module:

```ts
materializeSelfIterationPatch(candidate): SelfIterationPatchOverlay
```

Responsibilities:

- Convert candidate `proposedChange` into an overlay.
- Fail early with explicit reasons when required data is missing.
- Validate generated mode draft bundles before evaluation.
- Never read or write persistent runtime stores directly.

Candidate-specific rules:

1. Prompt candidate
   - Read `modeId`, optional `nodeId`, and string `proposedChange.after`.
   - Overlay clones the target mode and appends/replaces the node prompt for B config only.

2. Mode candidate
   - Require `proposedChange.after` to contain a valid `ModeStudioDraftBundle`.
   - Use `draftBundle.modeDraft` as an evaluation-only mode spec.
   - Do not call `applyModeStudioDraft` during evaluation.

3. Skill candidate
   - Require draft `{ name, description, content }`.
   - Use an ephemeral skill registry overlay for B config.
   - This can be Step 2 after prompt/mode overlays, because skill usefulness is harder to measure reliably.

4. Evaluation candidate
   - Does not need patched behavior A/B.
   - Gate should verify the feedback case exists / imports cleanly and optionally run the target config smoke evaluation.

#### Evaluation spec shape

Upgrade `runSelfIterationEvaluation(candidate)` in `apps/runtime/src/run-store.ts` to build two real configs:

```ts
configs: [
  {
    id: "self-iteration-before",
    label: "Current Ora behavior",
    runConfig: {
      metadata: {
        selfIterationPhase: "before",
        selfIterationCandidateId: candidate.id,
      },
    },
  },
  {
    id: "self-iteration-after",
    label: "Candidate patched behavior",
    runConfig: {
      metadata: {
        selfIterationPhase: "after",
        selfIterationCandidateId: candidate.id,
        selfIterationPatchOverlay: overlay,
      },
    },
  },
]
```

The same dataset, objective, repetitions, and evaluator profile must be used for both configs. Only the overlay differs.

#### Runtime overlay injection

The B config must run through the normal runtime kernel with temporary overlay dependencies:

- `OverlayModeRegistry` for prompt/mode overlays.
- `OverlaySkillRegistry` for skill overlays.
- Existing base stores remain unchanged.

Implementation target:

- `apps/runtime/src/run-store.ts` detects `runConfig.metadata.selfIterationPatchOverlay` before `executeRuntimeKernel`.
- `apps/runtime/src/harness/runtime-kernel.ts` accepts overlay-aware registries through existing options, not global state.
- `apps/runtime/src/run-kernel-lifecycle.ts` passes overlay registries through traced run/resume paths.

Minimal overlay behavior:

```ts
class OverlayModeRegistry {
  get({ modeId }) {
    if (modeId === patchedMode.id) return patchedMode;
    if (modeId === targetModeId) return patchedTargetMode;
    return base.get({ modeId });
  }

  list() {
    return [patchedModeOrTarget, ...base.list()];
  }
}
```

For prompt overlays, `patchedTargetMode` is a clone of the current mode with one patched node prompt.
For mode overlays, `patchedMode` is the generated `ModeStudioDraftBundle.modeDraft`.

#### Score comparator gate

After Evaluation Studio completes, compare config summaries, not just overall run score:

```ts
before = scorecard.configSummaries.find(id === "self-iteration-before")
after = scorecard.configSummaries.find(id === "self-iteration-after")
```

Recommended V1 gate:

```text
after.passRate >= before.passRate
after.regressionCount <= before.regressionCount
after.overallScore >= before.overallScore + minScoreDelta
```

Default `minScoreDelta`: `0.02`.

Decision rules:

- `improved`: all gates pass and score delta is meaningful.
- `neutral`: no regression, but improvement below threshold.
- `regressed`: passRate decreases, regressionCount increases, or score drops.

Apply policy:

- `improved`: candidate can become `ready` for user review.
- `neutral`: candidate can remain `ready` but UI should show weak evidence.
- `regressed`: candidate should become `failed` unless explicitly overridden later.
- Non-evaluation candidate apply still requires confirmation even if improved.

#### Safety boundaries

Never allow evaluation overlay to mutate persistent behavior:

- No `ModeStore.update/create` during `evaluate`.
- No `SkillRegistry.create/update/setEnabled` during `evaluate`.
- No project file writes from evaluation overlay.
- High-risk tools inside evaluation should remain blocked, dry-run, or approval-required.
- Generated sidecar bundles must not be treated as source of truth unless explicitly rebuilt.

The invariant:

```text
evaluate proves behavior; apply changes behavior.
```

#### Implementation plan

1. Shared contracts
   - Add `SelfIterationPatchOverlaySchema` and `SelfIterationScoreEvidenceSchema`.
   - Export through `packages/shared/src/index.ts`.
   - Add contract tests.

2. Patch materializer
   - Implement prompt overlay materialization.
   - Implement mode overlay materialization from validated `ModeStudioDraftBundle`.
   - Return explicit failure reasons for missing `after`, invalid draft, or missing target refs.

3. Runtime overlay execution
   - Add overlay-aware mode registry for evaluation runs.
   - Inject overlay only into the after config run.
   - Keep baseline config unchanged.

4. Comparator
   - Compare config summaries.
   - Store structured score evidence and decision.
   - Preserve current `applyResult.scoreEvidence` mirroring.

5. Tests
   - Prompt candidate: B config receives patched prompt and produces distinct trace/evidence from A.
   - Mode candidate: B config uses generated draft mode spec without persisting it.
   - Regression case: after worse than before marks candidate failed.
   - Safety case: evaluating a prompt/mode candidate does not mutate ModeStore or SkillRegistry.
   - Apply case: improved candidate still requires explicit confirmation.

6. Skill overlays later
   - Add ephemeral skill registry only after prompt/mode overlays are stable.
   - Design skill-specific assertions proving the skill is actually consulted.

#### Acceptance criteria

- Evaluation run contains two configs: `self-iteration-before` and `self-iteration-after`.
- After config actually executes patched prompt or generated mode draft.
- Persistent stores are byte-for-byte / schema-equivalent unchanged after evaluate.
- `SelfIterationCandidate.proposedChange.metadata.selfIterationEvaluation.scoreEvidence` contains structured before/after/delta/decision/gate evidence.
- `SelfIterationCandidate.applyResult.scoreEvidence` mirrors the same evidence after approved apply.
- Failed or regressed candidates cannot apply without explicit override confirmation.
- Project Signals review UI can surface the decision and score delta without implying auto-apply.

#### Verification commands

```bash
pnpm --filter @ora/shared test -- contracts.test.ts
pnpm --filter @ora/shared typecheck
pnpm --filter @ora/shared build
pnpm --filter @ora/runtime exec vitest run test/self-iteration-store.test.ts
pnpm --filter @ora/runtime typecheck
pnpm --filter @ora/desktop typecheck
git diff --check
```

If desktop score display changes, also run:

```bash
pnpm --filter @ora/desktop exec vitest run src/lib/runtimeClient.test.ts
```

#### Known risks

- Router-only Evaluation runs are too weak to prove prompt improvement; patched prompt tests need a behavior-level assertion, not only mode selection.
- Skill candidate A/B is inherently noisier because a skill being available does not prove the agent used it.
- Mode draft evaluation must not accidentally persist generated modes through `applyModeStudioDraft`.
- A/B comparisons can be noisy; use `minScoreDelta` and regression count gates to avoid approving meaningless changes.
- Overlay registries must be request-scoped. Global singleton overlays would leak candidate behavior into normal runs.

#### Suggested implementation order

First implementation slice:

1. Prompt patch overlay.
2. Mode draft overlay.
3. Structured comparator.
4. Safety regression tests.

Second implementation slice:

1. Skill registry overlay.
2. Skill-specific Evaluation objective.
3. Project Signals score-delta presentation polish.

## TODO

- [x] Shared contracts and RPC method enum.
- [x] Runtime store, candidate generators, apply/evaluate policy.
- [x] Desktop client/mock and review surface.
- [x] Focused tests and verification evidence.
- [x] FOLLOWUP: Implement idle/opportunistic curator trigger.
- [x] FOLLOWUP: Wire candidate evaluation to real Evaluation Studio runs.
- [x] FOLLOWUP: Generate actual Mode Studio draft bundles for mode candidates.
- [x] FOLLOWUP: Add before/after score comparison and invalid mode draft regression coverage.
- [x] FOLLOWUP: Expose reviewed `selfIteration.*` runtime tools.
- [x] FOLLOWUP: Design opt-in Kairos-style environment observer.

## Retrospective

- Pitfall: Evaluation Studio router-only smoke runs can look like poor `run.output` tests because they intentionally emit a mode-selection summary and little process trace. Evidence: the Self-Iteration gate needed an explicit `runtime.mode_selection` assertion objective instead of relying on generic text similarity/process scoring. Status: local_only.

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

### Checkpoint 4: Idle / Opportunistic Curator
- Requirement: Runtime triggers Self-Iteration scans after relevant events and persists per-project scan cadence state with pause controls.
- Verification method: shared contract test, runtime focused test, shared/runtime typechecks, diff whitespace.
- Status: Pass.
- Evidence: `pnpm --filter @ora/shared test -- contracts.test.ts` passed 90 tests; `pnpm --filter @ora/runtime test -- self-iteration-store.test.ts` passed 298 tests across the runtime suite; shared/runtime typechecks passed; `git diff --check` passed.

### Checkpoint 5: Real Candidate Evaluation Gate
- Requirement: `selfIteration.evaluate` must invoke a real Evaluation Studio run, attach the real `evaluationRunId`, persist pass/fail metadata, and prevent failed non-evaluation candidates from applying without explicit override confirmation.
- Verification method: focused runtime Self-Iteration tests, runtime/desktop typechecks, diff whitespace.
- Status: Pass.
- Evidence: `pnpm --filter @ora/runtime exec vitest run test/self-iteration-store.test.ts` passed 7 tests, including Evaluation Studio integration and failed-gate apply blocking; `pnpm --filter @ora/runtime typecheck` passed; `pnpm --filter @ora/desktop typecheck` passed; `git diff --check` passed.

### Checkpoint 6: Score Evidence and Mode Draft Safety
- Requirement: candidate evaluation must retain before/after score evidence and `applyResult` must preserve it; invalid generated Mode Studio drafts must not be applied.
- Verification method: focused Self-Iteration tests and runtime typecheck.
- Status: Pass.
- Evidence: `pnpm --filter @ora/runtime exec vitest run test/self-iteration-store.test.ts` passed 8 tests, including `applyResult.scoreEvidence` and invalid mode draft rejection; `pnpm --filter @ora/runtime typecheck` passed.

### Checkpoint 7: Reviewed Agent Runtime Tools
- Requirement: agents can list/get/scan/evaluate Self-Iteration candidates, while apply remains approval-gated and cannot bypass confirmation.
- Verification method: runtime tool executor tests, shared contract test, shared/runtime typechecks, diff whitespace.
- Status: Pass.
- Evidence: `pnpm --filter @ora/runtime exec vitest run test/runtime-tool-executor.test.ts` passed 20 tests, including approval gating for `selfIteration.apply`; `pnpm --filter @ora/shared test -- contracts.test.ts` passed 90 tests; shared/runtime/desktop typechecks passed; `git diff --check` passed.

### Checkpoint 8: Opt-in Environment Observer
- Requirement: project environment observation must be opt-in, metadata-only, budgeted, manually pausable, visible in Project Signals, and usable as Self-Iteration evidence without sending raw content.
- Verification method: shared contract test, focused runtime Self-Iteration test, desktop runtime client test, shared/runtime/desktop typechecks, diff whitespace, TODO scan.
- Status: Pass.
- Evidence: `pnpm --filter @ora/runtime exec vitest run test/self-iteration-store.test.ts` passed 9 tests including metadata-only environment observer signal/candidate/pause behavior; `pnpm --filter @ora/desktop exec vitest run src/lib/runtimeClient.test.ts` passed 5 tests; `pnpm --filter @ora/shared test -- contracts.test.ts` passed 90 tests; shared/runtime/desktop typechecks passed; `git diff --check` passed.

## Compressed State

- Objective: Continue Ora Self-Iteration Loop follow-up work.
- Objective: Ora Self-Iteration Loop V1 follow-ups are complete.
- Done: V1 shared/runtime/desktop loop; Phase 2 idle/opportunistic curator; Phase 3 real Evaluation Studio gate; Phase 4 Mode Studio draft bundle; before/after score evidence in applyResult; invalid mode draft regression; reviewed agent-facing Self-Iteration runtime tools; Phase 6 opt-in metadata-only environment observer.
- Active files: listed above plus feedback-loop store, Project Signals view, runtime tool executor/kernel lifecycle, and shared capability descriptors.
- Next actions: V1 is done; future Phase 7 implementation should start from prompt/mode patched-behavior A/B overlays as recorded above.
- Risks: existing dirty worktree has unrelated prior edits; V1 before/after evidence remains router-only until Phase 7; observer is refresh/scan driven, not always-on.
- Verification status: passed for DONE gate.

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

pnpm --filter @ora/shared build
-> pass

pnpm --filter @ora/shared typecheck
-> pass

pnpm --filter @ora/runtime typecheck
-> pass

pnpm --filter @ora/shared test -- contracts.test.ts
-> Test Files 1 passed; Tests 90 passed

pnpm --filter @ora/runtime test -- self-iteration-store.test.ts
-> Test Files 22 passed; Tests 298 passed

git diff --check
-> pass, empty output

pnpm --filter @ora/runtime exec vitest run test/self-iteration-store.test.ts
-> Test Files 1 passed; Tests 7 passed

pnpm --filter @ora/runtime typecheck
-> pass

pnpm --filter @ora/desktop typecheck
-> pass

git diff --check
-> pass, empty output

pnpm --filter @ora/runtime exec vitest run test/self-iteration-store.test.ts
-> Test Files 1 passed; Tests 8 passed

pnpm --filter @ora/runtime exec vitest run test/runtime-tool-executor.test.ts
-> Test Files 1 passed; Tests 20 passed

pnpm --filter @ora/shared test -- contracts.test.ts
-> Test Files 1 passed; Tests 90 passed

pnpm --filter @ora/shared typecheck
-> pass

pnpm --filter @ora/runtime typecheck
-> pass

pnpm --filter @ora/desktop typecheck
-> pass

pnpm --filter @ora/shared build
-> pass

pnpm --filter @ora/runtime exec vitest run test/self-iteration-store.test.ts test/runtime-tool-executor.test.ts
-> Test Files 2 passed; Tests 28 passed

git diff --check
-> pass, empty output

pnpm --filter @ora/runtime exec vitest run test/self-iteration-store.test.ts
-> Test Files 1 passed; Tests 9 passed

pnpm --filter @ora/shared test -- contracts.test.ts
-> Test Files 1 passed; Tests 90 passed

pnpm --filter @ora/shared typecheck
-> pass

pnpm --filter @ora/shared build
-> pass

pnpm --filter @ora/runtime typecheck
-> pass

pnpm --filter @ora/desktop typecheck
-> pass

pnpm --filter @ora/desktop exec vitest run src/lib/runtimeClient.test.ts
-> Test Files 1 passed; Tests 5 passed

git diff --check
-> pass, empty output

pnpm -r --if-present typecheck
-> packages/shared, apps/runtime, apps/desktop typechecks passed
```

### TODO Scan

```text
bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh
-> PASS, but script is hard-wired to the quantfox workspace and not authoritative for Ora.

rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX|\\[ \\]" <self-iteration touched files>
-> no source/test matches; remaining task journal matches are FOLLOWUP backlog items mirrored in Open Issues/Next actions.

bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"
-> existing matches only in skill templates, memory notes, generated sidecar bundle/binary, and allowed task follow-up backlog; no new blocking source TODO from this slice.

rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX|\\[ \\]" apps/runtime/src/self-iteration-store.ts apps/runtime/src/run-store.ts apps/runtime/test/self-iteration-store.test.ts
-> no output / exit 1 (no matches)

bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"
-> existing matches only in `.ora/skills/private/think/SKILL.md`, historical memory notes, generated sidecar bundle/binary, and skill-creator templates; no new blocking source TODO from this slice.

rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX|\\[ \\]" apps/runtime/src/self-iteration-store.ts apps/runtime/src/run-store.ts apps/runtime/src/harness/runtime-tool-executor.ts apps/runtime/src/harness/runtime-kernel.ts apps/runtime/src/run-kernel-lifecycle.ts apps/runtime/test/self-iteration-store.test.ts apps/runtime/test/runtime-tool-executor.test.ts packages/shared/src/capabilities.ts
-> no output / exit 1 (no matches)

bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"
-> existing matches only in `.ora/skills/private/think/SKILL.md`, historical memory notes, generated sidecar bundle/binary, and skill-creator templates; no new blocking source TODO from Phase 6.

rg --pcre2 -n "TODO(?!\\(FOLLOWUP\\))|FIXME|XXX|\\[ \\]" packages/shared/src/self-iteration.ts packages/shared/test/contracts.test.ts apps/runtime/src/feedback-loop-store.ts apps/runtime/src/run-store.ts apps/runtime/src/self-iteration-store.ts apps/runtime/test/self-iteration-store.test.ts apps/desktop/src/lib/runtimeClient.ts apps/desktop/src/components/ProjectSignalsView.tsx
-> no output / exit 1 (no matches)
```

### Functional Evidence

- `SelfIterationCandidateSchema`, `SelfIterationPolicySchema`, `SelfIterationRunSchema`, and `selfIteration.*` RPC methods are covered in shared contract tests.
- `LocalSelfIterationStore` scans pending feedback into Evaluation candidates and auto-applies them under low-risk policy.
- Prompt candidates require confirmation before apply; confirmed prompt apply uses the runtime callback path.
- Skill candidates are generated from successful multi-tool runs as private editable skill drafts.
- Browser fallback supports scan/list/get/evaluate/reject/apply/policy methods.
- Project Signals now has a Self-Iteration scan/review surface with candidate kind, status, risk, evaluation id, and apply/reject controls.
- Phase 2: runtime queues or runs curator scans after feedback acceptance/submission, Evaluation run completion, recovery/failure terminal runs, and idle-after-terminal-run.
- Phase 2: `SelfIterationPolicy` now controls curator enablement, scan cadence, and idle delay; `LocalSelfIterationStore` persists per-project last scan timestamps and skips duplicate opportunistic scans inside cadence.
- Phase 3 V1: `selfIteration.evaluate` now runs a real Evaluation Studio gate, records the real `evaluationRunId`, writes pass/score metadata, and blocks failed non-evaluation applies unless explicitly overridden.
- Phase 4 V1: mode candidates now produce a `ModeStudioDraftBundle` during evaluation, and mode apply routes through existing Mode Studio draft validation/apply instead of a plain handoff.
- Follow-up score evidence: Self-Iteration evaluation now records before/after config score snapshots and deltas, then mirrors the evidence into `SelfIterationCandidate.applyResult.scoreEvidence`.
- Follow-up mode safety: invalid generated mode drafts fail through the Mode Studio apply path and leave candidates in `ready` rather than marking them applied.
- Follow-up runtime tools: `selfIteration.list/get/scan/evaluate/apply` are available to agents; `selfIteration.apply` is high-risk, injects `confirmed: true` only on approved execution, and carries explicit approval copy.
- Phase 6 observer: `SelfIterationPolicy.environmentObserver` defaults off, supports watched paths/excluded globs/scan budget/max file size/manual pause, emits `project_file` signals with metadata-only file/run summaries, and can seed a review-gated mode candidate.
