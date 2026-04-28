# TASK-20260428-1929-mode-derived-thinking-policy

**Created:** 2026-04-28 19:29 CST
**Status:** Completed
**Source of Truth:** This file is the only authoritative plan for making Ora work mode the sole strategy entry point and deriving thinking depth from mode policy.

---

## Goal

Simplify Ora's chat composer strategy model so **工作模式** is the only first-class strategy control exposed in the main input surface, while thinking depth becomes a runtime policy derived from the selected `ModeSpec`.

The product goal is to remove the duplicated mental model of "工作模式 + 思考程度" from the composer. Users choose how Ora should organize the work through mode selection or Auto Mode Router. Ora then derives the effective reasoning depth, budget, planning behavior, provider thinking parameters, and delegation allowance from the mode.

## Product Thesis

Ora should not ask users to separately reason about two overlapping strategy knobs.

- **工作模式** answers: "How should this task be organized?"
- **模型** answers: "Which provider/model should execute it?"
- **思考深度** answers an implementation detail: "How much reasoning/budget/planning should this selected mode use?"

Therefore thinking depth should be visible as runtime evidence and editable in Mode Studio, but not remain a primary composer-level control.

## Current State

### Desktop

- `apps/desktop/src/components/ChatInput.tsx` defines `inputMode: "flash" | "thinking" | "pro" | "ultra"` and renders the visible `思考程度` picker.
- `apps/desktop/src/lib/state.tsx` stores `inputMode` in desktop state with default `"pro"`.
- `apps/desktop/src/components/ChatView.tsx` passes `state.inputMode` into `ChatInput`; `ultra` also affects welcome text styling through `golden-text`.
- `apps/desktop/src/lib/useRunActions.ts` does **not** pass `inputMode` into `runtimeClient.startStreamingRun(...)`.

### Runtime / Shared

- `packages/shared/src/runtime.ts` `RunConfigSchema` has no `inputMode`, `thinkingEnabled`, or `reasoningEffort` field.
- Provider adapters already preserve provider-native reasoning content such as DeepSeek `reasoning_content`, but there is no composer-level switch that changes provider thinking parameters.
- Mode definitions already carry rich mode-owned behavior through `ModeSpec`, `defaultBudget`, `completionPolicy`, `runtimeAtoms`, `capabilityFlags`, and topology.

### Upstream Reference

DeerFlow maps composer mode to real run behavior:

- `flash`: thinking off
- `thinking`: thinking on
- `pro`: thinking on + plan/todo middleware
- `ultra`: thinking on + plan/todo middleware + subagent tools

Ora should learn from the fact that the selector is wired to runtime behavior, but should not copy the extra top-level selector if work mode already owns that behavior.

## Design Decision

### Decision

Make `ModeSpec` the source of truth for runtime strategy. The main composer should expose:

1. model provider selector,
2. work mode selector, including Auto,
3. prompt/actions.

The composer should not expose `思考程度` as a separate first-level selector.

### Why

- Work mode is already Ora's user-facing strategy abstraction and is managed through Mode Studio.
- Auto Mode Router can select the right work organization and therefore indirectly select the appropriate runtime depth.
- A separate thinking-depth selector creates ambiguous combinations such as `工作模式: Single Agent` + `思考程度: Ultra` or `工作模式: Agent Teams` + `思考程度: Flash`.
- Runtime truth should be auditable through mode specs and Trails, not scattered across desktop local UI state.

### Alternatives Considered

- Add an `Auto` option to thinking depth.
  - Rejected for now: it creates a second router next to Auto Mode Router and doubles the number of strategic explanations the user must understand.
- Keep thinking depth as an advanced per-run override.
  - Deferred: this can exist later under advanced/dev controls, but not as a main composer button.
- Wire current `inputMode` directly to provider params.
  - Rejected: it would make the UI control real, but still keep the duplicated product model.

## Target Model

### Mode Runtime Policy

Add a mode-owned policy concept. Name is open, but the preferred shape is `runtimePolicy` on `ModeSpec`.

