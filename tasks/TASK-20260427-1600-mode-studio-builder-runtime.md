# TASK-20260427-1600-mode-studio-builder-runtime

**Created:** 2026-04-27 16:00 CST
**Status:** Done

---

## Goal
- Upgrade Mode Studio natural-language mode generation from a mostly stateless heuristic draft helper into an Ora runtime-backed builder run.
- Builder generate/refine should preserve multi-turn context, current canvas edits, prior draft bundle, validation feedback, available modes/agents/tools/skills/atoms, and return a complete validated `ModeStudioDraftBundle`.
- Persist no generated mode or agent until explicit Apply.

## Scope / Out of scope
- In scope:
  - Shared contracts for Mode Studio builder run start/result and mode visibility.
  - Runtime JSON-RPC methods for starting a builder run and reading its structured result.
  - Internal runtime builder path using Ora run state/events and provider-backed strict JSON generation with repair/fallback.
  - Desktop Mode Studio builder panel migration to start/stream/read builder runs, then hydrate the existing canvas draft.
  - Targeted shared/runtime/desktop verification.
- Out of scope:
  - Replacing `ModeSpec` as the mode source of truth.
  - Refactoring the Mode Studio canvas or inspector model.
  - Changing Apply persistence semantics.
  - Exposing the internal builder mode in normal chat mode selection.

## Constraints
- Keep changes surgical and aligned with existing shared/runtime/desktop RPC layering.
- Use `ModeSpec` and `ModeStudioDraftBundle` as the durable draft/apply contract.
- Internal builder mode must be hidden from user-facing mode lists/gallery by default.
- Existing `generateDraft/refineDraft` RPCs remain available as compatibility wrappers.

## Plan
1. Shared contracts
   - Add `ModeSpec.visibility` defaulting to `user`.
   - Add builder run start/result schemas and JSON-RPC methods.
   - Add contract coverage for visibility and new RPC payloads.
2. Runtime
   - Add hidden internal `mode_studio_builder` mode.
   - Implement start-builder-run/result methods with provider JSON generation, repair, validation, and local-smoke fallback.
   - Preserve current draft/manual edits and previous bundle during refine.
3. Desktop
   - Add runtime client methods and mock behavior.
   - Change `ModesView` builder submit flow to start a runtime-backed builder run, stream/read result, hydrate draft, and show run status/trails entry.
4. Verification
   - Run shared contracts, runtime builder tests, runtime typecheck, desktop typecheck, and a browser smoke if practical.

