# TASK-20260430-1713-ora-no-code-mode-layouts

**Created:** 2026-04-30 17:13 CST
**Status:** Ready for implementation

---

## Goal

Turn the recent Debate mode work into a reusable Ora capability: users should be able to create new structured modes in Mode Studio by declaring stages, roles, transcript layout, prompts, tools, and validation criteria, without adding a new `executeXxxMode()` runtime branch or a new `XxxTranscriptBody` frontend component for every scenario.

This task is the single source of truth for the next implementation cycle covering:

1. Debate mode retrospective: what was built, what was hardcoded, what was generic.
2. Architecture target: staged ModeSpec + generic staged runtime executor + transcript renderer registry + Mode Studio generation support.
3. Built-in layout registry: which reusable layouts Ora should provide in code, and how ModeSpec can configure them.
4. Phased implementation plan, checkpoints, verification gates, and risks.

## Non-goal

This task does not attempt to let users generate arbitrary frontend UI at runtime. The intended product boundary is:

- Ora codebase provides a finite set of reusable transcript/layout renderers.
- ModeSpec chooses and configures those renderers.
- Mode Studio can generate ModeSpec JSON that combines existing runtime families, stages, agents, tools, and layouts.
- Truly new layout primitives still require code changes.

---

## Background and source references

### Prior task sources

- `tasks/TASK-20260429-0003-debate-mode-stage-transcript.md`
  - Added typed `AgentConversationMessage.transcript` / `TurnAgentConversationMessage.transcript` style stage metadata.
  - Added `StageTranscript` content surface.
  - Added Debate mode as first staged transcript user.
  - Chose Debate as a mode preset, not a new `CoordinationPattern`.
  - Chose one reusable Debate Agent with virtual speaker labels.

- `tasks/TASK-20260429-1546-debate-mode-stance-lock.md`
  - Hardened Debate Agent prompt contracts.
  - Added per-turn `STANCE LOCK`, anti-neutralization, output structure, and moderator comparative judgment.
  - Verified prompt construction contract in runtime integration tests.

- `tasks/TASK-20260429-1605-debate-transcript-duel-ui.md`
  - Added Debate-specific left/right duel presentation in `StageTranscript.tsx`.
  - Preserved generic list rendering for non-debate transcript groups.
  - Confirmed frontend change was intentionally surgical and local, but left a future generalization opportunity.

- `tasks/TASK-20260429-1712-debate-session-switch-transcript.md`
  - Fixed loss of structured Debate transcript entries when switching sessions during a running debate.
  - Added event-to-`agentMessages` projection recovery and same-run snapshot merge safeguards.
  - Important guardrail: event logs and derived snapshot projections must not drift for structured transcript UI.

### Current planning source

- `/Users/quintenchen/.workbuddy/plans/swift-pulse-turing.md`
  - Consolidated Debate retrospective and proposed `stages[]`, `transcriptLayout`, generic staged executor, renderer registry, and Mode Studio builder extension.

---

## Current baseline

### Mode declaration layer: mostly generic already

Relevant files:

- `packages/shared/src/primitives.ts`
- `packages/shared/src/modes.ts`
- `apps/runtime/src/modes.ts`
- `apps/runtime/src/mode-selection.ts`
- `apps/desktop/src/components/ModesView.tsx`

Current facts:

- `DEBATE_MODE_ID = "debate"` exists in `packages/shared/src/primitives.ts`.
- `createDebateModeSpec()` exists in `packages/shared/src/modes.ts`.
- Debate is currently a standard `ModeSpec` with:
  - `family: "orchestrator_subagent"`
  - nodes: `frame`, `debate`, `synthesis`
  - profiles: `moderator`, `debate_agent`
  - mode metadata: label, summary, recommendedUse, failureMode, runtimePolicy, editorConstraints, profiles.
- `ModeSpecFileStore` already merges built-in `MVP_MODES` with custom `.ora/modes/*.json` modes.
- Runtime already exposes `modes.list/get/create/update/delete/validate/cloneFromPreset` and `modeStudio.*` RPC methods.
- Desktop `ModesView` already supports gallery, cloning presets, editing mode graph, saving, builder-run generation, and applying generated Mode Studio bundles.

Conclusion: the declaration/storage/UI shell for custom mode creation exists. The missing piece is not “can we save a ModeSpec?” but “can a ModeSpec declaratively express staged transcript execution and layout without new code?”

### Runtime execution layer: main hardcoded bottleneck

Relevant file:

- `apps/runtime/src/patterns/driver-registry.ts`

Current hardcoded points:

- `executeOrchestratorSubagent()` checks `if (modeSpec.id === DEBATE_MODE_ID) return executeDebateMode(input)`.
- `DEBATE_TURNS` hardcodes 8 speech turns with:
  - `stageId`
  - `stageLabel`
  - `speakerLabel`
  - `stance`
  - `instruction`
- `executeDebateMode()` hardcodes the three-part flow:
  1. Moderator framing.
  2. Eight Debate Agent speeches.
  3. Moderator synthesis.
- Per-turn prompt assembly hardcodes:
  - current virtual speaker
  - assigned stance
  - stance lock
  - anti-equivocation rules
  - prior transcript usage rule
  - output structure
