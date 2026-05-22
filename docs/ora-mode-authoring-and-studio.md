# Ora Mode 结构说明

这篇文档解释 Ora 的 Mode 系统：为什么需要 Mode、它怎么设计和运作、以及如何从零产出一个可用的 Mode。它是 `ora-graph-framework.md` 的延伸——那篇讲模式图的数据模型和运行时消费，这篇聚焦创作侧。

## Why：Ora 为什么需要 Mode

### 不同任务需要不同的 Agent 协作模式

单 Agent 对话能处理的问题有限。一旦任务变复杂——比如需要交叉验证、分阶段研究、或对抗性审查——靠一个 Agent 自己判断就容易漏。Ora 的答案是 **Mode**：一套预定义的 Agent 协作蓝图，告诉系统"这个任务该由几个 Agent 怎么配合"。

几个典型场景：

- **代码审查**：一个 Agent 生成代码，另一个独立验证，不通过就退回修改。这是 `generator_verifier` family 的模式。
- **深度研究**：先分解问题，再并行研究，交叉审查，最后综合成一份结论。这是 `orchestrator_subagent` family 中 `deep_research` 的做法。
- **辩论**：红蓝双方各执一个立场，交替发言，最后综合两方论点。`debate` mode 把这种对抗性审查做成了标准流程。

Mode 不是简单的 prompt 模板。它定义了 Agent 之间的分工、信息流向、停止条件、以及每个阶段的能力要求。切换 Mode，不只是换了一段提示词，而是换了一套执行语义。

### System Preset 与 Custom Mode

Ora 的 Mode 分两类：

- **System Preset**（`systemPreset: true`）：系统内置，开箱即用。只读，不能直接编辑或删除。
- **Custom Mode**（`systemPreset: false`）：从预设克隆、空白创建、或通过 Builder 对话生成。完全可编辑、可删除。

两者的数据结构完全一样（都是 `ModeSpec`），区别仅在于 `systemPreset` 字段和 `editorConstraints.readOnly`。克隆一个 System Preset 得到的就是一个普通的 Custom Mode，跟原预设不再有任何引用关系。

当前可用的 System Preset：

| Mode ID | family | 适用场景 |
| --- | --- | --- |
| `single_agent` | `orchestrator_subagent` | 简单问答，不做委派 |
| `orchestrator_subagent` | `orchestrator_subagent` | 默认编排：分解 → 研究 → 审查 → 综合 |
| `dynamic_orchestrator` | `orchestrator_subagent` | 动态编排：先判断是否需要研究/审查，再综合 |
| `code_development` | `orchestrator_subagent` | 代码开发专用 |
| `deep_research` | `orchestrator_subagent` | 多阶段研究、验收与综合 |
| `generator_verifier` | `generator_verifier` | 生成候选 + 验证循环 |
| `agent_teams` | `agent_teams` | 持久 worker 团队协作 |
| `message_bus` | `message_bus` | 事件路由 |
| `shared_state` | `shared_state` | 共享黑板协作 |
| `debate` | `orchestrator_subagent` | 双面对抗性审查（red team / blue team） |
| `mode_studio_builder` | `orchestrator_subagent` | Mode Studio 自身的 builder mode |
| `ora_self_builder` | `agent_teams` | Ora 自我迭代 |
| `deerflow_harness` | `orchestrator_subagent` | DeerFlow 风格 harness |

这 13 个预设复用了 5 个内置 family（`generator_verifier`、`orchestrator_subagent`、`agent_teams`、`message_bus`、`shared_state`）。新增预设不一定需要新增 family，详见后面的「新增 System Preset 或 Family」章节。

## How：Mode 如何设计和运作

### ModeSpec 数据模型

一个 Mode 的数据结构是 `ModeSpec`，定义在 `packages/shared/src/modes.ts`：

