# TASK-20260428-1926-agent-driven-evaluation-studio

**Created:** 2026-04-28 19:26 CST
**Status:** Done
**Source of Truth:** This file is the only authoritative plan for the Agent-driven Evaluation Studio work.

---

## Goal

Upgrade Ora Evaluation from a narrow "Agent modes comparison" page into an Agent-driven Evaluation Studio.

The target product should let a user describe a pointed evaluation goal in natural language, such as:

> 评估 Auto Mode Router 在多轮上下文之后是否还能选择匹配本轮意图的 mode。

Ora should then help convert that intent into durable, reviewable, runnable evaluation assets:

- an evaluation blueprint,
- a dataset or dataset plan,
- scorer/evaluator definitions,
- an executable evaluation spec,
- experiment runs,
- review and failure-analysis outputs,
- reusable baseline/gate decisions.

## Problem Statement

Current desktop Evaluation can run useful evaluations, but its UI model is too narrow:

- It assumes the primary object under test is a matrix of selected Agent modes.
- Step 2 requires choosing `Agent modes`, which blocks or distorts targeted evals like Auto Mode Router quality.
- Runtime already supports richer concepts such as `objective.target = "runtime.mode_selection"` and router-only execution, but the desktop page does not expose these as first-class workflows.
- The page is mostly a form for configuring a run, not an evaluation-design workspace.

The Auto Mode Router eval exposed the gap clearly:

- The desired target is not "compare several modes".
- The desired subject is "the Auto Router decision mechanism".
- The correct run config is `modeSelection: "auto"` with `metadata.evaluationRouterOnly = true`.
- The right result view needs route correctness, fallback rate, confidence calibration, and confusion/failure analysis.
- The current page cannot reproduce that flow without hand-written CLI spec files.

## Product Thesis

Evaluation Studio should be goal-driven and agent-assisted.

The primary user action should be:

1. describe what they want to evaluate,
2. review the generated evaluation blueprint,
3. refine cases/metrics/configs,
4. run and compare experiments,
5. analyze failures,
6. promote useful cases and gates.

The platform should not force every evaluation into "select Agent modes". Agent modes are only one possible subject under test.

## Product Principles

- **Goal first, configuration second.** Users start from evaluation intent, not low-level configs.
- **Blueprint as the durable artifact.** Natural language should compile into a structured, inspectable evaluation blueprint before any run.
- **Thin UI over runtime truth.** Desktop should visualize and edit runtime-owned eval assets, not maintain a parallel eval model.
- **Recipes, not hard-coded flows.** Auto Router, Mode Comparison, Tool Trajectory, RAG Quality, Safety, and Custom Spec should be recipes on the same backbone.
- **Agent assists, user approves.** The Eval Agent may propose datasets, assertions, and scorers, but generated assets are reviewable before execution.
- **Trace-aware scoring.** Platform evals must support final-output scoring and trace/trajectory scoring.
- **Closed learning loop.** Failed runs, user feedback, and Trails should feed back into datasets and baselines.

## Scope

### In Scope

- Define the Evaluation Studio product model.
- Add an `EvaluationBlueprint` concept as the bridge between natural language goals and executable `EvaluationSpec`.
- Add an Eval Agent workflow for blueprint generation, dataset curation, metric design, experiment execution, and failure analysis.
- Redesign desktop Evaluation flow around evaluation targets/recipes.
- Support Auto Mode Router eval as the first non-mode-comparison recipe.
- Preserve existing dataset import, mode comparison, baseline, export, and feedback inbox capabilities.
- Keep CLI/CI compatibility by compiling blueprints into the existing `EvaluationSpec` execution path.

### Out of Scope for v1

- Full general-purpose visual workflow builder.
- Arbitrary untrusted scorer code execution from the desktop UI.
- Hosted multi-user annotation operations beyond current local/runtime-backed storage.
- Replacing Trails; Evaluation should link into Trails for trace detail instead of duplicating full trace UI.
- Building a new external observability backend.

## Active Files

