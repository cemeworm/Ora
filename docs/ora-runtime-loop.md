# Ora runtime loop 结构图

本文描述当前 Ora runtime loop 的主结构：Task Flow 兼容层、run 外层生命周期、continuation dispatcher、mode 编排层、单个 node 内部的 model-tool loop，以及 plan list、gate、streaming finalization 如何进入持久 projection。

## 阅读地图

Ora 的 runtime loop 不是单一循环，而是几层边界叠在一起：

1. **Task Flow 兼容层**：`flows.*` 是 `runs.*` 上的 orchestration alias，`flowRunId` 当前等于 `runId`，不引入第二套持久状态。
2. **Run 生命周期层**：`LocalRunStore` 保持 public API facade，生命周期、resume、streaming、gate、ledger、projection 等服务负责具体边界。
3. **Continuation 层**：`RunContinuationDispatcher` 根据 ledger-backed continuation frame 决定恢复 suspended node、replay approved tool、whole-mode fallback，或给出 missing-owner diagnostic。
4. **Mode 编排层**：`executeModeSpec` 按 mode nodes/stages 推进 agent 调用，并同步 plan、todo、queue、topology。
5. **Node 执行层**：`runNodeRuntimeLoop` 在单个 agent/node 内做模型调用、工具调用、审批、澄清、plan-list lifecycle、恢复和强制 finalization。

主要源码入口：

- `/apps/runtime/src/run-store.ts`
- `/apps/runtime/src/mode-selection.ts`
- `/apps/runtime/src/run-projections.ts`
- `/apps/runtime/src/run-continuation-dispatcher.ts`
- `/apps/runtime/src/run-kernel-execution-service.ts`
- `/apps/runtime/src/run-resume-finalization-service.ts`
- `/apps/runtime/src/runtime-gate-ledger-service.ts`
- `/apps/runtime/src/run-kernel-lifecycle.ts`
- `/apps/runtime/src/harness/runtime-kernel.ts`
- `/apps/runtime/src/harness/node-runtime-loop.ts`
- `/apps/runtime/src/harness/runtime-tool-call-service.ts`
- `/apps/runtime/src/harness/runtime-tool-recovery-service.ts`
- `/apps/runtime/src/harness/runtime-clarifications.ts`
- `/apps/runtime/src/harness/runtime-interrupts.ts`
- `/apps/runtime/src/patterns/mode-driver-registry.ts`
- `/packages/shared/src/runtime.ts`
- `/packages/shared/src/runtime-ledger.ts`
- `/packages/shared/src/runtime-timeline.ts`

## 0. Task Flow、Run、Session 的边界

```mermaid
flowchart TD
  A["User / Channel / Automation input"] --> B["flows.* / runs.* RPC"]
  B --> C["FlowRun projection"]
  C --> C1["flowRunId = runId in this slice"]
  C --> D["LocalRunStore compatibility facade"]

  D --> E["Run lifecycle / resume / streaming services"]
  D --> F["Gate / ledger / persistence / projection services"]
  E --> G["Kernel execution"]
  F --> H["Session ledger + latest snapshot"]

  G --> I["Mode drivers"]
  I --> J["Node model-tool loop"]
  J --> K["Executor runtimes: model / tool / shell / MCP / channel"]
  K --> F

  H --> L["Session detail / list / desktop attention"]
  C --> M["flows.get detail: gates, checkpoints, activities, latest snapshot"]
```

这一层的重点是所有 flow 概念都先映射到现有 run 基础设施。`FlowRun` 是当前 `StateSnapshot` 和 run projection 的编排视角，`FlowGate` 来自现有 clarification、approval、plan decision 和 cancellation projection。Session 仍然是用户看到的对话容器，flow/run 是持久执行身份。

## 1. 外层 run lifecycle

