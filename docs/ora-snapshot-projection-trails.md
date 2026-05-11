# Ora Snapshot、Projection、Trails 消费链

本文解释 runtime 产生的执行事实如何经过 snapshot、projection、trails 三层加工，最终变成 desktop UI 可消费的七个标签页。它把 `StateSnapshot` → `toFlowRunDetail` / `toSessionTurn` → `synthesizeLocalTrail` → `trailViewModel` → `TrailsTabs` 串成一条完整的消费链。

## 阅读地图

| 关注点 | 对应章节 |
| --- | --- |
| StateSnapshot 的数据模型 | [1. StateSnapshot：运行时事实的容器](#1-statesnapshot运行时事实的容器) |
| 事件如何进入 snapshot 和 ledger | [2. 从事件到 Snapshot 再到 Ledger](#2-从事件到-snapshot-再到-ledger) |
| run/flow/session 投影函数 | [3. Projection 层：snapshot → read model](#3-projection-层snapshot--read-model) |
| Trails 观测合成 | [4. Trails 层：snapshot → 观测记录](#4-trails-层snapshot--观测记录) |
| Desktop view model 如何消费 snapshot | [5. Desktop View Model：snapshot → 七个标签页](#5-desktop-view-modelSnapshot--七个标签页) |
| 七个标签页各自消费的字段 | [6. 标签页字段消费矩阵](#6-标签页字段消费矩阵) |
| 为什么 UI 不应自己推断状态 | [7. UI 不应自己推断 runtime 状态](#7-ui-不应自己推断-runtime-状态) |
| 容易误解的点 | [8. 常见误解与边界](#8-常见误解与边界) |

核心源码文件：

| 文件 | 职责 |
| --- | --- |
| `packages/shared/src/runtime.ts` | `StateSnapshot` schema、`deriveRunInteraction`、`deriveRunAttention`、`RunAttention` 类型 |
| `packages/shared/src/runtime-timeline.ts` | `deriveRuntimeTimelineProjection`：从 snapshot 提取事件时间线 |
| `apps/runtime/src/run-projections.ts` | `toRunHandle`、`toFlowRunDetail`、`toSessionTurn`、`toRunSummary`、`buildRunTrailMetrics` |
| `apps/runtime/src/telemetry/trails.ts` | `synthesizeLocalTrail`：从 snapshot 合成 TrailObservation 数组 |
| `apps/runtime/src/persistence/session-ledger-projections.ts` | 批量 ledger → read model 持久化投影入口 |
| `apps/desktop/src/lib/trailViewModel.ts` | 全部 view model builder：timeline、lanes、tools、latency、findings 等 |
| `apps/desktop/src/components/TrailsTabs.tsx` | Trails 抽屉 UI，消费 trailViewModel 输出渲染七个标签页 |

## 1. StateSnapshot：运行时事实的容器

### 1.1 StateSnapshot 是什么

`StateSnapshot` 是 Ora 运行时在**一个时间点**的完整状态快照。它不是最终答案，不是日志，不是 ledger entry——它是 runtime kernel 在执行过程中不断更新、desktop 通过流式事件或 RPC 拉取到的**执行状态断面**。

```typescript
// packages/shared/src/runtime.ts
StateSnapshot {
  runId, sessionId, turnIndex, status, attention,
  pattern, coordinationKind, modeId,
  input: UserTaskInput,
  config: RunConfig,
  topology: { nodes: TopologyNode[], edges: TopologyEdge[] },
  profiles: AgentProfile[],
  memory: MemoryRecord[],
  plan: PlanItem[], planList: PlanListStep[],
  todos: TodoItem[],
  actions: ActionRecord[],
  toolCalls: OraToolCallEnvelope[],
  continuation: RunContinuation,
  planDecisions: PlanDecisionGate[],
  conversation: RuntimeConversationEntry[],
  contextState: SessionContextState,
  toolResults: RuntimeToolResultLedgerEntry[],
  policyDecisions: PolicyDecision[],
  checkpoints: CheckpointMeta[],
  events: OraEventEnvelope[],
  agentMessages: AgentConversationMessage[],
  artifacts: ArtifactRef[],
  activeAgents: string[],
  queueSummary, sharedStateSummary, busStats,
  pendingClarifications: PendingClarification[],
  pendingApprovals: string[],
  trace: RunTraceMetadata,
  latency: RunLatencyDiagnostics,
  modeSpec: ModeSpec,
  output, error, updatedAt
}
```

### 1.2 StateSnapshot 不是什么

| 误解 | 事实 |
| --- | --- |
| StateSnapshot 是最终结果 | 不是。流式过程中 snapshot 的许多字段是占位值。只有 run 终态（succeeded/failed/cancelled）后的 snapshot 才是完整的。 |
| StateSnapshot 可以替代 ledger | 不可以。snapshot 是内存视图，不持久。ledger 是 append-only 事实源。详见 `ora-ledger-model.md`。 |
| StateSnapshot.events 包含所有历史事件 | 不保证。slim 策略会清除 event batch 的 events 数组。完整事件历史应从 ledger replay 重建。 |
| StateSnapshot 的 attention 就是最终 attention | 流式过程中 attention 可能不准确。最终 attention 应由 `deriveLedgerRunAttention` 从 ledger-backed gate projection 计算。 |

### 1.3 Snapshot 的双重来源

同一个 `StateSnapshot` 结构可以来自两条路径：

```
路径 A: Live Snapshot (流式)
  Kernel emit → RunStreamingService.applyLiveEvent → snapshot 更新 → desktop push

路径 B: Ledger Projection (持久)
  RuntimeSessionLedger → deriveSessionProjection → deriveRunSnapshot → snapshot 重建
```

desktop UI 在 run 运行期间消费 live snapshot（路径 A），run 完成后切换到 ledger-backed snapshot（路径 B）。这两条路径的关键区别：

| 维度 | Live Snapshot | Ledger-backed Snapshot |
| --- | --- | --- |
| 时效性 | 实时 | 最终一致 |
| attention 准确性 | 可能不完整 | 经过 gate projection 调和 |
| events 完整性 | 包含流式 delta | 可能被 slim |
| 用途 | 流式 UI 更新 | session detail、Trails、sidebar |

## 2. 从事件到 Snapshot 再到 Ledger

### 2.1 事件产生

runtime kernel 在执行过程中发出 `OraEventEnvelope` 事件。53 种事件类型涵盖 run 生命周期、agent 活动、工具调用、gate 开关、恢复、产物等全部运行时事实。

### 2.2 事件进入 Snapshot

流式过程中，`RunStreamingService.applyLiveEvent` 把每个事件追加到 `StateSnapshot.events`，同时更新 snapshot 中的对应字段（如 `tool.called` 追加到 `toolCalls`，`topology.updated` 更新 `topology`）。

### 2.3 事件批量进入 Ledger

事件不会逐条写 ledger。runtime 定期 flush event batch：

```
runtime.event_batch entry → RuntimeSessionLedger
  payload.events: OraEventEnvelope[]  // 增量事件
  payload.snapshot: StateSnapshot     // 该时间点的完整快照
  payload.status, output, error       // 运行状态
```

slim 策略（`buildVisibleLedger`）会把 `events` 清空为 `[]`，但保留 `snapshot`、`status`、`output`、`error`。投影可以从 snapshot 和独立的 gate/tool result entry 重建必要信息。

### 2.4 从 Ledger 回到 Snapshot

`deriveSessionProjection` → `deriveRunSnapshot` 链从 ledger entry replay 重建 snapshot：

```
RuntimeSessionLedger.entries
  → runtimeSessionEntryPath (沿 parentId 回溯)
  → applyEntryToProjection (按 replay order fold)
  → runtimeRunProjectionToSnapshot (finalSnapshot + gate/tool projection 覆盖)
  → reconcileSnapshotRuntimeFields (gate 决议反向投影为事件)
```

详见 `ora-ledger-model.md` 第 4 章和第 9 章。

## 3. Projection 层：snapshot → read model

Projection 层把 `StateSnapshot` 转成结构化的 read model，供 RPC 响应和 desktop 消费。

### 3.1 投影函数全景

```
StateSnapshot
  ├─ toRunHandle        → RunHandle          (RPC: runs.start 返回值)
  ├─ toFlowRunHandle    → FlowRunHandle      (RPC: flows.start 返回值)
  ├─ toRunSummary       → RunSummary         (RPC: runs.list)
  ├─ toSessionTurn      → SessionTurn        (RPC: sessions.get turns[])
  ├─ toFlowRunDetail    → FlowRunDetail      (RPC: flows.get)
  ├─ buildRunTrailMetrics → RunTrailMetrics  (RPC: runs.trail liveMetrics)
  └─ deriveRunInteraction → RunInteraction   (RPC: runs.interaction)
       └─ deriveRunAttention → RunAttention
```

全部定义在 `apps/runtime/src/run-projections.ts`。

### 3.2 toRunHandle / toFlowRunHandle

最简单的投影。从 snapshot 提取 run 的身份信息：`runId`、`sessionId`、`turnIndex`、`status`、`pattern`、`modeId`、`startedAt`。

`toFlowRunHandle` 在 `toRunHandle` 基础上加了 `flowRunId`（当前等于 `runId`），是 flow vocabulary 对 run 的兼容别名。

### 3.3 toSessionTurn

从 snapshot 构建 session 的一个 turn（一轮对话）。关键字段：

```typescript
toSessionTurn(snapshot) → SessionTurn {
  runId, sessionId, turnIndex,
  status, attention,       // ← attention 来自 deriveRunAttention
  pattern, modeId,
  providerId, modelRef,    // ← 从 config 提取
  prompt,                  // ← 来自 input.prompt
  startedAt, updatedAt,
  eventCount,              // ← 来自 events.length
  checkpointCount,         // ← 来自 checkpoints.length
  artifactCount,           // ← 来自 artifacts.length
  trace,                   // ← 来自 snapshot.trace
}
```

session detail 的 `turns` 数组由这个函数逐个产生。

### 3.4 toFlowRunDetail

最复杂的投影函数。从一个 `StateSnapshot` 构建完整的 `FlowRunDetail`：

```
toFlowRunDetail(snapshot) → FlowRunDetail {
  flowRunId, runId, sessionId,
  status, attention,
  snapshotSource,              // "live" | "ledger"，默认 live
  definition: FlowDefinitionRef,  // modeId → flow definition 引用
  checkpoints: CheckpointMeta[],  // 直接从 snapshot.checkpoints
  gates: FlowGate[],              // 从 snapshot 的 pendingClarifications/Approvals/planDecisions 构建
  activities: FlowActivitySummary[], // 从 toolCalls + agentMessages 构建
  eventCount, latestEventSeq,
  latestSnapshot,                 // 原样携带 snapshot
}
```

Gate 构建逻辑：

| Gate 来源 | snapshot 字段 | Gate kind |
| --- | --- | --- |
| 待处理澄清 | `pendingClarifications` | `clarification` |
| 待审批 action | `pendingApprovals` + `toolCalls` (approval_required) | `approval` |
| 计划决策 | `planDecisions` | `plan_decision` |
| 运行取消 | `status === "cancelled"` | `cancellation` |

Activity 构建逻辑：

| Activity 来源 | snapshot 字段 | Activity kind |
| --- | --- | --- |
| 工具调用 | `toolCalls[]` | `tool` |
| Agent 消息 | `agentMessages[]` | `model` |

### 3.5 deriveRunInteraction / deriveRunAttention

`deriveRunInteraction` 从 snapshot 推导当前 run 需要用户如何交互。优先级顺序（在 `packages/shared/src/runtime.ts` 中定义）：

```
1. 有待处理的 clarification → needs_clarification (blocking)
2. 有待审批的 action/tool call → needs_approval (blocking)
3. 有 pending plan decision → needs_plan_decision (blocking)
4. status = queued/running → running
5. status = interrupted → paused
6. status = failed → failed
7. status = cancelled → cancelled
8. otherwise → idle
```

`deriveRunAttention` 是 `deriveRunInteraction(snapshot).attention` 的简写。

**关键差异**：`deriveRunInteraction` 直接消费 live snapshot 的 `pendingClarifications`、`pendingApprovals`、`continuation.frames`。而 ledger 投影层的 `deriveLedgerRunAttention` 消费的是 gate projection（从 ledger entry fold 出来的 open gates）。两者在大部分情况下一致，但 ledger 版本是最终权威——因为它考虑了 gate.resolved entry 和幂等性。

### 3.6 buildRunTrailMetrics

从 snapshot + trace 计算运行指标：

```typescript
buildRunTrailMetrics(snapshot, trace, observations) → RunTrailMetrics {
  runtimeMs,         // updatedAt - 首个 event createdAt
  eventCount,        // events.length
  checkpointCount,   // checkpoints.length
  topologyChangeCount, // events 中 topology.updated 的数量
  messageCount,      // events 中 message.delta 的数量
  activeAgentCount,  // activeAgents.length
  warningCount,      // observations 中 level=WARNING 的数量
  errorCount,        // observations 中 level=ERROR 的数量
  estimatedCostUsd,  // trace.generationRefs 的总 cost
}
```

### 3.7 deriveRuntimeTimelineProjection

在 `packages/shared/src/runtime-timeline.ts` 中，一个轻量投影：

```typescript
deriveRuntimeTimelineProjection(snapshot) → RuntimeTimelineProjection {
  runId,
  events: OraEventEnvelope[],  // 过滤 runId 匹配 + 按时间排序
  baseTime,                    // 首个事件的 createdAt
  agentLabels: Map<agentId, label>,  // 从 profiles 构建
}
```

## 4. Trails 层：snapshot → 观测记录

Trails 是 Ora 的可观测性层。它从 snapshot 合成结构化观测记录，并可选地合并 Langfuse 远程追踪数据。

### 4.1 synthesizeLocalTrail

`apps/runtime/src/telemetry/trails.ts` 中的 `synthesizeLocalTrail` 从 snapshot 本地合成完整的 trail：

```typescript
synthesizeLocalTrail(snapshot, base?) → {
  trace: RunTraceMetadata,
  observations: TrailObservation[]
}
```

合成的观测记录来自五个来源：

| 来源 | snapshot 字段 | observation type | 数量 |
| --- | --- | --- | --- |
| Run 根 | `input`, `output`, `status` | `agent` | 1 |
| 运行时事件 | `events[]` | `generation` / `tool` / `span` | events.length |
| 工具调用 | `toolCalls[]` | `tool` | toolCalls.length |
| Action 记录 | `actions[]` | `tool` / `span` | actions.length |
| Continuation 帧 | `continuation.frames[]` | `span` | frames.length |

每种观测都携带结构化的 `metadata`，包含来源标记（`ora-runtime`、`ora-runtime-event`、`ora-tool-call`、`ora-action`、`ora-continuation`）和关联 ID。

### 4.2 mergeTrailObservations

当同时有本地合成观测和 Langfuse 远程观测时，`mergeTrailObservations` 按 `observation.id` 合并，Langfuse 数据覆盖同 ID 的本地数据。

### 4.3 generationRefs 合成

`localGenerationRefs` 从 `message.delta` 和 `token.delta` 事件合成模型生成引用，用于成本估算和延迟追踪。

## 5. Desktop View Model：snapshot → 七个标签页

Desktop 的 Trails 抽屉不直接读 `StateSnapshot` 的原始字段。它通过 `trailViewModel.ts` 中的 builder 函数把 snapshot 转成 UI 专用的 view model。

### 5.1 数据流

```
StateSnapshot + OraRunTrail
  │
  ├─ buildTrailDebugSummary     → 顶部状态栏
  ├─ buildSemanticTimeline      → Flow 标签页 (流程事件)
  ├─ buildConversationView      → Flow 标签页 (对话内容)
  ├─ buildAgentLanes            → Agents 标签页
  ├─ buildToolLedger            → Tools 标签页
  ├─ buildLatencyDiagnostics    → Latency 标签页
  ├─ collectTrailFindings       → 发现列表 (Overview + Flow)
  ├─ buildEffectiveStrategySummary → Overview 运行策略卡片
  ├─ buildActiveMemorySummary   → Overview 主动记忆卡片
  ├─ buildPendingApprovalItems  → Overview 阻塞关卡卡片
  ├─ buildPlanProgressSummary   → Overview 执行计划卡片
  ├─ buildTodoProgressSummary   → Overview 任务进度卡片
  ├─ buildPolicyDecisionsSummary → Overview 策略决策卡片
  ├─ buildMemoryDetailSummary   → Overview 记忆详情卡片
  ├─ buildContextWindowSummary  → Overview 上下文窗口卡片
  ├─ buildCommunicationGraph    → Agents 通信关系
  └─ Evidence 标签页直接消费   → trace, trail.observations, artifacts, checkpoints
```

### 5.2 buildTrailDebugSummary

消费 snapshot + trail + actions + findings，构建顶部状态栏：

- `statusLabel` / `statusTone`：从 `snapshot.status` 映射
- `currentStage`：从 `snapshot.activeAgents`、`snapshot.attention`、`snapshot.status` 推断
- `blockingGate`：从 `snapshot.attention` + `pendingClarifications` + `pendingApprovals` 推断
- `metrics`：runtime 时长、成本、消息数

### 5.3 buildSemanticTimeline

消费 `snapshot.events` + `snapshot.topology` + `snapshot.profiles`，把原始事件转成 `SemanticTimelineItem[]`：

- 过滤掉 `token.delta`、`message.delta`（太高频）
- 默认隐藏内部事件（`worker.claimed`、`queue.updated`、`topology.updated` 等）
- 每个 item 计算 `kind`（run/agent/tool/handoff/checkpoint/recovery/gate/artifact/state）、`severity`、`label`、`detail`
- 从 `topology.nodes` 解析 `nodeLabel`，从 `profiles` 解析 `agentLabel`

### 5.4 buildAgentLanes

消费 `snapshot.profiles`、`snapshot.activeAgents`、`snapshot.agentMessages`、`snapshot.events`、`snapshot.toolCalls`、`snapshot.topology`，构建每个 agent 的泳道视图：

- agent 列表来自 profiles + activeAgents + events/toolCalls 中出现的 agentId
- 每条 lane 的消息来自 `agentMessages`（过滤 `fromAgentId`）
- 工具数来自 `toolCalls`（过滤 `agentId`）
- 状态从 topology node status 推断
- 成本从 trail observations 的 `totalCostUsd` 按 agentId 聚合

### 5.5 buildToolLedger

消费 `snapshot.toolCalls` + `snapshot.toolResults` + `snapshot.topology` + `snapshot.profiles`，构建工具调用记录列表：

- `toolId`、`status`、`source`、`latency` 来自 `OraToolCallEnvelope`
- `agentLabel` 从 profiles 查找
- `nodeLabel` 从 topology nodes 查找
- `argsPreview` / `resultPreview` 从 `call.args` / `call.result` 截断
- 如果 ledger-backed `snapshot.toolResults` 中存在没有对应 `toolCalls` envelope 的结果，Tools 标签页会补充一条 `source: "ledger"` 的记录。这样 slim/compaction 或 reload 后，最终工具结果仍以 durable `tool.result` entry 为准。

### 5.6 buildLatencyDiagnostics

消费 `snapshot.latency.marks`，构建延迟诊断：

- 14 个预定义段定义（从提交到首屏、从首屏到 handle、从 handle 到首个 stream 等）
- 每段从 marks 中查找 from/to 时间戳
- 状态判定：`< 500ms` ok，`500ms-2s` warning，`> 2s` slow
- 缺失的连续段自动合并
- `deriveFirstTextEvidence` 从 marks + snapshot.output + events 判断首文本是否被观测/测量

### 5.7 collectTrailFindings

15 条诊断规则，从 snapshot + trace 中检测问题：

| 规则 | 检测内容 | 数据来源 |
| --- | --- | --- |
| checkRunFailure | run 失败 | `snapshot.status`, `snapshot.error`, `events` |
| checkStrategyDegradation | 策略降级 | `snapshot.config.effectiveStrategy.providerPolicyStatus` |
| checkToolFailures | 工具失败/修复/中断/等待审批 | `snapshot.toolCalls` |
| checkApprovals | 待审批 | `snapshot.pendingApprovals` |
| checkContinuation | 续接状态 | `snapshot.continuation` |
| checkClarifications | 待澄清 | `snapshot.pendingClarifications` |
| checkRecovery | 恢复耗尽 | `snapshot.events` 中 `recovery.exhausted` |
| checkStopReason | 停止原因 | `snapshot.output.metadata` 或 `run.done` event |
| checkTraceStatus | 追踪可用性 | `trace.provider`, `trace.source`, `trace.enabled` |
| checkTrailError | 追踪加载错误 | `trailError` |
| checkEmptyEvents | 无事件 | `snapshot.events.length` |
| checkContextWindowUsage | 上下文使用率 | `snapshot.contextState` |
| checkToolCallLoop | 工具重复调用 | `snapshot.toolCalls` 相同 toolId+args 计数 |
| checkModelOutputQuality | 模型空响应/截断/JSON 解析失败 | `snapshot.conversation`, `snapshot.events` |
| checkAgentCommunication | 消息目标不存在/投递失败 | `snapshot.agentMessages` |
| checkToolBudgetExceeded | 工具预算超限 | `snapshot.config.effectiveStrategy.budget` |

## 6. 标签页字段消费矩阵

### 6.1 Overview（总览）

| 消费内容 | snapshot 字段 |
| --- | --- |
| 运行时长 | `updatedAt` - `input.createdAt` |
| 阶段 | `activeAgents`, `attention`, `status` |
| 焦点 | `topology.nodes` |
| 证据数 | `events.length`, `checkpoints.length`, `artifacts.length` |
| 发现列表 | `collectTrailFindings` 的 15 条规则（见上表） |
| 运行策略 | `config.effectiveStrategy` |
| 主动记忆 | `config.metadata.activeMemory` |
| 阻塞关卡 | `attention`, `pendingClarifications`, `pendingApprovals`, `actions`, `toolCalls` |
| 执行地图 | `topology.nodes` (status, kind, agentId) |
| 上下文窗口 | `contextState.activeTokenUsage`, `contextState.contextWindow` |
| 执行计划 | `planList`, `plan` |
| 任务进度 | `todos` |
| 策略决策 | `policyDecisions` |
| 记忆详情 | `memory` |

### 6.2 Flow（流程）

| 消费内容 | snapshot 字段 |
| --- | --- |
| 语义时间线 | `events` (过滤 + 分类 + 标签化) |
| 对话内容 | `conversation` (role, content, createdAt) |
| Agent/node 标签 | `topology.nodes`, `profiles` |
| 事件筛选 | `events` 的 `agentId`, `nodeId`, `type`, `payload` |

### 6.3 Agents（智能体）

| 消费内容 | snapshot 字段 |
| --- | --- |
| 执行拓扑 | `topology.nodes`, `topology.edges` |
| 通信关系 | `agentMessages` (from → to, kind, count) |
| 智能体泳道 | `profiles`, `activeAgents`, `agentMessages`, `toolCalls`, `events` |
| 成本分摊 | trail observations 的 `totalCostUsd` × `metadata.agentId` |

### 6.4 Tools（工具）

| 消费内容 | snapshot 字段 |
| --- | --- |
| 工具记录 | `toolCalls` (toolId, status, source, args, result, agentId, nodeId) |
| Node/Agent 标签 | `topology.nodes`, `profiles` |

### 6.5 Latency（延迟）

| 消费内容 | snapshot 字段 |
| --- | --- |
| 延迟 marks | `latency.marks` (name, source, at, detail) |
| 首文本证据 | `latency.marks` + `output` + `events` (message.delta) |
| 分段诊断 | marks 匹配 14 个预定义段定义 |

### 6.6 Evidence（证据）

| 消费内容 | 数据来源 |
| --- | --- |
| 追踪状态 | `trace` (provider, source, traceId, available) |
| 生成引用 | `trace.generationRefs` |
| 观测记录 | `trail.observations` (本地合成 + Langfuse) |
| 运行附件 | `artifacts`, `checkpoints`, `plan` |
| 原始快照 | `activeSnapshot` 完整 JSON |

### 6.7 Compare（对比）

| 消费内容 | 数据来源 |
| --- | --- |
| Session 运行列表 | `runtimeClient.listSessionRuns(sessionId)` |
| 对比运行 Trail | `runtimeClient.getRunTrail(compareRunId)` |
| 当前运行指标 | `snapshot.events`, `snapshot.toolCalls`, `snapshot.activeAgents`, `snapshot.checkpoints` |

## 7. UI 不应自己推断 runtime 状态

### 7.1 问题

desktop UI 如果从自己的本地状态推断 runtime 状态（比如"上一个 turn 是 approval，所以现在应该显示 approval card"），会出现以下问题：

1. **状态不一致**：UI 本地状态可能与 ledger projection 不同步（如 gate 已在另一个客户端被 resolve）
2. **恢复后状态错乱**：resume 后 UI 的"上一个状态"可能已经过时
3. **多客户端问题**：同一 session 在多个窗口中打开时，本地推断互相矛盾

### 7.2 正确做法

**所有状态判断都应以 snapshot 的权威字段为准**，不从 UI 本地状态推导：

| 要判断的事 | 应读取的字段 | 不应做的事 |
| --- | --- | --- |
| run 是否需要用户审批 | `snapshot.attention.kind === "needs_approval"` | 不应从"上次看到 approval.required 事件"推断 |
| 哪些 action 待审批 | `snapshot.pendingApprovals` + `snapshot.attention.pendingActionIds` | 不应从 UI 本地缓存的 action 列表推断 |
| run 是否在运行 | `snapshot.attention.kind === "running"` | 不应从"上次看到 run.started 还没看到 run.done"推断 |
| agent 是否活跃 | `snapshot.activeAgents.includes(agentId)` | 不应从 UI 本地的 agent 状态列表推断 |
| node 是否阻塞 | `topology.nodes.find(n => n.agentId === id)?.status === "blocked"` | 不应从 UI 本地的 node 状态缓存推断 |
| plan 是否已完成 | `planList.every(s => s.status === "completed")` | 不应从文本中猜测"看起来计划做完了" |
| gate 是否已解决 | `snapshot.planDecisions` 的 `status`、`pendingClarifications` 的长度 | 不应从"之前见过 gate.opened"推断 |

### 7.3 snapshotSource 标记

`StateSnapshot`、`FlowRunDetail` 和 `SessionDetail.snapshotSource` 字段标记当前 snapshot 的来源：

```typescript
snapshotSource: "ledger" | "live"
```

- `"live"`：来自流式 push，attention 等字段可能不完整
- `"ledger"`：来自 ledger projection，已经过 reconciliation

desktop 在 run 完成后应确保切换到 `"ledger"` 来源的 snapshot。`createStandaloneRunSnapshot` / `createRunningRunSnapshot` 会产出 `"live"`；`runtimeRunProjectionToSnapshot` 会产出 `"ledger"`；`deriveRunInteractionState` 会把该来源继续传到交互状态，`shouldSwitchToLedgerSnapshot` 用它避免终态 UI 长时间停留在 live view。

### 7.4 事件归属不应被前端推断

runtime 发出的每个事件都带有 `agentId` 和 `nodeId`。desktop timeline 和 trail projection 应消费 runtime 给出的 attribution，而不是靠"上一条事件来自 agent X，所以这条也是"来推断。

## 8. 常见误解与边界

### 8.1 "Trails 就是 Langfuse"

Trails 首先是 Ora 本地的可观测性层。`synthesizeLocalTrail` 从 snapshot 本地合成观测记录。Langfuse 是可选的外部追踪补充。当前本地合成已覆盖所有核心观测类型。

### 8.2 "StateSnapshot.attention 总是对的"

流式过程中的 snapshot.attention 可能不完整——比如 gate 尚未被 snapshot 捕获。最终应以 ledger-backed projection 的 attention 为准。

### 8.3 "toFlowRunDetail 的 gates 和 ledger gates 是一回事"

`toFlowRunDetail` 从传入的 `StateSnapshot` 构建 gates；如果传入的是 live snapshot，gate 状态仍可能不包含 gate.resolved 的幂等保护。如果传入的是 ledger-backed snapshot，`FlowRunDetail.snapshotSource` 会标记为 `"ledger"`。桌面端以 ledger-backed 的 session detail / run detail 为最终权威。

### 8.4 "trailViewModel 可以随意添加新的 snapshot 字段消费"

trailViewModel 中的 builder 函数是纯函数，不产生副作用。但新增字段消费时应注意：
- 该字段在 live snapshot 和 ledger-backed snapshot 中是否一致
- 该字段在 slim 后是否仍然可用
- 该字段在流式过程中的中间态是否有意义

### 8.5 "buildSemanticTimeline 显示所有事件"

默认过滤掉了 `token.delta`、`message.delta`（太高频）和内部管理事件（`worker.claimed`、`queue.updated`、`topology.updated`）。用户可切换"显示内部事件"来查看完整列表。

### 8.6 "snapshot toolCalls 就是 tool result 的最终记录"

`snapshot.toolCalls` 是内存中的 `OraToolCallEnvelope[]`。tool result 的耐久记录是独立的 `RuntimeToolResultLedgerEntry`（在 `snapshot.toolResults` 和 `tool.result` ledger entry 中）。两者可能因 slim/compaction 而不一致，ledger entry 是权威来源。

## 9. 实现边界与演进方向

### 当前实现边界

| 方面 | 当前状态 | 保守边界 |
| --- | --- | --- |
| 投影来源 | `toFlowRunDetail` 传播 `snapshotSource`，终态/hydrate 可消费 ledger-backed snapshot | streaming 期间仍允许 live snapshot；新增终态字段消费必须检查来源 |
| 本地 Trails | 本地合成覆盖全部观测类型 | 观测粒度和 Langfuse 不完全对齐 |
| trailViewModel | 纯函数，全部从 snapshot + trail 派生；Tools tab 会合并 durable `toolResults` | 未来可能需要支持增量更新而非全量重建 |
| compare 标签页 | 仅对比指标数值 | 未实现事件级 diff |
| Latency marks | 依赖 runtime/desktop 打点 | marks 缺失时部分分段无法计算 |
| 事件归属 | 依赖事件的 agentId/nodeId | 旧事件可能缺少这些字段 |

### 可演进方向

1. **更强的投影入口约束**：继续收敛 terminal/hydrate/read model 到 ledger-backed projection，同时保留 streaming live path 的低延迟。
2. **增量 view model**：当前 trailViewModel 每次全量重建。对于大 snapshot（数千事件），可缓存中间结果。
3. **事件级 diff**：compare 标签页可以对比两次运行的 event sequence 差异。
4. **Trails 导出**：将 trail observations 导出为 OpenTelemetry 兼容格式。
5. **工具结果预览**：补齐 `file.patch` diff preview、shell 输出高亮、image 预览等富媒体渲染。

---

> **核心判断**：Snapshot 是运行事实的容器，Projection 把容器中的事实转成结构化 read model，Trails 把事实和 read model 转成可观测的 UI 视图。三层各司其职：snapshot 负责持有，projection 负责解释，trails 负责呈现。UI 不应跳过这些层次直接推断状态。
