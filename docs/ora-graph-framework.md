# Ora 图框架：智能体建模为有向图

本文描述 Ora 如何将智能体和工作流统一建模为有向图，覆盖数据模型、模式蓝图、运行时投影和执行管线。

## 1. 概述

Ora 的核心架构决策之一是：**每个工作模式都是一张有向图，运行时是一个图执行引擎**。无论是 Generator-Verifier 的验证循环、Orchestrator-Subagent 的层级委派，还是 Message Bus 的事件路由，最终都映射为同一套图原语 —— 节点和边。

这套框架完全自研，不依赖 LangGraph、Dagre、React Flow 等外部图库。所有类型用 Zod schema 定义、TypeScript 类型推导，运行时在 Node.js 进程中直接执行。

### 阅读地图

| 概念 | 定义位置 | 角色 |
| --- | --- | --- |
| TopologyNode / TopologyEdge | `packages/shared/src/topology.ts` | 运行时图原语 |
| PatternDefinition | `packages/shared/src/modes.ts:9-41` | 内置协调模式蓝图 |
| ModeSpec / ModeNodeSpec / ModeEdgeSpec | `packages/shared/src/modes.ts:79-314` | 用户可编辑的模式图定义 |
| AgentProfile | `packages/shared/src/primitives.ts:128-141` | 智能体配置，绑定到图节点 |
| projectModeRuntimeTopology | `packages/shared/src/modes.ts:1135` | ModeSpec → 运行时拓扑投影 |
| KernelRuntimeContext | `apps/runtime/src/harness/runtime-kernel.ts:160` | 运行时拓扑持有者 |
| injectRootAgentTopology | `apps/runtime/src/harness/runtime-root-agent.ts:34` | 注入根智能体到拓扑 |

## 2. 图数据模型：TopologyNode 和 TopologyEdge

### 2.1 TopologyNode（拓扑节点）

节点是图的执行单元。每个节点在运行时拥有独立的状态机。

```typescript
// packages/shared/src/topology.ts
const TopologyNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["run", "agent", "capability", "checkpoint", "artifact"]),
  agentId: z.string().min(1).optional(),
  status: z.enum(["idle", "running", "blocked", "done", "failed"]).default("idle"),
  metadata: z.record(z.unknown()).default({}),
});
```

#### 节点类型（kind）

| kind | 含义 | 示例 |
| --- | --- | --- |
| `run` | 运行入口，每个拓扑有且仅有一个 | `{ id: "run", label: "Run" }` |
| `agent` | 智能体节点，通过 `agentId` 绑定 AgentProfile | `{ id: "orchestrator", kind: "agent", agentId: "orchestrator" }` |
| `capability` | 运行时能力节点，由 Runtime Atom 注入 | `{ id: "shared_board", kind: "capability", metadata: { role: "blackboard" } }` |
| `checkpoint` | 快照检查点 | 运行中断时插入的恢复点 |
| `artifact` | 产物节点 | 文件、报告等输出 |

#### 节点状态机

```
idle → running → done
              → blocked  (等待审批/澄清)
              → failed   (不可恢复的错误)
```

`blocked` 状态的节点在审批通过或澄清回答后会恢复为 `running`，最终走向 `done`。

### 2.2 TopologyEdge（拓扑边）

边定义节点间的关系和数据流向。

```typescript
// packages/shared/src/topology.ts
const TopologyEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1).optional(),
  kind: z.enum(["control", "delegation", "verification", "memory", "artifact"]),
  metadata: z.record(z.unknown()).default({}),
});
```

#### 边类型（kind）

| kind | 语义 | 典型用法 |
| --- | --- | --- |
| `control` | 控制流，定义执行顺序 | `run → orchestrator` |
| `delegation` | 委派，任务分发 | `orchestrator → researcher` |
| `verification` | 验证，检查/评审 | `generator → verifier`，`builder → reviewer` |
| `memory` | 记忆读写 | `researcher → shared_board` |
| `artifact` | 产物传递 | `router → triage_topic` |

### 2.3 图解：orchestrator_subagent 的拓扑

