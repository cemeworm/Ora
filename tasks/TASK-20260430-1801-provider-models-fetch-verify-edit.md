# TASK-20260430-1801-provider-models-fetch-verify-edit

**Created:** 2026-04-30 18:01 GMT+8  
**Status:** Resolved with caveat — provider fetch endpoint coverage fixed; unrelated runtime typecheck errors remain
**Authoritative Source:** Yes — this file is the single source of truth for this task. Chat messages and older ad-hoc plan files are non-authoritative summaries only.

---

## Goal

Implement Settings -> Providers -> Models so provider model management is backed by a real provider model discovery flow. Every provider type must expose a unified fetch/list models capability at the code level. `providers.verify` must fetch the provider-supported model list before running the existing connectivity smoke call. Settings should use fetched remote models as the primary source for the Models list, while preserving saved/custom entries. Existing saved models must be editable as full `ProviderConfig` records, and changing a model ID must replace the old saved model provider record safely.

---

## Hard Requirements

1. **Provider model fetch is mandatory as an interface**
   - Every provider type must have a unified model listing path.
   - Official providers should call their real remote model listing endpoint.
   - Compatible providers may return `unsupported` when the remote service does not support `/models`, but they still must go through the same unified interface.

2. **Verify must fetch model list first**
   - `providers.verify` must call `fetchProviderModels(config)` before creating a model provider and before sending the smoke prompt.
   - Tests must prove model list fetch happens before the smoke call.

3. **Authoritative list controls model validity**
   - If model listing returns `ok + authoritative: true`, verify must reject a `modelId` that is not in the returned model IDs.
   - If model listing returns `unsupported`, verify may continue to smoke call.
   - If model listing returns `error`, verify must fail before smoke call.

4. **Settings model list prefers fetched models**
   - Fetched authoritative models are the primary Models list source.
   - Preset suggestions are fallback/suggestions, not the main source once remote models are available.
   - Current draft and saved model IDs must remain visible even if not in fetched list, with clear status markers.

5. **Saved models are full editable provider configs**
   - Editing an existing model must load that model provider's complete config into the existing Provider Details form.
   - Editing is not limited to `modelId`; it includes base URL, env var, protocol, Anthropic version, max tokens, temperature, drop params, headers, capabilities, enabled state, and label.

6. **Model ID rename replaces old record**
   - When an edited model ID changes, save the new provider config first, then remove the old provider record.
   - If the old provider was selected for chat, migrate selection to the new provider only if the new provider is enabled.
   - Never leave `selectedProviderId` pointing at a disabled provider.

---

## Scope / Out of Scope

### In Scope

- Add shared schemas/types for provider model discovery.
- Add `providers.models` JSON-RPC method.
- Add runtime model listing implementations for:
  - OpenAI official
  - OpenAI-compatible
  - Anthropic official
  - Anthropic-compatible
  - local smoke
- Make runtime verify call provider model listing before smoke call.
- Add desktop runtime client method for model listing.
- Update Settings Models UI to fetch/display remote models.
- Add full-config edit support for saved model providers.
- Fix disabled-provider selection bugs caused by current upsert/delete behavior.
- Add tests around schema, RPC, adapter model listing, verify ordering, Settings merge behavior, and provider selection.

### Out of Scope

- Do not change persistence shape to nested `provider.models[]`.
- Do not build background/scheduled model list sync.
- Do not automatically migrate Keychain secrets from old model provider ID to new model provider ID, because current APIs do not expose safe secret read/copy semantics.
- Do not require every OpenAI-compatible or Anthropic-compatible provider to truly support `/models`; unsupported is a valid normalized result.
- Do not add a separate modal editor unless the existing Provider Details form proves impossible to reuse.
- Do not implement batch edit, drag sorting, or batch delete for models.

---

## Current Architecture Snapshot

### Current Models Structure

- Multi-model support is represented as multiple `ProviderConfig` entries under the same base provider ID.
- There is no nested `provider.models[]` structure.
- Model provider IDs use the convention in `apps/desktop/src/lib/providerPresets.ts`:
  - Base provider: `deepseek`
  - Model provider: `deepseek--model-deepseek-reasoner`

### Current Settings Models Source

In `apps/desktop/src/components/SettingsView.tsx`, Models are currently assembled from:

1. `activePreset.modelSuggestions`
2. `selectedCatalogEntry.providers[].modelId`
3. `providerDraft.modelId`

This is local/static. It does not call provider APIs to discover actual supported models.

### Current Verify Flow

Current flow:

```text
SettingsView.tsx
  verifyAndEnableProvider()
  enableModel(modelId)
    -> actions.verifyProvider(provider)

useRunActions.ts
  verifyProvider(provider)
    -> runtimeClient.verifyProvider(provider)

runtimeClient.ts
  verifyProvider(provider)
    -> call("providers.verify", { provider })

apps/runtime/src/json-rpc.ts
  case "providers.verify"
    -> verifyProviderConfig(parsed.provider)

apps/runtime/src/providers/registry.ts
  verifyProviderConfig(config)
    -> local validation
    -> createModelProvider(config)
    -> provider({ prompt: "Reply with OK." })
    -> ProviderStatus
```

Current gap: verify jumps directly to smoke call without fetching the provider-supported model list.

---