- packages/shared/src/evaluation.ts
- packages/shared/src/rpc.ts
- packages/shared/test/contracts.test.ts
- apps/runtime/src/evaluation-store.ts
- apps/runtime/src/evaluation-blueprint-draft.ts
- apps/runtime/src/run-store.ts
- apps/runtime/src/json-rpc.ts
- apps/runtime/src/cli.ts
- apps/runtime/src/mode-selection.ts
- apps/runtime/test/runtime-integration.test.ts
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/lib/runtimeClient.test.ts
- apps/desktop/src/components/EvaluationView.tsx
- tasks/TASK-20260428-1926-agent-driven-evaluation-studio.md

## Current State

### Runtime

Runtime already has useful foundations:

- `EvaluationSpec` supports `objective`.
- `EvaluationTarget` includes `runtime.mode_selection`.
- Evaluation runs reuse `runs.start`.
- Router-only execution can be requested with `metadata.evaluationRouterOnly = true`.
- Structured assertions and objective metrics can score route selection.
- CLI can import datasets and run specs.

### Desktop

Desktop currently limits the workflow:

- `EvaluationView` uses `selectedPatterns` as the main target selector.
- `handleRunEvaluation` maps selected patterns into configs with only `pattern`, `providerId`, and `modelRef`.
- `canRunEvaluation` requires at least one selected pattern.
- The Step 2 copy and layout are mode-matrix oriented.
- Advanced settings do not expose objective target, recipe type, router-only execution, custom metrics, or spec import/export.

### Consequence

The runtime can evaluate Auto Mode Router from CLI, but the page cannot reproduce the same evaluation as a first-class product flow.

## Target User Workflows

### Workflow 1: Agent-Driven Evaluation Design

1. User opens Evaluation Studio.
2. User enters a natural-language goal:
   - "评估 Auto Mode Router 在多轮上下文之后是否仍能选择正确 mode。"
   - "评估工具调用任务是否会提前结束。"
   - "评估这个 mode 对需要审批的文件修改是否安全。"
3. Eval Agent drafts an Evaluation Blueprint.
4. User reviews the blueprint cards:
   - objective,
   - subject under test,
   - dataset plan,
   - evaluator plan,
   - run plan,
   - review plan.
5. User accepts or edits the blueprint.
6. Studio compiles blueprint into an executable `EvaluationSpec`.
7. User runs the experiment.
8. Failure Analyst summarizes failure slices and suggests next cases or fixes.

### Workflow 2: Recipe-First Evaluation

1. User selects a recipe:
   - Agent Mode Comparison,
   - Auto Router Quality,
   - Tool Trajectory,
   - Multi-turn Memory,
   - RAG Answer Quality,
   - Safety/Policy,
   - Custom Spec.
2. Studio pre-fills the relevant blueprint fields.
3. User imports or creates a dataset.
4. User runs and reviews.

### Workflow 3: Trace-to-Eval Loop

1. User finds a failed or suspicious run in Trails.
2. User chooses "Add to Evaluation".
3. Eval Agent extracts input, context, trace observations, expected behavior, and candidate assertions.
4. User approves the case.
5. Case is added to a dataset and can be included in future runs.

### Workflow 4: Regression Gate

1. User promotes an evaluation run as baseline.
2. User marks a blueprint or dataset as a release gate.
3. Future CLI/CI runs compile and execute the same blueprint/spec.
4. Regressions produce failure tags and case-level evidence.

## Core Concepts

### Evaluation Blueprint

`EvaluationBlueprint` is the structured expression of evaluation intent. It sits above `EvaluationSpec`.

Blueprints are product-facing, editable, and durable. Specs are executable.

Proposed conceptual shape:

```ts
type EvaluationBlueprint = {
  id: string;
  title: string;
  goal: string;
  recipe: EvaluationRecipeId;
  target: EvaluationTarget;
  subject: EvaluationSubject;
  datasetPlan: EvaluationDatasetPlan;
  evaluatorPlan: EvaluationEvaluatorPlan;
  runPlan: EvaluationRunPlan;
  reviewPlan: EvaluationReviewPlan;
  status: "draft" | "ready" | "archived";
  createdAt: number;
  updatedAt: number;
};
```

### Evaluation Recipe

Recipes are templates for common evaluation goals. They should produce a default blueprint, not bypass user review.

Initial recipes:

- `mode_comparison`: compare selected Agent modes on a dataset.
- `auto_router_quality`: evaluate Auto Mode Router selection quality.
- `tool_trajectory`: evaluate required, forbidden, missing, or repeated tool calls.
- `agent_coordination`: evaluate multi-agent handoff, roles, and completion.
- `rag_quality`: evaluate retrieval, citation, groundedness, and answer quality.
- `safety_policy`: evaluate refusal, approval, data exposure, and tool safety.
- `custom_spec`: import or hand-edit advanced objective/spec configuration.

### Evaluation Subject

The subject under test is what the experiment is evaluating. It is not always an Agent mode.

Proposed subject kinds:

```ts
type EvaluationSubject =
  | { kind: "mode_matrix"; modeIds: string[] }
  | { kind: "auto_router"; fallbackModeId?: string }
  | { kind: "provider_matrix"; providerIds: string[]; modeId?: string }
  | { kind: "workflow"; modeId: string; workflowVersion?: string }
  | { kind: "tool_planner"; modeId?: string; toolIds?: string[] }
  | { kind: "prompt_or_policy"; modeId: string; policyRef?: string };
```

### Dataset Plan

Dataset plan describes where cases come from and what coverage is required.

Sources:

- file import,
- feedback inbox,
- Trails/run history,
- manual authoring,
- synthetic generation,
- existing dataset reuse.

Case requirements should be explicit enough for agent generation and review:

- happy path,
- boundary cases,
- ambiguity,
- adversarial phrasing,
- multi-turn context,
- failure regressions,
- negative instructions,
- provider-specific behavior.

### Evaluator Plan

Evaluator plan selects how results are scored:

- structured assertions,
- exact/acceptable match,
- code-like metric functions from trusted built-ins,
- LLM judge rubric,
- pairwise comparison,
- human review,
- trace scorer,
- confidence calibration,
- cost/latency/error-rate scoring.

For v1, scorer execution should be limited to trusted built-ins plus LLM judge prompts. Arbitrary user code should be deferred.

### Run Plan

Run plan covers:

- provider/model,
- repetitions,
- concurrency,
- full-run vs router-only,
- baseline comparison,
- CI gate threshold,
- export/report needs.

### Review Plan

Review plan controls what the results page emphasizes:

- result table,
- slice summaries,
- failure tags,
- confusion matrix,
- trace drill-down,
- baseline delta,
- failed case promotion,
- recommended next cases,
- recommended product/runtime changes.

## Eval Agent Design

Evaluation Studio should include an internal Eval Agent orchestration. It can be implemented as one visible assistant with internally separated responsibilities.

### Eval Strategist

Input:

- user goal,
- current project/runtime context,
- available datasets/runs/modes/providers.

Output:

- draft blueprint,
- recipe recommendation,
- assumptions,
- missing information.

Responsibilities:

- choose the right target and subject,
- avoid forcing all goals into mode comparison,
- explain why a recipe fits,
- identify if more cases are needed.

### Dataset Curator

Responsibilities:

- inspect selected dataset coverage,
- suggest missing slices,
- generate draft cases when requested,
- extract cases from feedback or Trails,
- assign metadata/tags/difficulty,
- deduplicate cases.

For Auto Router, it should create cases with:

- prompt,
- optional multi-turn context,
- expected selected mode,
- acceptable alternatives,
- minimum confidence,
- failure tags.

### Metric Designer

Responsibilities:

- choose metrics aligned to the target,
- generate structured assertions,
- draft LLM judge rubric if needed,
- warn about weak or vague scoring,
- prefer classification/pairwise/scoring over open-ended judgment when possible.

### Experiment Runner

Responsibilities:

- compile blueprint to `EvaluationSpec`,
- run via existing `evaluation.runs.start`,
- stream progress,
- handle provider/config errors,
- keep CLI/CI-compatible spec export.

### Failure Analyst

Responsibilities:

- summarize result slices,
- identify repeated failure tags,
- separate dataset issues from runtime/product issues,
- propose next cases,
- propose whether to promote baseline,
- link relevant Trails/run details.

## Desktop UX Design

### Top-Level Layout

Keep Evaluation under the Agent area, but rename the main surface to `Evaluation Studio`.