以最常用的编排-子智能体模式为例，其 PatternDefinition 中的拓扑结构为：

```
nodes:
  run (kind: run)
  orchestrator (kind: agent, agentId: orchestrator)
  researcher (kind: agent, agentId: researcher)
  reviewer (kind: agent, agentId: reviewer)

edges:
  run → orchestrator        (control)
  orchestrator → researcher (delegation, label: "research")
  orchestrator → reviewer   (delegation, label: "review")
```

运行时内核注入根智能体 Ora 后，拓扑变为：

```
  run → Ora (root agent) → orchestrator → researcher
                                        → reviewer
```

## 3. PatternDefinition：内置蓝图

`PatternDefinition` 是协调模式的不可变蓝图。每个模式定义包含完整的拓扑、智能体配置、执行模板和约束。

```typescript
// packages/shared/src/modes.ts:9-41
const PatternDefinitionSchema = z.object({
  id: CoordinationPatternSchema,
  label: z.string().min(1),
  summary: z.string().min(1),
  recommendedUse: z.string().min(1),
  failureMode: z.string().min(1),
  coordinationKind: z.enum(["loop", "hierarchical", "team", "bus", "shared_state"]),
  stateModel: z.enum(["ephemeral", "persistent_workers", "event_routed", "shared_blackboard"]),
  topology: z.object({
    nodes: z.array(TopologyNodeSchema),
    edges: z.array(TopologyEdgeSchema),
  }),
  planTemplate: z.array(z.object({
    id: z.string(),
    title: z.string(),
    ownerAgentId: z.string().optional(),
    dependencies: z.array(z.string()),
  })),
  profiles: z.array(AgentProfileSchema).min(1),
  defaultStopPolicy: z.object({ type, maxIterations, idleCycles, detail }),
  defaultConstraints: z.array(z.string()),
  defaultBudget: ResourceBudgetSchema,
});
```

### 3.1 五种协调模式详解

所有定义在 `MVP_PATTERN_DEFINITIONS`（`modes.ts:1222`）。

#### Generator-Verifier

```
coordinationKind: "loop"     stateModel: "ephemeral"
```

| 属性 | 值 |
| --- | --- |
| 拓扑 | `run → generator → verifier` |
| 智能体 | generator（生成候选）、verifier（按 rubric 验收） |
| Plan 模板 | draft → verify |
| 停止策略 | max_iterations（最多 3 轮） |
| 推荐场景 | 有明确验收标准的任务 |
| 失败模式 | 弱 rubric 导致虚假信心或无效重试循环 |

Verifier 节点以结构化 JSON `{ verdict, rationale, missingRequirements }` 返回验收结果，verdict 为 "pass" 时循环终止。

#### Orchestrator-Subagent

```
coordinationKind: "hierarchical"     stateModel: "ephemeral"
```

| 属性 | 值 |
| --- | --- |
| 拓扑 | `run → orchestrator → researcher, reviewer` |
| 智能体 | orchestrator（分解+综合）、researcher（收集证据）、reviewer（审查风险） |
| Plan 模板 | decompose → research → review → synthesize |
| 停止策略 | queue_drained（队列耗尽） |
| 推荐场景 | 可分解任务，需要可审查的委派链路 |
| 失败模式 | 过度分解消耗预算在协调而非进展上 |

这是 Ora 的默认模式。Orchestrator 先分解任务，将 research 和 review 委派给子智能体，最后综合所有结果。

#### Agent Teams

```
coordinationKind: "team"     stateModel: "persistent_workers"
```

| 属性 | 值 |
| --- | --- |
| 拓扑 | `team_lead → builder → reviewer → team_lead`（闭环） |
| 智能体 | team_lead（优先级+协调）、builder（执行）、reviewer（验收） |
| Plan 模板 | triage → build → check → handoff |
| 停止策略 | queue_drained |
| 推荐场景 | Worker 需要跨任务保持身份和记忆 |
| 失败模式 | 所有权不清导致重复工作或过时的 worker 记忆 |