```mermaid
flowchart TD
  A["User / Channel / Automation input"] --> A1["flows.* / runs.* RPC"]
  A1 --> A2["FlowRun projection (flowRunId = runId for now)"]
  A2 --> B["LocalRunStore compatibility facade"]
  B --> B1["Lifecycle / resume / streaming services"]
  B --> B2["Gate / ledger / projection services"]
  B1 --> C["resolveModeSelection"]
  C --> C1{"modeSelection = auto?"}
  C1 -->|yes| C2["Auto mode router selects modeId + taskIntent"]
  C1 -->|no| C3["Use requested/manual mode"]
  C2 --> D["Resolve ModeSpec + PatternDefinition"]
  C3 --> D
  D --> E["withMemoryPrompt + conversation context"]
  E --> F["RunKernelExecutionService"]
  F --> G["executeRuntimeKernel"]

  G --> H{"clarification preflight?"}
  H -->|needs clarification| I["gate.opened + clarification.required"]
  I --> J["run.interrupted + continuation frame"]
  J --> K["User answers clarification / approves action"]
  K --> L["flows.resume / runs.resume with patch"]
  L --> L1["RunContinuationDispatcher"]
  L1 -->|owner-backed frame| L2["resume suspended node"]
  L1 -->|approved deterministic tool| L3["replay tool, then resume owner"]
  L1 -->|legacy fallback| L4["resume whole mode"]
  L1 -->|missing owner| L5["diagnostic failure"]
  L2 --> L6["gate.resolved + resume finalization"]
  L3 --> L6
  L4 --> B1

  H -->|no / already answered| M["executeModeSpec"]
  M --> N{"mode output"}
  N -->|success| O["Ora root finalizer if needed"]
  O --> P["run.done + ledger snapshot projection"]
  N -->|provider/tool failure unrecovered| Q["run.failed"]
  N -->|approval required| R["gate.opened + approval_required"]
  R --> J

  P --> S{"taskIntent = plan and output has proposed_plan?"}
  S -->|yes| T["FlowGate: plan decision pending"]
  T --> U["User accepts / declines"]
  U -->|accepted| V["accepted plan handoff"]
  V --> W["Next implement run consumes accepted plan"]
  U -->|declined| X["Decision resolved, no handoff"]
  S -->|no| Y["Session idle"]
```

外层循环的关键点：

- `flows.*` 是当前 `runs.*` 的兼容 alias。它暴露 flow vocabulary，但不改变 `runId`、session UX 或持久格式。
- `LocalRunStore` 现在更像兼容 facade。kernel 执行、resume finalization、gate lifecycle、ledger append、persistence 和 projection 已经拆到更窄的服务边界。
- `resolveModeSelection` 先把输入解析成确定的 `ModeSpec`、`PatternDefinition` 和完整 `RunConfig`。
- `modeSelection: "auto"` 会调用 auto mode router，选择 `modeId`，并在 `taskIntentMode: "auto"` 时推断 `taskIntent`。
- 普通 start 和 resume 都会通过 kernel execution 边界进入 `executeRuntimeKernel`，resume 额外带入 clarification patch、approved action ids 和上一轮 resume state。
- kernel 捕获 `ClarificationInterruptError` 和 `ApprovalInterruptError` 后，把 run 标记为 `interrupted`，写入 `continuation` frame，并通过 gate ledger 写入 durable gate facts。
- resume 不再默认等同于 broad mode restart。`RunContinuationDispatcher` 会先读取 active continuation frame，owner-backed frame 优先恢复记录的 agent/node，缺少 owner metadata 的危险 frame 会进入 diagnostic failure。
- plan 模式输出完整 `<proposed_plan>` 后，run 本身可以是 `succeeded`，但 session attention 会变成 `needs_plan_decision`，等待用户接受或拒绝计划。

## 1.1 Continuation dispatcher

```mermaid
flowchart TD
  A["flows.resume / runs.resume"] --> B["Load ledger-backed latest snapshot"]
  B --> C["Read continuation.activeFrameId"]
  C --> D{"RunContinuationDispatcher decision"}

  D -->|approved deterministic tool| E["Replay approved tool/action"]
  E --> F{"completion guard needs model work?"}
  F -->|yes| G["resume_suspended_node using frame owner"]
  F -->|no| H["resume finalization"]

  D -->|manual/tool interrupted with owner| G
  D -->|clarification/approval legacy frame| I["whole-mode resume fallback"]
  D -->|missing required owner| J["diagnostic failure"]
  D -->|unsupported safe fallback| I

  G --> K["RunKernelExecutionService suspended-node resume"]
  K --> L["record node checkpoint / complete frame"]
  I --> M["RunKernelExecutionService whole-mode resume"]
  H --> N["terminal/interrupted projection"]
  J --> N
  L --> N
  M --> N
```