Suggested primary regions:

- left/main: blueprint and workflow,
- right rail: current state, selected dataset, provider, active blueprint, last run,
- bottom or review step: results table and failure analysis.

### Step Flow

Replace the current fixed mode matrix flow with a target-driven flow:

1. **Define Goal**
   - natural-language goal input,
   - recipe cards,
   - recent blueprints.

2. **Design Blueprint**
   - target card,
   - subject card,
   - dataset plan card,
   - evaluator plan card,
   - run plan card,
   - review plan card.

3. **Prepare Cases**
   - dataset picker/import,
   - feedback inbox,
   - Trails case picker,
   - generated draft cases,
   - coverage checklist.

4. **Run Experiment**
   - spec preview,
   - provider/model,
   - repetitions/concurrency,
   - baseline/gate settings,
   - run button.

5. **Review & Iterate**
   - scorecard,
   - case table,
   - failure tags,
   - trace links,
   - agent-written analysis,
   - actions: add cases, rerun, promote baseline, export spec.

### Recipe-Specific UI

#### Agent Mode Comparison

Show current `Agent modes` matrix.

Generated spec:

- one config per selected mode,
- target defaults to final/task outcome,
- full execution.

#### Auto Router Quality

Do not show Agent mode checkboxes as the main selection.

Show:

- provider/model for router,
- fallback mode,
- router-only toggle locked on by default,
- expected mode label field in cases,
- confusion matrix result view.

Generated spec:

- one config: Auto Router,
- `runConfig.pattern = "orchestrator_subagent"` as fallback execution family,
- `runConfig.modeSelection = "auto"`,
- `runConfig.metadata.evaluationRouterOnly = true`,
- objective target `runtime.mode_selection`,
- metrics: exact match, acceptable match, assertion pass rate, fallback rate, confidence calibration.

#### Tool Trajectory

Show:

- expected/forbidden tool calls,
- sequence requirements,
- repeated-call detection,
- trace scorer selection.

Generated spec:

- full run,
- objective target should use trace/tool target once runtime schema supports it,
- fallback in v1 can use structured assertions over trace observations.

#### Custom Spec

Show:

- advanced JSON editor/import,
- schema validation,
- compile/run button,
- clear warning that this bypasses recipe guardrails.

## Runtime and Shared Contract Plan

### Shared Schemas

Add blueprint schemas in `packages/shared`:

- `EvaluationRecipeIdSchema`
- `EvaluationSubjectSchema`
- `EvaluationDatasetPlanSchema`
- `EvaluationEvaluatorPlanSchema`
- `EvaluationRunPlanSchema`
- `EvaluationReviewPlanSchema`
- `EvaluationBlueprintSchema`
- `EvaluationBlueprintCompileResultSchema`

Keep `EvaluationSpec` as the executable contract.

### Runtime Store

Add runtime-owned storage and methods:

- `evaluation.blueprints.create`
- `evaluation.blueprints.update`
- `evaluation.blueprints.list`
- `evaluation.blueprints.get`
- `evaluation.blueprints.compile`
- `evaluation.blueprints.generateDraft`
- optional later: `evaluation.blueprints.archive`

`compile` should be deterministic and not call a model.

`generateDraft` may call a provider through the Eval Agent path.

### Desktop Runtime Client

Mirror all new JSON-RPC methods in:

- real runtime client,
- browser fallback `LocalJsonRpcRuntime`,
- type exports.

Browser fallback should produce deterministic draft blueprints so the UI can be tested without provider credentials.

### Blueprint Compilation

Compilation rules should be recipe-owned and explicit.

For `auto_router_quality`, compile to:

```ts
{
  objective: {
    kind: "classification",
    target: "runtime.mode_selection",
    metrics: [
      "exact_match",
      "acceptable_match",
      "assertion_pass_rate",
      "fallback_rate",
      "confidence_calibration"
    ],
    displayColumns: [
      "runtime.modeId",
      "runtime.autoModeRouter.status",
      "runtime.autoModeRouter.confidence",
      "runtime.autoModeRouter.reason"
    ]
  },
  configs: [{
    id: "auto-router-${providerId}",
    label: "Auto Router · ${providerLabel}",
    runConfig: {
      pattern: "orchestrator_subagent",
      modeSelection: "auto",
      providerId,
      modelRef,
      providerConfig,
      metadata: {
        providerId,
        evaluationRouterOnly: true
      }
    }
  }]
}
```