Conceptual shape:

```ts
type ModeRuntimePolicy = {
  thinking: "off" | "standard" | "deep";
  reasoningEffort?: "none" | "low" | "medium" | "high";
  budgetProfile: "fast" | "balanced" | "deep";
  planning: "none" | "light" | "explicit";
  delegation: "none" | "allowed" | "preferred";
  providerThinking: "disabled" | "auto" | "required";
};
```

The exact fields should be chosen conservatively during implementation and should reuse existing Ora primitives when possible:

- `defaultBudget`
- `completionPolicy`
- `runtimeAtoms`
- `capabilityFlags.toolIds`
- `capabilityFlags.approvalMode`
- provider capabilities

### Effective Run Policy

Runtime should derive and persist an effective policy per run:

```ts
type EffectiveRunStrategy = {
  sourceModeId: string;
  sourceModeSelection: "manual" | "auto";
  thinking: "off" | "standard" | "deep";
  reasoningEffort?: "none" | "low" | "medium" | "high";
  budget: ResourceBudget;
  planningEnabled: boolean;
  delegationEnabled: boolean;
  providerThinkingEnabled: boolean;
  providerPolicyStatus: "applied" | "unsupported" | "degraded";
  notes?: string[];
};
```

This should be recorded in run config metadata or a typed run snapshot field so Trails can show what actually happened.

## Proposed Built-In Mode Defaults

These defaults are a starting point. Implementation must verify current mode IDs and mode definitions before editing.

| Mode | Derived thinking depth | Planning | Delegation | Budget posture |
| --- | --- | --- | --- | --- |
| `single_agent` | standard | light or none | none | balanced |
| `deerflow_harness` | deep | explicit | allowed only if mode topology/tools support it | deep |
| `agent_teams` | deep | explicit | preferred | deep |
| `generator_verifier` | standard/deep | explicit verification loop | none | balanced/deep |
| lightweight/internal modes | off/standard | none | none | fast/balanced |

Auto Mode Router should only choose a mode. It should not also output a separate thinking mode unless a later evaluation proves the extra router is needed.

## Scope

### In Scope

- Define the mode-derived thinking policy design.
- Remove or demote the primary composer `思考程度` control.
- Move effective reasoning/budget/planning/delegation behavior into mode-owned runtime policy.
- Ensure Auto Mode Router's selected mode determines the default runtime policy.
- Persist and surface effective runtime policy in Trails/run metadata.
- Add focused tests proving different modes produce different effective policies.

### Out of Scope for First Implementation

- Adding a second Auto Thinking Router.
- Adding a general-purpose per-message strategy override UX.
- Redesigning Mode Studio beyond showing/editing the new mode policy.
- Replacing provider-specific reasoning-content preservation already implemented.
- Widening the top-level coordination family enum unless current code evidence proves it is necessary.

## Constraints

- Keep changes surgical. Every changed line should trace to removing the duplicated strategy control or deriving runtime policy from mode.
- Do not break existing saved modes or custom modes; new policy fields need defaults/migration.
- Keep Mode Studio as the management surface for mode behavior.
- Keep runtime as source of truth for effective strategy; desktop should not infer provider params.
- If provider thinking is unsupported, degrade explicitly and record the degradation.

## Implementation Plan

### Phase 1: Canonical Shared Schema

Files likely involved:

- `packages/shared/src/modes.ts`
- `packages/shared/src/primitives.ts`
- `packages/shared/src/runtime.ts`
- `packages/shared/src/index.ts`
- `packages/shared/test/contracts.test.ts`

Tasks:

1. Add a mode-owned runtime policy schema or reuse existing mode fields with a derived helper if a new field is too much.
2. Provide defaults for all existing built-in modes.
3. Ensure custom modes without explicit policy parse with safe defaults.
4. Export helpers/types for runtime and desktop.

Verification:

- Shared contract tests pass.
- A targeted test proves built-in modes expose distinct effective defaults.

