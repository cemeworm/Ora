# Ora 图框架：智能体建模为有向图

这份文档描述 Ora 当前如何把工作模式、智能体、运行阶段和运行时能力统一建模为有向图。重点看四层：共享契约里的拓扑原语、`ModeSpec` 的可编辑图、`PatternDefinition` 的运行时投影，以及 runtime kernel 如何消费这张图。

## 1. 概述

Ora 的核心设计仍然是：**工作模式是一张有向图，运行时围绕这张图执行、记录状态和生成观测事件。** Generator-Verifier 的验证循环、Orchestrator-Subagent 的层级委派、Agent Teams 的队列协作、Message Bus 的事件路由、Shared State 的共享黑板，都会落到同一组拓扑原语：节点和边。

需要区分两件事：

- **核心契约和运行时图执行** 在 `@cemeworm/shared` 与 `apps/runtime` 中实现，不依赖 LangGraph、Dagre 这类运行时图框架。
- **桌面端 Mode Studio 画布** 使用 React Flow 渲染和编辑模式图。React Flow 是 UI 层依赖，不参与 runtime 执行语义。

所有共享类型由 Zod schema 定义，再推导 TypeScript 类型。runtime 在 Node.js 进程中执行，desktop 通过快照和事件流消费拓扑状态。

### 阅读地图

| 概念 | 定义位置 | 角色 |
| --- | --- | --- |
| `TopologyNode` / `TopologyEdge` | `packages/shared/src/topology.ts` | 运行时拓扑原语 |
| `PatternDefinition` | `packages/shared/src/modes.ts` | 协调模式蓝图和运行时 definition |
| `ModeSpec` / `ModeNodeSpec` / `ModeEdgeSpec` | `packages/shared/src/modes.ts` | 用户可编辑的模式图定义 |
| `ModeRuntimeAtomDefinition` | `packages/shared/src/modes.ts` | 可插拔运行时能力声明 |
| `modeSpecToPatternDefinition` | `packages/shared/src/modes.ts` | `ModeSpec` 到 runtime definition 的桥接 |
| `projectModeRuntimeTopology` | `packages/shared/src/modes.ts` | `ModeSpec` 到 runtime topology 的投影 |
| `KernelRuntimeContext` | `apps/runtime/src/harness/runtime-kernel.ts` | runtime 中的拓扑状态持有者 |
| `injectRootAgentTopology` | `apps/runtime/src/harness/runtime-root-agent.ts` | 注入 Ora 根智能体和 handoff 边 |
| `ModeDriverRegistry` | `apps/runtime/src/patterns/mode-driver-registry.ts` | 按 family 选择 mode driver |
| Mode Studio | `apps/desktop/src/components/ModesView.tsx`、`apps/desktop/src/lib/modeCanvas.ts` | 桌面端模式图编辑器 |
| Trails 拓扑视图 | `apps/desktop/src/components/TrailsTabs.tsx` | 运行后拓扑观测视图 |

## 2. 拓扑数据模型

### 2.1 `TopologyNode`

节点是运行时拓扑里的执行或能力单元。每个节点都有稳定 `id`、展示 `label`、节点类型 `kind` 和运行状态 `status`。

```typescript
// packages/shared/src/topology.ts
export const BuiltInTopologyNodeKindSchema = z.enum([
  "run",
  "agent",
  "capability",
  "checkpoint",
  "artifact",
]);
export const TopologyNodeKindSchema = BuiltInTopologyNodeKindSchema.or(z.string());

export const TopologyNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: TopologyNodeKindSchema,
  agentId: z.string().min(1).optional(),
  status: z.enum(["idle", "running", "blocked", "done", "failed"]).default("idle"),
  metadata: z.record(z.unknown()).default({}),
});
```

内置 `kind` 有五种，但 schema 允许自定义字符串，方便后续扩展自定义拓扑节点。

| kind | 含义 | 示例 |
| --- | --- | --- |
| `run` | 运行入口 | `run` |
| `agent` | 智能体节点，通过 `agentId` 绑定 `AgentProfile` | `orchestrator`、`reviewer` |
| `capability` | 运行时能力或 topic，例如 runtime atom、共享黑板、消息主题 | `shared_board`、`capability:memory_capture` |
| `checkpoint` | 检查点节点，预留给恢复和可视化 | 运行中断后的恢复点 |
| `artifact` | 产物节点，预留给报告、文件等输出 | 报告、日志、导出文件 |