```
ModeSpec {
  id, family, systemPreset
  nodes: ModeNodeSpec[]     // 执行阶段（stage 节点）
  edges: ModeEdgeSpec[]      // 阶段之间的连接和条件
  profiles: AgentProfile[]   // 每个 Agent 的模型、技能、工具配置
  runtimeAtoms: string[]     // mode 级别的 runtime atom
  capabilityFlags            // 功能开关
  stopPolicy                 // 停止策略
  completionPolicy           // 完成策略
  recoveryPolicy             // 恢复策略
  transcriptLayout           // 对话展示布局
  editorConstraints          // 编辑权限控制
}
```

`ModeNodeSpec` 是图中最重要的单元，每个节点代表一个执行阶段：

```
ModeNodeSpec {
  id, template, label, ownerAgentId,
  enabled, instructions, prompt, riskLevel,
  config: {
    atoms,                    // node-scope runtime atom
    customAgentId,            // 覆盖默认 agent
    clarificationQuestion,    // 澄清问题
    clarificationKey,         // 澄清回答的 key
    requiredCapabilityGroups, // stage 最低能力契约
    timeoutMs                 // 阶段超时
  }
}
```

`template` 字段决定了阶段的语义（`decompose`、`research`、`review`、`synthesize` 等 17 种内置模板，也支持自定义字符串）。每个 template 在 `MODE_NODE_RUNTIME_TEMPLATE_LIBRARY` 中有对应的 fallback instructions 和 prompt。

### 画布节点：三类节点，只有一类是真实数据

Mode Studio 画布上能看到三种节点，但它们在数据模型中的角色完全不同。

**Stage 节点**（真实数据）：对应 `ModeSpec.nodes` 中的 `ModeNodeSpec`，是用户编辑的核心。每个节点代表模式图中的一个执行阶段，增删改都会直接写入 `ModeSpec.nodes`。

**Capability 节点**（纯渲染层）：当 mode 启用了 mode-scope runtime atom（如 `memory_capture`、`thread_workspace`），画布会自动渲染对应的 capability 节点。这些节点的 ID 前缀为 `__mode_atom__:`，不可拖拽、不可删除，不在 `ModeSpec.nodes` 中，仅存在于画布渲染层。它们从 `__runtime_anchor__` 节点用虚线连接。

**Attachment 节点**（纯渲染层）：当 stage 节点在 `config.atoms` 中启用了 node-scope runtime atom（如 `subagent_delegate`），画布会在该 stage 节点下方渲染 attachment 节点。ID 前缀为 `__node_atom__:`，从所属 stage 节点用虚线连接，同样不可拖拽、不可删除。

`__runtime_anchor__` 节点代表 runtime harness，也是一个 UI-only 节点。它不是 `ModeSpec.nodes` 中的真实数据，只在启用了 mode-scope atom 时渲染，作为 capability 节点的视觉锚点。

理解这个区分很关键：保存时，只有 Stage 节点和边会被写入 `ModeSpec`。synthetic 节点是画布帮你看清 atom 配置的视觉辅助。

### Runtime Atom：编辑态是开关，运行态是行为

Runtime atom 在编辑态和运行态扮演不同角色。

在 **Mode Studio 画布**上，atom 表现为 synthetic 节点的视觉开关。用户切换开关，就是在修改 `mode.runtimeAtoms`（mode-scope）或 `ModeNodeSpec.config.atoms`（node-scope）。画布的 `buildModeFlowNodes` 和 `buildModeFlowEdges` 负责将这些 atom 投影为视觉元素。

在 **Runtime Kernel** 中，atom 影响 `projectModeRuntimeTopology` 的投影结果：
- `family_capability`：复用 family 内置的 capability 节点（如 `message_bus` 的 `triage_topic`）
- `mode_capability`：投影时新增 `capability:<atomId>` 节点，从 `run` 连过去
- `stage_attachment`：投影时新增 `capability:<nodeId>:<atomId>` 节点，挂到对应 stage 的 owner agent