Agent Teams 的独特之处在于 Worker 是持久化的（`persistent_workers`），有自己的 memory namespace（`worker`），可以在多次运行间积累上下文。

#### Message Bus

```
coordinationKind: "bus"     stateModel: "event_routed"
```

| 属性 | 值 |
| --- | --- |
| 拓扑 | `run → router → triage_topic (capability) → researcher → responder` |
| 智能体 | router（分类+路由）、researcher（处理路由项）、responder（发布最终响应） |
| Plan 模板 | publish → route → handle → respond |
| 停止策略 | queue_drained |
| 推荐场景 | 事件驱动的可扩展管线 |
| 失败模式 | 丢弃或错误路由的事件可能无声地停滞系统 |

Message Bus 引入了 `capability` 节点（`triage_topic`），事件通过 `artifact` 边路由到 topic，再通过 `delegation` 边投递给订阅者。

#### Shared State

```
coordinationKind: "shared_state"     stateModel: "shared_blackboard"
```

| 属性 | 值 |
| --- | --- |
| 拓扑 | `orchestrator → shared_board (capability) ← researcher, reviewer` |
| 智能体 | orchestrator（播种+框架）、researcher（贡献发现）、reviewer（判断收敛） |
| Plan 模板 | seed → research → converge |
| 停止策略 | converged（收敛检测，默认 idleCycles=2） |
| 推荐场景 | 智能体需要近实时基于彼此发现协作 |
| 失败模式 | 无显式终止规则时智能体可能循环写入或重复工作 |

Shared State 以 `shared_board` capability 节点为中心，所有智能体通过 `memory` 边读写共享黑板。停止条件不是固定轮次，而是"连续 N 个周期无新发现"的收敛检测。

### 3.2 createModeSpecFromPattern

```typescript
// packages/shared/src/modes.ts:1707
function createModeSpecFromPattern(pattern: CoordinationPattern): ModeSpec
```

该函数将 PatternDefinition 转换为一个完整的 ModeSpec：
- 用 `planTemplate` 生成 ModeNodeSpec 数组（含默认 instructions）
- 根据模板依赖关系自动生成边
- 应用 family 对应的默认 runtime atoms
- 设置 editorConstraints（限制可用的节点模板和编辑权限）

## 4. ModeSpec：可编辑的有向图

`ModeSpec` 是用户可见、可在 Mode Studio 中编辑的模式定义。它本质上是一个包含执行策略、智能体配置和编辑器约束的图。

### 4.1 ModeNodeSpec

```typescript
// packages/shared/src/modes.ts:79-92
const ModeNodeSpecSchema = z.object({
  id: z.string().min(1),
  template: ModeNodeTemplateSchema,  // 17 种模板之一
  label: z.string().min(1),
  title: z.string().min(1).optional(),
  ownerAgentId: z.string().min(1).optional(),  // 绑定到 AgentProfile
  position: ModeNodePositionSchema.optional(),   // 可视化布局
  enabled: z.boolean().default(true),
  instructions: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  riskLevel: ActionRiskLevelSchema.optional(),
  config: z.record(z.unknown()).default({}),
});
```

#### 17 种节点模板及按 family 的分配

| 模板 | 语义 | generator_verifier | orchestrator_subagent | agent_teams | message_bus | shared_state |
| --- | --- | :-: | :-: | :-: | :-: | :-: |
| draft | 生成候选输出 | ✓ 必选 | | | | |
| verify | 按 rubric 验收 | ✓ 必选 | | | | |
| decide | 接受/重试/停止决策 | ✓ | | | | |
| decompose | 分解任务 | | ✓ 必选 | | | |
| research | 收集证据和上下文 | | ✓ | | | ✓ |
| review | 审查风险和完整性 | | ✓ | | | |
| synthesize | 综合最终输出 | | ✓ 必选 | | | |
| triage | 分流为团队 backlog | | | ✓ 必选 | | |
| build | 完成分配的工作项 | | | ✓ | | |
| check | 验收已完成工作 | | | ✓ | | |
| handoff | 记录移交和下一步 | | | ✓ 必选 | | |
| publish | 发布事件 | | | | ✓ 必选 | |
| route | 路由事件到订阅者 | | | | ✓ 必选 | |
| handle | 处理订阅的工作 | | | | ✓ | |
| respond | 发布最终响应 | | | | ✓ 必选 | |
| seed | 播种共享黑板 | | | | | ✓ 必选 |
| converge | 判断收敛并终结 | | | | | ✓ 必选 |