- `emitAgentMessage()` hardcodes Debate transcript metadata:
  - `groupId: "debate"`
  - `groupLabel: "结构化辩论"`
  - `threadId: "debate:${projectId}"`
  - `fromAgentId: "debate_agent"`
- Output shape and `context.remember()` namespace also carry Debate-specific semantics.

Conclusion: as long as staged execution lives inside `executeDebateMode()`, every new mode with custom staged transcript behavior risks requiring a new business-code branch.

### Transcript protocol: useful generic foundation

Relevant places:

- Runtime `context.emitAgentMessage({ transcript: ... })`
- Desktop `StageTranscript.tsx`
- Desktop view-model / state snapshot projection paths

Current generic fields already exist in transcript metadata:

- `kind: "stage_transcript"`
- `groupId`
- `groupLabel`
- `stageId`
- `stageLabel`
- `sequence`
- `speakerLabel`
- `speakerId`
- `stance`
- `status`

Current reusable frontend behavior:

- `groupStageTranscriptMessages()` groups by transcript group.
- Entries are sorted by `sequence`.
- Non-debate groups render through `StageTranscriptEntry` list layout.
- Status icons and Markdown content rendering are reusable.

Conclusion: `stage_transcript` is the right canonical bridge between runtime and UI. This should be promoted from “metadata used by Debate” into a first-class output contract that ModeSpec can declare.

### Frontend layout layer: partially generic, currently Debate-specific

Relevant file:

- `apps/desktop/src/components/StageTranscript.tsx`

Generic parts:

- `StageTranscript` component as a main assistant content surface.
- `groupStageTranscriptMessages()` grouping.
- `StageTranscriptEntry` generic list renderer.
- `TranscriptStatusIcon`.
- `MarkdownContent` reuse.

Hardcoded parts:

- `isDebateTranscriptGroup()` detects Debate by:
  - `group.id === "debate"`
  - label contains `debate` or `辩论`
  - group contains both `affirmative` and `negative` stances.
- `DebateTranscriptBody`, `DebateTranscriptRow`, `DebateModeratorRow`, `DebateRoundAxis`, `DebateTranscriptCard` are Debate-specific names and semantics.
- Left/right placement is fixed to `affirmative` left and `negative` right.
- `stanceLabel`, `stanceTone`, `stancePillTone`, `debateCardTone` only know `affirmative | negative | moderator | neutral`.
- Summary card text includes hardcoded “主持总结”.

Conclusion: the left/right visual form is valuable, but it should become a generic `two_sided_duel` renderer configured by layout metadata, not a Debate detector.

---

## Core product boundary

Ora should support “no-code new mode” by combining a finite set of code-provided primitives:

1. Runtime families: existing `CoordinationPattern` families.
2. Node templates: existing `ModeNodeTemplate` library.
3. Runtime atoms: existing and future runtime capabilities.
4. Stages: declarative ordered execution units.
5. Transcript layout renderers: code-provided reusable visual surfaces.
6. Mode Studio builder: natural-language-to-ModeSpec generator with validation.

Important boundary:

- Adding a new mode that uses existing families/stages/layouts should not require code.
- Adding a truly new runtime behavior or truly new visual primitive can still require code.
- The goal is not arbitrary UI generation; the goal is a strong library of reusable structured work surfaces.

---

## Target architecture

```text
ModeSpec
  ├─ nodes / edges / profiles              existing
  ├─ runtimePolicy / completionPolicy      existing
  ├─ runtimeAtoms                          existing
  ├─ stages[]                              new: ordered or grouped stage declarations
  └─ transcriptLayout                      new: renderer selection and layout config

Runtime
  ├─ executeModeSpec()                     existing family switch
  ├─ executeOrchestratorSubagent()         existing generic node runner
  └─ executeStagedTranscriptMode()         new: reads stages[] and emits transcript entries

Frontend
  ├─ StageTranscript                       existing entry surface
  ├─ transcript renderer registry          new
  ├─ StageListRenderer                     default
  ├─ TimelineRenderer                      process view
  ├─ TwoSidedDuelRenderer                  generalized Debate UI
  └─ RoleLanesRenderer                     multi-role agent/team view

Mode Studio
  ├─ Builder agent                         existing
  ├─ stages[] generation                   new
  ├─ transcriptLayout generation           new
  ├─ guided choices for layout selection   new
  └─ validation/apply                      existing flow extended
```

---

## Proposed shared schema additions

### `ModeStageSpec`

Initial minimal version:

```ts
type ModeStageSpec = {
  id: string;
  label: string;
  nodeId: string;
  speakerId?: string;
  speakerLabel?: string;
  stance?: string;
  instruction?: string;
  promptTemplate?: string;
  outputKey?: string;
};
```

Notes:

- `nodeId` links the stage to an existing `ModeNodeSpec`.
- `speakerId` should normally resolve to a profile id or fall back to the node owner.
- `stance` should be an open string, not locked to Debate terms.
- `outputKey` allows later stages to reference prior outputs in prompt templates.
- First version should support linear stages only.

### `ModeTranscriptLayout`

Initial minimal version:

```ts
type ModeTranscriptLayout = {
  style: TranscriptLayoutStyle;
  groupId?: string;
  groupLabel?: string;
  stanceLabels?: Record<string, string>;
  stanceTones?: Record<string, string>;
  sideByStance?: Record<string, "left" | "right" | "center">;
  laneBySpeaker?: Record<string, string>;
  summaryStances?: string[];
  showStatus?: boolean;
  showTimestamp?: boolean;
  showSpeaker?: boolean;
};
```

Notes:

- `style` chooses a code-provided renderer.
- Stance and speaker labels must be configurable.
- Color/tone should use a constrained token set rather than arbitrary CSS class strings if possible.
- Layout must be optional for backward compatibility.
- Missing layout should fall back to `stage_list`.

### Debate as declarative staged mode

Debate should become:

- `stages[]` contains current `DEBATE_TURNS` plus synthesis stage if desired.
- `transcriptLayout.style = "two_sided_duel"`.
- `sideByStance.affirmative = "left"`.
- `sideByStance.negative = "right"`.
- `summaryStances = ["moderator", "neutral"]`.
- `stanceLabels` maps `affirmative/negative/moderator/neutral` to localized labels.

---

## Built-in layout registry

### MVP renderers: implement first

#### 1. `stage_list`

Default fallback for all staged transcript groups.

Use cases:

- research → analysis → synthesis
- plan → execute → verify
- simple single-agent workflows
- any custom staged mode without a more specialized layout

Core config:

```json
{
  "style": "stage_list",
  "showStatus": true,
  "showSpeaker": true,
  "showTimestamp": true
}
```

#### 2. `timeline`

Vertical process timeline / stepper.

Use cases:

- long-task protocol
- checkpointed debugging
- setup/onboarding flows
- release/deploy flows
- structured research pipeline

Core config:

```json
{
  "style": "timeline",
  "orientation": "vertical",
  "showArtifacts": true
}
```

#### 3. `two_sided_duel`

Generalized Debate left/right layout.

Use cases:

- Debate
- red team / blue team
- attack / defense
- support / opposition
- option A / option B
- courtroom-style examination
- investment committee pro/con review

Core config:

```json
{
  "style": "two_sided_duel",
  "sideByStance": {
    "affirmative": "left",
    "negative": "right"
  },
  "summaryStances": ["moderator", "judge"],
  "stanceLabels": {
    "affirmative": "正方",
    "negative": "反方",
    "moderator": "主持"
  }
}
```

#### 4. `role_lanes`

Multi-role swimlanes, not necessarily adversarial.

Use cases:

- planner / builder / reviewer
- researcher / analyst / writer
- PM / engineer / designer / QA
- multi-expert panel
- agent team mode

Core config:

```json
{
  "style": "role_lanes",
  "groupBy": "speakerId",
  "lanes": [
    { "id": "planner", "label": "规划" },
    { "id": "builder", "label": "执行" },
    { "id": "reviewer", "label": "审查" }
  ]
}
```

### P1 renderers: high value after MVP

#### 5. `kanban_pipeline`

Use cases:

- issue triage
- content production pipeline
- recruiting/sales/ops workflows
- multi-item batch processing

#### 6. `rubric_matrix`

Use cases:

- code review
- PRD review
- supplier/vendor evaluation
- model output evaluation
- candidate evaluation
- architecture tradeoff scoring

#### 7. `judge_panel`

Use cases:

- final verdict
- verifier result
- safety/quality gate
- go/no-go decision
- approval summary

#### 8. `evidence_board`

Use cases:

- research mode
- due diligence
- fact checking
- paper review
- source-based competitive analysis

#### 9. `comparison_table`

Use cases:

- option A/B/C comparison
- model/tool selection
- product competitor comparison
- technical route comparison

#### 10. `artifact_gallery`

Use cases:

- multiple generated files
- prompt variants
- design mockups
- code artifacts
- evaluation outputs

### P2 renderers: advanced / after runtime support matures

#### 11. `branch_compare`

Shows multiple explored routes and final merge.

#### 12. `state_board`

Shared-state / blackboard view for facts, hypotheses, open questions, and decisions.

#### 13. `event_stream`

Message bus / channel / topic stream view with correlation ids.

#### 14. `graph_topology`

Runtime topology graph showing agent handoffs, node status, and edge events.

#### 15. `report_builder`

Report outline and section assembly view for long-form document generation.

### Recommended TypeScript shape

```ts
export const TranscriptLayoutStyleSchema = z.enum([
  "stage_list",
  "timeline",
  "two_sided_duel",
  "role_lanes",
  "kanban_pipeline",
  "rubric_matrix",
  "judge_panel",
  "evidence_board",
  "comparison_table",
  "artifact_gallery",
  "branch_compare",
  "state_board",
  "event_stream",
  "graph_topology",
  "report_builder",
]);
```

Implementation should not build all renderers at once. Start with:

```ts
const MVP_TRANSCRIPT_RENDERERS = {
  stage_list,
  timeline,
  two_sided_duel,
  role_lanes,
};
```

---

## Implementation phases

### Phase 1: shared schema and Debate spec migration

Goal: make Debate’s stage table and layout declaration data-driven without changing runtime behavior yet.

Files likely touched:

- `packages/shared/src/modes.ts`
- `packages/shared/src/primitives.ts` only if layout/style enums are placed there
- `packages/shared/test/contracts.test.ts`

Steps:

1. Add optional `stages` and `transcriptLayout` to `ModeSpecSchema`.
2. Add `ModeStageSpecSchema` and `ModeTranscriptLayoutSchema`.
3. Keep fields optional to preserve old custom modes.
4. Update `createDebateModeSpec()` to include current Debate stages and `two_sided_duel` layout config.
5. Extend shared contract tests:
   - Debate mode parses with stages.
   - Debate stages reference valid nodes/profiles.
   - Layout config parses.
   - Existing presets still parse.

Pass criteria:

- No runtime behavior changes.
- Shared tests pass.
- Typecheck passes.

### Phase 2: generic staged transcript executor

Goal: replace `DEBATE_TURNS`-driven execution with `modeSpec.stages`-driven execution.

Files likely touched:

- `apps/runtime/src/patterns/driver-registry.ts`
- `apps/runtime/test/runtime-integration.test.ts`
- `apps/runtime/test/run-streaming.test.ts`
- possibly `apps/runtime/src/run-streaming.ts` if transcript layout hints must flow through snapshots

Steps:

1. Add `executeStagedTranscriptMode(input)`.
2. In `executeOrchestratorSubagent()`, prefer staged executor when `modeSpec.stages?.length` exists.
3. Migrate Debate execution to read from `modeSpec.stages`.
4. Preserve Debate’s existing prompt guarantees by putting stance-lock and anti-equivocation into stage-level prompt construction or stage-level prompt templates.
5. Preserve output order and existing 9-entry transcript behavior.
6. Keep `executeDebateMode()` only as temporary compatibility fallback if needed; remove after tests prove staged path covers Debate.

Pass criteria:

- Existing Debate runtime tests still pass.
- New test proves a non-Debate custom staged mode can emit transcript entries without `modeSpec.id === "debate"`.
- Prompt contract test still sees stance lock and anti-equivocation constraints for Debate.

### Phase 3: frontend renderer registry

Goal: remove Debate-specific detection and route transcript groups via layout config.

Files likely touched:

- `apps/desktop/src/components/StageTranscript.tsx`
- `apps/desktop/src/types.ts`
- `apps/desktop/src/lib/viewModel.ts`
- `apps/desktop/src/lib/viewModel.test.ts`
- `apps/desktop/src/components/AssistantTurnCard.test.tsx`

Steps:

1. Decide how frontend receives layout:
   - Option A: runtime copies minimal layout hint into transcript metadata.
   - Option B: desktop view model resolves active `modeSpec.transcriptLayout` and passes it to `StageTranscript`.
   - Preferred initial path: include minimal layout hint in transcript group metadata for robust replay/session-switch behavior.
2. Create `resolveTranscriptRenderer(group, layout)`.
3. Rename/genericize Debate UI pieces:
   - `DebateTranscriptBody` → `TwoSidedDuelTranscriptRenderer`
   - `DebateTranscriptRow` → `TwoSidedDuelRow`
   - `DebateRoundAxis` → reusable stage axis
4. Read labels, side placement, summary stances, and tones from layout config.
5. Keep `stage_list` as default fallback.
6. Add at least one test with non-Debate `two_sided_duel` layout.

Pass criteria:

- Debate UI remains visually and structurally equivalent.
- Non-Debate two-sided staged group reuses same renderer.
- Non-configured transcript groups still use list layout.
- No `group.id === "debate"` required for two-sided layout routing.

### Phase 4: Mode Studio builder support

Goal: let users generate staged modes from natural language.

Files likely touched:

- `apps/runtime/src/mode-studio-draft.ts`
- `apps/runtime/src/mode-studio-store.ts`
- `apps/desktop/src/components/ModesView.tsx`
- Mode Studio tests

Steps:

1. Update `modeStudioBuilderSystemPrompt()` to include `stages[]` and `transcriptLayout` requirements when relevant.
2. Update Mode Studio context prompt to list available layout styles and when to use them.
3. Update `assessModeStudioDesignCompleteness()` to detect missing staged flow / layout intent when user asks for debate, red-team/blue-team, panels, reviews, comparisons, etc.
4. Update `enrichModeStudioGeneratedDraft()` to preserve/repair stage node/profile references.
5. Add validation feedback for invalid stage references and invalid layout config.
6. Add UI affordance in `ModesView` to preview stages/layout summary. A full stage editor can be deferred.

Pass criteria:

- User can ask Mode Studio for a red-team/blue-team review mode.
- Builder returns a valid ModeSpec with stages and `two_sided_duel` layout.
- Apply creates the mode.
- Running the mode produces staged transcript UI without code changes.

### Phase 5: optional P1 renderer expansion

Goal: add more high-value work-surface renderers after staged MVP is stable.

Suggested order:

1. `rubric_matrix`
2. `judge_panel`
3. `evidence_board`
4. `comparison_table`
5. `artifact_gallery`
6. `kanban_pipeline`

Do not start this phase until MVP staged runtime and renderer registry are stable.

---

## Key decisions

### Decision 1: Do not add `CoordinationPattern = "debate"`

Why:

- Debate is not a new base coordination family.
- It is better modeled as `orchestrator_subagent + stages[] + two_sided_duel`.
- Adding a new coordination pattern increases schema/runtime/editor/test blast radius.

### Decision 2: Keep one reusable Debate Agent unless evidence proves otherwise