atom 也直接影响运行时行为。比如 `loop_guard` 控制最大迭代次数，`clarification_interrupt` 启用澄清中断，`dynamic_delegation` 让 orchestrator_subagent driver 按 delegation plan 跳过或聚焦 subagent。

`validateModeSpec` 对 atom 做了几项检查：mode-scope atom 必须与原子的 `scope: "mode"` 匹配，atom 必须兼容当前 family，atom 的 `requiresFlags` 必须在 `capabilityFlags` 中启用，node-scope atom 如果已在 mode.runtimeAtoms 中启用会报警告。

### 校验：多层次保证 Mode 正确性

`validateModeSpec`（`packages/shared/src/modes.ts:2737`）是保存前的核心校验，检查以下内容：

1. mode-scope runtime atom 兼容性
2. node ID 唯一性
3. node template 是否在 family 允许的范围内
4. node-scope atom 兼容性
5. stage ID 唯一性，nodeId/speakerId 引用完整性
6. `transcriptLayout` 与 `stages` 一致性
7. recovery rules 引用完整性和 skip 约束
8. required template 是否都有对应的 enabled node
9. `stopPolicy` type 是否在 family 允许范围内
10. edge 源/目标引用完整性、自环检测、重复边检测、环检测
11. edge condition 语法检查
12. 至少有一个 enabled node

校验在两个节点触发：保存前（`saveDraft()` 调用 `runtimeClient.validateMode(draft)`，不通过则拒绝保存）和 Builder 返回 draft 后（`withModeStudioValidation` 附加最新校验结果）。注意 Builder 返回后用户可能继续手动编辑，所以 `saveDraft` 总是对当前 draft 重新校验。

### 从 ModeSpec 到 Runtime 执行

编辑完成的 ModeSpec 要经过两步转换才能被 Runtime 执行。

第一步，`modeSpecToPatternDefinition(mode)`（`packages/shared/src/modes.ts:2700`）：

```
ModeSpec
  → orderedEnabledModeNodes(mode)        // 拓扑排序
  → projectModeRuntimeTopology(mode)      // 投影 runtime topology
  → PatternDefinition {
      topology, profiles, planTemplate,
      defaultStopPolicy, defaultBudget, ...
    }
```

`planTemplate` 由拓扑排序后的节点推导，其中 `dependencies` 来自 `ModeSpec.edges`。

第二步，Runtime Kernel 消费：

```
PatternDefinition
  → executeRuntimeKernel(..., { definition, modeSpec })
  → injectRootAgentTopology(definition.topology, modeSpec)
    → 添加 Ora 根 agent 节点
    → 建立 run → ora → handoffTarget 边
  → ModeDriverRegistry[modeSpec.family] 执行
```

`ModeSpec.family` 决定了运行时用哪个 driver。即使两个 mode 有完全相同的 nodes 配置，只要 family 不同，Runtime 会用不同的 driver 执行。family 是与执行语义绑定的，不是纯粹的视觉分组。

## What：具体怎么创建和操作 Mode

### 三条创建路径

**从预设克隆**：在 Mode Studio gallery 中选中系统预设，点击 Customize。系统会复制一份 ModeSpec，id 加上 `-custom` 后缀，设置 `systemPreset = false`，`editorConstraints.readOnly = false`，然后通过 `hydrateModeDraft` 深拷贝所有嵌套对象。桌面端入口在 `ModesView.tsx` 的 `startDraft(source, forceCreate=true)`。

**空白创建**：选择一个 family，从 `createModeSpecFromPattern(family)` 获得干净的 mode 骨架，然后手动编辑节点、边、profile。

**Builder 对话式生成**：用自然语言描述需求，Builder 自动推导 family、生成节点和 agent roster：