节点状态机仍是这组状态：

```text
idle -> running -> done
              -> blocked
              -> failed
```

`blocked` 通常对应审批、澄清或其他人工关卡。恢复后，节点可以重新进入运行路径，最终变为 `done` 或 `failed`。

### 2.2 `TopologyEdge`

边描述拓扑节点之间的关系。当前运行时主要使用 `source` 和 `target` 确定图结构；`kind` 和 `label` 更多用于可视化、观测和人类可读上下文。

```typescript
// packages/shared/src/topology.ts
export const BuiltInTopologyEdgeKindSchema = z.enum([
  "control",
  "delegation",
  "verification",
  "memory",
  "artifact",
]);
export const TopologyEdgeKindSchema = BuiltInTopologyEdgeKindSchema.or(z.string());

export const TopologyEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1).optional(),
  kind: TopologyEdgeKindSchema,
  metadata: z.record(z.unknown()).default({}),
});
```

当前源码里的边语义有一个重要边界：`kind` **不直接驱动 runtime 分支**。mode drivers 和拓扑排序主要读取 `source`、`target`；`kind` 目前用于观测、UI 和上下文说明。需要条件执行时，用的是 `ModeEdgeSpec.condition`，不是 `TopologyEdge.kind`。

| kind | 当前语义 | 典型用法 |
| --- | --- | --- |
| `control` | 控制流或阶段顺序的可视化标记 | `run -> orchestrator` |
| `delegation` | 委派关系的可视化标记 | `orchestrator -> researcher` |
| `verification` | 验证或评审关系的可视化标记 | `generator -> verifier` |
| `memory` | 记忆或共享状态读写关系 | `researcher -> shared_board` |
| `artifact` | 产物、事件或 topic 传递关系 | `router -> triage_topic` |

## 3. `PatternDefinition`：协调模式蓝图

`PatternDefinition` 是每个 family 的运行时蓝图。它包含默认拓扑、智能体 roster、停止策略、资源预算和能力 flags。

```typescript
// packages/shared/src/modes.ts
export const PatternDefinitionSchema = z.object({
  id: CoordinationPatternSchema,
  label: z.string().min(1),
  summary: z.string().min(1),
  recommendedUse: z.string().min(1),
  failureMode: z.string().min(1),
  coordinationKind: z.enum(["loop", "hierarchical", "team", "bus", "shared_state"]),
  stateModel: z.enum(["ephemeral", "persistent_workers", "event_routed", "shared_blackboard"]),
  supportsPersistentWorkers: z.boolean().default(false),
  supportsSharedState: z.boolean().default(false),
  supportsEventRouting: z.boolean().default(false),
  defaultStopPolicy: z.object({
    type: z.enum(["max_iterations", "queue_drained", "converged", "manual"]),
    maxIterations: z.number().int().positive().optional(),
    idleCycles: z.number().int().positive().optional(),
    detail: z.string().min(1),
  }),
  defaultConstraints: z.array(z.string().min(1)),
  defaultBudget: ResourceBudgetSchema,
  profiles: z.array(AgentProfileSchema).min(1),
  topology: z.object({
    nodes: z.array(TopologyNodeSchema),
    edges: z.array(TopologyEdgeSchema),
  }),
  planTemplate: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    ownerAgentId: z.string().min(1).optional(),
    dependencies: z.array(z.string().min(1)).default([]),
  })),
});
```

内置 family 仍是五类，定义在 `MVP_PATTERN_DEFINITIONS`：