Why:

- Current design intentionally treats debate seats as virtual speaking roles.
- Separate real agents for every seat would increase management complexity.
- The main issue was prompt contract softness, already addressed by stance-lock tests.

### Decision 3: Test prompt contracts, not generated prose quality

Why:

- Mock/local provider output is not a reliable semantic oracle.
- Contract tests can assert that prompt construction includes required constraints.

### Decision 4: Layouts are code-provided, not arbitrary model-generated UI

Why:

- Arbitrary UI generation would be fragile and unsafe.
- A finite renderer registry gives product quality, testability, accessibility, and compatibility.
- Users can still create many modes by configuring existing renderer primitives.

### Decision 5: Start with linear stages only

Why:

- Debate and many panel/review workflows are linear.
- Conditions, loops, parallel stages, and scoring/regeneration can be future extensions.
- Linear staged execution is enough to remove the current Debate hardcoding bottleneck.

### Decision 6: Runtime snapshots and frontend projections must preserve derived transcript messages

Why:

- Previous Debate session-switch bug proved event logs and derived snapshot fields can drift.
- New staged modes will rely even more on reliable transcript persistence and replay.

---

## Open issues

1. **Layout source of truth for frontend**
   - Need decide whether `transcriptLayout` is copied into each transcript event, attached once per transcript group, or resolved from the run snapshot’s `modeSpec`.
   - Current preference: include minimal group-level layout hint in transcript metadata to make replay/session-switch robust.

2. **Tone/color config safety**
   - Avoid arbitrary Tailwind class strings in saved ModeSpec if possible.
   - Prefer a constrained semantic token set, e.g. `green | blue | violet | amber | red | gray`.

3. **Stage prompt templating scope**
   - Need define which bag variables are safe and stable: `prompt`, previous `outputKey`s, `priorTranscript`, `stage`, `speaker`, `stance`.

4. **Backward compatibility and migration**
   - Existing custom modes have no `stages` or `transcriptLayout`; both fields must be optional.
   - Existing Debate runs in history may contain old transcript metadata without layout hints; frontend needs fallback.

5. **Mode editor UI complexity**
   - Full visual stage editor may be expensive.
   - First pass can rely on builder generation + validation + compact stage summary.

---

## TODO

### Phase 1 TODO

- [x] Add `ModeStageSpecSchema`.
- [x] Add `ModeTranscriptLayoutSchema`.
- [x] Extend `ModeSpecSchema` with optional `stages` and `transcriptLayout`.
- [x] Update `createDebateModeSpec()` to declare current Debate turns as `stages[]`.
- [x] Update shared contract tests.

### Phase 2 TODO

- [x] Add `executeStagedTranscriptMode()`.
- [x] Route staged modes through the generic staged executor.
- [x] Migrate Debate execution off `DEBATE_TURNS` hardcoded constant.
- [x] Preserve Debate stance-lock prompt contract through stage-level prompt assembly.
- [x] Add runtime integration test for custom non-Debate staged mode.
- [x] Add/adjust streaming tests for staged transcript projection.

### Phase 3 TODO

- [x] Add transcript renderer registry.
- [x] Convert Debate-specific duel components into `TwoSidedDuelTranscriptRenderer`.
- [x] Add `StageListRenderer` fallback.
- [ ] Add `TimelineRenderer` if not too large for MVP; otherwise leave as P1.
- [ ] Add `RoleLanesRenderer` if not too large for MVP; otherwise leave as P1.
- [x] Remove dependency on `group.id === "debate"` for duel layout routing.
- [x] Add frontend tests for custom non-Debate duel layout.

### Phase 4 TODO

- [x] Update Mode Studio builder prompts for stages/layouts.
- [x] Update Mode Studio draft enrichment/repair for stage references.
- [x] Add Mode Studio validation messages for invalid staged layout config.
- [x] Add compact stage/layout preview in `ModesView`.
- [x] Add builder test for red-team/blue-team mode generation.

### Phase 5 TODO

- [x] Prioritize and implement P1 renderers after MVP stabilizes.
- [x] Implement `rubric_matrix` renderer: evaluation rubric table with criteria rows and stance columns.
- [x] Implement `judge_panel` renderer: multi-judge review cards with verdict section.
- [x] Implement `evidence_board` renderer: evidence cards grouped by stance with color dots.
- [x] Implement `comparison_table` renderer: dimension cards with side-by-side option columns.
- [x] Implement `artifact_gallery` renderer: responsive card grid for generated outputs.
- [x] Implement `kanban_pipeline` renderer: horizontal scrollable columns grouped by stage.
- [x] Update Mode Studio builder prompts to list all 8 available layouts.
- [x] Update `modeStudioStructuredLayoutIntent` to detect all P1 layout intents.
- [x] Update `normalizeModeStudioStagesAndLayout` to auto-select detected layout style.
- [x] Add frontend tests for all 6 new renderers.

---

## Active Files