```
用户输入自然语言
  → modeStudioUserText(messages) 提取用户文本
  → assessModeStudioDesignCompleteness(text) 检查设计信息是否完整
  → inferModeStudioFamily(text, fallback) 推导 family
  → modeStudioRolePlans(family, text) 生成 agent roster
  → buildModeStudioDraft(params, deps) 组装草稿
  → validateModeSpec(draft) 校验
  → 返回 ModeStudioDraftBundle（含 guidance、changeSummary、validation）
```

Builder 有两条后端路径：本地规则引擎（`buildModeStudioDraft`，基于关键词和模板推导，不调用 LLM）和 provider-backed（`createModeStudioBuilderResult`，调用 LLM 生成完整 draft，失败时降级到规则引擎）。

Builder 的 guidance 系统用 6 个步骤引导用户补齐设计：`goal` → `topology` → `agents` → `style` → `capabilities` → `preview`。

### 画布编辑

画布编辑操作和对应的函数：

| 操作 | 函数 | 说明 |
| --- | --- | --- |
| 添加节点 | `addModeNode(mode, template)` | 自动选默认模板、分配 ID、调用 `autoLayoutModeSpec` |
| 删除节点 | 通过 `canDeleteModeNode` 检查 | 不允许删除 family required 模板节点 |
| 禁用节点 | 通过 `canDisableModeNode` 检查 | 同样受 required 模板约束 |
| 添加边 | `addModeEdge(mode, connection)` | 需通过 `validateCanvasConnection` |
| 删除边 | `removeModeEdges(mode, edgeIds)` | 支持批量删除 |
| 移动节点 | `patchModeNodePosition` | 坐标需 `modeCanvasStagePositionToStoredPosition` 转换 |
| 自动布局 | `autoLayoutDraft(mode)` | 调用 shared 的 `autoLayoutModeSpec` |
| 切换 family | `resetModeDraftFamily(mode, family)` | 重置 nodes/edges/profiles 为 family blueprint |

`validateCanvasConnection` 阻止以下连接：源或目标为空、自环、节点不存在、节点未启用、重复边、会产生环的边（DFS 检测）。

### Builder 对话流程

Builder 是 Mode Studio 的 AI 辅助创建路径，完整流程：

```
用户输入描述
  → submitBuilder(prompt) 或 submitBuilder(choice.prompt)
  → 消息追加到 builderMessages
  → runtimeClient.startModeStudioBuilderRun({ operation, messages, ... })
    → createModeStudioBuilderInput(params) 构造 UserTaskInput
    → createModeStudioBuilderConfig(params) 构造 RunConfig
    → 以 MODE_STUDIO_BUILDER_MODE_ID mode 启动一次 runtime run
  → runtimeClient.modeStudioBuilderResult(runId) 轮询结果
  → 收到 ModeStudioBuilderResult
    → draftBundle.modeDraft → hydrateModeDraft → setDraft
    → draftBundle.guidance.assistantMessage → 追加到 builderMessages
    → draftBundle.validation → setValidation
  → 用户在画布上编辑 draft
  → 继续对话 refine，或 applyBuilderBundle() 保存
```

当 provider 不是 local-smoke 时，Builder 调用 LLM：构造 `modeStudioBuilderSystemPrompt()`（详细的 JSON-only system prompt）和 `modeStudioBuilderUserPrompt(params, context)`（包含可用 modes、agents、tools、skills、atoms、transcript layouts 的上下文），以 temperature=0.2、maxTokens=5000 调用 LLM，解析 JSON 响应，失败时用 temperature=0 修复，最后映射到 `ModeStudioDraftBundle`。

Builder 的 guidance 选择：`modeStudioGuidance(family, text)` 返回 3 个 refine 选项（收紧审查标准、增加并行度、最小化工具），用户点击后 choice.prompt 作为新的用户消息追加，触发 refine 流程。

Transcript Layout 的自动推导：`modeStudioStructuredLayoutIntent(text)` 通过关键词匹配合适的展示风格。比如输入含 "debate"、"辩论" 会推导 `two_sided_duel`，含 "kanban"、"看板" 会推导 `kanban_pipeline`。对于 `two_sided_duel`，`modeStudioStagedDraft` 会进一步生成完整的 stages 配置（opening → response → rebuttal → closing → synthesis）。