## Active Files
- `tasks/TASK-20260427-1600-mode-studio-builder-runtime.md`
- `packages/shared/src/primitives.ts`
- `packages/shared/src/modes.ts`
- `packages/shared/src/rpc.ts`
- `packages/shared/src/mode-studio-builder.ts`
- `packages/shared/test/contracts.test.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/test/mode-studio-builder.test.ts`
- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/components/ModesView.tsx`

## Decisions
- Decision: Use the existing Ora run persistence/event stream as the builder run substrate.
  - Why: User explicitly selected "接入主运行态"; this makes builder progress and result inspectable like other runs.
  - Tradeoff: Larger shared/runtime/desktop surface than strengthening the old stateless RPC.
- Decision: Keep Apply as the only persistent write boundary.
  - Why: Builder generation should be reversible and previewable; mode/agent stores should only change after user confirmation.
- Decision: Hide the internal builder mode using `ModeSpec.visibility`.
  - Why: Runtime needs a real mode-like execution profile without polluting normal mode selection.

## Progress Log
- 2026-04-27 16:00 CST - Created task journal and locked implementation scope.
  Next: Patch shared contracts; implement runtime builder run; migrate desktop builder flow.
- 2026-04-27 16:12 CST - Implemented shared visibility and builder-run contracts, hidden internal `mode_studio_builder` mode, runtime JSON-RPC handlers, provider JSON+repair builder result path, and desktop builder flow migration.
  Next: Run shared/runtime/desktop verification and fix type/test failures.
- 2026-04-27 16:17 CST - Fixed shared schema import, internal-mode test expectations, runtime create-param visibility propagation, and mock desktop client support. Shared contracts, shared build, runtime builder tests, runtime typecheck, and desktop typecheck now pass.
  Next: Record verification evidence and close.
- 2026-04-27 16:20 CST - Matched Agents draft behavior by passing the selected provider/providerConfig/modelRef from Mode Studio into builder runs, then re-ran desktop typecheck and runtime builder tests successfully.
  Next: Final diff check and report.

## Open Issues
- None yet.

## TODO
- [x] Patch shared contracts and tests.
- [x] Patch runtime builder run and tests.
- [x] Patch desktop client/UI and mock.
- [x] Run verification commands.
- [x] Record retrospective and final evidence.

## Retrospective
- Item 1
  - Pitfall: Adding a hidden internal mode changes assumptions in tests and UI lists that previously treated all `MVP_MODES` as user-facing.
  - Symptom: Contract tests failed on fixed mode counts and array-index lookups after inserting `mode_studio_builder`.
  - Root Cause: Older tests used positional assumptions instead of selecting modes by id or filtering by visibility.
  - Reusable Guardrail: Any future internal mode/capability should add an explicit visibility/source field and update user-facing lists/tests to filter by that field.
  - Evidence: `contracts.test.ts` failed on `MVP_MODES[5]` message-bus topology and bootstrap mode count until changed to id/visibility checks.
  - Scope: Mode Studio, runtime bootstrap, mode picker/gallery tests.
  - Suggested Writeback Target: None yet; keep local unless more hidden runtime modes are added.
  - Status: local_only

## Functional Verification
- Shared contract verification passed.
- Runtime builder behavior verification passed.
- Runtime and desktop typechecks passed.
- Vite dev server smoke: port `1420` was already serving HTTP 200; a new dev server could not start because the port was in use. No full browser interaction smoke was run in this turn.

## Comparison
- Reference: existing Mode Studio guided builder v1 and existing `agents.generateDraft` provider JSON + repair path.
- Expected consistency:
  - Keep draft/apply schemas stable.
  - Reuse provider invocation and validation patterns.
  - Use runtime run/stream/trail primitives for inspectability.

## Checkpoints
- Checkpoint 1: Shared contracts parse old and new mode/draft payloads.
  - Verification method: `pnpm --filter @ora/shared test -- contracts.test.ts`.
  - Status: Pass.
- Checkpoint 2: Builder generate/refine runs return validated bundles without persisting mode/agent before Apply.
  - Verification method: `pnpm --filter @ora/runtime exec vitest run test/mode-studio-builder.test.ts`.
  - Status: Pass.
- Checkpoint 3: Desktop Mode Studio uses builder run APIs and typechecks.
  - Verification method: `pnpm --filter @ora/desktop typecheck`.
  - Status: Pass.

## Compressed State (<= 20 lines)
- Objective: Runtime-backed Mode Studio builder run with multi-turn context and Apply-only persistence.
- Status: Done.
- Active files: shared mode/rpc/builder contracts, runtime run-store/json-rpc/test, desktop runtimeClient/ModesView.
- Implemented: hidden internal `mode_studio_builder`, `ModeSpec.visibility`, builder-run/result RPCs, provider strict JSON+repair result flow, desktop selected-provider start/result/hydrate flow.
- Verification: shared contracts/build, runtime builder tests/typecheck, desktop typecheck passed.
- Residual risk: full interactive browser smoke was not run; only HTTP server availability was checked.

## Verification
### Commands run + outputs
- `pnpm --filter @ora/shared test -- contracts.test.ts`: passed, `80 tests`.
- `pnpm --filter @ora/shared build`: passed.
- `pnpm --filter @ora/runtime exec vitest run test/mode-studio-builder.test.ts`: passed, `6 tests`.
- `pnpm --filter @ora/runtime typecheck`: passed.
- `pnpm --filter @ora/desktop typecheck`: passed, re-run after selected provider wiring also passed.
- `git diff --check`: passed.
- `curl -I --max-time 3 http://127.0.0.1:1420/`: returned `HTTP/1.1 200 OK`.

### TODO gate
- Long-task protocol script output:
  - `Result: PASS`
  - Note: the bundled script resolved the latest Quantfox task path, not this Ora task path.
- Local direct scan over changed source/test files:
  - `rg -n "TODO|FIXME" ...`: no matches.

### Changed files
- `packages/shared/src/primitives.ts`
- `packages/shared/src/modes.ts`
- `packages/shared/src/rpc.ts`
- `packages/shared/src/mode-studio-builder.ts`
- `packages/shared/test/contracts.test.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/test/mode-studio-builder.test.ts`
- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/components/ModesView.tsx`
- `tasks/TASK-20260427-1600-mode-studio-builder-runtime.md`

### Functional evidence
- Runtime builder tests cover:
  - provider-backed generate returning validated draft without persisting mode/agent before Apply;
  - refine preserving current draft manual prompt edits while applying new provider label;
  - invalid provider JSON repaired into a valid builder result;
  - existing Apply-only persistence behavior.
