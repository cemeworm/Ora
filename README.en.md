# Ora

[简体中文](README.md) | English

Ora is a desktop AI workbench. It puts modes, agents, skills, and model providers in one place, so you can choose how a task should run before handing it to the right agent setup.

The project is still early. It is built for people who want to organize local AI workflows, inspect multi-agent runs, connect different model providers, and experiment with message-channel driven automation.

## What Ora Is For

Most AI tools push every task into the same chat box. Ora treats work as something you can route. A task can run through a single agent, a generator-verifier loop, an orchestrator with subagents, an agent team, or a custom topology you draw yourself.

For users, Ora cuts down the switching between chat apps, coding tools, model dashboards, and project context. For developers, it gives multi-agent workflows a runtime you can inspect, tune, replay, and evaluate.

## Core Capabilities

- Composable workflows: choose a coordination mode, then pair it with agents and skills.
- Visual orchestration: use generator-verifier, orchestrator-subagent, agent-team presets, or design your own nodes and edges.
- Model provider support: OpenAI, Anthropic, OpenRouter, OpenAI-compatible APIs, and Anthropic-compatible APIs.
- Run history: state, events, checkpoints, and trails make each run easier to inspect.
- Permissions and approvals: tool calls are grouped by risk, with default, read-only, and full-trust policies.
- Self-iteration: Ora analyzes runs and project signals, then proposes reviewable improvements.
- Message channels: the runtime includes adapters for HTTP webhook, Slack, Feishu, WeChat, WeCom, Telegram, Discord, and DingTalk.
- Local desktop runtime: Tauri owns the desktop shell, React owns the workbench UI, and a TypeScript sidecar runs the agent system.

## Architecture

```text
.
├── apps
│   ├── desktop          # Tauri + React + Vite desktop app
│   └── runtime          # TypeScript runtime sidecar
├── packages
│   └── shared           # Shared types, schemas, modes, capabilities, and RPC contracts
├── scripts              # Local development, build, and version scripts
├── skills               # Ora skill directory
└── tasks                # Project task records
```

The desktop app starts the runtime as a Tauri sidecar. The frontend and sidecar communicate through the JSON-RPC contracts in `packages/shared`. The runtime handles model calls, tool execution, channel events, persistence, evaluation, and tracing.

## Quick Start

Install the required tools first:

- Node.js
- pnpm 10.11.0
- Rust and Cargo, required by Tauri local builds

Install dependencies:

```bash
pnpm install
```

Start the desktop development app:

```bash
pnpm dev:desktop
```

This script cleans up stale Ora development processes, installs dependencies when needed, packages the runtime sidecar, and starts Tauri dev.

Start only the Vite frontend:

```bash
pnpm dev
```

Start only the runtime:

```bash
pnpm dev:runtime
```

Run the runtime smoke check:

```bash
pnpm --filter @ora/runtime smoke
```

## Model Setup

The onboarding flow asks you to choose a model provider the first time you open Ora. You can start with a free provider option such as OpenRouter, or add your own API key for OpenAI, Anthropic, or a compatible provider.

You can configure API keys inside the app. Optional search and Langfuse tracing settings are documented in `.env.example`; export the ones you need in your shell:

```bash
ORA_LANGFUSE_ENABLED=false
ORA_SEARCH_PROVIDER=brave
BRAVE_SEARCH_API_KEY=...
```

If you use a custom provider base URL, the runtime requires an explicit opt-in:

```bash
ORA_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true
```

## Common Commands

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm lint
pnpm version:check
```

Build the desktop app:

```bash
./scripts/build-desktop.sh
```

Build artifacts are written under `apps/desktop/src-tauri/target/release/bundle`.

## Development Notes

- `apps/desktop` owns the UI, settings, onboarding, workbench state, and Tauri command calls.
- `apps/runtime` owns run orchestration, provider registry, channel service, search providers, evaluation, memory, feedback loops, and persistence.
- `packages/shared` is the protocol boundary between the frontend and runtime. Add cross-process schemas and types there first.
- `scripts/dev-desktop.sh` packages the runtime sidecar and checks the Langfuse resource bundle.
- `.ora/runtime.db` is the default local runtime store. Set `ORA_RUNTIME_STORE_DIR` to override it.

## Project Status

Ora is best treated as a local development and internal testing project for now. The capabilities listed here come from the current repository, and some integrations still require API keys, external services, or more product work before they feel ready for general use.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