### Draft 生命周期与保存链路

Draft 的生命周期：

```
startDraft(source)
  → hydrateModeDraft(seed)     // 深拷贝，确保可变
  → setDraft(nextDraft)         // React state
  → 用户在画布上编辑
  → patchDraft(updater)        // 每次变更更新 updatedAt
```

`hydrateModeDraft` 的关键动作：深拷贝 `nodes`、`edges`、`profiles`、`stopPolicy`、`capabilityFlags`、`completionPolicy`、`runtimePolicy`、`recoveryPolicy`、`memoryPolicy`，将 `systemPreset` 设为 `false`，将 `editorConstraints.readOnly` 设为 `false`，调用 `ensureModeNodePositions` 补齐缺失的位置。

保存链路：

```
saveDraft()
  → runtimeClient.validateMode(draft)     // 调用 validateModeSpec
  → 如果 !valid，显示 errors，中断保存
  → toCreateParams(draft)                 // 剥离 systemPreset、createdAt、updatedAt
  → editingModeId
      ? runtimeClient.updateMode(id, payload)
      : runtimeClient.createMode(payload)
  → refreshModes()                        // 重新拉取 mode 列表
  → dispatch SET_MODE                     // 选中新保存的 mode
```

`ModeCreateParams` 与 `ModeSpec` 的区别仅在于省略了 `systemPreset`、`createdAt`、`updatedAt`，这些由服务端管理。

删除链路：

```
deleteMode(modeId)
  → 阻止删除 systemPreset
  → window.confirm 确认
  → runtimeClient.deleteMode(modeId)
  → refreshModes()
```

系统预设不可删除，必须先 clone 为 custom mode。

### 新增 System Preset 或 Family

**新增 System Preset（不改 family）**：适用于拓扑结构可以用已有 family 表达的新 mode。

步骤：
1. 在 `packages/shared/src/modes.ts` 中添加工厂函数（参考 `createDebateModeSpec`、`createCodeDevelopmentModeSpec`）
2. 设置 `systemPreset: true`，选择合适的 family
3. 定义 `nodes`、`edges`、`profiles`、`runtimeAtoms`、`editorConstraints`
4. 在 `packages/shared/src/primitives.ts` 中添加 mode ID 常量
5. 在 MVP presets 数组中注册
6. 如有特殊的 Stage Transcript 布局，设置 `transcriptLayout` 和 `stages`

举例：`debate` mode 基于 `orchestrator_subagent` family，但配置了 `two_sided_duel` 的 transcript layout 和 dual-speaker stages。`dynamic_orchestrator` 也基于同一个 family，但默认启用 `dynamic_delegation` runtime atom，运行时由 decompose 输出的 `<delegation_plan>` 决定是否跳过 research/review。

**新增 Family（新的 coordination pattern）**：适用于现有 5 个 family 都无法表达目标拓扑的情况。

步骤：
1. 在 `packages/shared/src/primitives.ts` 的 `BuiltInCoordinationPatternSchema` 中添加 family
2. 在 `packages/shared/src/modes.ts` 的 `MODE_FAMILY_RULES` 中定义模板约束
3. 在 `MODE_NODE_RUNTIME_TEMPLATE_LIBRARY` 中添加模板定义
4. 在 `MVP_PATTERN_DEFINITIONS` 中添加 `PatternDefinition`
5. 添加 runtime atom 兼容性声明
6. 在 `apps/runtime/src/patterns/` 中实现新的 mode driver
7. 在 `apps/runtime/src/patterns/mode-driver-registry.ts` 中注册 driver
8. 更新 `DEFAULT_RESOURCE_BUDGETS`
9. 在 `apps/desktop/src/lib/modeCanvas.ts` 和 `ModesView.tsx` 中确认 Mode Studio 对新 family 的支持

