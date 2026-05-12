# Ora 结构说明文档规划

本文记录在已有 `ora-runtime-loop.md` 与 `ora-graph-framework.md` 之外，Ora 项目还应该补充的结构说明文档。目标不是堆更多文档，而是把 Ora 中最容易被误解、最影响后续演进的机制拆成可维护的知识边界。

## 当前已有文档边界

| 文档 | 已覆盖问题 | 仍未覆盖的问题 |
| --- | --- | --- |
| `ora-runtime-loop.md` | runtime loop 分层、run lifecycle、resume、mode 编排、dynamic delegation、node model-tool loop、assistant text projection 边界、streaming finalization | 更细粒度的 ledger entry replay 与 projection 内部算法应留给 ledger 文档 |
| `ora-graph-framework.md` | ModeSpec、PatternDefinition、Topology、runtime atoms、`dynamic_delegation`、Mode Studio、runtime graph consumption | 运行事实如何沉淀、gate 如何耐久化、snapshot/Trails 如何消费执行状态 |
| `ora-ledger-model.md` | Ledger 事实层、session/run projection、gate/tool/result durable facts | 具体 UI 消费细节仍应看 snapshot/projection/Trails 文档 |
| `ora-gates-and-resume.md` | Gate、Continuation、Resume、attention 收敛 | 不展开普通 tool/action 治理链 |
| `ora-tool-action-governance.md` | Tool / Action / Approval / Recovery / Ledger / Trails 治理链 | 不替代 Pi 对比文档的外部设计借鉴 |
| `ora-snapshot-projection-trails.md` | StateSnapshot、projection、Trails、assistant text projection、desktop streaming UI 消费边界 | 不展开 mode graph authoring 细节 |
| `ora-mode-authoring-and-studio.md` | System preset / custom mode、Mode Studio、runtime atom 双重语义、`dynamic_orchestrator` | 不描述 runtime node loop 内部状态机 |
| `ora-pi-tool-design-analysis.md` | Ora 与 Pi tool 设计对比、可借鉴方向 | Ora 自身 tool/action/policy/approval 的结构化说明见 `ora-tool-action-governance.md` |

结论：文档体系已经从「Ora 怎么跑」和「Ora 的模式图怎么建模」扩展到「事实如何沉淀、如何衍生状态、如何被桌面端和恢复机制消费」。后续维护重点应从“新增文档”转为“关键机制改动后同步相关结构说明”。

## 推荐文档清单

### 1. `ora-ledger-model.md`：Ledger 事实层设计

**优先级：P0。必须单独成文。**

Ledger 是 Ora 的耐久事实层，不只是日志。它横跨 run/session/gate/projection/branch/plan handoff/desktop read model，是理解 Ora 状态模型的核心。

建议覆盖：

- `RuntimeSessionLedger` 的 entry 类型体系。
- `parentId`、`leafEntryId`、`seq` 如何构成会话链。
- `runtime.event_batch`、`assistant.message`、`tool.result`、`gate.opened`、`gate.resolved` 的语义。
- `deriveSessionProjection`、`deriveRunProjection`、`deriveRunSnapshot` 如何从 ledger 衍生 read model。
- branch、candidate、adopted run 如何挂在 ledger 上。
- gate、plan handoff、compaction 如何变成 durable facts。
- 哪些状态来自 live snapshot，哪些状态必须来自 ledger projection。
- 为什么 event batch 可以 slim，但 projection 仍然能重建 snapshot。

核心文件：

- `packages/shared/src/runtime-ledger.ts`
- `apps/runtime/src/run-ledger-service.ts`
- `apps/runtime/src/run-ledger-branch-service.ts`
- `apps/runtime/src/runtime-gate-service.ts`
- `apps/runtime/src/runtime-gate-ledger-service.ts`
- `apps/runtime/src/persistence/session-ledger-projections.ts`

建议标题：

> Ora Ledger：从运行事实到会话投影

文档定位：Ora 的事件溯源、状态投影、恢复事实层说明书。

### 2. `ora-gates-and-resume.md`：Gate、Continuation、Resume 机制

**优先级：P0。建议单独成文。**

现有 runtime loop 文档已经描述了 resume 主路径，但 gate/resume 是 Ora 最容易出错的机制之一，值得独立解释。

建议覆盖：

- clarification、approval、plan decision、cancellation 的区别。
- `gate.opened` 与 `gate.resolved` 如何进入 ledger。
- resume patch 如何被解析。
- `RunResumeService`、`RunContinuationDispatcher`、`RunKernelExecutionService` 的职责边界。
- owner-backed continuation、whole-mode fallback、diagnostic failure 的判断逻辑。
- approved tool continuation 为什么不由 dispatcher 直接执行。
- plan decision 为什么不是普通 run interrupt。
- gate resolution 如何影响 session attention。

