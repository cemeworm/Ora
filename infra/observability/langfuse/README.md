# Optional Local Langfuse

Ora Trails is local-first. The packaged Mac app records run trajectory, timeline, topology, tool calls, model-call summaries, approvals, and status from Ora runtime without Docker or Langfuse. Ordinary users do not need to install Docker, start Compose, create Langfuse projects, or copy API keys.

Langfuse remains an optional developer/operator workbench for deeper trace inspection. Enable it only when a compatible local or remote Langfuse service is explicitly available.

## Start Langfuse locally for development

Ora ships a managed Docker Compose project at `infra/observability/langfuse/docker-compose.yml`. The desktop packaging step can stage this file into `apps/desktop/src-tauri/resources/langfuse/`, and Tauri can bundle it into `Ora.app/Contents/Resources/langfuse/`. This resource is optional; the app must not require a host Docker CLI for Trails.

For local development, you can run the same managed bundle directly:

```sh
cd infra/observability/langfuse
docker compose --project-name ora-langfuse up -d
```

Langfuse will create the local organization, project, user, and API keys on startup via `LANGFUSE_INIT_*` variables.

For desktop development, the normal sidecar packaging step stages the managed compose file:

```sh
pnpm --filter @ora/runtime package:sidecar
pnpm --filter @ora/desktop tauri dev
```

Packaged and desktop startup will not auto-spawn Docker Compose by default. To explicitly request managed startup, set `ORA_MANAGED_LANGFUSE_SERVICE=true`. If a different startup path is needed, set `ORA_MANAGED_LANGFUSE_COMMAND` to a background-safe command that starts Langfuse. To force opt-out, set `ORA_MANAGED_LANGFUSE_SERVICE=false`.

## Point Ora at Managed Langfuse

For development, enable Langfuse tracing with the same managed runtime environment:

```sh
ORA_LANGFUSE_ENABLED=true
LANGFUSE_BASE_URL=http://localhost:3000
LANGFUSE_PUBLIC_KEY=lf_pk_ora_local_runtime
LANGFUSE_SECRET_KEY=lf_sk_ora_local_runtime
```

If `ORA_LANGFUSE_ENABLED=true` is set without explicit keys, Ora runtime falls back to these managed local keys. When Langfuse is not enabled, `runs.trail` still returns Ora-native local Trails data.

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

1. Serve Ora-native Trails from local runtime state with no Docker or Langfuse dependency.
2. Treat missing Docker as an optional integration diagnostic, not a runtime failure.
3. Start local Langfuse only when explicitly requested by developer/operator configuration.
4. Pass `managedLangfuseBootstrapEnv()` and `managedLangfuseRuntimeEnv()` only for that explicit managed Langfuse path.
5. Open Langfuse only when a Langfuse trace URL is actually attached to the run.

This preserves Langfuse's project-level authentication while keeping the ordinary Trails product native to Ora.