每个模板在 `MODE_NODE_RUNTIME_TEMPLATE_LIBRARY`（`modes.ts:491`）中有对应的运行时定义，包括 description、display story、fallbackInstructions 和 fallbackPrompt。

### 4.2 ModeEdgeSpec

```typescript
// packages/shared/src/modes.ts:94-102
const ModeEdgeSpecSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1).optional(),
  kind: TopologyEdgeSchema.shape.kind.default("control"),
  enabled: z.boolean().default(true),
});
```

边的 `kind` 默认是 `control`。Mode Studio 中用户可以拖拽连线来创建和编辑边。

### 4.3 Runtime Atoms：可插拔的运行时能力

Ora 定义了 15 种运行时原子（`modes.ts:104-120`），它们是可插拔的运行时能力，按需注入拓扑：

| Atom | scope | 说明 |
| --- | --- | --- |
| `thread_workspace` | mode | 线程工作区 |
| `recovery_policy` | mode | 工具恢复策略 |
| `tool_error_boundary` | mode | 工具错误边界 |
| `loop_guard` | mode | 循环守卫 |
| `clarification_interrupt` | mode | 澄清中断 |
| `memory_capture` | mode | 记忆捕获 |
| `long_term_memory` | mode | 长期记忆 |
| `deferred_tool_discovery` | mode | 延迟工具发现 |
| `subagent_delegate` | node | 子智能体委派 |
| `persistent_worker_memory` | mode | 持久 Worker 记忆 |
| `event_routing` | mode | 事件路由 |
| `shared_blackboard` | mode | 共享黑板 |
| `artifact_publish` | mode | 产物发布 |
| `token_usage_trace` | mode | Token 用量追踪 |
| `dynamic_stage_skipping` | node | 动态阶段跳过 |

Atom 有三种拓扑呈现方式：
- **`family_capability`**：直接注释已有的 family 内置节点（不新增节点）
- **`mode_capability`**：新增 mode 级别的 capability 节点
- **`stage_attachment`**：为特定 stage/node 新增 capability 节点

Atom 的兼容性由 `compatibleFamilies` 控制。例如 `shared_blackboard` 只在 `shared_state` 模式下可用，`event_routing` 只在 `message_bus` 模式下可用。

### 4.4 ModeSpec 的完整结构

```
ModeSpec
├── id, family, label, summary, description
├── nodes: ModeNodeSpec[]          ← 图的节点
├── edges: ModeEdgeSpec[]          ← 图的边
├── profiles: AgentProfile[]       ← 绑定到节点的智能体
├── runtimeAtoms: RuntimeAtomId[]  ← 启用的运行时能力
├── stages: ModeStageSpec[]        ← 多说话人 transcript 阶段（可选）
├── stopPolicy                     ← 停止策略
├── completionPolicy               ← 完成策略
├── runtimePolicy                  ← 运行时策略（thinking、planning、delegation）
├── recoveryPolicy                 ← 恢复策略
├── memoryPolicy                   ← 记忆策略
├── toolLimits                     ← 工具限制
├── capabilityFlags                ← 能力标志
├── editorConstraints              ← 编辑器约束
├── transcriptLayout               ← 对话布局
└── defaultBudget                  ← 默认资源预算
```

## 5. 从 ModeSpec 到运行时拓扑

`projectModeRuntimeTopology`（`modes.ts:1135`）是将 ModeSpec 投影为运行时拓扑的核心管线：

