# Local Langfuse

Ora runtime can export local run traces and model generations to Langfuse. In the packaged Mac app, Ora should manage this service and its bootstrap credentials internally; users should not create projects or copy API keys by hand.

## Start Langfuse locally

Ora ships a managed Docker Compose project at `infra/observability/langfuse/docker-compose.yml`. The desktop packaging step stages this file into `apps/desktop/src-tauri/resources/langfuse/`, and Tauri bundles it into `Ora.app/Contents/Resources/langfuse/`.

For local development, you can run the same managed bundle directly:

```sh
cd infra/observability/langfuse
docker compose --project-name ora-langfuse up -d
```

Langfuse will create the local organization, project, user, and API keys on startup via `LANGFUSE_INIT_*` variables.

For desktop development, the normal sidecar packaging step stages the managed compose file automatically:

```sh
pnpm --filter @ora/runtime package:sidecar
pnpm --filter @ora/desktop tauri dev
```

If a different startup path is needed, set `ORA_MANAGED_LANGFUSE_COMMAND` to a background-safe command that starts Langfuse. To opt out of managed startup entirely, set `ORA_MANAGED_LANGFUSE_SERVICE=false`.

## Point Ora at Managed Langfuse

For development, enable tracing with the same managed runtime environment:

```sh
ORA_LANGFUSE_ENABLED=true
LANGFUSE_BASE_URL=http://localhost:3000
LANGFUSE_PUBLIC_KEY=lf_pk_ora_local_runtime
LANGFUSE_SECRET_KEY=lf_sk_ora_local_runtime
```

If `ORA_LANGFUSE_ENABLED=true` is set without explicit keys, Ora runtime falls back to these managed local keys.

Run the runtime as usual:

```sh
pnpm --filter @ora/runtime smoke
```

For short-lived local scripts, use:

```sh
ORA_LANGFUSE_EXPORT_MODE=immediate pnpm --filter @ora/runtime smoke
```

## What gets traced

- Deterministic Ora runs are exported as an `agent` trace with child observations for run events.
- LangGraph-enabled runs are exported as an active `agent` trace.
- Provider calls inside LangGraph runs are exported as Langfuse `generation` observations.

Set `ORA_LANGGRAPH_ENABLED=true` to see real LangGraph/provider call nesting.

## Packaging Contract

The Mac app should:

1. Start the local Langfuse service before enabling tracing.
2. Pass `managedLangfuseBootstrapEnv()` to Langfuse on first boot so resources are created automatically.
3. Pass `managedLangfuseRuntimeEnv()` to Ora runtime.
4. Open the embedded/local Langfuse UI directly from Ora when the user asks to inspect traces.

This preserves Langfuse's project-level authentication while keeping it invisible to the user.
