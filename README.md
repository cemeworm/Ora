# Ora

简体中文 | [English](README.en.md)

Ora 是一个桌面端 AI 工作台。它把模式、智能体、技能和模型服务提供方放在同一个工作界面里，让你先选合适的跑法，再把任务交给合适的智能体完成。

当前项目仍在早期开发阶段，主要面向想在本地组织 AI 工作流、调试多智能体协作、接入不同模型服务和消息渠道的用户与开发者。

## Ora 解决什么问题

很多 AI 工具把所有任务都塞进同一个聊天框。Ora 的思路更接近一个工作台：同一个任务可以用单智能体、生成-验证、编排调度、团队协作等不同模式来跑；每个模式可以搭配不同的智能体、技能和权限策略。

对普通用户来说，Ora 希望减少在聊天工具、代码工具、模型控制台和项目上下文之间来回切换的成本。对开发者来说，Ora 提供一个可以观察、调整和复盘的运行时，让多智能体工作流不只停留在 prompt 里。

## 核心能力

- 组合式工作流：按任务选择协调模式，再搭配智能体和技能。
- 可视化编排：支持生成-验证、编排调度、团队协作等拓扑，也可以自己设计节点和连线。
- 多模型提供方：内置 OpenAI、Anthropic、OpenRouter，以及 OpenAI-compatible 和 Anthropic-compatible 服务配置。
- 运行记录与复盘：保留 run state、events、checkpoints、trails，方便查看任务如何推进。
- 权限与审批：把工具调用按风险分层，支持默认策略、只读策略和完全信任策略。
- 自我迭代：分析运行记录和项目线索，提出可审阅的改进建议。
- 多渠道入口：运行时已经包含 HTTP webhook、Slack、飞书、微信、企业微信、Telegram、Discord、钉钉等 channel adapter。
- 本地优先的桌面体验：Tauri 桌面壳负责应用窗口和 sidecar，React 前端负责工作台界面，TypeScript runtime 负责执行。

## 技术结构

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

## 快速开始

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

## 配置模型

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

## 常用命令

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

## 开发说明

- `apps/desktop` 负责界面、设置、onboarding、工作台状态展示和 Tauri 命令调用。
- `apps/runtime` 负责 run orchestration、provider registry、channel service、search providers、evaluation、memory、feedback loop 和 persistence。
- `packages/shared` 是前端与 runtime 的协议边界。新增跨端数据结构时，优先从这里定义 schema 和类型。
- `scripts/dev-desktop.sh` 会打包 runtime sidecar，并检查 Langfuse 资源是否存在。
- `.ora/runtime.db` 是默认的本地 runtime 存储路径，可通过 `ORA_RUNTIME_STORE_DIR` 覆盖。

## 项目状态

Ora 现在更适合本地开发和内部试用。README 里的能力以当前仓库代码为准，部分集成可能还需要配置密钥、启动外部服务或补齐产品化流程。

## 许可证

本项目使用 MIT License，见 [LICENSE](LICENSE)。
