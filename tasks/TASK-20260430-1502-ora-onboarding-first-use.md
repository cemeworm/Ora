# TASK-20260430-1502-ora-onboarding-first-use

**Created:** 2026-04-30 15:02 GMT+8
**Status:** In Progress
**Source of Truth:** This file is the authoritative plan and task journal for the Ora first-use onboarding iteration. Chat summaries are non-authoritative.

---

## Goal
Build a first-use onboarding experience for Ora so a new user can understand what Ora is, understand why Mode customization matters, and configure a model provider before entering regular chat. The onboarding must be a full-screen first-run page, embed provider configuration directly, and present providers in two layers: providers with free model quota/recommendation first, then the complete provider list.

## Product Requirements
1. Friendly welcome for first-time users.
2. Introduce Ora's core value clearly, with emphasis on custom Modes.
3. Guide users to configure a Provider so Ora works after setup.
4. Provider display:
   - First row: providers with free model quota / free model availability, such as OpenRouter.
   - Second row: full provider list.
5. Page shape: full-screen onboarding page.
6. Provider setup: embedded API Key input, verification, and enable flow inside onboarding.
7. Provider metadata: allowed to add structured free-tier/recommendation fields to provider presets.
8. Skip behavior: user can fully skip onboarding; after skip, onboarding should not reappear.

## Scope / Out of scope
- In scope:
  - Full-screen onboarding UI integrated into desktop app startup.
  - First-run local persistence for completed/skipped onboarding state.
  - Provider selection, API Key entry, verification, and enablement inside onboarding.
  - Provider preset metadata for free-tier/recommendation/onboarding priority.
  - Minimal shared provider setup logic extracted from Settings to avoid duplicating provider verification code.
  - Verification that Settings provider configuration still works after extraction.
- Out of scope:
  - No new routing system.
  - No forced onboarding; skip remains available.
  - No embedded Mode builder/canvas in onboarding.
  - No rewrite of `SettingsView.tsx` beyond the minimum needed for provider setup reuse.
  - No hard commitment to exact provider free-credit amounts unless verified and intentionally added later.
  - No onboarding analytics unless separately requested.

## Constraints
- Compatibility:
  - Keep current React 18 + Vite + Tauri + TailwindCSS architecture.
  - Match existing app shell and UI language: warm gray workspace, white cards, fine rings, large radii, lucide icons.
- Performance:
  - Onboarding should not block runtime bootstrap longer than current startup path.
  - Avoid importing heavy `ModesView` / ReactFlow into onboarding.
- Risk:
  - Provider verification depends on external network/provider services; failure must be recoverable and must not trap the user.
  - Settings provider logic is currently embedded in a large file; extraction must be surgical.
- Tool/Environment limits:
  - Verification should at minimum run `pnpm --filter @ora/desktop typecheck`.
  - UI behavior requires manual desktop/browser verification.

## Current Codebase Findings
- Main app: `apps/desktop`.
- App startup/gating: `apps/desktop/src/App.tsx`.
- Global state: `apps/desktop/src/lib/state.tsx`.
- Chat empty welcome: `apps/desktop/src/components/ChatView.tsx` and `apps/desktop/src/lib/welcomeGreeting.ts`.
- Provider presets and drafts: `apps/desktop/src/lib/providerPresets.ts`.
- Provider shared schema/status: `packages/shared/src/providers.ts`.
- Provider settings UI and current verify flow: `apps/desktop/src/components/SettingsView.tsx`.
- Runtime actions used by Settings: `apps/desktop/src/lib/useRunActions.ts`.
- Mode customization UI: `apps/desktop/src/components/ModesView.tsx`.
- UI primitives: `apps/desktop/src/components/ui/button.tsx`, `input.tsx`, `select.tsx`, `field.tsx`, `choice-card.tsx`.
- Shared visual style: `apps/desktop/src/styles.css`, `apps/desktop/tailwind.config.ts`.

## Design Direction
### Visual thesis
Warm workbench onboarding. The page should feel like an Ora workspace panel, not a generic SaaS marketing landing page. Use the existing `bench-*` palette, `bg-sidebar` / `bg-card`, fine `ring-bench-200`, large rounded cards, compact pills, and quiet lucide icons.

### Content plan
1. Welcome:
   - Friendly welcome copy.
   - Explain Ora as an AI workspace where behavior can be shaped around how the user works.
2. Mode customization:
   - Explain that Modes define collaboration style, tool access, output format, and safety/approval behavior.
   - Mention existing capabilities from `ModesView`: natural-language mode creation, clone preset, customize, use in chat.
