# Ora

[中文](#中文) | [English](#english)

## 中文

Ora 是一个桌面端 AI 工作台。它把模式、智能体、技能和模型服务提供方放在同一个工作界面里，让你先选合适的跑法，再把任务交给合适的智能体完成。

当前项目仍在早期开发阶段，主要面向想在本地组织 AI 工作流、调试多智能体协作、接入不同模型服务和消息渠道的用户与开发者。

### Ora 解决什么问题

很多 AI 工具把所有任务都塞进同一个聊天框。Ora 的思路更接近一个工作台：同一个任务可以用单智能体、生成-验证、编排调度、团队协作等不同模式来跑；每个模式可以搭配不同的智能体、技能和权限策略。

对普通用户来说，Ora 希望减少在聊天工具、代码工具、模型控制台和项目上下文之间来回切换的成本。对开发者来说，Ora 提供一个可以观察、调整和复盘的运行时，让多智能体工作流不只停留在 prompt 里。

### 核心能力

- 组合式工作流：按任务选择协调模式，再搭配智能体和技能。
- 可视化编排：支持生成-验证、编排调度、团队协作等拓扑，也可以自己设计节点和连线。
- 多模型提供方：内置 OpenAI、Anthropic、OpenRouter，以及 OpenAI-compatible 和 Anthropic-compatible 服务配置。
- 运行记录与复盘：保留 run state、events、checkpoints、trails，方便查看任务如何推进。
- 权限与审批：把工具调用按风险分层，支持默认策略、只读策略和完全信任策略。
- 自我迭代：分析运行记录和项目线索，提出可审阅的改进建议。
- 多渠道入口：运行时已经包含 HTTP webhook、Slack、飞书、微信、企业微信、Telegram、Discord、钉钉等 channel adapter。
- 本地优先的桌面体验：Tauri 桌面壳负责应用窗口和 sidecar，React 前端负责工作台界面，TypeScript runtime 负责执行。

### 技术结构

```text
.
├── apps
│   ├── desktop          # Tauri + React + Vite 桌面端
│   └── runtime          # TypeScript runtime sidecar
├── packages
│   └── shared           # 跨端共享的类型、schema、模式、能力和 RPC 定义
├── scripts              # 本地开发、构建和版本同步脚本
├── skills               # Ora 技能目录
└── tasks                # 项目任务记录
```

桌面端通过 Tauri 启动 runtime sidecar。前端和 sidecar 之间使用 shared 包里的 JSON-RPC 合约通信，运行时负责模型调用、工具执行、channel 事件、存储、评测和 trace。

### 快速开始

先准备这些工具：

- Node.js
- pnpm 10.11.0
- Rust 和 Cargo，Tauri 本地构建需要

安装依赖：

```bash
pnpm install
```

启动桌面开发环境：

```bash
pnpm dev:desktop
```

这个脚本会清理旧的 Ora 开发进程，按需安装依赖，打包 runtime sidecar，然后启动 Tauri dev。

只启动 Vite 前端：

```bash
pnpm dev
```

只启动 runtime：

```bash
pnpm dev:runtime
```

运行 runtime smoke：

```bash
pnpm --filter @ora/runtime smoke
```

### 配置模型

第一次打开 Ora 时，onboarding 会引导你选择模型服务提供方。你可以从 OpenRouter 等免费模型入口开始，也可以填入自己的 OpenAI、Anthropic 或兼容服务 API key。

API key 可以在应用内配置。搜索和 Langfuse trace 这类可选能力可以参考 `.env.example`，按需在 shell 环境里设置：

```bash
ORA_LANGFUSE_ENABLED=false
ORA_SEARCH_PROVIDER=brave
BRAVE_SEARCH_API_KEY=...
```

如果要使用自定义 provider base URL，runtime 会要求显式设置：

```bash
ORA_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true
```

### 常用命令

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm lint
pnpm version:check
```

构建桌面应用：

```bash
./scripts/build-desktop.sh
```

构建完成后，产物会出现在 `apps/desktop/src-tauri/target/release/bundle` 下。

### 开发说明

- `apps/desktop` 负责界面、设置、onboarding、工作台状态展示和 Tauri 命令调用。
- `apps/runtime` 负责 run orchestration、provider registry、channel service、search providers、evaluation、memory、feedback loop 和 persistence。
- `packages/shared` 是前端与 runtime 的协议边界。新增跨端数据结构时，优先从这里定义 schema 和类型。
- `scripts/dev-desktop.sh` 会打包 runtime sidecar，并检查 Langfuse 资源是否存在。
- `.ora/runtime.db` 是默认的本地 runtime 存储路径，可通过 `ORA_RUNTIME_STORE_DIR` 覆盖。

### 项目状态

Ora 现在更适合本地开发和内部试用。README 里的能力以当前仓库代码为准，部分集成可能还需要配置密钥、启动外部服务或补齐产品化流程。

### 许可证

本项目使用 MIT License，见 [LICENSE](LICENSE)。

## English

Ora is a desktop AI workbench. It puts modes, agents, skills, and model providers in one place, so you can choose how a task should run before handing it to the right agent setup.

The project is still early. It is built for people who want to organize local AI workflows, inspect multi-agent runs, connect different model providers, and experiment with message-channel driven automation.

### What Ora Is For

Most AI tools push every task into the same chat box. Ora treats work as something you can route. A task can run through a single agent, a generator-verifier loop, an orchestrator with subagents, an agent team, or a custom topology you draw yourself.

For users, Ora cuts down the switching between chat apps, coding tools, model dashboards, and project context. For developers, it gives multi-agent workflows a runtime you can inspect, tune, replay, and evaluate.

### Core Capabilities

- Composable workflows: choose a coordination mode, then pair it with agents and skills.
- Visual orchestration: use generator-verifier, orchestrator-subagent, agent-team presets, or design your own nodes and edges.
- Model provider support: OpenAI, Anthropic, OpenRouter, OpenAI-compatible APIs, and Anthropic-compatible APIs.
- Run history: state, events, checkpoints, and trails make each run easier to inspect.
- Permissions and approvals: tool calls are grouped by risk, with default, read-only, and full-trust policies.
- Self-iteration: Ora analyzes runs and project signals, then proposes reviewable improvements.
- Message channels: the runtime includes adapters for HTTP webhook, Slack, Feishu, WeChat, WeCom, Telegram, Discord, and DingTalk.
- Local desktop runtime: Tauri owns the desktop shell, React owns the workbench UI, and a TypeScript sidecar runs the agent system.

### Architecture

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

### Quick Start

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

### Model Setup

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

### Common Commands

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

### Development Notes

- `apps/desktop` owns the UI, settings, onboarding, workbench state, and Tauri command calls.
- `apps/runtime` owns run orchestration, provider registry, channel service, search providers, evaluation, memory, feedback loops, and persistence.
- `packages/shared` is the protocol boundary between the frontend and runtime. Add cross-process schemas and types there first.
- `scripts/dev-desktop.sh` packages the runtime sidecar and checks the Langfuse resource bundle.
- `.ora/runtime.db` is the default local runtime store. Set `ORA_RUNTIME_STORE_DIR` to override it.

### Project Status

Ora is best treated as a local development and internal testing project for now. The capabilities listed here come from the current repository, and some integrations still require API keys, external services, or more product work before they feel ready for general use.

### License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
