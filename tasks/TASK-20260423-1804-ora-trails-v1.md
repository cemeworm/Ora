# TASK-20260423-1804-ora-trails-v1

**Created:** 2026-04-23 18:04 CST
**Status:** Done

## Goal
- Implement Trails v1 for Ora chat runs by upgrading the current right-side Details surface into a Trails workbench backed by local runtime state plus Langfuse trace metadata.

## Scope
- Shared contracts for run trace metadata, trail observations/generations, live KPI summaries, and `runs.trail`.
- Runtime Langfuse trace/generation ref capture plus structured degradation when Langfuse is unavailable.
- Desktop refactor from `Details` to `Trails` for the chat view only, including async trace loading and `Open in Langfuse`.
- Browser mock and Rust fallback parity for local desktop usage.

## Decisions
- Keep Trails hybrid and Ora-native for the primary experience: local snapshot/event/topology is the fast path, Langfuse is the deep-drill layer.
- In test mode, keep local trace synthesis enabled but skip exporter startup so runtime tests do not require a live Langfuse endpoint.

## Progress Log
- 2026-04-23 18:09 CST - Scoped Trails to chat-only and confirmed the repo already had unrelated in-flight changes; kept the change set surgical.
- 2026-04-23 18:32 CST - Implemented shared/runtime/Desktop/Tauri Trails v1 end to end. `runs.trail` now exists across shared/runtime/fallback layers, chat `Details` became `Trails`, desktop can open a Langfuse trace URL through Tauri, and package-scoped tests/builds pass.

## Retrospective
### Item 1
- Pitfall: Langfuse-enabled runtime tests tried to boot the OTLP exporter even when the test only needed local synthesized traces.
- Symptom: `apps/runtime/test/runtime-integration.test.ts` failed with `OTLPExporterError: Not Found`.
- Root Cause: `initLangfuseTelemetry()` always started the NodeSDK exporter whenever tracing was enabled.
- Reusable Guardrail: In test mode, keep tracing logic enabled for metadata synthesis but skip exporter startup unless the test explicitly covers network export.
- Evidence: `apps/runtime/src/telemetry/langfuse.ts`; `pnpm --filter @ora/runtime test`
- Status: candidate_for_skill

## Verification
### Code Verification
- `pnpm --filter @ora/shared test` -> passed (`56` tests)
- `pnpm --filter @ora/runtime test` -> passed (`56` tests)
- `pnpm --filter @ora/runtime build` -> passed
- `pnpm --filter @ora/desktop typecheck` -> passed
- `pnpm --filter @ora/desktop build` -> passed
- `cargo check` in `apps/desktop/src-tauri` -> passed

### Functional Verification
- Shared contracts now validate `RunTrailParams`, `RunTraceMetadata`, turn-level trace metadata, and `RunTrail`.
- Runtime integration tests cover `runs.trail` with Langfuse disabled and with remote Langfuse fetch unavailable, confirming graceful degradation and locally synthesized observations.
- Desktop build/typecheck passes with the new `TrailsDrawer`/`TrailsTabs`, async `runs.trail` loading, and host/browser `Open in Langfuse` wiring.
- Tauri compile check passes with `open_external_url` plus `runs.trail` fallback support.
- Manual interactive verification in a launched desktop shell was not run in this turn, so the exact click-through behavior for `Open in Langfuse` remains code-verified rather than manually exercised.

## Checkpoints
### Checkpoint 1: Shared/runtime Trail contract
- Status: Pass
- Evidence: `pnpm --filter @ora/shared test`; `pnpm --filter @ora/runtime test`

### Checkpoint 2: Desktop Trails workbench
- Status: Pass
- Evidence: `pnpm --filter @ora/desktop typecheck`; `pnpm --filter @ora/desktop build`; `cargo check`

## Outcome
- Trails v1 is implemented for chat runs only.
- `runs.trail` ships from shared/runtime through browser/Tauri fallbacks.
- Desktop now renders `Live`, `Timeline`, `Topology`, and `Trace` tabs and can open Langfuse trace URLs through the host.