| family | coordinationKind | stateModel | 默认拓扑 | 说明 |
| --- | --- | --- | --- | --- |
| `generator_verifier` | `loop` | `ephemeral` | `run -> generator -> verifier` | 生成候选，再按 rubric 验证；最多默认 3 轮。 |
| `orchestrator_subagent` | `hierarchical` | `ephemeral` | `run -> orchestrator -> researcher/reviewer` | 默认编排模式，先分解，再研究和审查，最后综合。 |
| `agent_teams` | `team` | `persistent_workers` | `team_lead -> builder -> reviewer -> team_lead` | 持久 worker 围绕 backlog 协作。 |
| `message_bus` | `bus` | `event_routed` | `run -> router -> triage_topic -> researcher -> responder` | 通过 topic 和 correlation id 表达事件路由。 |
| `shared_state` | `shared_state` | `shared_blackboard` | `orchestrator/researcher/reviewer -> shared_board` | 多个 agent 通过共享黑板协作并判断收敛。 |

这些蓝图既能直接生成系统预设 mode，也能作为用户自定义 mode 的 family 基础。

## 4. `ModeSpec`：可编辑的模式图

`ModeSpec` 是 Mode Studio 和 runtime 共同使用的模式定义。它包含可编辑节点、边、智能体配置、运行策略、完成策略、恢复策略、记忆策略和权限配置。

```typescript
export const ModeSpecSchema = z.object({
  id: ModeIdSchema,
  family: CoordinationPatternSchema,
  label: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().min(1).optional(),
  recommendedUse: z.string().min(1).optional(),
  failureMode: z.string().min(1).optional(),
  systemPreset: z.boolean().default(false),
  visibility: z.enum(["user", "internal"]).default("user"),
  nodes: z.array(ModeNodeSpecSchema).min(1),
  edges: z.array(ModeEdgeSpecSchema).default([]),
  stopPolicy: ModeStopPolicySchema,
  capabilityFlags: ModeCapabilityFlagsSchema,
  editorConstraints: ModeEditorConstraintsSchema,
  defaultBudget: ResourceBudgetSchema,
  profiles: z.array(AgentProfileSchema).min(1),
  runtimeAtoms: z.array(ModeRuntimeAtomIdSchema).default([]),
  complexitySkipRules: ComplexitySkipRulesSchema.optional(),
  stages: z.array(ModeStageSpecSchema).optional(),
  transcriptLayout: ModeTranscriptLayoutSchema.optional(),
  completionPolicy: ModeCompletionPolicySchema.default(COMPLETION_POLICY_PRESETS.balanced),
  runtimePolicy: ModeRuntimePolicySchema.default(DEFAULT_MODE_RUNTIME_POLICY),
  recoveryPolicy: ModeRecoveryPolicySchema.default(DEFAULT_MODE_RECOVERY_POLICY),
  memoryPolicy: ModeMemoryPolicySchema.default({}),
  toolLimits: ModeToolLimitsSchema.default({}),
  permissionProfileId: z.string().min(1).optional(),
  langfusePromptRef: z.object({
    name: z.string().min(1),
    version: z.number().int().positive().optional(),
    label: z.string().min(1).optional(),
  }).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
```

### 4.1 `ModeNodeSpec`

`ModeNodeSpec` 是可编辑图里的阶段节点，不等同于运行时 `TopologyNode`。一个 `ModeNodeSpec` 通常代表计划阶段或说话阶段；投影到 runtime topology 时，会被绑定到 owner agent 或 runtime capability。

```typescript
export const ModeNodeSpecSchema = z.object({
  id: z.string().min(1),
  template: ModeNodeTemplateSchema,
  label: z.string().min(1),
  title: z.string().min(1).optional(),
  ownerAgentId: z.string().min(1).optional(),
  position: ModeNodePositionSchema.optional(),
  enabled: z.boolean().default(true),
  instructions: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  riskLevel: ActionRiskLevelSchema.optional(),
  config: z.object({
    atoms: z.array(z.string()).optional(),
    customAgentId: z.string().optional(),
    clarificationQuestion: z.string().optional(),
    clarificationKey: z.string().optional(),
    story: z.unknown().optional(),
    timeoutMs: z.number().int().positive().optional(),
  }).passthrough().default({}),
});
```

内置节点模板仍是 17 种：`draft`、`verify`、`decide`、`decompose`、`research`、`review`、`synthesize`、`triage`、`build`、`check`、`handoff`、`publish`、`route`、`handle`、`respond`、`seed`、`converge`。schema 同样允许自定义模板字符串。