- `packages/shared/src/modes.ts`
- `packages/shared/src/runtime.ts`
- `packages/shared/test/contracts.test.ts`
- `apps/runtime/src/mode-studio-draft.ts`
- `apps/runtime/src/mode-studio-store.ts`
- `apps/runtime/src/patterns/driver-registry.ts`
- `apps/runtime/test/mode-studio-builder.test.ts`
- `apps/runtime/test/runtime-integration.test.ts`
- `apps/runtime/test/run-streaming.test.ts`
- `apps/desktop/src/components/ModesView.tsx`
- `apps/desktop/src/components/StageTranscript.tsx`
- `apps/desktop/src/components/AssistantTurnCard.test.tsx`
- `apps/desktop/src/lib/state.tsx`
- `apps/desktop/src/types.ts`
- `tasks/TASK-20260430-1713-ora-no-code-mode-layouts.md`

---

## Progress Log

### 2026-04-30 21:28 CST

- Started implementation from this plan.
- Assumption: implement Phase 1 and Phase 2 first; only move into Phase 3 once staged transcript metadata can carry layout hints without broad frontend churn.
- Success criteria for this pass: shared schema compatibility, Debate still emits 9 ordered transcript entries, and one non-Debate staged mode can emit transcript entries through the generic executor.
- Next: inspect shared schema/tests, inspect Debate runtime executor/tests, then make the smallest schema/spec changes.

### 2026-04-30 21:40 CST

- Implemented Phase 1 schema/spec migration: `ModeSpec.stages`, `ModeSpec.transcriptLayout`, Debate declarative stages/layout, shared validation, and transcript metadata layout hints.
- Implemented Phase 2 generic staged executor: staged modes now route by `modeSpec.stages?.length`; Debate no longer uses `DEBATE_TURNS`, `executeDebateMode()`, or `modeSpec.id === "debate"` runtime branching.
- Implemented Phase 3 core renderer routing: `StageTranscript` resolves `two_sided_duel` from layout metadata and keeps `stage_list` fallback; old Debate transcript groups still have a compatibility fallback.
- Deferred full `timeline` and `role_lanes` renderers to avoid expanding scope beyond the verified MVP path.
- Noted unrelated pre-existing dirty files in provider-model work and another task journal; they were not touched by this task.
- Next: Phase 4 Mode Studio builder prompt/enrichment/preview support; then optional renderer expansion.

### 2026-04-30 21:48 CST

- Started Phase 4 implementation.
- Assumption: keep Phase 4 focused on enabling Mode Studio to generate valid linear staged modes with existing layout primitives, plus a compact preview in the existing mode editor UI.
- Non-goal for this pass: full visual stage editor or implementing deferred renderers.
- Next: inspect `mode-studio-draft`, `mode-studio-store`, builder tests, and `ModesView`; then patch prompt/enrichment/validation/preview in the smallest path.

### 2026-04-30 22:00 CST

- Implemented Phase 4 Mode Studio support.
- Builder prompt now documents `stages[]`, `transcriptLayout`, and apply-ready layout choices (`stage_list`, `two_sided_duel`).
- Local Mode Studio generation now recognizes red-team/blue-team, debate, pro/con, and attack/defense intents as `orchestrator_subagent` staged modes with `two_sided_duel` layout.
- Provider-generated drafts now preserve and repair staged references by normalizing stage `nodeId` and `speakerId` values against the generated ModeSpec.
- Apply paths now preserve `stages` and `transcriptLayout` in both runtime and desktop create payloads.
- `ModesView` overview now shows a compact transcript layout/stage preview.
- Verification proved a generated red/blue mode can be applied and run, producing staged transcript messages with layout metadata.
- Next: optional Phase 5 renderer expansion when needed.

### 2026-04-30 22:50 CST

- Implemented Phase 5 P1 renderer expansion: all 6 new renderers.
- Frontend renderers added to `StageTranscript.tsx`: `rubric_matrix`, `judge_panel`, `evidence_board`, `comparison_table`, `artifact_gallery`, `kanban_pipeline`.
- Shared helpers added: `pivotTranscriptEntries` (for table-based renderers), `groupByTranscriptField` (for grouped renderers), `accentDot` (for evidence board dots).
- `resolveTranscriptRenderer` updated to switch-based dispatch for all 8 layout styles.
- `TranscriptRendererId` expanded to include all P1 styles.
- Frontend `types.ts` layout type expanded with `laneBySpeaker`, `lanes`, `orientation`, `showArtifacts`, `groupBy` fields.
- Mode Studio builder prompt updated with all 8 available layouts and usage guidance.
- `modeStudioStructuredLayoutIntent` expanded to detect all P1 layout intents (Chinese + English keywords).
- `inferModeStudioFamily` updated to route any staged layout intent to `orchestrator_subagent`.
- `normalizeModeStudioStagesAndLayout` updated to auto-select detected layout style with layout-specific config (e.g., `summaryStances` for judge_panel, `lanes` for kanban_pipeline).
- 6 new frontend tests added (one per renderer), all pass.
- Next: optional Phase 5 P2 renderer expansion.

---

## Checkpoints

### Checkpoint 1: schema compatibility

- Requirement: Existing modes still parse; Debate mode also declares stages/layout.
- Verification method: shared contract tests and typecheck.
- Pass criteria: all built-in modes parse; old custom mode fixture without `stages` passes.
- Status: [x] Pass / [ ] Fail

### Checkpoint 2: staged runtime behavior