3. Provider setup:
   - Show free-tier/recommended providers first.
   - Show full provider list second.
   - Let the user select a provider, paste API Key, verify, enable, then enter Ora.

### Interaction thesis
- Three-step progress/checklist: Welcome -> Modes -> Provider.
- Provider cards use subtle hover: background step + stronger ring + active scale.
- Right top or card top-right Skip action always available.
- Verification failure keeps the user on Provider step with a readable error and provider API key link.
- Verification success writes completed state and enters the main app.

## Plan
1. Add onboarding persistence helpers.
   - File: `apps/desktop/src/lib/onboarding.ts`.
   - Objective:
     - Define storage key `ora.onboarding.v1`.
     - Export read/write helpers for status `completed | skipped`.
     - Keep this local to desktop UI; do not add global reducer state unless needed.

2. Add provider preset onboarding metadata.
   - File: `apps/desktop/src/lib/providerPresets.ts`.
   - Objective:
     - Extend `ProviderPreset` with optional fields:
       - `freeTier?: { label: string; description?: string; url?: string }`
       - `recommendationReason?: string`
       - `onboardingPriority?: number`
     - Add metadata to OpenRouter first:
       - `freeTier.label`: `Free models available`
       - `recommendationReason`: `Start quickly with a unified model gateway.`
       - `onboardingPriority`: high priority value chosen consistently with sort direction.
     - Avoid adding unverified free-tier claims for other providers.

3. Extract reusable provider setup logic.
   - New file: `apps/desktop/src/hooks/useProviderSetup.ts`.
   - Objective:
     - Centralize provider catalog/draft selection and verification logic currently embedded in `SettingsView.tsx`.
     - Reuse existing helpers from `providerPresets.ts`:
       - `buildProviderCatalog`
       - `createDraftFromPreset`
       - `createDraftFromProvider`
       - `buildProviderConfigFromDraft`
       - `createModelProviderId`
       - `getModelProviderBaseId`
     - Reuse existing runtime actions from `useRunActions()`:
       - `actions.storeProviderSecret`
       - `actions.verifyProvider`
       - `actions.upsertCustomProvider`
     - Return state and functions needed by both Settings and onboarding:
       - provider catalog
       - selected entry/draft
       - update draft
       - save secret
       - verify and enable provider
       - status/error/busy state

4. Update Settings provider UI to use the shared setup hook.
   - File: `apps/desktop/src/components/SettingsView.tsx`.
   - Objective:
     - Keep existing settings UI intact.
     - Replace duplicated provider setup internals with hook calls where safe.
     - Preserve advanced settings, custom model, enable/disable, delete, capability toggles.
     - Do not restructure memory/runtime/tools settings sections.

5. Build onboarding page and provider step.
   - New file: `apps/desktop/src/components/onboarding/OnboardingView.tsx`.
   - New file: `apps/desktop/src/components/onboarding/ProviderOnboardingStep.tsx`.
   - Optional if needed: `ProviderCard.tsx`, `ModeFeatureCard.tsx` under same folder.
   - Objective:
     - Full-screen layout matching Ora visual style.
     - Step 1: welcome panel.
     - Step 2: Mode customization explanation cards.
     - Step 3: Provider setup:
       - First row: provider entries with `preset.freeTier`.
       - Second row: full provider catalog excluding `local_smoke`.
       - API key input and API key link from preset `apiKeyUrl`.
       - Verify & enable button.
       - Inline status and error display.
     - Use existing UI primitives where practical: `Button`, `Input`, `Select` or custom lightweight buttons matching current Settings style.

6. Integrate full-screen gating in app startup.
   - File: `apps/desktop/src/App.tsx`.
   - Objective:
     - After bootstrap provider statuses are available, compute whether onboarding should show.
     - Show onboarding when:
       - local onboarding status is absent; and
       - no non-`local_smoke` provider is verified.
     - Do not show onboarding when:
       - status is `completed` or `skipped`; or
       - at least one real provider is already verified.
     - On completed: write `completed`, then render normal app.
     - On skipped: write `skipped`, then render normal app.

7. Keep ChatView empty state unchanged unless integration reveals visual conflict.
   - File: `apps/desktop/src/components/ChatView.tsx`.
   - Objective:
     - Since onboarding gates before ChatView, no provider reminder is needed in ChatView for this iteration.
     - Existing `welcomeGreeting` remains the post-onboarding empty-chat welcome.

8. Verify and fix type/runtime regressions.
   - Commands:
     - `pnpm --filter @ora/desktop typecheck`
     - `pnpm --filter @ora/desktop test` if available and practical.
   - Manual checks listed in Functional Verification.