For `mode_comparison`, preserve current behavior but express it through a blueprint.

## Data and Persistence

Blueprints should live beside evaluation datasets/runs in the runtime evaluation store.

Minimum persisted fields:

- blueprint id,
- title,
- goal,
- recipe,
- target,
- subject,
- dataset plan,
- evaluator plan,
- run plan,
- review plan,
- linked dataset ids,
- linked run ids,
- status,
- timestamps.

Runs should optionally reference `blueprintId` in `spec.metadata`.

Datasets should optionally record `blueprintId` and `caseSource` in metadata.

## Auto Mode Router Reference Recipe

This recipe is the first acceptance test for the new product model.

### User Goal

> 评估 Auto Mode Router 在多轮上下文之后是否还能选择匹配本轮意图的 mode。

### Blueprint

- recipe: `auto_router_quality`
- target: `runtime.mode_selection`
- subject: `auto_router`
- dataset sources: file import + generated contextual cases
- case requirements:
  - single-turn easy cases,
  - mode-specific core cases,
  - ambiguous fallback cases,
  - multi-turn history shift cases,
  - explicit negative instruction cases,
  - acceptable-alternative cases.
- evaluator plan:
  - exact match,
  - acceptable match,
  - assertion pass rate,
  - fallback rate,
  - confidence calibration.
- run plan:
  - router-only execution,
  - DeepSeek or selected runnable provider,
  - one repetition by default,
  - concurrency 1 by default.
- review plan:
  - selected mode distribution,
  - fallback count,
  - confidence distribution,
  - failure tags,
  - confusion matrix,
  - case-level reason table.

### Acceptance

The UI can reproduce the same kind of run as the CLI Auto Router eval without asking the user to select Agent modes.

## Implementation Phases

### Phase 1: Product Model and Blueprint Storage

Deliverables:

- shared blueprint schemas,
- runtime blueprint store methods,
- deterministic blueprint-to-spec compiler,
- browser fallback support,
- tests for creating, updating, listing, getting, and compiling blueprints.

Pass criteria:

- A blueprint can compile into the same `EvaluationSpec` shape currently used by runtime eval runs.
- Existing Evaluation datasets/runs remain compatible.

### Phase 2: Desktop Evaluation Studio Shell

Deliverables:

- replace Step 2 mode-only flow with recipe/goal-driven flow,
- add natural-language goal input,
- add recipe cards,
- add blueprint cards,
- keep current Agent Mode Comparison as one recipe,
- add Auto Router recipe UI.

Pass criteria:

- Existing mode comparison remains usable.
- Auto Router recipe can generate a valid router-only spec without selected Agent modes.

### Phase 3: Eval Agent Drafting

Deliverables:

- `evaluation.blueprints.generateDraft`,
- provider-backed Eval Strategist prompt,
- deterministic fallback draft for browser/local smoke,
- user-editable assumptions and missing info.

Pass criteria:

- User can type a goal and receive a reviewable blueprint.
- Draft generation does not run the eval automatically.

### Phase 4: Dataset Curator and Case Builder

Deliverables:

- case coverage checklist,
- generate draft cases from blueprint requirements,
- import from Trails or feedback where available,
- attach metadata/tags/failure tags,
- preview and approve generated cases.

Pass criteria:

- Auto Router contextual dataset can be authored or extended from the UI.
- Generated cases are ordinary `EvaluationCase` records after approval.

### Phase 5: Review and Failure Analysis

Deliverables:

- recipe-specific result views,
- Auto Router confusion/fallback/confidence view,
- Failure Analyst summary,
- "add failed case to dataset" action,
- baseline promotion from blueprint context.

Pass criteria:

- A completed Auto Router run clearly shows selected modes, fallback rate, confidence, and failed intent slices.
- User can turn a failure into a future regression case.

### Phase 6: CI/Gate Integration

Deliverables:

- export blueprint and compiled spec,
- CLI command to run by blueprint id or blueprint file,
- gate thresholds in blueprint run plan,
- documented rerun path.

Pass criteria:

- The same blueprint can be run from desktop and CLI/CI.
- Release gate failures include run id, failure tags, and case ids.

## UI Acceptance Criteria

- User can start with a natural-language goal.
- User can choose a recipe without importing a full spec manually.
- User can run existing Agent Mode Comparison exactly as before.
- User can run Auto Router Quality without selecting Agent modes.
- User can inspect the generated `EvaluationSpec` before running.
- User can export the spec.
- User can see why the Eval Agent chose a target, subject, dataset plan, and metrics.
- Errors distinguish provider/auth issues from invalid blueprint/spec issues.

## Runtime Acceptance Criteria

- Blueprint schemas parse and validate.
- Blueprint compile is deterministic.
- `auto_router_quality` compiles to `runtime.mode_selection` objective.
- Router-only runs do not call downstream execution providers after route selection.
- Runs link back to blueprint id in metadata.
- Existing evaluation imports/runs/exports keep working.
- Browser fallback mirrors new methods.

## Testing Plan

### Shared Tests

- Schema parse tests for every recipe and subject kind.
- Invalid blueprint tests:
  - missing dataset,
  - empty mode matrix,
  - auto router without provider/model fallback,
  - unsupported target/recipe pair.

### Runtime Tests

- Create/list/get/update blueprint.
- Compile `mode_comparison` blueprint to current spec shape.
- Compile `auto_router_quality` blueprint to router-only spec.
- Start an evaluation run from compiled Auto Router spec and assert:
  - provider called once for router,
  - downstream execution skipped,
  - observations include `runtime.modeId` and `runtime.autoModeRouter`.
- Browser fallback supports blueprint lifecycle and compile.

### Desktop Tests

- Evaluation Studio renders recipe cards.
- Mode Comparison recipe preserves existing selected-mode behavior.
- Auto Router recipe hides/does not require Agent mode selection.
- Run button is enabled for Auto Router when dataset/provider are ready.
- Spec preview contains `modeSelection: "auto"` and `evaluationRouterOnly: true`.
- Result view shows router-specific columns.

### Functional Smoke

- Import Auto Router contextual dataset.
- Generate or select Auto Router blueprint.
- Compile and run with a real provider when credentials exist.
- Confirm report shows:
  - selected/fallback counts,
  - selected mode distribution,
  - confidence,
  - failure tags,
  - case-level reasons.

## Checkpoints

### Checkpoint 1: Evaluation Is No Longer Mode-Matrix Only

- Requirement: UI can represent at least one non-mode-comparison recipe.
- Verification: Auto Router recipe runs without selected Agent modes.
- Pass criteria: No "please select Agent mode" blocker for Auto Router.

### Checkpoint 2: Blueprint Is Durable

- Requirement: Generated evaluation intent is persisted and reusable.
- Verification: Create blueprint, reload app/runtime, compile and run same blueprint.
- Pass criteria: blueprint id and metadata survive refresh.

### Checkpoint 3: Runtime Truth

- Requirement: Desktop run uses the same runtime path as CLI eval.
- Verification: Compare compiled desktop spec with CLI Auto Router spec.
- Pass criteria: key fields match: target, metrics, modeSelection, provider, router-only metadata.

### Checkpoint 4: Agent Assistance Is Reviewable

- Requirement: Eval Agent output is not opaque.
- Verification: User sees and can edit blueprint before run.
- Pass criteria: no eval run starts directly from unreviewed generated text.

### Checkpoint 5: Failure Loop

- Requirement: Results can create better future evals.
- Verification: Failed case can be added or promoted into dataset with metadata.
- Pass criteria: rerun includes the promoted case.

## Key Risks

- **Over-generalizing v1:** Avoid building a fully arbitrary eval IDE first. Start with recipes and blueprint compile.
- **Opaque agent magic:** The Eval Agent must produce editable blueprints with assumptions, not hidden configs.
- **Schema drift:** Desktop, runtime, browser fallback, and CLI must share the same blueprint/spec contracts.
- **Weak generated cases:** Synthetic cases should be marked as draft and reviewed before becoming canonical regression data.
- **Judge overtrust:** LLM judge results should be calibrated against human review for high-stakes evals.
- **Trace duplication:** Evaluation should link to Trails for trace detail rather than duplicating all Trails UI.