每个模板的运行时默认说明、展示 story 和 fallback prompt 定义在 `MODE_NODE_RUNTIME_TEMPLATE_LIBRARY`。Mode Studio 读取这些定义来生成节点文案和预览；runtime drivers 也会用它们补齐未显式配置的 prompt 和 instructions。

### 4.2 `ModeEdgeSpec`

`ModeEdgeSpec` 是 Mode Studio 中用户可编辑的边。

```typescript
export const ModeEdgeSpecSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1).optional(),
  kind: TopologyEdgeSchema.shape.kind.default("control"),
  enabled: z.boolean().default(true),
  condition: z.string().min(1).optional(),
});
```

`condition` 是当前需要特别注意的字段。它属于 `ModeEdgeSpec`，不是 `TopologyEdge`。`apps/runtime/src/patterns/driver-utils.ts` 里有 `evaluateEdgeCondition` 和 `resolveConditionalSkips`，用于根据前序节点输出跳过目标节点。目前这条能力只在部分 driver 路径中消费，不应该把它理解成所有拓扑边天然具备的通用路由规则。

### 4.3 Runtime Atoms

runtime atom 是可插拔运行时能力，定义在 `MVP_MODE_RUNTIME_ATOMS`。atom 有两种 scope：

- `mode`：挂在整个模式上，通过 `mode.runtimeAtoms` 启用。
- `node`：挂在单个 `ModeNodeSpec.config.atoms` 上。

| Atom | scope | 默认启用 | 兼容 family | 拓扑呈现 |
| --- | --- | --- | --- | --- |
| `thread_workspace` | mode | 是 | `orchestrator_subagent`、`agent_teams` | `mode_capability` |
| `recovery_policy` | mode | 是 | 全部内置 family | `mode_capability` |
| `tool_error_boundary` | mode | 是 | 全部内置 family | `mode_capability` |
| `loop_guard` | mode | 是 | 全部内置 family | `mode_capability` |
| `clarification_interrupt` | mode | 是 | 全部内置 family | `mode_capability` |
| `memory_capture` | mode | 是 | 全部内置 family | `mode_capability` |
| `long_term_memory` | mode | 是 | 全部内置 family | `mode_capability` |
| `deferred_tool_discovery` | node | 否 | `orchestrator_subagent` | `stage_attachment` |
| `subagent_delegate` | node | 否 | `orchestrator_subagent`、`agent_teams` | `stage_attachment` |
| `persistent_worker_memory` | mode | 是 | `agent_teams` | `mode_capability` |
| `event_routing` | mode | 是 | `message_bus` | `family_capability` |
| `shared_blackboard` | mode | 是 | `shared_state` | `family_capability` |
| `artifact_publish` | node | 否 | `agent_teams`、`message_bus`、`shared_state` | `stage_attachment` |
| `token_usage_trace` | mode | 否 | 全部内置 family | `mode_capability` |
| `dynamic_stage_skipping` | mode | 否 | `agent_teams` | `mode_capability` |

三种拓扑呈现方式的含义：

- `family_capability`：复用 family 内置 capability 节点，例如 `message_bus` 的 `triage_topic`、`shared_state` 的 `shared_board`。
- `mode_capability`：投影时新增 `capability:<atomId>` 节点，并从 `run` 连过去。
- `stage_attachment`：投影时新增 `capability:<nodeId>:<atomId>` 节点，并挂到对应 stage 的 owner agent 或 node anchor 上。

## 5. 从 `ModeSpec` 到运行时拓扑

当前链路不是 kernel 直接拿 `ModeSpec` 临时投影，而是先通过 `modeSpecToPatternDefinition(mode)` 得到 runtime definition：

```text
ModeSpec
  -> modeSpecToPatternDefinition(mode)
    -> orderedEnabledModeNodes(mode)
    -> projectModeRuntimeTopology(mode)
    -> PatternDefinition.topology
  -> executeRuntimeKernel(..., { definition, modeSpec })
  -> injectRootAgentTopology(definition.topology, modeSpec)
```

`projectModeRuntimeTopology(mode)` 内部做几件事：