- Requirement: Generic staged executor can run a non-Debate staged mode and emit ordered transcript messages.
- Verification method: runtime integration test.
- Pass criteria: custom staged mode emits ordered transcript entries without `modeSpec.id === "debate"`.
- Status: [x] Pass / [ ] Fail

### Checkpoint 3: Debate compatibility

- Requirement: Debate still emits the same 9 ordered transcript entries and prompt contract remains strong.
- Verification method: existing and updated runtime integration tests.
- Pass criteria: first 8 entries from `debate_agent`, final entry from `moderator`, stance-lock assertions pass.
- Status: [x] Pass / [ ] Fail

### Checkpoint 4: renderer generalization

- Requirement: `two_sided_duel` renderer works for Debate and another non-Debate mode.
- Verification method: desktop component/view-model tests.
- Pass criteria: renderer is selected by layout config, not by `group.id === "debate"`.
- Status: [x] Pass / [ ] Fail

### Checkpoint 5: Mode Studio no-code creation

- Requirement: user can generate, apply, and run a new staged mode from natural language.
- Verification method: Mode Studio builder test and manual/automated runtime smoke.
- Pass criteria: generated mode has valid `stages[]` and `transcriptLayout`; run displays structured transcript UI.
- Status: [x] Pass / [ ] Fail

### Checkpoint 6: P1 renderer coverage

- Requirement: all 6 P1 renderers render correctly for non-trivial transcript groups.
- Verification method: desktop component tests.
- Pass criteria: each renderer shows groupLabel, entry content, and layout-specific visual elements.
- Status: [x] Pass / [ ] Fail

---

## Verification

### 2026-04-30 Phase 1-3 implementation pass

Commands run:

```bash
pnpm --filter @ora/shared test
```

Output: `test/contracts.test.ts` passed; 88 tests passed.

```bash
pnpm --filter @ora/runtime test -- runtime-integration.test.ts run-streaming.test.ts
```

Output: runtime suite passed; 20 files passed, 278 tests passed. This includes Debate 9-entry compatibility, custom non-Debate staged mode execution, Debate prompt stance-lock contract, and streaming projection preserving transcript layout hints.

```bash
pnpm --filter @ora/desktop test -- src/lib/viewModel.test.ts src/components/AssistantTurnCard.test.tsx
```

Output: desktop target suite passed; 12 files passed, 85 tests passed. This includes custom non-Debate `two_sided_duel` layout rendering.

```bash
pnpm typecheck
```

Output: shared, runtime, and desktop typechecks passed.

```bash
pnpm lint
```

Output: command completed successfully; no workspace package reported lint failures.

### 2026-04-30 Phase 4 implementation pass

Commands run:

```bash
pnpm --filter @ora/shared build
```

Output: shared package build completed successfully.

```bash
pnpm --filter @ora/runtime test -- mode-studio-builder.test.ts
```

Output: runtime target suite passed; 20 files passed, 280 tests passed. This includes a red-team/blue-team Mode Studio draft that is generated, applied, run, and verified to emit staged transcript entries with `two_sided_duel` layout metadata.

```bash
pnpm --filter @ora/shared test
```

Output: `test/contracts.test.ts` passed; 88 tests passed.

```bash
pnpm --filter @ora/desktop test -- src/components/AssistantTurnCard.test.tsx src/lib/viewModel.test.ts
```

Output: desktop target suite passed; 12 files passed, 85 tests passed.

```bash
pnpm typecheck
```

Output: shared, runtime, and desktop typechecks passed.

```bash
pnpm lint
```

Output: command completed successfully; no workspace package reported lint failures.

Residual risk:

- `timeline` and `role_lanes` renderers remain deferred; current frontend MVP covers `stage_list` and `two_sided_duel`.
- Full visual stage editing remains deferred; Mode Studio currently provides generation, validation, repair, apply, and compact preview.

### 2026-04-30 Phase 5 P1 implementation pass

Commands run:

```bash
pnpm --filter @ora/shared test
```

Output: `test/contracts.test.ts` passed; 88 tests passed.

```bash
pnpm --filter @ora/runtime test -- mode-studio-builder.test.ts runtime-integration.test.ts run-streaming.test.ts
```

Output: runtime suite passed; 20 files passed, 280 tests passed.

```bash
pnpm --filter @ora/desktop test
```

Output: desktop suite passed; 12 files passed, 91 tests passed (includes 6 new renderer tests).

```bash
pnpm typecheck
```

Output: shared, runtime, and desktop typechecks passed.

```bash
pnpm lint
```

Output: command completed successfully; no workspace package reported lint failures.

Files changed:

- `apps/desktop/src/components/StageTranscript.tsx`: added 6 P1 renderers, 3 helpers, updated routing.
- `apps/desktop/src/types.ts`: expanded layout type with `laneBySpeaker`, `lanes`, `orientation`, `showArtifacts`, `groupBy`.
- `apps/desktop/src/components/AssistantTurnCard.test.tsx`: added 6 renderer test cases.
- `apps/runtime/src/mode-studio-draft.ts`: updated builder prompt, layout intent detection, family inference, normalize function.
- `tasks/TASK-20260430-1713-ora-no-code-mode-layouts.md`: updated TODO, progress log, checkpoints, compressed state.

---

## Comparison

### Reference implementation