```
ModeSpec
  │
  ├─→ getPatternDefinition(family)    // 获取 family 蓝图
  ├─→ orderedEnabledModeNodes(mode)   // 拓扑排序 mode nodes
  ├─→ runtimeBaseTopology(...)        // 克隆 family 拓扑 + 应用 mode 元数据
  │
  ├─→ Mode-scoped atoms:
  │     • family_capability → 注释已有节点
  │     • mode_capability  → 新增 capability 节点 + 边
  │
  └─→ Node-scoped atoms:
        • stage_attachment  → 为每个 node 新增 capability 节点 + 边
```

投影结果是一个 `{ nodes: TopologyNode[], edges: TopologyEdge[] }` 结构，移除了所有 ModeSpec 层的编辑器元数据（position 等），只保留运行时需要的字段。

## 6. Runtime 执行：Kernel 如何消费拓扑

### 6.1 初始化

运行时内核在 `executeRuntimeKernel`（`runtime-kernel.ts:678`）中初始化拓扑：

1. **投影**：调用 `projectModeRuntimeTopology(modeSpec)` 得到运行时拓扑
2. **注入根智能体**：调用 `injectRootAgentTopology(topology, modeSpec)` 注入 Ora 根智能体
   - 添加 `ora` agent 节点（标记 `rootAgent: true`）
   - 添加 `run → ora` control 边
   - 确定 handoff 目标（mode 的第一个 agent 节点）
   - 添加 `ora → handoffTarget` delegation 边
3. **创建上下文**：将最终拓扑传入 `KernelRuntimeContext` 构造函数

```typescript
// runtime-root-agent.ts:34
function injectRootAgentTopology(
  topology: { nodes: TopologyNode[]; edges: TopologyEdge[] },
  modeSpec: ModeSpec,
): { nodes: TopologyNode[]; edges: TopologyEdge[]; handoffTargetId?: string }
```

### 6.2 状态追踪与事件

`KernelRuntimeContext` 持有运行时拓扑，并通过 `setTopologyStatus` 追踪节点状态变化：

```typescript
// runtime-kernel.ts:268
setTopologyStatus(agentId: string, status: "idle" | "running" | "done" | "blocked" | "failed") {
  for (const node of this.topologyValue.nodes) {
    if (node.agentId === agentId || node.id === agentId) {
      node.status = status;
    }
  }
  this.emit("topology.updated", this.topologyValue, { agentId, nodeId: agentId });
}
```

每次状态变更都会：
1. 更新拓扑中对应节点的 `status` 字段
2. 发出 `topology.updated` 事件，携带完整拓扑快照
3. `StateSnapshot.topology` 始终反映当前图状态

### 6.3 执行流

`KernelRunner`（`runtime-kernel-runner.ts`）编排整个执行：

1. `emitStartEvents()` — 发出 `topology.updated` 初始事件（所有节点为 idle）
2. Mode driver 按 `orderedEnabledModeNodes` 顺序迭代节点
3. 对每个节点调用 `runNodeRuntimeLoop`（`node-runtime-loop.ts`）
4. 节点状态变更通过 `setTopologyStatus` 追踪
5. `flushMemory()` — 刷新记忆捕获队列
6. 组装最终 StateSnapshot（含 `topology` 字段）返回

每个节点的执行状态机详见 `docs/ora-runtime-loop.md` 第三节。

## 7. AgentProfile：智能体与拓扑节点的绑定

`AgentProfile` 定义了智能体的身份和能力，通过 `agentId` 绑定到拓扑中的 agent 节点。

```typescript
// packages/shared/src/primitives.ts:128-141
const AgentProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  role: z.string().min(1),
  systemPrompt: z.string().min(1).optional(),
  customAgentId: z.string().min(1).optional(),  // 引用自定义智能体
  modelRef: z.string().min(1).optional(),        // 模型引用
  toolPolicyId: z.string().min(1),               // 工具策略
  toolIds: z.array(z.string()),                   // 工具列表
  skillIds: z.array(z.string()),                  // 技能列表
  memoryNamespaces: z.array(z.string()),          // 记忆命名空间
  budget: ResourceBudgetSchema,                   // 资源预算
});
```

### 绑定关系

```
TopologyNode.agentId ──────→ AgentProfile.id
ModeNodeSpec.ownerAgentId ──→ AgentProfile.id
PatternDefinition.profiles ─→ AgentProfile[]
```