## Open Issues

- TODO(FOLLOWUP): Decide whether blueprint storage should be project-scoped from v1 or initially global with project metadata.
- TODO(FOLLOWUP): Decide whether arbitrary custom scorers are postponed entirely or allowed only through checked-in trusted scorer ids.
- TODO(FOLLOWUP): Decide how much of Eval Agent drafting should be available when only `local-smoke` provider is runnable.

## Completed Phase Checklist

- [x] Phase 1: Add shared blueprint schemas and runtime blueprint methods.
- [x] Phase 1: Add deterministic blueprint compiler.
- [x] Phase 1: Mirror blueprint methods in desktop browser fallback.
- [x] Phase 2: Refactor EvaluationView into recipe/goal-driven Studio shell.
- [x] Phase 2: Preserve current Agent Mode Comparison as a recipe.
- [x] Phase 2: Add Auto Router Quality recipe.
- [x] Phase 3: Add provider-backed Eval Agent draft generation.
- [x] Phase 4: Add dataset coverage and case builder workflow.
- [x] Phase 5: Add recipe-specific review and Failure Analyst output.
- [x] Phase 6: Add CLI/CI blueprint rerun support.

## TODO

- None.

## Comparison

### References

- Current Ora Evaluation v1: shared runtime-owned backbone with desktop UI, CLI, browser fallback, datasets, runs, baselines, export.
- Auto Mode Router eval: real provider-backed `runtime.mode_selection` eval that currently works through CLI/spec files but not as a first-class desktop workflow.
- OpenAI eval guidance: define objective, collect dataset, define metrics, run/compare, continuously evaluate.
- LangSmith evaluation model: datasets/examples, experiments, runs/traces, evaluators, offline/online loop.
- Promptfoo model: config-driven tests, providers, test cases, assertions, CLI/UI/CI.
- MLflow/Braintrust model: trace-aware scoring, experiments, production traces into datasets, side-by-side comparison.

### Consistency Conclusion

Ora should keep the existing runtime-owned evaluation backbone, but raise the desktop and product model one level:

- from run form to blueprint workspace,
- from mode matrix to subject-under-test,
- from static metrics to evaluator plan,
- from result table only to failure analysis and dataset feedback loop.

## Retrospective

- Status: local_only. Browser fallback parity must be implemented in the same pass as real JSON-RPC methods; otherwise desktop typecheck can pass against types while local smoke still lacks behavior.
- Status: local_only. `todo_scan.sh` defaults to its own repo root, so Ora closeout must pass `--task /Users/quintenchen/developer/ora/tasks/...` explicitly.
- Status: local_only. Provider-backed draft generation should keep deterministic fallback because local-smoke or missing credentials can return non-blueprint text while the Studio still needs to remain testable.

## Progress Log

### 2026-04-28 19:31 CST

- Started implementation from this task file after confirming current Evaluation seams.
- Relevant prior project memory: Evaluation should stay runtime-owned, desktop should be a thin consumer, and browser fallback must mirror new JSON-RPC domains.
- Current git state before edits: `main...origin/main [ahead 6]` with unrelated untracked `tasks/TASK-20260428-1929-mode-derived-thinking-policy.md`; leave it untouched.
- Initial edit scope: `packages/shared/src/evaluation.ts`, `packages/shared/src/rpc.ts`, `apps/runtime/src/evaluation-store.ts`, `apps/runtime/src/json-rpc.ts`, `apps/desktop/src/lib/runtimeClient.ts`, `apps/desktop/src/components/EvaluationView.tsx`, and focused tests.
- Next: add blueprint schemas/store/compiler, mirror runtime client + fallback methods, then refactor EvaluationView to run mode comparison and Auto Router through compiled blueprints.

### 2026-04-28 19:52 CST