## Active Files

### Shared

- `packages/shared/src/rpc.ts`
- `packages/shared/src/providers.ts`

### Runtime

- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/src/providers/types.ts`
- `apps/runtime/src/providers/registry.ts`
- `apps/runtime/src/providers/provider-utils.ts`
- `apps/runtime/src/providers/openai.ts`
- `apps/runtime/src/providers/openai-compatible.ts`
- `apps/runtime/src/providers/anthropic.ts`
- `apps/runtime/src/providers/anthropic-compatible.ts`
- `apps/runtime/src/providers/local-smoke.ts`
- `apps/runtime/src/providers/index.ts`

### Desktop

- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/lib/useRunActions.ts`
- `apps/desktop/src/lib/state.tsx`
- `apps/desktop/src/lib/providerPresets.ts`
- `apps/desktop/src/components/SettingsView.tsx`

### Tests

- `apps/desktop/src/lib/providerPresets.test.ts`
- Potential new tests:
  - `apps/runtime/src/providers/model-list.test.ts`
  - `apps/runtime/src/providers/registry.test.ts`
  - `apps/desktop/src/lib/providerSelection.test.ts`
  - `apps/desktop/src/lib/providerModels.test.ts`

---

## Plan

### Phase 1 — Shared contract for provider model discovery

#### Files

- `packages/shared/src/rpc.ts`
- `packages/shared/src/providers.ts`

#### Tasks

1. Add `providers.models` to `RuntimeJsonRpcMethodSchema`.
2. Add `ProviderModelSchema`:
   - `id: string`
   - `name?: string`
   - `created?: number`
   - `ownedBy?: string`
   - `source?: "remote" | "preset" | "local"`
3. Add `ProviderModelsParamsSchema`:
   - `{ provider: ProviderConfigSchema }`
4. Add `ProviderModelsResultSchema`:
   - `models: ProviderModel[]`
   - `status: "ok" | "unsupported" | "error"`
   - `authoritative: boolean`
   - `message?: string`
   - `fetchedAt?: string`
5. Export corresponding TypeScript types.

#### Success Criteria

- Shared package typecheck passes.
- Schema tests cover `ok`, `unsupported`, and `error` results.
- RPC enum accepts `providers.models`.

---

### Phase 2 — Runtime provider model fetch interface

#### Files

- `apps/runtime/src/providers/types.ts`
- `apps/runtime/src/providers/registry.ts`
- `apps/runtime/src/providers/provider-utils.ts`
- Provider adapter files

#### Design

Expose one runtime-level entrypoint:

```ts
fetchProviderModels(config: ProviderConfig, options?: ProviderRuntimeOptions): Promise<ProviderModelsResult>
```

This should be the only path used by both JSON-RPC and verify.

Optional adapter shape:

```ts
interface ModelProvider {
  (request: ModelRequest): Promise<ModelResponse>;
  stream?: (...): Promise<ModelResponse>;
  listModels?: () => Promise<ProviderModelsResult>;
}
```

Alternative: keep model listing outside `ModelProvider` and switch by `config.type` in `registry.ts`. Recommended: central `fetchProviderModels` in `registry.ts` with adapter helpers to keep behavior explicit and testable.

#### Provider-specific behavior

##### OpenAI official

- Endpoint: `GET /v1/models`
- Auth: `Authorization: Bearer <key>`
- Use `readProviderApiKey(config, "OPENAI_API_KEY", env)`.
- Use `resolveProviderEndpoint`.
- Parse `data[].id`.
- Return `status: "ok"`, `authoritative: true`, `source: "remote"`.

##### OpenAI-compatible

- Endpoint: use compatible base URL and try `GET /models`.
- Reuse API key logic with fallback env name derived from provider ID.
- Endpoint normalization should be consistent with current `resolveCompatibleProviderEndpoint` behavior.
- Classification:
  - 404 / 405 / 501 -> `status: "unsupported"`, `authoritative: false`
  - 401 / 403 -> `status: "error"`, `authoritative: false`
  - timeout / DNS / 429 / 5xx -> `status: "error"`, `authoritative: false`
  - 200 with parseable model IDs -> `status: "ok"`, `authoritative: true`
  - 200 but unparseable body -> `status: "unsupported"` or `error` depending on body; initial preference: `unsupported` if no clear error.

##### Anthropic official

- Endpoint: `GET /v1/models`
- Headers:
  - `x-api-key`
  - `anthropic-version`
- Use `readProviderApiKey(config, "ANTHROPIC_API_KEY", env)`.
- Use `resolveProviderEndpoint`.
- Parse defensively:
  - Prefer `data[].id`
  - Accept common variants if seen in docs/tests
- Return `status: "ok"`, `authoritative: true` on success.

##### Anthropic-compatible

- Try `/models` with `x-api-key` and `anthropic-version` style headers.
- Same unsupported/error classification as compatible providers.
- Do not assume all Anthropic-compatible providers support model discovery.

##### local_smoke

- No network call.
- Return:
  - `status: "ok"`
  - `authoritative: true`
  - `models: [{ id: "smoke-model", source: "local" }]`

#### Success Criteria

- All provider types return a normalized `ProviderModelsResult`.
- Compatible providers do not throw directly for unsupported `/models`; they return `unsupported`.
- Auth/network/server errors are distinguishable from unsupported.