核心文件：

- `apps/runtime/src/run-resume-service.ts`
- `apps/runtime/src/run-continuation-dispatcher.ts`
- `apps/runtime/src/run-kernel-execution-service.ts`
- `apps/runtime/src/run-resume-finalization-service.ts`
- `apps/runtime/src/runtime-gate-service.ts`
- `apps/runtime/src/runtime-gate-ledger-service.ts`

### 3. `ora-tool-action-governance.md`：Tool / Action / Approval 治理链

**优先级：P0。建议单独成文。**

Ora 的工具系统不是简单 tool calling，而是一条 runtime governance 链：

```text
model tool call
  -> tool descriptor / executor
  -> action proposal
  -> risk / approval policy
  -> tool execution
  -> recovery
  -> ledger / snapshot / Trails
```

建议覆盖：

- tool descriptor、tool executor、tool call service 的边界。
- tool call 如何生成 action proposal。
- risk level、approval mode、policy hook 如何影响执行。
- approval required 时如何进入 gate。
- tool result 如何写入 snapshot 与 ledger。
- tool recovery 与 provider recovery 的区别。
- code development boundary 如何阻止 orchestrator 做 mutation。
- Ora 与 Pi tool 设计对比中哪些能力已经落地，哪些属于后续改造方向。

核心文件：

- `packages/shared/src/actions.ts`
- `packages/shared/src/runtime.ts`
- `apps/runtime/src/harness/runtime-tool-call-service.ts`
- `apps/runtime/src/harness/runtime-tool-executor.ts`
- `apps/runtime/src/harness/runtime-tool-approval.ts`
- `apps/runtime/src/harness/runtime-tool-action-proposal.ts`
- `apps/runtime/src/harness/runtime-tool-recovery-service.ts`
- `apps/runtime/src/harness/runtime-tool-ledger.ts`
- `apps/runtime/src/harness/runtime-tool-boundary.ts`

### 4. `ora-snapshot-projection-trails.md`：Snapshot、Projection、Trails 消费链

**优先级：P0/P1。建议单独成文。**

这份文档解释 runtime 产生的事实如何被桌面端看见。它应该把 runtime snapshot、ledger projection、flow projection、desktop Trails 串成一条消费链。

建议覆盖：

- `StateSnapshot` 是什么，不是什么。
- runtime event batch 如何进入 ledger。
- run/session/flow projection 如何生成。
- `toFlowRunDetail`、`toSessionTurn`、`deriveRunAttention` 的职责。
- desktop Trails 如何从 snapshot 和 trail observations 构建视图。
- Flow、Tools、Agents、Evidence、Latency 各自消费哪些字段。
- 为什么 UI 不应该自己推断 runtime 状态。

核心文件：

- `packages/shared/src/runtime.ts`
- `packages/shared/src/runtime-timeline.ts`
- `apps/runtime/src/run-projections.ts`
- `apps/runtime/src/telemetry/trails.ts`
- `apps/desktop/src/lib/trailViewModel.ts`
- `apps/desktop/src/components/TrailsTabs.tsx`

### 5. `ora-memory-system.md`：Memory 系统

**优先级：P1。建议补充。**

Ora 的 memory 已经不是单点能力，而是一组 admission、active memory、journal、wiki、dreaming、updates 组成的系统。

建议覆盖：

- memory policy 如何由 mode 控制。
- active memory 如何选取和注入。
- memory admission 如何判断是否沉淀。
- memory journal、wiki、dreaming、updates 的职责边界。
- memory observability 如何进入 Trails 或 diagnostic。

核心文件：

- `packages/shared/src/memory.ts`
- `apps/runtime/src/memory.ts`
- `apps/runtime/src/active-memory.ts`
- `apps/runtime/src/memory-admission.ts`
- `apps/runtime/src/memory-updates.ts`
- `apps/runtime/src/memory-journal.ts`
- `apps/runtime/src/memory-wiki.ts`
- `apps/runtime/src/memory-dreaming.ts`
- `apps/runtime/src/memory-observability.ts`

### 6. `ora-mode-authoring-and-studio.md`：Mode Authoring 与 Mode Studio

**优先级：P1。建议在图框架文档之后补。**

`ora-graph-framework.md` 已经解释了模式图与 runtime 拓扑，这份文档可以更偏向「如何创建、编辑、校验、保存、运行一个 mode」。