在 `orchestrator_subagent` 中：
- `{ agentId: "orchestrator" }` 的节点绑定到 `id: "orchestrator"` 的 profile
- profile 的 `toolPolicyId: "orchestrator_subagent"` 决定其工具权限
- `memoryNamespaces: ["session", "project"]` 决定其记忆范围

### Ora 根智能体

所有模式都会注入一个根智能体 Ora（`ORA_ROOT_AGENT_ID = "ora"`），定义在 `runtime-root-agent.ts`：

- 接收用户消息的第一入口
- 根据 mode selection 决定是否委派给模式智能体
- 编写最终面向用户的响应
- 不暴露内部链式思维或元数据

## 8. 与 Runtime Loop 的关系

图框架和 Runtime Loop 是 Ora 的两个正交维度：

| 维度 | 图框架 | Runtime Loop |
| --- | --- | --- |
| 关注点 | **定义什么运行**：拓扑结构、智能体、关系 | **描述怎么运行**：状态机、事件、生命周期 |
| 文档 | 本文档 | `docs/ora-runtime-loop.md` |
| 关键类型 | TopologyNode, TopologyEdge, ModeSpec, PatternDefinition | RunStatus, StateSnapshot, OraEventEnvelope |
| 执行入口 | `projectModeRuntimeTopology` + `injectRootAgentTopology` | `executeRuntimeKernel` → `executeModeSpec` → `runNodeRuntimeLoop` |

在三层 Runtime Loop 中的对应关系：
- **外层 Run 生命周期**：在 kernel 初始化阶段调用 `projectModeRuntimeTopology` 和 `injectRootAgentTopology`，构建初始拓扑
- **中层 Mode 编排**：驱动按 `orderedEnabledModeNodes` 拓扑排序后的节点依次执行，每完成一个节点就更新 topology 状态
- **内层 Node Loop**：单个节点的 model-tool loop，状态变更通过 `setTopologyStatus` 发出 `topology.updated` 事件

Mode 驱动器的选择基于 `ModeSpec.family`：`ModeDriverRegistry` 根据协调模式 family 选择对应的 driver（orchestrator-subagent driver、generator-verifier driver 等）。

## 9. 扩展与自定义

### 9.1 Mode Studio

用户可以在 Mode Studio 中可视化编辑模式图：
- 拖拽节点（从允许的模板中选择）
- 连线定义执行顺序
- 为每个节点选择 owner agent 和 instructions
- 启用/禁用 runtime atoms

编辑器约束由 `ModeEditorConstraints` 控制：
- `allowedNodeTemplates`：可用的节点模板（受 family 限制）
- `requiredNodeTemplates`：必须存在的节点模板
- `readOnly`：是否只读
- `allowReorder / allowCreate / allowDelete / allowDisable`：编辑权限

### 9.2 克隆模式

系统预设模式（`systemPreset: true`）的 `readOnly: true`，但用户可以克隆后自由编辑。克隆通过 `ModeCloneParams` 创建新 ModeSpec，继承原模式的结构但 `systemPreset: false`。

### 9.3 添加新模式

理论上，添加新的协调模式需要：
1. 在 `CoordinationPatternSchema` 中新增枚举值
2. 在 `MODE_FAMILY_RULES` 中定义允许的模板和停止策略
3. 在 `MVP_PATTERN_DEFINITIONS` 中添加 PatternDefinition
4. 在 `MODE_NODE_RUNTIME_TEMPLATE_LIBRARY` 中添加模板的运行时定义
5. 可选：实现新的 ModeDriver

### 9.4 自定义智能体

每个模式的 `profiles` 数组定义了智能体 roster。用户可以通过 `customAgentId` 引用自定义智能体（CustomAgentDetail），覆盖模型、技能和工具配置，同时保留模式定义的 role 和 budget。

### 9.5 Transcript 布局

模式可以配置 `transcriptLayout`，其中 `style: "graph_topology"` 是 15 种布局风格之一，直接在对话界面中以图的形式渲染智能体拓扑和执行状态。