Continuation frame 是 resume ownership 的 source of truth。Frame 记录 `agentId`、`nodeId`、`planItemId`、pending action/tool/clarification ids、conversation cursor，以及 node checkpoint metadata。Owner-backed frame 能恢复到暂停的 agent/node；ownerless legacy approval/clarification frame 可以走 whole-mode fallback；ownerless manual/tool-interrupted frame 不能安全恢复，会以可见 diagnostic failure 结束。

## 2. Mode 编排层

```mermaid
flowchart TD
  A["executeModeSpec"] --> A1["ModeDriverRegistry selects driver"]
  A1 --> B["orderedEnabledModeNodes(modeSpec)"]
  B --> C["initializeQueueSummary"]
  C --> D["For each mode node / stage"]

  D --> E{"node has clarificationQuestion + clarification_interrupt atom?"}
  E -->|yes, unanswered| F["ensureClarification"]
  F --> G["node blocked + run interrupted"]
  E -->|no / answered| H["setPlanStatus: running"]

  H --> I{"node atom: subagent_delegate?"}
  I -->|yes| J["runDelegatedTask"]
  I -->|no| K["direct node execution"]
  J --> L["callAgent"]
  K --> L

  L --> L1["checkpointNode / node.updated"]
  L1 --> M["runNodeRuntimeLoop"]
  M --> N{"node result"}
  N -->|completed| O["memory_capture / artifact_publish if enabled"]
  O --> P["setPlanStatus: done"]
  P --> Q["queue.updated + topology.updated"]
  Q --> D

  N -->|skipped via recovery| R["setPlanStatus: skipped"]
  R --> Q
  N -->|interrupt| G
  N -->|failed| S["recovery policy or run.failed"]

  D --> T["mode output"]
  T --> U{"plan mode and contains proposed_plan?"}
  U -->|yes| V["skip remaining nodes, finish plan mode"]
  U -->|no| W["kernel finalization"]
```

Mode 编排影响 loop 的方式：

- mode 决定 `nodes`、`profiles`、`stages`、`runtimeAtoms`、tool/skill scope、默认 budget、completion policy 和 recovery policy。
- `ModeDriverRegistry` 里的不同 driver 会把 mode 转成不同执行形态，例如 single owner、orchestrator/subagent、generator/verifier、agent teams、staged transcript。
- 每个 node 进入 `runNode` 时会更新 plan/todo/queue 状态，运行结束后再同步 topology 和 queue。
- built-in pattern drivers 通过 `runGenericModeNode` 记录 node-level bag checkpoint。Continuation resume 可以用这些 checkpoint 判断如何恢复 owner-backed suspended node，而不是从 mode 入口重新跑旧节点。
- 带 `clarification_interrupt` atom 的 mode/node 可以在执行前或执行中主动挂起，等待用户补充信息。
- 带 `subagent_delegate` atom 的 node 会通过 delegated task 事件显式标记任务委派。
- plan 模式中一旦产出完整 `<proposed_plan>`，后续 node 可以被跳过，避免计划已经完备后继续跑无关阶段。

## 3. 单个 node 的 model-tool loop