- Implemented EvaluationBlueprint schemas, runtime persistence, JSON-RPC lifecycle methods, deterministic compile, provider-backed draft generation with deterministic fallback, CLI blueprint compile/run, desktop runtime client parity, browser fallback parity, and focused contract/runtime/desktop tests.
- Refactored EvaluationView into an Evaluation Studio shell with natural-language goal, recipe cards, blueprint preview, Auto Router Quality recipe, spec preview, draft case builder, router-specific readout, and preserved Mode Comparison as a recipe.
- Functional browser smoke at `http://127.0.0.1:1421/`: opened Evaluation, selected Auto Router Quality, generated blueprint, generated draft cases, approved them into a dataset, previewed compiled spec, and ran a router-only evaluation. DOM evidence included `runtime.mode_selection`, `modeSelection:auto`, `evaluationRouterOnly`, and `Auto Router Readout`.
- Verification commands passed; only residual warning is the existing desktop Vite chunk-size warning.
- Next: none for this task; remaining open issues are explicitly marked TODO(FOLLOWUP).

## Verification

### Evidence Requirements

- [x] Task file created.
- [x] Complete product and implementation plan recorded.
- [x] Implementation verification completed for all phases.

### Environment

- Environment: `/Users/quintenchen/developer/ora`, zsh, 2026-04-28 CST.

### Commands run + outputs

- `date '+%Y%m%d-%H%M %Y-%m-%d %H:%M %Z'`
  - Output: `20260428-1926 2026-04-28 19:26 CST`
- `ls tasks | tail -30`
  - Output: confirmed current task naming pattern and latest task files.
- `pnpm --filter @ora/shared test -- contracts.test.ts`
  - Output: `Test Files 1 passed (1); Tests 81 passed (81)`.
- `pnpm --filter @ora/shared build`
  - Output: passed with no TypeScript errors.
- `pnpm --filter @ora/runtime test -- runtime-integration.test.ts`
  - Output: `Test Files 14 passed (14); Tests 219 passed (219)`.
- `pnpm --filter @ora/runtime build`
  - Output: passed with no TypeScript errors.
- `pnpm --filter @ora/desktop test -- runtimeClient.test.ts`
  - Output: `Test Files 9 passed (9); Tests 41 passed (41)`.
- `pnpm --filter @ora/desktop typecheck`
  - Output: passed with no TypeScript errors.
- `pnpm --filter @ora/desktop build`
  - Output: built successfully; Vite reported the pre-existing chunk-size warning for chunks over 500 kB.
- `bash /Users/quintenchen/developer/quantfox/.codex/skills/long-task-protocol/scripts/todo_scan.sh --task /Users/quintenchen/developer/ora/tasks/TASK-20260428-1926-agent-driven-evaluation-studio.md`
  - Output: `Blocking TODO matches: none`; `Blocking task-journal TODO entries: none`; `Result: PASS`.
- Browser smoke via in-app browser at `http://127.0.0.1:1421/`
  - Output: Auto Router recipe rendered without Agent mode selection; generated blueprint; generated/approved draft cases; spec preview included `runtime.mode_selection`, `modeSelection:auto`, and `evaluationRouterOnly`; completed run showed `Auto Router Readout`, fallback count, router attempts, and selected-mode distribution.

## Compressed State (<= 20 lines)

- Objective: Design Agent-driven Evaluation Studio as the successor to mode-matrix-only Evaluation UI.
- Source of truth: `tasks/TASK-20260428-1926-agent-driven-evaluation-studio.md`.
- Current status: Done; implementation completed 2026-04-28 19:52 CST.
- Core decision: introduce durable `EvaluationBlueprint` above executable `EvaluationSpec`.
- Product shape: natural-language goal -> Eval Agent draft blueprint -> user review -> compile spec -> run -> failure analysis.
- First acceptance recipe: Auto Router Quality, no Agent mode selection required.
- Runtime direction: shared schemas + runtime blueprint store + deterministic compiler + browser fallback parity.
- Desktop direction: recipe/goal-driven Evaluation Studio shell while preserving Mode Comparison.
- Implemented: blueprint schemas/store/compiler, JSON-RPC/browser fallback parity, provider-backed draft path with fallback, case builder, failure readout, CLI blueprint compile/run, and focused verification.
- Next actions: none; TODO(FOLLOWUP) open issues remain for project scoping, trusted scorer policy, and local-smoke drafting policy.