### `ModeNodeSpec.config` 详解

`config` 是每个 stage 节点的运行时配置，一个 `passthrough` 的 Zod object：

```typescript
config: z.object({
  atoms: z.array(z.string()).optional(),
  customAgentId: z.string().optional(),
  clarificationQuestion: z.string().optional(),
  clarificationKey: z.string().optional(),
  requiredCapabilityGroups: z.array(z.string()).optional(),
  story: z.unknown().optional(),
  timeoutMs: z.number().int().positive().optional(),
}).passthrough().default({})
```

各字段的含义：

- **`atoms`**：node-scope runtime atom 列表。与 `mode.runtimeAtoms`（mode scope）不同，这些 atom 只对当前 stage 生效。用户在画布上点击 stage 节点的 capability 开关时，对应的 atom ID 被加入或移出 `config.atoms`。
- **`customAgentId`**：为特定 stage 指定自定义 agent。runtime 调用 agent 时用这个 ID 解析实际的模型、技能和工具配置，同时保留 stage 自身的语义（template、instructions、prompt）。这个字段独立于 `ModeNodeSpec.ownerAgentId`，后者是 mode profile 层面的绑定。
- **`clarificationQuestion` / `clarificationKey`**：在 stage 入口触发澄清中断。runtime 会在进入该 stage 前暂停执行，向用户展示问题并等待回答。答案通过 `clarificationKey` 注入到 prompt 变量中。
- **`requiredCapabilityGroups`**：声明 stage 级能力契约。告诉 runtime：这个节点至少要拿到哪些能力组，才允许真正进入模型调用。runtime 会先按 mode/node 解析实际 preset，再用 `resolveModeStageToolPreflight()` 检查解析后的工具面是否满足这些能力组。能力不足时 stage 在 launch-time 被 block，不会把 prompt 发给模型。blocked 结果会发出 `mode_stage_preflight.completed`，并把诊断信息写进 child session 投影，供 Trails、协作区和调试路径消费。这个字段最典型的消费者是 `ora_self_builder`：`build` / `check` / `handoff` 节点分别声明 `package_build_candidate`、`package_verify`、`package_promote` 等最低能力要求。
- **`timeoutMs`**：阶段超时时间。

## 参考：常见误解与边界

- **System Preset 不可编辑但可以 clone**。编辑预设 mode 时，编辑器总是先复制一份 `{ ...base, id: base.id + '-custom', systemPreset: false }`。clone 后与原预设没有任何引用关系。

- **画布上的 synthetic 节点不在 ModeSpec 数据中**。`__runtime_anchor__`、`__mode_atom__:*`、`__node_atom__:*` 只存在于 React Flow 渲染层。保存时这些节点不会被写入 ModeSpec。

- **Builder 生成的 draft 仍然可以手动编辑**。builder 返回 draft 后，用户在画布上的手动修改会覆盖 builder 的生成结果。`applyBuilderBundle` 时会把当前画布 draft 塞回 bundle 再保存。

- **family 决定了运行时 driver，不只是视觉分组**。即使两个 mode 的 nodes 配置完全相同，只要 family 不同，runtime 会用不同的 driver 执行。

- **Mode ID 必须全局唯一**。`ModeSpecSchema.id` 使用 `ModeIdSchema` 校验。Builder 生成的 mode ID 通过 `slugifyModeStudio` 处理，中文会被替换为 "guided"。

- **Builder 的 family 推导是启发式的**。`inferModeStudioFamily` 基于关键词匹配，可能不准确。用户可以在画布上通过 `resetModeDraftFamily` 切换 family，但切换会重置 nodes/edges/profiles 为 family 默认值。

- **`editorConstraints` 在 preset 上为只读**。clone 后的 custom mode 会重置 `readOnly: false`、`allowDelete: true`、`allowDisable: true`。