### Phase 2: Runtime Policy Resolution

Files likely involved:

- `apps/runtime/src/mode-selection.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/harness/node-runtime-loop.ts`
- `apps/runtime/src/providers/registry.ts`
- `apps/runtime/src/providers/openai-compatible.ts`
- `apps/runtime/test/runtime-smoke.test.ts`
- `apps/runtime/test/providers/provider-registry.test.ts`

Tasks:

1. Add `resolveEffectiveRunStrategy(modeSpec, config, providerConfig)` after mode selection.
2. Merge mode policy with existing `defaultBudget` and `completionPolicy`.
3. Apply provider-facing thinking/reasoning settings only at provider/runtime boundary.
4. Record applied/degraded policy in snapshot metadata or a typed field.
5. Keep DeepSeek reasoning history preservation intact.

Verification:

- Runtime tests prove `single_agent`, `deerflow_harness`, and `agent_teams` derive different effective strategies.
- Provider tests prove unsupported reasoning does not crash and records degradation.
- Existing DeepSeek `reasoning_content` regressions still pass.

### Phase 3: Desktop Composer Simplification

Files likely involved:

- `apps/desktop/src/components/ChatInput.tsx`
- `apps/desktop/src/components/ChatView.tsx`
- `apps/desktop/src/lib/state.tsx`
- `apps/desktop/src/lib/useRunActions.ts`
- `apps/desktop/src/lib/viewModel.ts`
- `apps/desktop/src/lib/i18n.ts`
- `apps/runtime/test/desktop-composer-state.test.ts`

Tasks:

1. Remove the first-level `思考程度` picker from the composer.
2. Remove local `inputMode` state unless an advanced hidden override is explicitly kept.
3. Remove `ultra`-only decorative composer/welcome styling if it no longer has a strategy source.
4. Keep work mode and model selectors as the main composer strategy controls.
5. Ensure `startRun()` continues to send selected mode/modeSelection/provider only.

Verification:

- Desktop typecheck passes.
- Composer state tests are updated to prove no orphan `inputMode` state is required.
- Manual UI check confirms composer has no duplicate strategy control.

### Phase 4: Mode Studio + Trails Visibility

Files likely involved:

- `apps/desktop/src/components/ModesView.tsx`
- `apps/desktop/src/components/TrailsTabs.tsx`
- `apps/desktop/src/lib/modeCanvas.ts`
- `apps/desktop/src/lib/trailViewModel.ts`
- `apps/desktop/src/lib/viewModel.ts`

Tasks:

1. Show/edit mode runtime policy in Mode Studio only if the schema needs user management.
2. Show effective run strategy in Trails so users can audit derived thinking depth.
3. Label degraded provider thinking clearly when a model cannot honor the mode's desired thinking policy.

Verification:

- Desktop typecheck passes.
- Trail view model tests cover applied/degraded effective policy display.

### Phase 5: Evaluation Coverage

Files likely involved:

- `evals/router/*`
- `apps/runtime/src/evaluation-store.ts`
- `apps/runtime/test/runtime-smoke.test.ts`

Tasks:

1. Add evaluation cases that ensure Auto Mode Router can select modes that imply different runtime policies.
2. Track effective policy in evaluation outputs where relevant.
3. Avoid adding an Auto Thinking Router unless evaluation shows mode selection alone is insufficient.

Verification:

- Router eval smoke or targeted unit test proves mode choice implies policy choice.

## Product UX Spec

### Composer

Keep:

- Model selector.
- Work mode selector, including Auto.
- Prompt input.
- Attachments and send/stop actions.

Remove/demote:

- Primary `思考程度` selector.

Optional later:

- Advanced run details popover showing read-only effective strategy before submit.
- Developer-only override for debugging provider reasoning behavior.

### Mode Studio

Mode Studio is the correct place to manage persistent strategy differences:

- budget posture,
- planning behavior,
- delegation allowance,
- reasoning/provider thinking preference,
- completion policy.