1. 读取 family 蓝图：`getPatternDefinition(mode.family)`。
2. 对 mode nodes 做启用过滤和拓扑排序：`orderedEnabledModeNodes(mode)`。
3. 构造基础 runtime topology：`runtimeBaseTopology(mode, family, orderedNodes)`。
4. 应用 mode scope atoms。
5. 应用 node scope atoms。
6. 给节点和边写入 `modeId`、`enabledNodeIds`、`atomId`、`atomScope`、`atomPresentation` 等 metadata。

`runtimeBaseTopology` 有一个 single-owner 优化：如果所有启用节点都属于同一个 owner，且没有节点使用 `subagent_delegate`，投影结果会压缩成：

```text
run -> primary agent
```

这种情况下不会完整克隆 family 默认拓扑。多 owner 或显式 subagent delegate 的模式，才会使用 family topology 作为基础。

## 6. Runtime 如何消费拓扑

### 6.1 初始化链路

runtime 启动时，`RunKernelExecutionService` 会把解析后的 `modeSpec` 转成 `definition`：

```typescript
modeSpecToPatternDefinition(modeSpec)
```

随后 `executeRuntimeKernel` 接收这两个对象。非 resume 场景下，它从 `definition.topology` 克隆节点和边，再调用 `injectRootAgentTopology` 注入 Ora 根智能体：

```typescript
const rootTopology = resumeTopology
  ? { nodes: resumeTopology.nodes.map((n) => ({ ...n })), edges: resumeTopology.edges }
  : injectRootAgentTopology({
      nodes: definition.topology.nodes.map((node) => ({ ...node })),
      edges: definition.topology.edges,
    }, modeSpec);
```

`injectRootAgentTopology` 会：

- 添加或覆盖 `ora` agent 节点，metadata 标记 `rootAgent: true` 和 `modeId`。
- 确保存在 `run` 节点。
- 删除原本从 `run` 指向非 Ora 节点的边。
- 添加 `run -> ora` control 边。
- 根据 mode family 选择 handoff target，再添加 `ora -> handoffTarget` delegation 边。

handoff target 的优先规则在 `rootAgentHandoffTarget` 中：

| family / mode | handoff target |
| --- | --- |
| `single_agent` | 无 handoff target |
| `agent_teams` | `team_lead` |
| `message_bus` | `router` |
| `orchestrator_subagent` | `orchestrator` |
| `shared_state` | `orchestrator` |
| 其他自定义情况 | 第一个非 Ora owner 或第一个非 Ora profile |

### 6.2 状态追踪和事件

`KernelRuntimeContext` 持有当前拓扑快照。节点状态通过 `setTopologyStatus` 更新：

```typescript
setTopologyStatus(agentId, status) {
  for (const node of this.topologyValue.nodes) {
    if (node.agentId === agentId || node.id === agentId) {
      node.status = status;
    }
  }
  this.emit("topology.updated", this.topologyValue, { agentId, nodeId: agentId });
}
```

每次状态变化都会发出 `topology.updated` 事件。`StateSnapshot.topology` 保存最新节点和边，desktop 订阅快照后更新 Trails 视图。

### 6.3 KernelRunner 与 mode drivers

`KernelRunner` 执行主流程：

1. `emitStartEvents()` 发出 `run.started`、初始 `topology.updated`、`profile.updated`、`plan.updated`、`todo.updated`。
2. `preflight()` 把 Ora 根智能体置为 `running`，必要时触发澄清 preflight。
3. `executeModeSpec()` 通过 `ModeDriverRegistry` 按 `modeSpec.family` 调用对应 driver。
4. driver 逐节点或逐层执行，节点执行统一经过 `runGenericModeNode` 或 `runModeLayer`。
5. 完成后 `finalizeAsOra()` 生成最终用户响应。
6. `flushMemory()` 刷新记忆捕获队列。
7. `checkpoint()` 返回最终 `StateSnapshot`。

当前内置 driver 文件：

| family | driver |
| --- | --- |
| `generator_verifier` | `apps/runtime/src/patterns/generator-verifier-driver.ts` |
| `orchestrator_subagent` | `apps/runtime/src/patterns/orchestrator-subagent-driver.ts` |
| `agent_teams` | `apps/runtime/src/patterns/agent-teams-driver.ts` |
| `message_bus` | `apps/runtime/src/patterns/message-bus-driver.ts` |
| `shared_state` | `apps/runtime/src/patterns/shared-state-driver.ts` |