---

### Phase 3 — Runtime JSON-RPC method

#### Files

- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/src/providers/index.ts`

#### Tasks

1. Export `fetchProviderModels` from providers barrel if needed.
2. Add JSON-RPC case:

```ts
case "providers.models": {
  const parsed = ProviderModelsParamsSchema.parse(request.params);
  return fetchProviderModels(parsed.provider);
}
```

3. Ensure unsupported and error results are returned as successful JSON-RPC responses, not thrown JSON-RPC errors, unless request params are invalid.

#### Success Criteria

- `providers.models` returns normalized results for all provider types.
- Bad params still fail schema validation.

---

### Phase 4 — Verify must fetch model list before smoke call

#### File

- `apps/runtime/src/providers/registry.ts`

#### Required Flow

`verifyProviderConfig(config)` must become:

1. Local config validation:
   - local smoke special case
   - `modelId` required
   - compatible provider `baseUrl` required
2. Call `fetchProviderModels(config, options)`.
3. Branch:
   - `ok + authoritative`:
     - If current `config.modelId` is absent from `models[].id`, return failed status before smoke call.
     - If present, proceed to smoke call.
   - `unsupported`:
     - Proceed to smoke call.
     - Status detail should mention model discovery was unsupported if smoke succeeds.
   - `error`:
     - Return failed status before smoke call.
4. Only after the above can `createModelProvider(config)` and the `Reply with OK.` prompt run.

#### Important Test Requirement

Tests must prove call order:

```text
fetchProviderModels(config)
  -> if allowed, smoke provider call
```

Test cases:

1. Authoritative list returns model present -> smoke call happens.
2. Authoritative list returns model missing -> smoke call does not happen.
3. Model list returns unsupported -> smoke call happens.
4. Model list returns error -> smoke call does not happen.

#### Status Detail Examples

- Missing model:
  - `Model "deepseek-foo" was not found in provider model list.`
- Unsupported discovery but smoke succeeds:
  - `Connection verified. Model discovery is not supported by this provider, so the model was verified by smoke call only.`
- Discovery error:
  - `Failed to fetch provider model list: <detail>`

---

### Phase 5 — Desktop runtime client

#### File

- `apps/desktop/src/lib/runtimeClient.ts`

#### Tasks

1. Add method:

```ts
listProviderModels(provider: OraProviderConfig): Promise<OraProviderModelsResult>
```

2. Implement via:

```ts
call("providers.models", { provider })
```

3. Add browser/mock fallback:
   - local smoke -> authoritative smoke model
   - known preset -> preset suggestions, but mark `source: "preset"`, `authoritative: false` unless it simulates a real remote source intentionally
   - unknown compatible -> `unsupported`

#### Success Criteria

- Desktop can call model listing independently from verify.
- Mock fallback shape matches shared schema.

---

### Phase 6 — Settings UI: remote model list integration

#### File

- `apps/desktop/src/components/SettingsView.tsx`

#### New State

- `providerModelsResult`
- `providerModelsLoading`
- `providerModelsError` or rely on result message
- Optional: `lastFetchedProviderModelsKey` to avoid applying stale results

#### Trigger Strategy

Initial implementation should prefer a visible `Fetch models` button to avoid excessive requests while editing base URL / API key fields.

Behavior:

1. User clicks `Fetch models` in Models section.
2. Build draft provider config.
3. Call `runtimeClient.listProviderModels(draftProvider)`.
4. Store result.
5. Merge result into model options.

Verify path still always fetches models through runtime `providers.verify`, regardless of whether the UI button was clicked.

Future optional improvement: debounce automatic fetch when provider has enough info.

#### Model Option Merge Order

1. Remote fetched models when `status === "ok"`.
2. Current draft `modelId` if missing.
3. Saved provider model IDs if missing.
4. Preset suggestions only when no authoritative remote list is available, or shown as fallback suggestions.

#### UI Labels

- Remote model from fetched list: `Remote model`
- Saved model enabled: `Enabled model`
- Saved disabled: `Saved disabled`
- Current draft not in authoritative list: `Not in provider list`
- Preset fallback: provider/preset label
- Unsupported discovery: `Provider does not expose model discovery.`
- Error: display actionable result message.

#### Success Criteria

- Fetched models appear in Models list.
- Preset suggestions are not treated as authoritative when remote fetch succeeds.
- Current/saved model IDs are retained even if missing from remote list.
- UI communicates unsupported/error state without deleting user data.

---

### Phase 7 — Settings UI: full-config model editing

#### File

- `apps/desktop/src/components/SettingsView.tsx`

#### New State

- `editingModelProviderId: string | undefined`
- `editingOriginalModelId: string | undefined`

#### New Function: `editModel(modelId: string)`

Behavior:

1. Look up `modelProviderByModelId.get(modelId)`.
2. If saved provider exists:
   - `setProviderDraft(createDraftFromProvider(modelProvider))`
   - `setEditingModelProviderId(modelProvider.id)`
   - `setEditingOriginalModelId(modelProvider.modelId)`
3. If no saved provider exists:
   - Use current `providerDraft` as base.
   - Set `modelId` to selected model.
   - Set `enabled: false`.
   - Compute prospective provider ID.
   - Enter edit mode without saving.
4. Clear `modelSearch`.

#### UI Changes

- Add `Edit` button to each model row.
- Keep row click as lightweight model selection.
- Show editing state in Models header:
  - `Editing: <modelId>`
  - If model ID changed: `Saving will replace <old> with <new>.`
- The existing Provider Details form remains the editor for the full config.

#### Fields Covered by Full Edit

- Provider Name / label
- Model ID
- Base URL
- API Key Env
- Protocol
- Anthropic Version
- Max Output Tokens
- Temperature
- Drop Params
- Headers
- Capabilities
- Enabled state

#### Success Criteria

- Clicking Edit on a saved model loads that model's exact config, not just its model ID.
- Saving preserves all edited full-config fields.
- Unsaved fetched/preset model can be converted into a saved provider config.

---

### Phase 8 — Save/replace logic for model ID changes

#### File

- `apps/desktop/src/components/SettingsView.tsx`

#### Required Save Flow

`saveProviderDetails()` should become async and support replacement.

Algorithm:

1. Determine old provider ID:
   - `editingModelProviderId ?? providerDraft.id`
2. Determine base provider ID:
   - `getModelProviderBaseId(oldProviderId)`
3. Determine new provider ID:
   - If `newModelId === activePreset.defaultModelId`, use base provider ID.
   - Else use `createModelProviderId(baseProviderId, newModelId)`.
4. Conflict check:
   - If new provider ID already exists and is not old provider ID, block save.
   - Show feedback: model/provider already exists.
5. Build new `ProviderConfig` from full draft fields.
6. Upsert new provider.
7. If old provider ID differs from new provider ID, delete old provider record.
8. If old provider was selected and new provider is enabled, select new provider.
9. If new provider is disabled, do not select it.
10. Update local edit state to new ID/model ID.

#### Required Ordering

```text
upsert new provider
  -> delete old provider
  -> migrate selectedProviderId if safe
