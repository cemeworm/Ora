# TASK-20260423-1119-provider-settings-custom-providers

**Created:** 2026-04-23 11:19 CST
**Status:** Done

---

## Goal
- Make Ora Provider Settings mature enough to support user-defined OpenAI-compatible providers without exposing API keys to the frontend.

## Scope / Out of scope
- In scope: shared provider contracts, runtime custom provider adapter, run-time custom provider resolution, desktop settings UI for adding/selecting custom providers, focused tests.
- Out of scope: full LiteLLM embedding, multi-provider routing/fallback policy UI, remote sync of provider settings.

## Constraints
- Compatibility: Preserve existing OpenAI, Anthropic, and local smoke providers.
- Performance: Provider registry changes should stay lightweight and not add startup dependencies.
- Risk: Do not expose provider secrets to React; runtime reads env or macOS Keychain by provider id.
- Tool/Environment limits: Worktree already has unrelated user changes; only provider-related files should be touched.

## Plan
1. `packages/shared/src/index.ts` and tests: add `openai_compatible`, provider metadata fields, and optional run-scoped provider config.
2. `apps/runtime/src/providers/**` and pattern files: add OpenAI-compatible chat-completions adapter, Keychain/env secret lookup, and run-scoped provider resolution.
3. `apps/desktop/src/**`: add local custom provider persistence and a compact settings UI for custom provider creation/selection.
4. Verify with shared/runtime/desktop typecheck and focused tests.

