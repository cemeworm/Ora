# Ora

<p align="center">
  <img src="apps/desktop/src-tauri/icons/icon_source_1024.png" alt="Ora Logo" width="200">
</p>

简体中文 | [English](README.en.md)

**Ora 是一个可解释的 Agent 工作台。**

大多数 AI 工具对 Agent 的决策过程是不透明的——你知道它做了什么，但不知道它为什么选择追问而不是搜索、为什么调用这个工具而不是那个、为什么在某个时刻选择停止。

Ora 选择了一条不同的路：**Agent 的每一次关键决策都经过结构化因果判断**——目标是否明确、事实是否缺失、上下文是否足够、行动风险有多高、用户成本有多大、操作是否可逆——而不是靠模型的语言倾向。决策记录、反事实推演和量化评估构成完整的可解释链路。你可以对比不同策略的净提升，把"这个 agent 好不好"从直觉降维到可追溯的数值。

同时，Ora 把运行事实耐久化为事件溯源模型（Ledger），把工作模式建模为可编辑的有向图（Graph Framework），把对话成果沉淀为跨 Session 存在的长期组件（Widget Dashboard）。

## 三个核心差异

### 决策可解释，不是黑箱

Agent 的每次干预——直接回答、追问澄清、搜索、读上下文、调用工具、规划、请求审批或停止——都经过六维不确定性评估：`goalUncertainty` / `factUncertainty` / `contextUncertainty` / `actionRisk` / `userCost` / `reversibility`。

- 目标不确定性高时主动追问，事实风险高时主动搜索，上下文缺失会改变结果时主动读文件
- 低风险操作直接执行，高风险操作走审批门控，边际收益低时主动停止
- 每次决策附带反事实记录：如果不做这个动作，结果会差在哪里
- 因果 A/B 评估用有效干预率、过度行动率、反事实提升等五项指标量化决策质量

详见 [因果决策系统](docs/ora-causal-decision.md)。

### 事实可溯源，不会掉电丢失

不是日志——是 append-only 事件溯源模型。16 种 entry 类型（运行启动/停止、gate 开闭、工具结果、计划交接、上下文压缩等）按序写入 Ledger。

- 投影系统从 Ledger 重建所有 read model：Session 摘要、Turn 列表、Gate 状态、Attention
- 掉电、重启、切换客户端后，UI 状态从 ledger-backed projection 重建，不是从内存猜测
- 中断-恢复机制（Clarification / Approval / Plan Decision 三种 Gate + Continuation Frame）保证暂停后精确恢复到暂停点
- 分支模型支持在同一 Session 中分叉出多个 candidate run，选择最佳结果 adopt

详见 [Ledger 模型](docs/ora-ledger-model.md)、[Gate 与恢复](docs/ora-gates-and-resume.md)。

### 模式即图，可编辑可观测

不依赖 LangGraph、Dagre 等外部图库——整个图框架自研。每个工作模式是一张可编辑的有向图。

- **5 种协调模式**：Orchestrator-Subagent（层级委派）、Generator-Verifier（循环验证）、Agent Teams（团队协作）、Message Bus（事件路由）、Shared State（共享黑板）
- **17 种节点模板**：decompose、research、review、synthesize、build、check 等，可绑定不同 Agent
- **15 种可插拔 Runtime Atom**：memory_capture、subagent_delegate、clarification_interrupt、dynamic_delegation 等，按需注入
- Mode Studio 可视化编辑节点和连线，保存前自动校验拓扑合法性
- Driver Capability Manifest 声明每种 family 的执行能力边界，五层语义严格区分

详见 [图框架](docs/ora-graph-framework.md)、[Mode 创作与 Studio](docs/ora-mode-authoring-and-studio.md)。

## 产品形态

**桌面应用**：Tauri + React + Vite，本地优先，API key 留在本地。TypeScript runtime sidecar 负责模型调用、工具执行、持久化和评估。两者通过 shared 包的 JSON-RPC 合约通信。

**Widget Dashboard**：对话成果不只是聊天记录。Ora 把对话沉淀为三种结构化组件：