```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> running_model: tools allowed
  pending --> finalizing: tool budget exhausted

  running_model --> tool_requested: native/fallback tool call detected
  running_model --> plan_lifecycle: no tool + completion candidate
  plan_lifecycle --> completed: plan lifecycle + guards pass
  plan_lifecycle --> running_model: guard follow-up
  plan_lifecycle --> failed: unchanged guard cycle bound

  tool_requested --> finalizing: attempt denied by completion policy
  tool_requested --> failed: code-development boundary violation
  tool_requested --> approval_required: definition/policy requires approval
  approval_required --> interrupted: ApprovalInterruptError
  interrupted --> running_model: resume approved action

  tool_requested --> tool_running: approval not required / resumed approval
  tool_running --> clarification_required: tool/middleware asks clarification
  clarification_required --> interrupted: ClarificationInterruptError
  interrupted --> tool_running: resume with clarification answer

  tool_running --> tool_result_observed: tool succeeded
  tool_result_observed --> running_model: append tool result as context

  tool_running --> degraded: tool execution failure
  degraded --> tool_running: recovery retry / alternate tool
  degraded --> repairing: fallback artifact
  repairing --> running_model: follow-up with degraded result
  degraded --> failed: recovery exhausted
  running_model --> running_model: provider transient retry

  running_model --> finalizing: max tool calls / repeat / loop limit
  finalizing --> completed: forced final provider call
  completed --> [*]
  failed --> [*]
```

`NodeRuntimeLoopState` 当前包括：

- `pending`
- `running_model`
- `tool_requested`
- `tool_running`
- `tool_result_observed`
- `repairing`
- `finalizing`
- `completed`
- `degraded`
- `interrupted`
- `failed`

图里的 `plan_lifecycle` 是 completion guard 前的概念性 hook，不是 `NodeRuntimeLoopState` 的持久状态值。源码里的状态转换仍然从 `running_model` 进入 `completed`、`running_model` follow-up 或 `failed`。

内层循环的关键点：

- provider 支持 native tools 时优先走 native tool call；否则从文本里解析 JSON fallback tool call。
- 每次工具调用都会注册 completion attempt，用于限制重复调用、工具预算、loop safety limit。
- 工具执行走 definition-first registry。`RuntimeToolCallService` 负责普通工具调用 orchestration，definition 和 policy hook 决定风险、审批 copy 和执行行为。
- 高风险、manual approval 或 policy hook 要求审批时，工具 action 会进入 approval gate；未批准时抛 `ApprovalInterruptError`。
- 工具或 middleware 需要用户信息时，通过 `ensureClarification(s)` 抛 `ClarificationInterruptError`。
- 工具成功后，结果会被写回 messages，然后继续下一次模型调用。
- 自然完成候选进入 completion guard 前，runtime 会先运行 plan-list lifecycle hook。它只基于当前 agent/node 的 successful non-plan tool evidence 推进 active step，不从纯文本语义猜测完成状态。
- completion guard 会对 unchanged `plan_list.incomplete` 结果做 fingerprint 计数，重复无进展超过边界后失败，避免无限发出同一条继续运行提示。
- 工具执行失败后进入 `RuntimeToolRecoveryService`：可 retry、alternate tool、fallback artifact，或最终 fail。这个 recovery surface 只允许从 `tool_running` 进入 `degraded`。
- 工具结果已经记录后，follow-up model/provider 的 transient 或 busy failure 留在 `running_model` phase，由 provider recovery 重试同一个 model request，不会重跑已经成功的工具。
- 如果非 tool-running phase 错误进入 tool recovery boundary，runtime 会发 `tool_recovery_boundary` diagnostic 并停止这条错误恢复路径，不会放宽成 `running_model -> degraded`。
- 当工具预算耗尽、重复调用被拦截或 runtime loop limit 到达时，进入 forced final answer，禁止继续调用工具。

## 中断、澄清、审批、决策的区别

```mermaid
flowchart LR
  A["Runtime needs external input"] --> B{"kind"}
  B --> C["Clarification"]
  B --> D["Approval"]
  B --> E["Plan decision"]
  B --> F["Manual interrupt/cancel"]

  C --> C1["clarification.required event"]
  C1 --> C2["ClarificationInterruptError"]
  C2 --> C3["gate.opened + run.interrupted"]
  C3 --> C4["resume with clarifications patch"]
  C4 --> C5["gate.resolved + resumed projection"]

  D --> D1["action/tool approval_required"]
  D1 --> D2["ApprovalInterruptError"]
  D2 --> D3["gate.opened + run.interrupted"]
  D3 --> D4["resume with approvedActionIds / approvedActions"]
  D4 --> D5["gate.resolved + resumed projection"]

  E --> E1["run.done but PlanDecisionGate pending"]
  E1 --> E2["attention: needs_plan_decision"]
  E2 --> E3["accept -> accepted plan handoff"]
  E3 --> E4["next implement run consumes handoff"]

  F --> F1["run.interrupted or run.cancelled"]
  F1 --> F2["cancellation / manual attention projection"]
```