## Active Files
- packages/shared/src/index.ts
- packages/shared/test/contracts.test.ts
- apps/runtime/src/providers/*
- apps/runtime/src/patterns/*
- apps/runtime/test/providers/provider-registry.test.ts
- apps/desktop/src/lib/runtimeClient.ts
- apps/desktop/src/lib/state.tsx
- apps/desktop/src/lib/useRunActions.ts
- apps/desktop/src/components/SettingsView.tsx

## Decisions
- Decision: Add `openai_compatible` as a first-class provider type instead of overloading `openai`.
  - Why: Official OpenAI uses Responses API and keeps the custom-base-url guard; compatible providers generally expect Chat Completions.
  - Alternatives: Treat custom providers as `openai` with a custom `baseUrl`.
  - Tradeoffs: Slightly more code, but avoids sending official OpenAI credentials to arbitrary compatible endpoints.
- Decision: Carry `providerConfig` in `RunConfig`.
  - Why: Custom providers saved in desktop state must be available to runtime graph nodes even when not part of the static default registry.
  - Alternatives: Persist a global runtime provider file first.
  - Tradeoffs: Run snapshots are more self-contained; later shared/global provider persistence can still be added.

## Progress Log
- 2026-04-23 11:19 CST - Task created
  Next: Update shared contracts, implement runtime provider adapter, then wire desktop settings UI.
- 2026-04-23 11:28 CST - Added shared provider fields, OpenAI-compatible runtime adapter, run-scoped provider resolution, desktop custom provider persistence/UI, and focused tests.
  Next: Future follow-up can add model discovery and per-role routing policies.

## Open Issues
- [ ] TODO(FOLLOWUP): Confirm whether future routing policies should bind separate models per Ora role.

## TODO
- None.

## Retrospective
### Item 1
- Pitfall: Workspace packages may typecheck against built `dist` declarations from another package, not just source edits.
- Symptom: Shared tests passed, but runtime and desktop still saw the old `ProviderConfig` union until `@ora/shared` was rebuilt.
- Root Cause: `@ora/shared` exports `dist/index.d.ts` through package exports.
- Reusable Guardrail: After shared contract changes, run `pnpm --filter @ora/shared build` before downstream package typechecks.
- Evidence: Runtime typecheck initially reported missing `openai_compatible`, `apiKeyEnv`, `dropParams`, and `providerConfig`; the errors cleared after rebuilding shared.
- Scope: Monorepo contract packages with generated declaration outputs.
- Suggested Writeback Target: None for now; local project workflow note is enough.
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [x] Unit tests pass
- [ ] Lint checks pass

**Output**:
- `pnpm --filter @ora/shared build` -> passed.
- `pnpm --filter @ora/shared typecheck` -> passed.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm --filter @ora/desktop build` -> passed; Vite built `dist/index.html`, CSS, and JS chunks successfully.
- Lint was not run because this repo currently has no lint script in the changed packages beyond the root passthrough.

### Functional Verification (Feature Works)
- [x] Core functionality verification: runtime adapter test sends an OpenAI-compatible Chat Completions request to `/v1/chat/completions`.
- [x] Edge cases verification: adapter supports localhost HTTP endpoints and `dropParams`; official OpenAI custom base URL guard still rejects without opt-in.
- [x] Error handling verification: missing compatible provider keys fail through the existing missing-key path; non-HTTPS non-localhost endpoints are rejected.

**Output**:
- `pnpm --filter @ora/shared test` -> `test/contracts.test.ts` passed, 45 tests.
- `pnpm --filter @ora/runtime test -- test/providers/provider-registry.test.ts` -> runtime suite passed, 5 files / 42 tests. Provider tests verify OpenAI-compatible payload shape, parsed `choices[].message.content`, run-scoped provider config, and existing OpenAI base URL guard.
- `pnpm --filter @ora/desktop build` -> desktop UI compiled and bundled successfully.

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: Cline OpenAI-compatible provider settings, Open WebUI protocol-oriented connections, LibreChat custom endpoints, Continue model roles/config.

### Comparison Points
- [x] Cline-style fields: provider name/id, base URL, API key, model ID.
- [x] Open WebUI-style protocol split: `openai_compatible` is separate from native OpenAI.
- [x] LibreChat-style secret separation: UI stores provider config separately from secrets; runtime reads env or Keychain.

### Findings
- Consistency: Ora now follows the common `Base URL + API key + model ID` custom provider pattern.
- Differences: Model discovery and per-role model routing are deferred.
- Conclusion: The current implementation is a solid first mature layer without adding a gateway dependency.

## Checkpoints

### Checkpoint 1: Shared Contract
- Requirement: Shared schemas express OpenAI-compatible providers and run-scoped provider configs.
- Verification method: Shared tests and typecheck.
- Status: [x] Pass
- Evidence: `pnpm --filter @ora/shared test` passed 45 tests; `pnpm --filter @ora/shared typecheck` passed.

### Checkpoint 2: Runtime Adapter
- Requirement: Runtime can invoke a run-scoped OpenAI-compatible provider without weakening native OpenAI base URL protections.
- Verification method: Runtime provider tests and typecheck.
- Status: [x] Pass
- Evidence: Runtime tests passed 42 tests; OpenAI-compatible and native OpenAI guard tests passed.

### Checkpoint 3: Desktop Settings
- Requirement: Desktop settings can save/select/delete custom providers and pass selected provider config into runs.
- Verification method: Desktop typecheck/build.
- Status: [x] Pass
- Evidence: `pnpm --filter @ora/desktop typecheck` and `pnpm --filter @ora/desktop build` passed.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Add mature custom OpenAI-compatible provider support to Ora Provider Settings.
- Done: Shared schema, runtime adapter, run-scoped registry resolution, desktop local custom provider persistence, settings UI, and tests.
- In-progress: None.
- Active files: shared provider schema/tests, runtime provider registry/adapters/patterns, desktop settings state/client/UI.
- Next actions (top 3; exact file/function): optional follow-up for model discovery; optional per-role routing; optional provider import/export.
- Blockers/Risks: Existing worktree is dirty; avoid unrelated changes. Keychain runtime lookup only works on macOS.
- Verification status: Shared/runtime/desktop tests and builds passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: /Users/quintenchen/developer/ora, macOS desktop workspace, pnpm 10.11.0.

### Commands run + outputs
- `bash skills/long-task-protocol/scripts/todo_scan.sh` -> no output.
- `pnpm --filter @ora/shared build` -> passed.
- `pnpm --filter @ora/shared typecheck` -> passed.
- `pnpm --filter @ora/shared test` -> 45 tests passed.
- `pnpm --filter @ora/runtime typecheck` -> passed.
- `pnpm --filter @ora/runtime test -- test/providers/provider-registry.test.ts` -> 5 test files / 42 tests passed.
- `pnpm --filter @ora/desktop typecheck` -> passed.
- `pnpm --filter @ora/desktop build` -> passed.