## Active Files
- `tasks/TASK-20260430-1502-ora-onboarding-first-use.md`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/onboarding.ts` (planned new)
- `apps/desktop/src/lib/providerPresets.ts`
- `apps/desktop/src/hooks/useProviderSetup.ts` (planned new)
- `apps/desktop/src/components/SettingsView.tsx`
- `apps/desktop/src/components/onboarding/OnboardingView.tsx` (planned new)
- `apps/desktop/src/components/onboarding/ProviderOnboardingStep.tsx` (planned new)
- `apps/desktop/src/components/ChatView.tsx` (read/coordination only unless needed)
- `apps/desktop/src/components/ModesView.tsx` (reference only)

## Decisions
- Decision: Full-screen onboarding rather than overlay or chat empty-state enhancement.
  - Why: The flow has three real jobs and embedded provider configuration; full-screen has enough space and clearer hierarchy.
  - Alternatives: Overlay/dialog; enhanced chat empty state.
  - Tradeoffs: Full-screen is more visible and polished, but needs app-level gating.

- Decision: Embedded provider API Key verification in onboarding.
  - Why: New users need a working provider before Ora is useful.
  - Alternatives: Jump to Settings provider section.
  - Tradeoffs: Better first-run completion, but requires extracting provider setup logic from Settings.

- Decision: Provider free-tier/recommendation metadata belongs in desktop provider presets.
  - Why: This is presentation/catalog metadata for onboarding and Settings, not runtime provider schema.
  - Alternatives: Hard-code OpenRouter in onboarding; add shared schema fields.
  - Tradeoffs: Preset metadata is maintainable without expanding runtime schema; claims must remain conservative.

- Decision: Skip writes a permanent skipped state for v1.
  - Why: User explicitly chose fully skippable onboarding with no future nag.
  - Alternatives: Skip but remind if provider missing; block until provider configured.
  - Tradeoffs: Respects user control, but some users may enter a non-functional state until they configure provider manually.

- Decision: Do not embed Mode builder in onboarding.
  - Why: `ModesView` is complex and depends on canvas/editor/runtime atoms; onboarding should teach and route, not become a second studio.
  - Alternatives: Add a mini mode creator during onboarding.
  - Tradeoffs: Lower implementation risk; less hands-on mode setup during first run.

## Open Issues
- [ ] Confirm exact sort direction for `onboardingPriority` before implementation. Recommendation: lower number means earlier display, or document the chosen convention in code.
- [ ] Confirm whether OpenRouter is the only provider with known free model availability for v1. Recommendation: only OpenRouter gets `freeTier` initially unless another provider is explicitly verified.
- [ ] During implementation, inspect `actions.storeProviderSecret` behavior to ensure secret write can be awaited or followed by verification reliably.

## TODO
- [ ] Implement `apps/desktop/src/lib/onboarding.ts`.
- [ ] Add provider free-tier metadata to `apps/desktop/src/lib/providerPresets.ts`.
- [ ] Extract minimal `apps/desktop/src/hooks/useProviderSetup.ts`.
- [ ] Update `apps/desktop/src/components/SettingsView.tsx` to use shared provider setup logic without changing unrelated sections.
- [ ] Create `apps/desktop/src/components/onboarding/OnboardingView.tsx`.
- [ ] Create `apps/desktop/src/components/onboarding/ProviderOnboardingStep.tsx`.
- [ ] Integrate onboarding gating in `apps/desktop/src/App.tsx`.
- [ ] Run typecheck and tests.
- [ ] Perform manual first-run verification matrix.

## Retrospective
- No implementation retrospective yet. Fill after the first meaningful build/rework loop.

## Functional Verification

### Code Verification (Code Correctness)
- [ ] Desktop typecheck passes.
- [ ] Unit tests pass where available.
- [ ] No unintended changes outside onboarding/provider setup files.

**Output:** Paste command outputs after implementation.

### Functional Verification (Feature Works)
- [ ] First-run display:
  - Method: clear `ora.onboarding.v1` and ensure no verified non-local provider.
  - Expected: full-screen onboarding appears.
- [ ] Skip behavior:
  - Method: click Skip, refresh/restart.
  - Expected: onboarding does not reappear.
- [ ] Existing provider bypass:
  - Method: have at least one verified non-`local_smoke` provider.
  - Expected: onboarding does not appear.
- [ ] Provider first row:
  - Method: inspect provider onboarding UI.
  - Expected: OpenRouter appears in free-tier/recommended row.
- [ ] Full provider row:
  - Method: inspect provider onboarding UI.
  - Expected: all user-visible provider presets appear in full list; `local_smoke` is excluded.
- [ ] Empty API key handling:
  - Method: attempt verify with blank key.
  - Expected: no verification or clear validation message.
- [ ] Invalid API key handling:
  - Method: attempt verify with invalid key.
  - Expected: verification failure is shown; onboarding remains usable; Skip still works.
- [ ] Valid API key handling:
  - Method: enter valid key and verify.
  - Expected: secret saved, provider verified/enabled, selected provider updated, onboarding writes completed and enters app.
- [ ] Settings regression:
  - Method: configure/verify provider from Settings after hook extraction.
  - Expected: existing Settings provider flow still works.

**Output:** Paste manual verification results after implementation.

## Comparison

### Reference
- Existing Settings provider configuration: `apps/desktop/src/components/SettingsView.tsx`.
- Existing Mode customization surface: `apps/desktop/src/components/ModesView.tsx`.
- Existing empty chat welcome: `apps/desktop/src/components/ChatView.tsx` + `apps/desktop/src/lib/welcomeGreeting.ts`.

### Comparison Points
- [ ] Provider status labels and verification semantics remain consistent with Settings.
- [ ] Onboarding visual treatment remains consistent with app shell and Settings cards.
- [ ] Mode explanation uses real `ModesView` concepts and does not overpromise.

### Findings
- Consistency: To be filled after implementation.
- Differences: Onboarding is simpler than Settings; it only covers first successful provider setup.
- Conclusion: Onboarding should reuse provider logic but not duplicate the full Settings UI.

## Checkpoints

### Checkpoint 1: First-run gating
- Requirement: Show onboarding only for fresh users without a verified real provider.
- Verification method: manual localStorage/provider status matrix.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending implementation.

### Checkpoint 2: Provider metadata and layout
- Requirement: Providers are separated into free-tier/recommended row and full-list row.
- Verification method: inspect rendered onboarding UI and provider catalog output.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending implementation.

### Checkpoint 3: Embedded provider verification
- Requirement: User can paste API Key, verify, enable provider, and finish onboarding.
- Verification method: manual valid/invalid key tests plus provider status inspection.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending implementation.

### Checkpoint 4: Settings regression safety
- Requirement: Existing Settings provider configuration remains functional.
- Verification method: manually verify provider from Settings and run typecheck/tests.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending implementation.

**All checkpoints must pass before marking task DONE.**

## Compressed State (<= 20 lines)
- Objective: Add Ora full-screen first-use onboarding with welcome, Mode explanation, and embedded Provider setup.
- User decisions: full-screen; embedded API Key verification; add provider free-tier metadata; fully skippable with no nag after skip.
- Recommended architecture: app-level gating in `App.tsx`, local persistence key `ora.onboarding.v1`, new onboarding components, shared provider setup hook.
- Provider rows: first row from `preset.freeTier`; second row full user-visible provider catalog excluding `local_smoke`.
- Key new files: `lib/onboarding.ts`, `hooks/useProviderSetup.ts`, `components/onboarding/OnboardingView.tsx`, `components/onboarding/ProviderOnboardingStep.tsx`.
- Key modified files: `App.tsx`, `providerPresets.ts`, `SettingsView.tsx`.
- Do not do: no routing rewrite, no Mode builder embedding, no full Settings UI duplication, no forced provider setup.
- In-progress: task plan recorded; implementation not started.
- Next actions: implement onboarding persistence helper; add provider metadata; extract provider setup hook from Settings.
- Blockers/Risks: Settings provider logic coupling; provider verification network failures; conservative free-tier claims.
- Verification status: pending implementation.

## Verification

### Evidence Requirements
Must provide the following evidence before DONE:
- [ ] Code Verification output: `pnpm --filter @ora/desktop typecheck`.
- [ ] Test output: `pnpm --filter @ora/desktop test` if practical.
- [ ] Functional verification output for first-run, skip, provider rows, invalid key, valid key, Settings regression.
- [ ] Checkpoints evidence.
- [ ] Retrospective evidence.

### Environment
- Environment: macOS / darwin, workspace `/Users/quintenchen/developer/ora`, Node 22.17.0, pnpm workspace.

### Commands run + outputs
- Planning only so far. No implementation verification commands run yet.

## Progress Log
- 2026-04-30 15:02 GMT+8 - Created task journal from approved planning direction and user decisions.
  Next: Implement `apps/desktop/src/lib/onboarding.ts`; add provider onboarding metadata in `providerPresets.ts`; extract `useProviderSetup.ts`.