大多数 driver 用 `orderedEnabledModeNodes(modeSpec)` 顺序执行。`shared_state` 使用 `orderedEnabledModeLayers(modeSpec)`，同一层没有依赖的节点可以通过 `runModeLayer` 并发执行。条件边跳过目前也主要出现在这一类分层执行路径中。

## 7. `AgentProfile` 与节点绑定

`AgentProfile` 定义智能体身份、工具、技能、记忆命名空间和预算。

```typescript
export const AgentProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  role: z.string().min(1),
  systemPrompt: z.string().min(1).optional(),
  customAgentId: z.string().min(1).optional(),
  modelRef: z.string().min(1).optional(),
  toolPolicyId: z.string().min(1),
  toolIds: z.array(z.string().min(1)).default([]),
  skillIds: z.array(z.string().min(1)).default([]),
  memoryNamespaces: z.array(z.string().min(1)),
  budget: ResourceBudgetSchema,
});
```

绑定关系有三条：

```text
TopologyNode.agentId      -> AgentProfile.id
ModeNodeSpec.ownerAgentId -> AgentProfile.id
PatternDefinition.profiles -> AgentProfile[]
```

Mode Studio 还允许在 `ModeNodeSpec.config.customAgentId` 上引用用户自定义智能体。运行时调用 agent 时，会把 `customAgentId` 传入 `context.callAgent`，用自定义智能体覆盖具体模型、技能或工具配置，同时保留 mode 节点自身的阶段语义。

所有模式都会注入根智能体 Ora：

```typescript
export const ORA_ROOT_AGENT_ID = "ora";
```

Ora 的角色是接收用户消息、处理自动模式选择和澄清、决定是否 handoff 给模式内 agent，并最终写出面向用户的回答。

## 8. 图框架与 Runtime Loop 的关系

图框架回答“运行什么”，Runtime Loop 回答“怎么运行”。

| 维度 | 图框架 | Runtime Loop |
| --- | --- | --- |
| 关注点 | 模式拓扑、节点、边、智能体、能力 | run 生命周期、node loop、工具调用、审批、恢复、事件 |
| 核心文件 | `topology.ts`、`modes.ts`、mode drivers | `runtime-kernel.ts`、`runtime-kernel-runner.ts`、`node-runtime-loop.ts` |
| 关键类型 | `TopologyNode`、`TopologyEdge`、`ModeSpec`、`PatternDefinition` | `StateSnapshot`、`OraEventEnvelope`、`RunStatus` |
| 执行入口 | `modeSpecToPatternDefinition`、`projectModeRuntimeTopology`、`injectRootAgentTopology` | `executeRuntimeKernel`、`executeModeSpec`、`runNodeRuntimeLoop` |

运行时的三层对应关系：

- **Run 层**：构建 `definition.topology`，注入 Ora 根智能体，创建 `KernelRuntimeContext`。
- **Mode 层**：`ModeDriverRegistry` 根据 family 选择 driver，driver 按 mode nodes 或 mode layers 执行。
- **Node 层**：`runGenericModeNode` 和 `runNodeRuntimeLoop` 驱动单节点 model-tool loop，并通过 `setTopologyStatus` 更新拓扑状态。

## 9. Mode Studio 和桌面端展示

### 9.1 Mode Studio 编辑器

Mode Studio 的主入口是 `apps/desktop/src/components/ModesView.tsx`。它使用 React Flow 渲染模式画布，核心转换逻辑在 `apps/desktop/src/lib/modeCanvas.ts`：

- `buildModeFlowNodes(mode, atoms)`：把 `ModeSpec.nodes`、runtime atoms 和 synthetic capability nodes 转成 React Flow nodes。
- `buildModeFlowEdges(mode, atoms)`：把 `ModeSpec.edges` 和 runtime atom attachment 转成 React Flow edges。
- `addModeNode` / `addModeEdge` / `removeModeEdges`：处理节点和边编辑。
- `validateCanvasConnection`：阻止自环、重复边、连接 disabled node，以及会造成 cycle 的边。
- `autoLayoutDraft` / `ensureModeNodePositions`：补齐或重算节点位置。