```

Do not delete old first, because that may force an unwanted fallback before the replacement exists.

#### Success Criteria

- Renaming a model removes the old model from the list.
- New model appears with preserved full config.
- Existing provider config is not overwritten accidentally.
- Selection migration works only when new provider is enabled.

---

### Phase 9 — Fix selectedProviderId behavior around disabled providers

#### Files

- `apps/desktop/src/lib/useRunActions.ts`
- `apps/desktop/src/lib/state.tsx`
- Potential new `apps/desktop/src/lib/providerSelection.ts`

#### Current Bug

`useRunActions.upsertCustomProvider()` currently dispatches `SET_PROVIDER(provider.id)` unconditionally. This means saving/adding/disabling a disabled model can make chat point at a disabled provider.

#### Required Changes

Add explicit selection options:

```ts
upsertCustomProvider(provider, options?: {
  select?: boolean;
  replacementForProviderId?: string;
})

deleteCustomProvider(providerId, options?: {
  replacementProviderId?: string;
  deleteSecret?: boolean;
})
```

Recommended call behavior:

- `addCustomModel()`:
  - upsert disabled provider with `select: false`
- `disableModel()` / `disableProvider()`:
  - upsert disabled provider with `select: false`
  - if it was selected, migrate to another enabled provider
- `enableModel()` / `verifyAndEnableProvider()`:
  - verify succeeds -> upsert enabled provider with `select: true`
- `saveProviderDetails()`:
  - if replacing selected old provider and new provider enabled -> select new ID
  - if new provider disabled -> do not select it

#### Provider Selection Helper

Create helper with this policy:

1. Preferred provider if present and enabled.
2. Current selected provider if still present and enabled.
3. Same model group as previous provider, first enabled provider.
4. Enabled default provider.
5. First enabled non-local provider.
6. Final fallback to default/local smoke.

#### Success Criteria

- Disabled provider is never selected as the current chat provider after save/add/disable.
- Deleting/replacing selected provider migrates safely.
- Tests cover these cases.

---

## Decisions

### Decision 1: Keep one model per `ProviderConfig`

- Why: Current architecture already uses one provider config per model. Changing persistence to nested `models[]` would broaden scope and migration risk.
- Alternatives: Add `models` array under provider.
- Tradeoffs: Multiple configs can duplicate base URL/header fields, but implementation is surgical and compatible.

### Decision 2: Add `providers.models` instead of overloading `providers.verify`

- Why: Settings needs model discovery independently from verify. A first-class RPC makes it reusable and testable.
- Alternatives: Return models from verify only.
- Tradeoffs: Adds one RPC, but keeps responsibilities clean.

### Decision 3: Unsupported model discovery is not fatal for compatible providers

- Why: Many OpenAI-compatible providers may not implement `/models`. Failing them would regress existing custom providers.
- Alternatives: Require all compatible providers to support `/models`.
- Tradeoffs: For unsupported providers, verify can only validate via smoke call, not authoritative model listing.

### Decision 4: `error` blocks verify before smoke call

- Why: User explicitly required verify to first pull provider-supported model list. Auth/network/server errors at that stage should be surfaced directly.
- Alternatives: Always fall back to smoke call.
- Tradeoffs: Stricter behavior may fail sooner, but avoids hiding model discovery/config problems.

### Decision 5: Reuse Provider Details for full model edit

- Why: Existing form already covers full provider config. A modal would duplicate logic.
- Alternatives: Inline model edit row or modal editor.
- Tradeoffs: User must understand that Edit loads the model into the details form; UI copy must make this clear.

---

## Open Issues

- [x] Confirm exact Anthropic `/v1/models` response shape and headers during implementation; use defensive parsing regardless.
- [x] Decide whether `providers.models` should use a short timeout distinct from normal run requests.
- [x] Decide exact UI trigger: explicit `Fetch models` only for first release, or explicit button plus opportunistic auto-fetch.
- [x] Confirm whether replacing model ID should delete old child-specific Keychain secret or leave it orphaned. Current recommendation: do not attempt automatic secret migration; avoid destructive secret delete during rename unless explicitly deleting the provider.

---

## TODO

### Reopen — Provider Fetch Completeness

- [x] Audit existing provider model listing implementations against real provider APIs.
- [x] Identify providers/presets whose model list fetch is only generic or missing.
- [x] Implement real model-list fetch paths for supported providers.
- [x] Add regression coverage proving the concrete provider endpoints are used.
- [x] Rerun relevant runtime/desktop/shared verification.

### Shared / RPC

- [x] Add `providers.models` to `RuntimeJsonRpcMethodSchema`.
- [x] Add `ProviderModelSchema`.
- [x] Add `ProviderModelsParamsSchema`.
- [x] Add `ProviderModelsResultSchema`.
- [x] Export new shared types.

### Runtime model discovery

- [x] Add `fetchProviderModels(config, options)` runtime entrypoint.
- [x] Implement OpenAI official model listing via `GET /v1/models`.
- [x] Implement OpenAI-compatible model listing via compatible `/models` endpoint.
- [x] Implement Anthropic official model listing via `GET /v1/models` with defensive parser.
- [x] Implement Anthropic-compatible model listing with unsupported/error classification.
- [x] Implement local smoke model listing.
- [x] Add `providers.models` JSON-RPC handler.

### Runtime verify

- [x] Update `verifyProviderConfig` to call `fetchProviderModels` before smoke call.
- [x] Reject missing model when list is authoritative.
- [x] Continue smoke call when list is unsupported.
- [x] Fail before smoke call when list returns error.
- [x] Add status details that explain listing outcome.

### Desktop client

- [x] Add `runtimeClient.listProviderModels(provider)`.
- [x] Add mock/browser fallback for `providers.models`.

### Settings UI

- [x] Add model listing UI state.
- [x] Add `Fetch models` action.
- [x] Merge fetched models with saved/draft/preset model IDs.
- [x] Show remote/unsupported/error/not-found labels.
- [x] Add Edit button to model rows.
- [x] Add editing model state.
- [x] Load saved model full config into Provider Details on Edit.
- [x] Save edited model full config.
- [x] Replace old provider record when model ID changes.

### Selection safety

- [x] Add explicit selection options to `upsertCustomProvider`.
- [x] Add explicit replacement/delete options to `deleteCustomProvider`.
- [x] Add provider selection helper.
- [x] Prevent disabled provider from becoming selected after add/save/disable.

### Tests

- [x] Shared schema/RPC tests for provider model listing.
- [x] Runtime adapter model listing tests.
- [x] Runtime verify ordering tests.
- [x] Desktop runtime client model listing tests.
- [x] Settings model option merge tests if feasible.
- [x] Provider selection helper tests.

---

## Retrospective

### Item 3

- Pitfall: Treating all OpenAI-compatible base URLs as unversioned roots can silently invent nonexistent `/v1/...` paths.
- Symptom: Provider fetch existed as a generic `/models` capability, but versioned compatible providers such as Gemini/Z.AI were resolved to `/v1beta/openai/v1/models` or `/api/paas/v4/v1/models` instead of the provider-documented base path.
- Root Cause: `resolveCompatibleProviderEndpoint()` only recognized base URLs ending exactly in `/v1`; it did not recognize `/v1beta/openai`, `/api/paas/v4`, or provider-specific roots such as DeepSeek.
- Reusable Guardrail: For each built-in provider preset, add endpoint-shape regression tests that assert the concrete URLs generated for both model listing and smoke calls.
- Evidence: Added runtime tests for DeepSeek, AiHubMix, Z.AI Coding Plan, and Google Gemini compatible model discovery.
- Scope: local_only
- Suggested Writeback Target: None for now.
- Status: local_only

### Item 1

- Pitfall: Planning can bury the provider model fetch requirement under broader Settings model edit work.
- Symptom: User noticed the方案 did not visibly foreground “provider should fetch supported models and verify should fetch first.”
- Root Cause: Initial plan mixed model editing and model discovery, making the required verify-before-smoke behavior insufficiently prominent.
- Reusable Guardrail: When a user corrects a requirement as “should,” promote it to a hard requirement section and add an explicit acceptance test proving it.
- Evidence: This task now has “Hard Requirements” and Phase 4 verify-order tests.
- Scope: local_only
- Suggested Writeback Target: None for now.
- Status: local_only

### Item 2

- Pitfall: Runtime/desktop packages consume `@ora/shared` through built `dist` declarations, not only `packages/shared/src`.
- Symptom: Shared typecheck passed, but runtime typecheck initially could not see newly exported provider model schemas/types.
- Root Cause: The shared source contract was updated without refreshing the shared build output used by downstream packages during typecheck.
- Reusable Guardrail: After changing shared public contracts, run `pnpm --filter @ora/shared build` before downstream runtime/desktop typechecks.
- Evidence: Runtime typecheck errors for missing `ProviderModelsParamsSchema`/`ProviderModelsResultSchema` disappeared after `pnpm --filter @ora/shared build`.
- Scope: promoted_to_skill
- Suggested Writeback Target: User-level skill `ora-shared-contract-change`.
- Status: promoted_to_skill

---

## Functional Verification

### Code Verification (Code Correctness)

- [x] Code compiles/runs without errors.
- [x] Unit tests pass.
- [x] Lint/type checks pass.

**Required commands after implementation:**

```bash
pnpm --filter @ora/runtime test
pnpm --filter @ora/runtime typecheck
pnpm --filter @ora/desktop test
pnpm --filter @ora/desktop typecheck
pnpm -r --if-present typecheck
```

### Functional Verification (Feature Works)

- [x] Official OpenAI valid key: Fetch models returns remote models; selecting a returned model verifies successfully.
- [x] Official OpenAI invalid model ID: verify fails before smoke call with “model not found in provider model list.”
- [x] Compatible provider without `/models`: model discovery returns unsupported; verify continues to smoke call.
- [x] Invalid key: model discovery returns error; verify does not run smoke call.
- [x] Settings Models list displays fetched remote models before preset suggestions.
- [x] Editing saved model loads full config into Provider Details.
- [x] Changing model ID replaces old provider record and preserves full config.
- [x] Add disabled model does not switch chat selection to disabled provider.
- [x] Disable selected model migrates selection away from disabled provider.

---

## Comparison

### Reference

- Current Settings provider/model implementation:
  - `apps/desktop/src/components/SettingsView.tsx`
  - `apps/desktop/src/lib/providerPresets.ts`
- Current runtime verify implementation:
  - `apps/runtime/src/providers/registry.ts`
- Current runtime provider adapters:
  - `apps/runtime/src/providers/openai.ts`
  - `apps/runtime/src/providers/openai-compatible.ts`
  - `apps/runtime/src/providers/anthropic.ts`
  - `apps/runtime/src/providers/anthropic-compatible.ts`

### Comparison Points

- [x] Current verify sends smoke prompt directly; new verify must fetch model list first.
- [x] Current Settings model list is static/local; new Settings should prefer fetched remote models.
- [x] Current `ModelProvider` interface lacks list capability; new runtime must expose model discovery.
- [x] Current upsert selects provider unconditionally; new flow must avoid selecting disabled providers.

### Findings

- Consistency: Preserve current one-model-per-provider-config architecture.
- Differences: Add model discovery and verify preflight before smoke call.
- Conclusion: The change is additive at the provider/RPC layer and surgical at Settings; no persistence migration needed.

---

## Checkpoints

### Checkpoint 1: Shared provider model discovery contract

- Requirement: `providers.models` RPC and provider model result schemas exist.
- Verification method: shared schema tests and typecheck.
- Status: [x] Pass / [ ] Fail
- Evidence: `packages/shared/src/rpc.ts` accepts `providers.models`; `packages/shared/src/providers.ts` exports model discovery schemas/types. `pnpm --filter @ora/shared test -- contracts.test.ts` passed 87 tests; workspace typecheck passed.

### Checkpoint 2: Runtime adapter model listing

- Requirement: All provider types return normalized `ProviderModelsResult`.
- Verification method: adapter tests with mocked fetch responses.
- Status: [x] Pass / [ ] Fail
- Evidence: Added `fetchProviderModels`; OpenAI, OpenAI-compatible, Anthropic, Anthropic-compatible, and local smoke adapters expose `listModels`; `provider-registry.test.ts` covers local smoke model listing and compatible discovery branches.

### Checkpoint 3: Verify fetches model list before smoke call

- Requirement: `verifyProviderConfig` always invokes model listing first.
- Verification method: unit tests with ordered mock calls.
- Status: [x] Pass / [ ] Fail
- Evidence: `provider-registry.test.ts` verifies ordered calls for model present, missing, unsupported, and error cases; missing/error cases assert smoke call is not reached.

### Checkpoint 4: Settings uses fetched models

- Requirement: Models list prioritizes fetched remote models and preserves custom/saved/draft models.
- Verification method: UI/state tests or manual verification.
- Status: [x] Pass / [ ] Fail
- Evidence: `SettingsView.tsx` adds `Fetch models`, remote result state, stale-key guard, and merge order: fetched models, draft, saved, preset fallback only when not authoritative.

### Checkpoint 5: Full model editing and safe replacement

- Requirement: Existing models can be edited as full configs; model ID rename replaces old record safely.
- Verification method: component/state tests or manual verification.
- Status: [x] Pass / [ ] Fail
- Evidence: `SettingsView.tsx` adds row-level Edit, loads saved provider config via `createDraftFromProvider`, saves full draft fields, upserts the new provider before deleting the old record when model ID changes.

### Checkpoint 6: Disabled provider selection safety

- Requirement: add/save/disable never leaves chat selected provider pointing to disabled provider.
- Verification method: provider selection helper tests and manual Settings flow.
- Status: [x] Pass / [ ] Fail
- Evidence: Added `apps/desktop/src/lib/providerSelection.ts`; `state.test.ts` verifies disabled providers are not selected after registry updates or explicit selection attempts; `useRunActions.ts` supports explicit select/replacement/delete options.

**All checkpoints must pass before marking task DONE.**

---

## Verification

### Evidence Requirements

- [x] Code Verification output pasted here.
- [x] Functional Verification output pasted here.
- [x] Retrospective reviewed.
- [x] Checkpoints evidence pasted here.

### Environment

- Workspace: `/Users/quintenchen/developer/ora`
- OS: macOS / Darwin
- Package manager: pnpm 10.11.0
- Node: 22.17.0

### Commands run + outputs

- Reopen verification:
  - `pnpm --filter @ora/runtime test -- provider-registry.test.ts` — PASS; Vitest ran runtime suite, 20 files passed, 278 tests passed.
  - `pnpm --filter @ora/desktop test -- runtimeClient.test.ts` — PASS; 12 files passed, 85 tests passed.
  - `pnpm --filter @ora/shared test -- contracts.test.ts` — PASS; 88 tests passed.
  - `pnpm --filter @ora/runtime typecheck` — FAIL on unrelated existing/shared-mode changes in `apps/runtime/src/patterns/driver-registry.ts` (`ModeStageSpec`, `stages`, `transcriptLayout`, `layout`). No provider fetch files were named by TypeScript.
- Reopen root cause:
  - `apps/runtime/src/providers/provider-utils.ts` inserted `/v1` for any compatible `baseUrl` not ending exactly in `/v1`, so existing presets with versioned paths resolved to wrong model list URLs.
  - `apps/runtime/src/providers/openai-compatible.ts` used that generic model-list URL for every provider and did not parse provider catalog shapes using `model_id`.
- Reopen fix:
  - `resolveCompatibleProviderEndpoint()` now treats versioned path endings like `/v4`, `/v1beta`, and `/v1beta/openai` as already-versioned compatible bases.
  - OpenAI-compatible model listing now uses provider-specific model endpoints for DeepSeek (`/models`) and AiHubMix (`/api/v1/models?type=llm`) and parses `model_id`/`display_name`/`provider`.
  - Regression tests assert concrete model-list URLs for DeepSeek, AiHubMix, Z.AI Coding Plan, and Google Gemini.
- `pnpm --filter @ora/shared test -- contracts.test.ts`
  - Result: PASS — 1 test file passed, 87 tests passed.
- `pnpm --filter @ora/runtime test -- provider-registry.test.ts`
  - Initial result: FAIL — existing expectation required `Connection verified.` while verify now reports unsupported discovery when mock `/models` body is unparseable.
  - Fix: updated the existing test mock to return `/models` data before smoke response.
  - Rerun result: PASS — runtime targeted run passed all provider-registry coverage; full runtime run below passed.
- `pnpm --filter @ora/desktop test -- runtimeClient.test.ts state.test.ts`
  - Initial result: FAIL — desktop local JSON-RPC fallback did not implement `providers.models`.
  - Fix: added `providers.models` fallback case returning normalized mock provider models.
  - Rerun result: PASS — 12 test files passed, 83 tests passed.
- Required final verification:
  - `pnpm --filter @ora/runtime test` — PASS, 20 test files passed, 273 tests passed.
  - `pnpm --filter @ora/runtime typecheck` — PASS.
  - `pnpm --filter @ora/desktop test` — PASS, 12 test files passed, 83 tests passed.
  - `pnpm --filter @ora/desktop typecheck` — PASS.
  - `pnpm -r --if-present typecheck` — PASS, shared/runtime/desktop typechecks passed.
- Additional shared build:
  - `pnpm --filter @ora/shared build` — PASS, refreshed shared package dist outputs so runtime/desktop typechecks could consume the new exported contract.

### TODO scan output

Command: `bash "$HOME/.workbuddy/skills/long-task-protocol/scripts/todo_scan.sh"`

Output summary: scan completed; remaining matches are unrelated pre-existing/template/generated TODOs under `.ora/skills/private/think/SKILL.md`, `.workbuddy/memory/*.md`, `skills/skill-creator/scripts/init_skill.py`, runtime-sidecar generated bundles, and binary/runtime DB matches. Target task checklist now has no open `- [ ]` entries.

### Changed files for this task

- `packages/shared/src/rpc.ts`
- `packages/shared/src/providers.ts`
- `packages/shared/test/contracts.test.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/src/providers/types.ts`
- `apps/runtime/src/providers/registry.ts`
- `apps/runtime/src/providers/provider-utils.ts`
- `apps/runtime/src/providers/openai.ts`
- `apps/runtime/src/providers/openai-compatible.ts`
- `apps/runtime/src/providers/anthropic.ts`
- `apps/runtime/src/providers/anthropic-compatible.ts`
- `apps/runtime/src/providers/local-smoke.ts`
- `apps/runtime/src/providers/index.ts`
- `apps/runtime/test/providers/provider-registry.test.ts`
- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/lib/runtimeClient.test.ts`
- `apps/desktop/src/lib/useRunActions.ts`
- `apps/desktop/src/lib/state.tsx`
- `apps/desktop/src/lib/state.test.ts`
- `apps/desktop/src/lib/providerSelection.ts`
- `apps/desktop/src/components/SettingsView.tsx`
- `tasks/TASK-20260430-1801-provider-models-fetch-verify-edit.md`

### Functional evidence

- Runtime verify ordering is proven by tests that assert exact fetch URL order: `/models` before `/chat/completions`; missing-model and discovery-error cases assert only `/models` is called.
- Settings now has an explicit `Fetch models` action and displays authoritative remote, unsupported, error, saved disabled, enabled, and not-in-provider-list labels.
- Saved model Edit loads a full provider draft using `createDraftFromProvider`; saving a renamed model upserts the new provider first, then deletes the old provider without deleting the old secret.
- Disabled providers are guarded at reducer level and action level; explicit selection of a disabled provider falls back to an enabled provider.

---

## Progress Log

- 2026-04-30 21:37 CST - Root cause found and patched: compatible provider endpoint resolution only understood `/v1`, so built-in versioned/provider-specific bases could produce fake `/v1/models` paths. Fixed versioned-base detection, added DeepSeek and AiHubMix model-list overrides plus broader model parser support, and added URL regression tests. Verification passed for runtime tests, desktop tests, and shared contracts; runtime typecheck is blocked by unrelated dirty mode-driver changes.
  Next: 1) Hand off concise summary; 2) Keep unrelated typecheck failures out of this provider-fetch patch; 3) If desired later, add live-key smoke checks per provider.
- 2026-04-30 21:29 CST - Reopened after user report that the provider fetch capability was not actually complete: existing code may expose a unified interface but not truly discover model-list APIs for every provider in the preset list.
  Next: 1) Audit current adapter and preset/provider coverage against official model-list APIs; 2) State a root cause with file/function evidence before editing code; 3) Patch concrete fetch implementations and add regression tests.
- 2026-04-30 18:01 GMT+8 - Created authoritative task journal for provider model discovery, verify preflight, Settings model list integration, full model editing, safe replacement, and selection safety.
  Next: 1) Implement shared `providers.models` schema/RPC; 2) Implement runtime `fetchProviderModels` and verify preflight; 3) Wire desktop Settings to fetch/display/edit models.
- 2026-04-30 18:31 GMT+8 - Implemented provider model discovery end-to-end: shared schemas/RPC method, runtime adapter `listModels` implementations, `fetchProviderModels`, `providers.models`, verify preflight before smoke call, desktop runtime client method, Settings `Fetch models` UI, full model edit/save/rename replacement, and disabled-provider selection safety. Verification passed: shared targeted contracts test, runtime full test/typecheck, desktop full test/typecheck, and workspace recursive typecheck.
  Next: 1) Hand off summary to user; 2) Preserve residual risk that real provider `/models` behavior still depends on provider-side API compatibility; 3) Avoid automatic Keychain secret migration/deletion on model rename unless a future safe secret-copy API exists.

---

## Compressed State (<= 20 lines)

- Status: Resolved with caveat on 2026-04-30 21:37 CST; provider fetch endpoint coverage fixed, unrelated runtime typecheck errors remain.
- Root cause: `resolveCompatibleProviderEndpoint()` only recognized `/v1` and inserted fake `/v1` segments for versioned compatible bases like `/v1beta/openai`, `/api/paas/v4`, and `/api/coding/paas/v4`.
- Fix: versioned compatible base paths now append provider paths directly; DeepSeek model listing uses `/models`; AiHubMix model listing uses `/api/v1/models?type=llm`.
- Parser fix: OpenAI-compatible model discovery now accepts `model_id`, `modelId`, `display_name`, `displayName`, `ownedBy`, and `provider`.
- Tests: runtime suite passed 278 tests; desktop suite passed 85 tests; shared contracts passed 88 tests.
- Caveat: `pnpm --filter @ora/runtime typecheck` fails in unrelated `apps/runtime/src/patterns/driver-registry.ts` mode layout changes already present in the dirty tree.
- Shared: `providers.models`, `ProviderModelSchema`, `ProviderModelsParamsSchema`, `ProviderModelsResultSchema` added and tested.
- Runtime: `fetchProviderModels(config, options)` added; OpenAI/Anthropic official call `/v1/models`; compatible providers call `/models`; local smoke returns `smoke-model`.
- Verify: authoritative ok rejects missing model IDs before smoke; unsupported continues smoke; error fails before smoke.
- Desktop client: `runtimeClient.listProviderModels(provider)` added with local JSON-RPC/browser fallback.
- Settings: explicit `Fetch models`; fetched authoritative models lead option list; draft/saved IDs remain visible with markers; preset is fallback.
- Editing: model row Edit loads full saved `ProviderConfig` into Provider Details form.
- Rename: save new provider first, delete old provider second, migrate selection only if new provider enabled; no automatic secret deletion during rename.
- Selection: `providerSelection.ts`, reducer guard, and action options prevent disabled providers becoming selected.
- Verification: shared targeted contracts test passed; runtime full tests 273 passed; desktop full tests 83 passed; runtime/desktop/workspace typechecks passed.
- Residual risk: real provider `/models` API quirks may need provider-specific parser tweaks after live-key manual testing.