- Debate v1: `TASK-20260429-0003-debate-mode-stage-transcript.md`
- Debate prompt hardening: `TASK-20260429-1546-debate-mode-stance-lock.md`
- Debate duel UI: `TASK-20260429-1605-debate-transcript-duel-ui.md`
- Debate transcript persistence: `TASK-20260429-1712-debate-session-switch-transcript.md`

### Comparison points

- Preserve Debate’s product behavior while removing ID-based hardcoding.
- Preserve `stage_transcript` as the runtime/UI protocol.
- Preserve one Debate Agent with virtual speaker labels.
- Convert Debate-specific visual components into generic renderer registry entries.
- Convert hardcoded `DEBATE_TURNS` into `ModeSpec.stages` data.

### Expected differences

- Debate no longer needs `if (modeSpec.id === DEBATE_MODE_ID)` for staged execution.
- Frontend no longer needs `isDebateTranscriptGroup()` as the primary routing mechanism.
- Mode Studio can generate modes with similar interaction patterns without code changes.

### Consistency conclusion

This plan follows the original Stage Transcript direction: Debate was intentionally the first concrete ritual, not the endpoint. The correct next step is to promote the useful parts into declarative runtime and frontend primitives.

---

## Verification plan

### Code verification commands

Run after relevant implementation phases:

```bash
pnpm --filter @ora/shared test
pnpm --filter @ora/runtime test -- runtime-integration.test.ts run-streaming.test.ts
pnpm --filter @ora/desktop test -- src/lib/viewModel.test.ts src/components/AssistantTurnCard.test.tsx
pnpm typecheck
pnpm test
pnpm lint
```

### Functional verification

- Run built-in Debate mode and confirm:
  - 9 ordered transcript entries.
  - left/right layout still works.
  - stance-lock prompt test still passes.
- Create a custom red-team/blue-team staged mode and confirm:
  - no new runtime branch required.
  - no new frontend component required.
  - `two_sided_duel` renderer works with custom stance names.
- Create a simple staged mode with no layout and confirm:
  - it falls back to `stage_list`.
- Switch sessions during a running staged mode and confirm:
  - prior transcript entries are preserved.

### TODO scan

Before marking implementation done, run:

```bash
bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"
```

Record full output under this task’s Verification section. Allow only pre-existing/generated hits or explicit `TODO(FOLLOWUP)` items mirrored in Open Issues.

---

## Retrospective

### Item 1

- Pitfall: Debate was added as a useful staged ritual, but the runtime and frontend still contain scenario-specific hardcoding.
- Symptom: adding a red-team/blue-team mode with the same interaction shape would still require runtime/frontend code changes.
- Root Cause: `DEBATE_TURNS`, `executeDebateMode()`, and `isDebateTranscriptGroup()` encode staged execution and layout selection imperatively instead of reading ModeSpec declarations.
- Reusable Guardrail: when a feature introduces a useful new interaction shape, isolate the scenario-specific preset data from the generic runtime/layout primitive before adding the second scenario.
- Evidence: Current Debate implementation has generic transcript metadata but Debate-specific executor and renderer routing.
- Scope: candidate_for_skill
- Suggested Writeback Target: future Ora mode extensibility implementation skill if this staged-mode refactor recurs.
- Status: candidate_for_skill

### Item 2

- Pitfall: “No-code mode creation” can be misunderstood as arbitrary UI generation.
- Symptom: product planning may overreach into model-generated layouts that are hard to test, unsafe, or visually inconsistent.
- Root Cause: lack of explicit boundary between code-provided renderer primitives and ModeSpec-level configuration.
- Reusable Guardrail: define a finite renderer registry; allow ModeSpec to choose/configure renderers, not define arbitrary UI.
- Evidence: Recommended layout list separates MVP/P1/P2 renderers and says new primitives still require code.
- Scope: local_only
- Suggested Writeback Target: none for now; keep inside this task.
- Status: local_only

---

## Compressed State (<= 20 lines)

- Objective: make Ora support no-code creation of structured staged modes by promoting Debate’s useful pieces into generic primitives.
- Implemented Phase 1-4: shared schema, generic staged executor, renderer registry, Mode Studio builder support. All verified.
- Implemented Phase 5 P1: 6 new renderers (`rubric_matrix`, `judge_panel`, `evidence_board`, `comparison_table`, `artifact_gallery`, `kanban_pipeline`).
- Helpers added: `pivotTranscriptEntries` (table pivoting), `groupByTranscriptField` (grouped views), `accentDot` (evidence board dots).
- Mode Studio updated: builder prompt lists 8 layouts, intent detection covers all P1 styles, auto-layout-selection in normalize.
- Frontend types expanded: `laneBySpeaker`, `lanes`, `orientation`, `showArtifacts`, `groupBy` added to layout type.
- Current implemented layouts (8 total): `stage_list`, `two_sided_duel`, `rubric_matrix`, `judge_panel`, `evidence_board`, `comparison_table`, `artifact_gallery`, `kanban_pipeline`.
- Deferred layouts: `timeline`, `role_lanes` (Phase 3 deferred).
- P2 layouts: `branch_compare`, `state_board`, `event_stream`, `graph_topology`, `report_builder`.
- Verification passed: shared 88 tests; runtime 280 tests; desktop 91 tests; typecheck; lint.
- Current status: Phase 1-5 P1 complete.