Important distinction:

- **Clarification/approval** 会中断当前 kernel run，并依赖 `flows.resume` / `runs.resume` 回到同一个 kernel loop。
- **Plan decision** 不一定中断 run；它通常发生在 plan run 成功之后，是 session-level gate。
- **Attention** 是 UI/会话层看到的阻塞状态。当前实现从 ledger-backed snapshot 和 gate projection 推导 attention，再供 session detail、session list、latest snapshot、desktop sidebar/chat/timeline 使用。clarification、approval、plan decision 和 cancellation 都应该表现为 durable gate/projection 事实，不能只依赖 UI 本地状态。

## Mode 编排对 loop 的影响清单

| 机制 | 影响 |
| --- | --- |
| `modeSelection` | manual 直接使用请求模式；auto 先用 router 选择 mode 和 task intent。 |
| `taskIntent` | chat/plan/implement 会改变系统提示、是否允许修改、是否生成 plan decision、是否消费 accepted plan。 |
| `runtimeAtoms` | 开启 clarification interrupt、recovery policy、memory capture、artifact publish、delegation、shared state 等能力。 |
| `profiles` | 决定 agent 身份、工具集合、skill 集合和 system overlay。 |
| `nodes/stages` | 决定 mode 的执行顺序、handoff、stage transcript 和 plan/todo 进度。 |
| `capabilityFlags.toolIds` | 决定 agent 可用工具；部分 mode 会禁用默认 web tools 或启用特定工具。 |
| `completionPolicy` | 影响工具预算、重复调用限制、forced final answer。 |
| `approvalMode` | auto/high_risk_only/manual 决定 action 是否进入审批 gate。 |
| `recoveryPolicy` | provider failure 在 model phase 内 retry/fail；tool execution failure 才进入 retry、alternate tool、fallback artifact 或 fail。 |
| `memoryPolicy` | mode 含 long-term memory atom 时可注入 active memory，并在 run 后更新 memory。 |

## Plan list 生命周期

```mermaid
flowchart TD
  A["Model calls plan.update"] --> B["runtime-plan-list-state canonicalizes payload"]
  B --> C{"valid plan status invariant?"}
  C -->|yes| D["emit plan_list.updated"]
  C -->|no| E["reject before ledger event"]

  F["Tool/action created"] --> G["bind active planStepId when available"]
  G --> H["successful non-plan tool evidence"]
  H --> I{"completion candidate for same agent/node?"}
  I -->|yes| J["pre-guard plan lifecycle hook"]
  J --> K["complete bound/active step"]
  K --> L["activate next pending step or finish plan"]
  L --> D

  M["completion guard sees incomplete plan"] --> N["fingerprint guard result"]
  N --> O{"unchanged too many cycles?"}
  O -->|no| P["follow-up model message"]
  O -->|yes| Q["diagnostic failure"]
```

`plan.update` 的 wire shape 仍然是 `{ explanation?, plan: [{ step, status }] }`，但 runtime 会在事件进入 ledger 前验证和 canonicalize。未完成的 plan list 必须有且只有一个 `in_progress` step，全部完成时才允许没有 active step。

Runtime 也会给 plan step 生成稳定 id，并把新的 action/tool call 绑定到当前 active `planStepId`。Node loop 在 completion guard 前检查当前 agent/node 的 successful non-plan tool evidence；如果证据绑定到 plan step，就优先推进这个 step，否则只在存在单一 active step 时推进。这个 hook 不根据自然语言猜测任务完成，只处理已有工具生命周期证据。

## Scoped runtime events

Agent/tool context 里发出的 runtime event 应该带上执行上下文。`RuntimeToolCallService` 这类已知 `{ agentId, nodeId }` 的边界会用 scoped emitter 给缺失的 event metadata 补默认 attribution，同时保留调用方显式传入的 `agentId` / `nodeId`。