| 组件 | 用途 | 特点 |
| --- | --- | --- |
| **Artifact** | 文章、摘要、Prompt、研究结果 | 可编辑、可导出、可版本回滚 |
| **Todo** | 待办事项、截止日期、提醒 | 勾选不触发版本快照，可关联 Automation |
| **Feed** | 定时刷新外部信息（热点、GitHub、关键词） | 按 cron/interval 调度刷新 |

组件跨 Session 存在，关闭对话后继续存活。可通过 Builder Session 继续用自然语言修改。

详见 [Widget 系统](docs/ora-widget-system.md)。

## 关键技术能力

**工具治理链**：50 个已实现工具，每个调用经过 `policy → approval → action → execution → ledger → snapshot → projection` 完整治理链。三层风险体系 + Permission Profile 三态矩阵 + 审批中断恢复。详见 [工具系统](docs/ora-tool-system.md)。

**Memory 系统**：五个子系统——Long-Term Memory（持久事实）、Active Memory（注入检索）、Short-Term Journal（信号存储）、Memory Wiki（知识编译）、Memory Dreaming（信号聚类晋升）。支持确定性准入和 Provider 驱动准入两种模式。详见 [Memory 系统](docs/ora-memory-system.md)。

**多模型提供方**：内置 OpenAI、Anthropic、OpenRouter，也支持 OpenAI-compatible 和 Anthropic-compatible 服务。

**多渠道入口**：HTTP webhook、Slack、飞书、微信、企业微信、Telegram、Discord、钉钉 8 种 Channel Adapter，统一转换为内部 session/run。详见 [Channel 连接器](docs/ora-channel-connectors.md)。

**Self-Iteration 闭环**：五条信号→候选派生路径（feedback → evaluation、recovery failure → prompt、insight cluster → mode 等），评测门控，三级自治策略，支持自动应用和人工确认。详见 [Self-Iteration](docs/ora-self-iteration-loop.md)。

**可观测性**：Trails 面板提供七个标签页（总览、流程、智能体、工具、延迟、证据、对比），消费 snapshot → projection → trailViewModel 三层加工链。详见 [Snapshot 与 Trails](docs/ora-snapshot-projection-trails.md)。

## 技术结构

```text
.
├── apps
│   ├── desktop          # Tauri + React + Vite 桌面端
│   └── runtime          # TypeScript runtime sidecar
├── packages
│   └── shared           # 跨端共享类型、schema、模式定义、RPC 合约
├── scripts              # 本地开发、构建和版本同步脚本
└── skills               # Ora 技能目录
```

## 安装

### macOS（Apple Silicon）

从 [GitHub Releases](https://github.com/cemeworm/Ora/releases) 下载最新 DMG 安装包：

[下载 Ora](https://github.com/cemeworm/Ora/releases/latest)

打开 `Ora_*.dmg`，将 Ora 拖入 Applications 文件夹即可。首次打开时，macOS 可能提示"无法验证开发者"，在**系统设置 → 隐私与安全性**中点击"仍要打开"即可。

### 从源码构建

需要 Node.js、pnpm 10.11.0、Rust 和 Cargo。

```bash
pnpm install
pnpm dev:desktop
```

仅启动前端或 runtime：

```bash
pnpm dev           # Vite 前端
pnpm dev:runtime   # Runtime sidecar
```

运行 runtime smoke：

```bash
pnpm --filter @ora/runtime smoke
```

### 配置模型

首次打开 Ora 时，onboarding 会引导选择模型提供商。可以从 OpenRouter 等免费入口开始，也可以填入自己的 OpenAI、Anthropic 或兼容服务 API key。

可选能力参考 `.env.example`：

```bash
ORA_LANGFUSE_ENABLED=false
ORA_SEARCH_PROVIDER=brave
BRAVE_SEARCH_API_KEY=...
ORA_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true
```

常用命令：

```bash
pnpm test && pnpm typecheck && pnpm build && pnpm lint
```

## 项目状态

Ora 当前面向本地开发和内部试用。渠道接入、搜索、Langfuse trace 等功能需要额外配置密钥或外部服务。

## 许可证

MIT License，见 [LICENSE](LICENSE)。