### Trails

Trails should answer:

- Which mode was used?
- Was mode selected manually or by Auto?
- What effective thinking depth/policy was derived?
- Was provider thinking applied or degraded?
- Which budget/completion policy governed the run?

## Open Questions

- [x] Should `runtimePolicy` be a new `ModeSpec` field, or should the first implementation derive from existing `defaultBudget`, `completionPolicy`, `runtimeAtoms`, and `capabilityFlags` only?
  - Answer: Use a new `ModeSpec.runtimePolicy` field with safe defaults. Runtime still merges it with existing `defaultBudget` and topology/tool evidence when deriving the effective strategy.
- [x] Should provider thinking settings live in `RunConfig.metadata`, a typed `RunConfig.providerPolicy`, or a snapshot-only effective field?
  - Answer: Use typed `RunConfig.effectiveStrategy`; also mirror it in metadata/trail events where useful for auditability.
- [x] Should a developer-only per-run override exist from day one, or wait until a concrete debugging need appears?
  - Answer: Wait. No composer-level override was added.
- [x] What is the exact minimum visible Mode Studio UI for runtime policy without making the mode editor too dense?
  - Answer: Add one Safety-tab policy panel with compact segmented/select controls for thinking, budget, planning, delegation, provider thinking, and reasoning effort.

## Decisions

- Decision: Do not add Auto Thinking Router in the first implementation.
  - Why: Auto Mode Router already chooses the strategy-bearing mode; adding a second router duplicates product semantics.
  - Tradeoff: Some tasks may benefit from high reasoning inside a low-complexity mode, but this can be revisited with eval evidence.

- Decision: Desktop should not map mode to provider params.
  - Why: Provider behavior differs by model/provider; runtime/provider adapters are the correct boundary.
  - Tradeoff: Desktop cannot preview every low-level param without asking runtime for effective policy.

- Decision: Use Mode Studio as the durable management surface.
  - Why: User-visible built-in/custom mode behavior already belongs there.
  - Tradeoff: Initial implementation may need schema/UI migration work.

## Active Files

Implemented:

- `packages/shared/src/primitives.ts`
- `packages/shared/src/modes.ts`
- `packages/shared/src/runtime.ts`
- `packages/shared/test/contracts.test.ts`
- `apps/runtime/src/mode-selection.ts`
- `apps/runtime/src/modes.ts`
- `apps/runtime/src/mode-studio-draft.ts`
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/providers/types.ts`
- `apps/runtime/src/providers/registry.ts`
- `apps/runtime/src/providers/openai-compatible.ts`
- `apps/runtime/src/providers/openai.ts`
- `apps/runtime/src/evaluation-store.ts`
- `apps/runtime/test/runtime-smoke.test.ts`
- `apps/runtime/test/runtime-integration.test.ts`
- `apps/runtime/test/providers/provider-registry.test.ts`
- `apps/runtime/test/desktop-composer-state.test.ts`
- `apps/desktop/src/components/ChatInput.tsx`
- `apps/desktop/src/components/ChatView.tsx`
- `apps/desktop/src/components/ModesView.tsx`
- `apps/desktop/src/components/TrailsTabs.tsx`
- `apps/desktop/src/lib/state.tsx`
- `apps/desktop/src/lib/modeCanvas.ts`
- `apps/desktop/src/lib/trailViewModel.ts`
- `apps/desktop/src/lib/trailViewModel.test.ts`
- `tasks/TASK-20260428-1929-mode-derived-thinking-policy.md`

## TODO

- [x] Phase 1: Add or derive mode-owned runtime policy in shared mode definitions.
- [x] Phase 2: Resolve effective run strategy in runtime after mode selection.
- [x] Phase 3: Remove/demote composer `思考程度` primary control and orphan desktop `inputMode` state.
- [x] Phase 4: Surface effective strategy in Trails and, if needed, Mode Studio.
- [x] Phase 5: Add tests/evals proving mode choice implies runtime policy choice.

## Checkpoints

### Checkpoint 1: Product Model

- Requirement: Main composer has one strategy entry point: work mode.
- Verification method: Inspect composer UI/components and desktop state.
- Status: [x] Pass / [ ] Fail
- Evidence: `ChatInput` no longer accepts/renders `inputMode`; `initialWorkbenchState` has no `inputMode`; source grep for `inputMode|SET_INPUT_MODE|思考程度|golden-text|InputMode` in composer/state files has no matches.

### Checkpoint 2: Runtime Truth

- Requirement: Selected/effective `ModeSpec` determines reasoning/budget/planning/delegation policy.
- Verification method: Runtime unit/smoke tests for at least three modes.
- Status: [x] Pass / [ ] Fail
- Evidence: Runtime smoke test covers `single_agent`, `deerflow_harness`, and `agent_teams`; all derive distinct `effectiveStrategy` values and persist them in run config/metadata.

### Checkpoint 3: Provider Boundary

- Requirement: Provider thinking/reasoning params are applied or degraded at provider/runtime boundary, not desktop.
- Verification method: Provider adapter tests and run metadata inspection.
- Status: [x] Pass / [ ] Fail
- Evidence: Provider registry injects `reasoningEffort` from typed `effectiveStrategy`; OpenAI/OpenAI-compatible adapters map it to provider-native payload fields; provider tests pass including DeepSeek `reasoning_content` regression.

### Checkpoint 4: Auditability

- Requirement: Trails or run metadata shows the effective derived policy and any degradation.
- Verification method: Trail view model test or manual UI evidence.
- Status: [x] Pass / [ ] Fail
- Evidence: Trails overview now renders `Runtime Strategy`; `trailViewModel.test.ts` covers degraded effective strategy summary and warning finding.

### Checkpoint 5: Regression Safety

- Requirement: Existing mode, runtime, desktop, and DeepSeek reasoning-content tests remain green.
- Verification method: Targeted package test commands.
- Status: [x] Pass / [ ] Fail
- Evidence: Shared contracts, runtime tests, desktop tests/typecheck, provider reasoning-content regression, and `git diff --check` all passed.

## Verification Plan

Minimum commands after implementation:

```bash
pnpm --filter @ora/shared test -- contracts.test.ts
pnpm --filter @ora/runtime test -- runtime-smoke.test.ts
pnpm --filter @ora/runtime exec vitest run test/providers/provider-registry.test.ts -t "reasoning_content"
pnpm --filter @ora/desktop test -- desktop-composer-state.test.ts
pnpm --filter @ora/desktop typecheck
```

Add narrower commands as new tests are introduced.

## Comparison

### Reference

- DeerFlow upstream `backend/packages/harness/deerflow`
- Ora current mode architecture and Mode Studio management surface

### Compared Points

- DeerFlow composer modes are wired to `thinking_enabled`, `is_plan_mode`, `subagent_enabled`, and `reasoning_effort`.
- Ora currently has a visible `inputMode` picker but no runtime wiring.
- Ora already has richer user-facing work modes and Mode Studio, so strategy should live in modes rather than in a second composer control.

### Consistency Conclusion

The useful DeerFlow lesson is not "copy the thinking-depth picker." The useful lesson is "the selected strategy must have runtime effects." Ora should make its existing work mode strategy real and auditable.

## Retrospective

- Good call: Making `runtimePolicy` explicit on `ModeSpec` kept Mode Studio/custom-mode migration straightforward while preserving existing saved modes through schema defaults.
- Pitfall avoided: The old composer `inputMode` was purely local desktop state; wiring it would have made a duplicated product model real. Removing it and deriving strategy in runtime kept the boundary clean.
- Follow-up candidate: A future advanced/dev run preview could ask runtime for a read-only effective strategy before submit, but it should not reintroduce a primary composer strategy knob.

## Progress Log

- 2026-04-28 19:29 CST - Task created from product decision: work mode should be the only primary strategy entry point; thinking depth should be derived from mode policy. Captured current code evidence, target model, phased plan, checkpoints, and verification commands.
  Next: choose whether `runtimePolicy` is a new `ModeSpec` field or derived helper; then implement Phase 1 shared schema/tests; then implement Phase 2 runtime resolution.
- 2026-04-28 19:40 CST - Implemented shared `ModeRuntimePolicy`/`EffectiveRunStrategy` schemas, built-in runtime policy presets, and compatibility defaults for existing/custom modes.
- 2026-04-28 19:44 CST - Implemented runtime effective strategy resolution after mode selection, provider capability degradation, provider boundary mapping, and run/trail metadata persistence.
- 2026-04-28 19:47 CST - Removed the composer `思考程度` control and desktop `inputMode` state; kept work mode + model as the primary strategy controls.
- 2026-04-28 19:49 CST - Added Mode Studio runtime policy editing and Trails runtime strategy visibility, including degraded provider thinking warnings.
- 2026-04-28 19:52 CST - Added evaluation observation coverage so Auto Mode Router evaluation outputs include `runtime.effectiveStrategy.*`; targeted auto-router objective test passes.
- 2026-04-28 19:53 CST - Final verification passed; all planned phases and checkpoints are complete.

## Compressed State (<= 20 lines)

- Objective complete: Work mode is the only primary composer strategy selector; thinking depth is mode-derived.
- Shared: Added `ModeRuntimePolicy`, built-in presets/defaults, and typed `EffectiveRunStrategy`.
- Runtime: `resolveModeSelection` derives `effectiveStrategy` after manual/auto mode selection and persists it on run config/metadata.
- Provider boundary: Provider reasoning effort is injected only in runtime/provider adapters; unsupported policy degrades explicitly.
- Desktop composer: Removed primary `思考程度`, `inputMode` state, and `ultra` welcome styling.
- Mode Studio: Runtime policy is editable from the mode Safety tab.
- Trails: Effective strategy and provider degradation are visible/auditable.
- Evaluation: Auto-router evaluation observations expose `runtime.effectiveStrategy.*`.
- Decision preserved: No Auto Thinking Router and no per-run composer override in v1.
- Verification status: Complete; commands listed below passed.

## Verification

### Evidence Requirements

- [x] Shared schema/contract tests.
- [x] Runtime policy resolution tests.
- [x] Provider reasoning/degradation tests.
- [x] Desktop composer/typecheck tests.
- [x] Trails/Mode Studio visibility tests if touched.

### Commands run + outputs

- `pnpm --filter @ora/shared test -- contracts.test.ts`
  - Result: passed; 1 file, 83 tests.
- `pnpm --filter @ora/shared typecheck`
  - Result: passed.
- `pnpm --filter @ora/runtime test -- runtime-integration.test.ts runtime-smoke.test.ts desktop-composer-state.test.ts`
  - Result: passed; runtime package suite ran 14 files, 219 tests.
- `pnpm --filter @ora/runtime exec vitest run test/runtime-integration.test.ts -t "scores auto mode routing"`
  - Result: passed; targeted auto-router evaluation objective now asserts `runtime.effectiveStrategy.*`.
- `pnpm --filter @ora/runtime exec vitest run test/providers/provider-registry.test.ts -t "reasoning_content"`
  - Result: passed; 2 provider regression tests.
- `pnpm --filter @ora/runtime typecheck`
  - Result: passed.
- `pnpm --filter @ora/desktop test -- trailViewModel.test.ts`
  - Result: passed; desktop package suite ran 9 files, 41 tests.
- `pnpm --filter @ora/desktop typecheck`
  - Result: passed.
- `rg -n "inputMode|SET_INPUT_MODE|思考程度|golden-text|InputMode" apps/desktop/src/components/ChatInput.tsx apps/desktop/src/components/ChatView.tsx apps/desktop/src/lib/state.tsx`
  - Result: no matches in composer/state source files.
- `git diff --check`
  - Result: passed.