- **`transcriptLayout.style` 实际支持两种布局**（`stage_list` 和 `two_sided_duel`）。`role_lanes` 有 schema 定义但渲染器未实现，会降级为 `stage_list`。

- **Driver Capability Manifest 是语义契约**。每个 family 在 `packages/shared/src/driver-manifest.ts` 中有 manifest 声明。Mode Studio 保存前会通过 `validateModeSpec` 自动检查 manifest，生成关于条件边、runtime atom、节点数、transcript layout 的警告和修复建议。用户可以通过工具栏的 Validate 按钮提前看到这些警告。

- **动态 delegation 不是新增 family**。`dynamic_orchestrator` 只是 `orchestrator_subagent` 的系统预设；`dynamic_delegation` 是 compatibleFamilies 包含 `orchestrator_subagent` 的 mode-scope atom。Mode Studio 可以把它展示成 synthetic capability，但真实执行语义在 runtime driver 中。

- **Execution Preview 可在保存前查看**。`generateModeExecutionPreview`（共享包）和 `getExecutionPreview`（桌面端）提供 mode 的执行预览，包括执行顺序、并行层、被忽略的条件边、synthetic node 映射和投影拓扑摘要。不启动真实 model/tool loop。

- **Builder 的修复建议**。当 Builder 生成的 draft 与 driver manifest 不匹配时，`generateRepairSuggestions` 会生成可操作的修复选项（切 family、删除条件、移除 atom 等）。这些建议通过 `ModeValidationResult.repairSuggestions` 返回。

- **自定义 family 需可选链保护**。`getModeNodeRuntimeTemplateDefinition` 访问 `MODE_NODE_RUNTIME_TEMPLATE_LIBRARY[family]` 时已使用可选链（`?.[template]`），防止自定义 family 字符串导致 `TypeError`。同文件的 `defaultNodeInstructions` 也使用相同保护。

- **Stance Lock 仅对 adversarialStance 阶段生效**。`shouldApplyStanceLock()` 检查 `stage.adversarialStance === true`，而非按 coordination pattern 判断。当前仅 `debate` mode 的 8 个 speech stages 标记了 `adversarialStance: true`。

## 关键文件索引

| 概念 | 定义位置 | 角色 |
| --- | --- | --- |
| `ModeSpec` / `ModeNodeSpec` / `ModeEdgeSpec` | `packages/shared/src/modes.ts` | 可编辑的模式图定义 |
| `ModeSpecSchema` validation | `packages/shared/src/modes.ts:2737` (`validateModeSpec`) | 保存前校验 |
| `MODE_FAMILY_RULES` | `packages/shared/src/modes.ts:461` | 每个 family 的模板约束 |
| `ModeCreateParams` / `ModeUpdateParams` | `packages/shared/src/modes.ts:358-369` | 创建/更新 mode 的 API 契约 |
| `createModeSpecFromPattern` | `packages/shared/src/modes.ts:1773` | 从 family blueprint 生成系统预设 mode |
| `modeSpecToPatternDefinition` | `packages/shared/src/modes.ts:2700` | ModeSpec → runtime PatternDefinition 的桥接 |
| `projectModeRuntimeTopology` | `packages/shared/src/modes.ts:1151` | ModeSpec → runtime topology 的投影 |
| `modeStudioDraft.ts` | `apps/runtime/src/mode-studio-draft.ts` | Mode Studio builder 的意图推导和草稿生成逻辑 |
| `mode-studio-store.ts` | `apps/runtime/src/mode-studio-store.ts` | builder draft 的组装与 provider 调用 |
| `mode-studio-builder-run.ts` | `apps/runtime/src/mode-studio-builder-run.ts` | builder run 的输入构建和快照管线 |
| `ModesView.tsx` | `apps/desktop/src/components/ModesView.tsx` | Mode Studio 桌面端主入口 |
| `modeCanvas.ts` | `apps/desktop/src/lib/modeCanvas.ts` | 画布节点/边构建、布局、校验 |