这条规则尤其影响 `plan.update`。模型调用 `plan.update` 后产生的 `plan_list.updated` 是执行 agent 的事件，不是 root/system 事件；desktop timeline 和 trail projection 应该消费 runtime 给出的 attribution，而不是靠前端推断上一条 agent。

## Ledger 和 streaming finalization

```mermaid
flowchart TD
  A["streaming runtime events"] --> B["runtime.event_batch"]
  B --> C["payload.events stores incremental events"]
  B --> D["compact payload.snapshot with events: []"]
  C --> E["ledger projection reconstructs full snapshot.events"]
  D --> E

  F["provider SSE"] --> G{"terminal signal"}
  G -->|"data: [DONE]"| H["finish provider stream"]
  G -->|"idle watchdog timeout"| I["fail stream"]
  H --> J["run.done / terminal snapshot"]
  I --> K["run.failed projection"]

  L["maintenance staleRunningMs"] --> M["ledger-projected queued/running with no progress"]
  M --> N["append terminal run.failed"]
```

新的 streaming event batch 不再存累计的 `snapshot.events`，完整事件历史由 ledger `payload.events` 重建。旧的 full snapshot row 仍然兼容。Provider stream 会把 SSE `[DONE]` 当作 terminal signal，即使 transport 没有关闭也会结束；idle/no-progress stream 会失败，不再无限等待。Runtime maintenance 可以把超过 `staleRunningMs` 的 stale queued/running ledger projection 收敛成 terminal failed run。

## 特殊路径

### Code Development boundary

`code_development` mode 下，orchestrator 不能执行 mutation 类工具，例如：

- `file.write`
- `file.patch`
- `file.delete`
- `modes.applyDraft`
- `selfIteration.apply`
- `skills.create`
- `skills.update`
- `skills.setEnabled`
- 高风险 `shell.execute`

orchestrator 负责计划和协调，实际代码修改必须落到 builder 阶段。

### Accepted plan handoff

plan run 输出 `<proposed_plan>` 后：

1. snapshot 归一化时生成 pending `PlanDecisionGate`。
2. 用户 accept 后，session ledger 记录 `handoff.accepted_plan`。
3. 下一次 `taskIntent: "implement"` 的 run 会把 accepted plan 注入 conversation context。
4. implement run 启动后会把 handoff 标记为 consumed，避免重复消费。

### Resume continuation

当 run 因 clarification、approval、manual interrupt 或 tool interrupt 暂停：

1. kernel 创建 `continuation.activeFrameId`。
2. frame 记录 pending action/tool/clarification ids、agent、node、plan item、conversation cursor 和可用的 node checkpoint。
3. resume 时，`flows.resume` / `runs.resume` 把 clarification patch、approved actions 或 manual/tool continuation intent 交给 resume service 边界。
4. `RunContinuationDispatcher` 先基于 frame reason、owner metadata、pending ids 和 checkpoint 判断 resume 策略。
5. owner-backed frame 通过 suspended-node resume 回到记录的 agent/node；approved deterministic tool 会先 replay action，再根据 completion guard 决定是否回到 owner node。
6. gate ledger 记录 `gate.resolved`，resume finalization 负责最终 snapshot、ledger、persistence 和 session projection 收敛。

## 建议的文档呈现方式

推荐在架构文档或产品说明里分层画图，而不是合并为一张：

- Flow/Run/Session 边界图给产品和平台接口理解：为什么 flow 是持久执行身份，session 是用户对话容器。
- Run lifecycle 图给前端和 runtime 调用方理解：为什么有 running、interrupted、needs decision、resume。
- Mode 编排图给 mode 作者理解：mode spec 如何映射到 runtime 编排。
- Node loop 图给 runtime 工程理解：模型、工具、审批、澄清、恢复在一个 node 内如何循环。

如果要做交互式可视化，可以把边界映射成：

- **Flow lane**：flowRunId、linked sessions、gates、checkpoints、activities。
- **Run lane**：run status、attention、continuation frame、checkpoint、session ledger。
- **Mode lane**：node/stage、plan/todo、planStepId、queue/topology。
- **Agent lane**：model call、tool call、action approval、clarification、recovery。