Mode Studio 画布里有一类 UI-only 节点：`__runtime_anchor__`。它代表 runtime harness，不是 `ModeSpec.nodes` 的真实节点。mode scope atoms 和 node scope atoms 在画布中也会渲染为 synthetic nodes，用于帮助用户理解当前 mode 开启了哪些运行时能力。

### 9.2 克隆和自定义 mode

系统预设 mode 的 `systemPreset: true`，编辑时会先复制成自定义 mode：

```typescript
const seed = forceCreate || base.systemPreset
  ? { ...base, id: `${base.id}-custom`, systemPreset: false }
  : base;
```

保存时，desktop 调用 runtime client 的 create/update mode 接口。runtime 侧会通过 `validateModeSpec` 校验 family 规则、节点合法性、runtime atom 兼容性和必选模板。

### 9.3 Stage Transcript 与拓扑视图

`ModeTranscriptLayoutSchema` 里保留了 15 种布局风格，其中包括 `graph_topology`。不过截至当前代码，`apps/desktop/src/components/StageTranscript.tsx` 并没有实现 `graph_topology` renderer；它实际支持的 renderer 主要是：

- `stage_list`
- `two_sided_duel`
- `rubric_matrix`
- `judge_panel`
- `evidence_board`
- `comparison_table`
- `artifact_gallery`
- `kanban_pipeline`

运行时拓扑目前主要在 Trails Drawer 里展示，入口在 `apps/desktop/src/components/TrailsTabs.tsx`。它读取 `activeSnapshot.topology.nodes` 和 `activeSnapshot.topology.edges`，展示执行拓扑、智能体泳道、通信关系和事件证据。

`apps/desktop/src/components/TopologyPanel.tsx` 仍存在，但当前没有主路径引用。需要做拓扑图 UI 时，优先以 Trails 当前实现和 Mode Studio canvas 为准。

## 10. 添加新模式时要改哪里

新增内置 family 通常要改这几处：

1. `packages/shared/src/primitives.ts`：在 `BuiltInCoordinationPatternSchema` 中添加 family。
2. `packages/shared/src/modes.ts`：更新 `MODE_FAMILY_RULES`。
3. `packages/shared/src/modes.ts`：添加或复用 `MODE_NODE_RUNTIME_TEMPLATE_LIBRARY` 模板定义。
4. `packages/shared/src/modes.ts`：在 `MVP_PATTERN_DEFINITIONS` 中添加 `PatternDefinition`。
5. `packages/shared/src/modes.ts`：必要时添加 runtime atom 兼容性。
6. `apps/runtime/src/patterns/`：实现新的 mode driver。
7. `apps/runtime/src/patterns/driver-registry.ts`：注册 driver。
8. `apps/desktop/src/lib/modeCanvas.ts` 和 `ModesView.tsx`：确认 Mode Studio 是否需要新的编辑行为或展示文案。

如果只是新增一个系统预设 mode，而不是新增 family，可以复用已有 family。例如当前 `single_agent`、`debate`、`mode_studio_builder`、`code_development`、`ora_self_builder` 都是基于已有 family 构造的 mode spec，而不是新的 coordination pattern。

## 11. 当前边界和容易误解的点

- `TopologyEdge.kind` 当前不决定执行分支。它主要是观测和可视化语义。
- `ModeEdgeSpec.condition` 才是条件边能力，但当前只有部分 driver 路径消费。
- `ModeSpec.nodes` 是用户可编辑阶段，不一定一对一对应 runtime `TopologyNode`。single-owner 模式会压缩 topology。
- runtime atoms 既影响运行时行为，也影响 topology 投影；但 UI 中的 synthetic atom nodes 不等于 ModeSpec 真实节点。
- `graph_topology` 目前是 schema 预留，不是已经接入的 transcript renderer。
- runtime 使用的是 `@cemeworm/shared` 包导出的共享契约，旧的 `@ora/shared` 包名已经不再是当前结构。