建议覆盖：

- system preset 与 custom mode 的关系。
- Mode Studio 画布中的真实节点、synthetic capability node、`__runtime_anchor__` 的区别。
- mode clone、draft、save、validate 的链路。
- `ModeNodeSpec.config` 中 custom agent、clarification、atoms 的含义。
- runtime atom 在编辑态和运行态的双重语义。
- 新增一个系统预设 mode 与新增 family 的区别。

核心文件：

- `packages/shared/src/modes.ts`
- `packages/shared/src/mode-studio-builder.ts`
- `apps/runtime/src/mode-studio-store.ts`
- `apps/runtime/src/mode-studio-draft.ts`
- `apps/runtime/src/mode-studio-builder-run.ts`
- `apps/desktop/src/components/ModesView.tsx`
- `apps/desktop/src/lib/modeCanvas.ts`

### 7. `ora-channel-connectors.md`：外部 Channel / Connector 入口

**优先级：P1/P2。取决于近期是否继续做外部渠道。**

如果 Ora 要强调外部入口、多渠道执行、chat/webhook/Feishu/Slack 等连接能力，这份文档应该存在。

建议覆盖：

- channel binding。
- inbound message normalization。
- attachment enrichment。
- channel-originated run。
- outbound delivery。
- channel commands。
- Feishu、Slack、Discord、Telegram、WeChat、WeCom、DingTalk、HTTP webhook 的共同抽象与差异。

核心目录：

- `apps/runtime/src/channels/`

### 8. `ora-self-iteration-loop.md`：Self-Iteration Loop

**优先级：P2。若 Self-Iteration 成为主线能力，再提升优先级。**

如果 Self-Iteration 是 Ora 的长期核心卖点，应该单独成文；如果仍处实验状态，可以暂缓。

建议覆盖：

- self-iteration contract。
- candidate generation。
- evaluation gate。
- low-risk auto-apply。
- curator scan。
- Evaluation Studio / Mode Studio draft automation 的关系。

核心文件：

- `packages/shared/src/self-iteration.ts`
- `apps/runtime/src/self-iteration-store.ts`
- `apps/runtime/src/harness/runtime-self-iteration-tools.ts`

## 推荐写作顺序

```text
1. ora-ledger-model.md
2. ora-gates-and-resume.md
3. ora-tool-action-governance.md
4. ora-snapshot-projection-trails.md
5. ora-memory-system.md
6. ora-mode-authoring-and-studio.md
7. ora-channel-connectors.md
8. ora-self-iteration-loop.md
```

排序依据：

1. 先写跨机制的事实层，再写依赖它的 gate/resume。
2. 再写 tool/action，因为工具执行会同时触发 approval、recovery、ledger、snapshot、Trails。
3. 然后写 snapshot/projection/Trails，解释 runtime 事实如何进入桌面端。
4. memory、mode authoring、channel、self-iteration 可以按近期开发重点推进。

## Ledger 文档为什么必须单独写

Ledger 不适合只作为 runtime loop 的一个小节，因为它承担的是 Ora 的 source-of-truth 角色。

如果没有单独文档，后续改这些能力时很容易误判边界：

- resume：不清楚应该信 continuation frame、live snapshot 还是 ledger projection。
- gate：不清楚 opened/resolved 何时必须变成 durable fact。
- plan mode：不清楚 plan decision gate 和 accepted plan handoff 应该落在哪里。
- branch：不清楚 candidate run 为什么不能直接更新 session leaf。
- desktop：不清楚 session list、attention、Trails 应该消费 projection，而不是 UI 本地猜测。
- streaming：不清楚 event batch slim 后如何保持 projection 可重建。

Ledger 文档建议围绕这条主线组织：

```text
Runtime emits events / snapshots
  -> RunLedgerService appends session entries
  -> RuntimeSessionLedger stores durable facts
  -> deriveSessionProjection derives read models
  -> deriveRunSnapshot reconstructs latest run state
  -> desktop/runtime APIs consume session/run/flow projections
```

核心判断：**Ledger 文档写完后，Ora 的架构理解会从「流程图」升级到「状态模型」。**

## 建议验收标准

每份结构说明文档都应满足：

1. 有明确阅读地图，列出核心类型、服务和文件路径。
2. 有一张主流程图或状态关系图。
3. 明确说明 source of truth 与派生状态的边界。
4. 明确说明 runtime、shared contract、desktop UI 各自消费什么。
5. 写出容易误解的点，避免后续开发重新踩坑。
6. 不只描述现状，也标出当前实现的保守边界和可演进方向。
