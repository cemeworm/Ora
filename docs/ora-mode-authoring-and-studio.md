# Ora Mode Authoring 与 Mode Studio

这份文档解释如何在 Ora 中创建、编辑、校验、保存和运行一个 mode。它是 `ora-graph-framework.md` 的延伸——那篇文档解释了模式图的数据模型和运行时消费，这篇聚焦在“如何从零产出一个可用的 mode”。

## 阅读地图

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

## 1. 核心概念：System Preset 与 Custom Mode

Ora 中的 mode 分两类：

- **System Preset**（`systemPreset: true`）：由 `createModeSpecFromPattern` 或内联工厂函数（如 `createSingleAgentModeSpec`）生成。只读，不可直接编辑或删除。
- **Custom Mode**（`systemPreset: false`）：用户通过 Mode Studio 编辑器或 builder 对话创建。可编辑、可删除。

两者的数据结构完全相同（都是 `ModeSpec`），区别仅在于 `systemPreset` 字段和 `editorConstraints.readOnly`。

当前系统预设 mode：

| Mode ID | family | 说明 |
| --- | --- | --- |
| `single_agent` | `orchestrator_subagent` | 单 agent 直接回答，不委派 |
| `generator_verifier` | `generator_verifier` | 生成候选 + 验证循环 |
| `orchestrator_subagent` | `orchestrator_subagent` | 默认编排：分解 → 研究 → 审查 → 综合 |
| `agent_teams` | `agent_teams` | 持久 worker 团队协作 |
| `message_bus` | `message_bus` | 事件路由 |
| `shared_state` | `shared_state` | 共享黑板协作 |
| `debate` | `orchestrator_subagent` | 双面对抗性审查（red team / blue team） |
| `mode_studio_builder` | `orchestrator_subagent` | Mode Studio 自身的 builder mode |
| `code_development` | `orchestrator_subagent` | 代码开发专用 mode |
| `ora_self_builder` | `agent_teams` | Ora 自我迭代 mode |
| `deerflow_harness` | `orchestrator_subagent` | DeerFlow 风格 harness |

这些预设 mode 复用了 5 个内置 family（`generator_verifier`、`orchestrator_subagent`、`agent_teams`、`message_bus`、`shared_state`）。新增系统预设不一定需要新增 family。

## 2. Mode 的创建路径

Ora 提供三条创建 mode 的路径：

### 2.1 从预设克隆

用户在 Mode Studio gallery 中选中一个系统预设，点击 "Customize"：

```
systemPreset ModeSpec
  → 复制，id 加 -custom 后缀，systemPreset = false
  → hydrateModeDraft(mode) 深拷贝所有嵌套对象
  → editorConstraints.readOnly = false
  → 进入 edit 模式
```

桌面端入口：`ModesView.tsx` 中的 `startDraft(source, forceCreate=true)`。

### 2.2 空白创建

用户选择一个 family，从 `createModeSpecFromPattern(family)` 获得一个干净的 mode 骨架，然后手动编辑节点、边、profile。

### 2.3 Mode Studio Builder（对话式生成）

用户通过自然语言描述需求，builder 自动推导 family、生成节点和 agent roster：

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

Builder 有两种后端路径：
- **本地规则引擎**（`buildModeStudioDraft`）：基于关键词和模板推导，不调用 LLM。
- **Provider-backed**（`createModeStudioBuilderResult`）：调用 LLM 生成完整 draft，失败时降级到规则引擎。

Builder 的 guidance 系统用 6 个步骤引导用户补齐设计：
`goal` → `topology` → `agents` → `style` → `capabilities` → `preview`。

## 3. Mode Studio 画布节点类型

Mode Studio 画布中有三类节点，它们在数据模型和 UI 交互上角色不同：

### 3.1 真实 Stage 节点

对应 `ModeSpec.nodes` 中的 `ModeNodeSpec`。这是用户编辑的核心——每个节点代表模式图中的一个执行阶段。

```
ModeNodeSpec {
  id, template, label, ownerAgentId,
  enabled, instructions, prompt, riskLevel,
  config: { atoms, customAgentId, clarificationQuestion, ... }
}
```

`template` 决定了这个阶段的语义（`decompose`、`research`、`review`、`synthesize` 等 17 种内置模板 + 自定义字符串）。每个 template 在 `MODE_NODE_RUNTIME_TEMPLATE_LIBRARY` 中有对应的 fallback instructions 和 prompt。

### 3.2 Synthetic Capability Node（mode scope）

当 mode 启用了 mode-scope runtime atom（如 `memory_capture`、`thread_workspace`），画布会自动渲染对应的 capability 节点。这些节点：

- ID 前缀为 `__mode_atom__:`（`MODE_CAPABILITY_NODE_PREFIX`）
- 从 `__runtime_anchor__` 节点用虚线连接
- `draggable: false`，不可删除
- 不在 `ModeSpec.nodes` 中，仅存在于画布渲染层

### 3.3 Node Attachment Node

当 stage 节点在 `config.atoms` 中启用了 node-scope runtime atom（如 `subagent_delegate`、`deferred_tool_discovery`），画布会在该 stage 节点下方渲染 attachment 节点：

- ID 前缀为 `__node_atom__:`（`NODE_ATTACHMENT_NODE_PREFIX`）
- 从所属 stage 节点用虚线连接
- 同样不可拖拽、不可删除

### 3.4 `__runtime_anchor__` 节点

这是画布中的 UI-only 节点，代表 runtime harness。它**不是** `ModeSpec.nodes` 的真实节点。仅当 mode 启用了 mode-scope runtime atom 时才渲染。它的作用是：
- 作为所有 mode capability 节点的视觉锚点
- 展示当前启用的 capability 数量
- 为 stage 节点区域提供顶部 padding 基准

## 4. Mode 的编辑与保存链路

### 4.1 Draft 生命周期

```
startDraft(source)
  → hydrateModeDraft(seed)     // 深拷贝，确保可变
  → setDraft(nextDraft)         // React state
  → 用户在画布上编辑
  → patchDraft(updater)        // 每次变更更新 updatedAt
```

`hydrateModeDraft` 的关键动作：
- 深拷贝 `nodes`、`edges`、`profiles`、`stopPolicy`、`capabilityFlags`、`completionPolicy`、`runtimePolicy`、`recoveryPolicy`、`memoryPolicy`
- 将 `systemPreset` 设为 `false`
- 将 `editorConstraints.readOnly` 设为 `false`
- 调用 `ensureModeNodePositions` 补齐缺失的位置

### 4.2 画布编辑操作

| 操作 | 函数 | 说明 |
| --- | --- | --- |
| 添加节点 | `addModeNode(mode, template)` | 自动选默认模板、分配 ID、调用 `autoLayoutModeSpec` |
| 删除节点 | 通过 `canDeleteModeNode` 检查 | 不允许删除 family required 模板节点 |
| 禁用节点 | 通过 `canDisableModeNode` 检查 | 同样受 required 模板约束 |
| 添加边 | `addModeEdge(mode, connection)` | 需通过 `validateCanvasConnection` |
| 删除边 | `removeModeEdges(mode, edgeIds)` | 支持批量删除 |
| 移动节点 | `patchModeNodePosition` | 坐标需要 `modeCanvasStagePositionToStoredPosition` 转换 |
| 自动布局 | `autoLayoutDraft(mode)` | 调用 shared 的 `autoLayoutModeSpec` |
| 切换 family | `resetModeDraftFamily(mode, family)` | 重置 nodes/edges/profiles 为 family blueprint |

### 4.3 画布连接校验

`validateCanvasConnection` 阻止以下情况：
- 源或目标为空
- 自环（source === target）
- 源或目标节点不存在
- 连接的节点未启用
- 重复边
- 会产生环的边（DFS 检测）

### 4.4 保存链路

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

`ModeCreateParams` 与 `ModeSpec` 的区别仅在于省略了 `systemPreset`、`createdAt`、`updatedAt`——这些由服务端管理。

### 4.5 删除链路

```
deleteMode(modeId)
  → 阻止删除 systemPreset
  → window.confirm 确认
  → runtimeClient.deleteMode(modeId)
  → refreshModes()
```

系统预设不可删除，必须先 clone 为 custom mode。

## 5. `ModeNodeSpec.config` 详解

`config` 是一个 `passthrough` 的 Zod object，承载每个 stage 节点的运行时配置：

```typescript
config: z.object({
  atoms: z.array(z.string()).optional(),           // node-scope runtime atom 列表
  customAgentId: z.string().optional(),             // 覆盖默认 agent 的自定义 agent ID
  clarificationQuestion: z.string().optional(),     // 澄清问题文本
  clarificationKey: z.string().optional(),          // 澄清回答的 key
  story: z.unknown().optional(),                    // 阶段描述（Mode Studio builder 生成）
  timeoutMs: z.number().int().positive().optional(), // 阶段超时
}).passthrough().default({})
```

### 5.1 `atoms`

node-scope runtime atom 列表。与 `mode.runtimeAtoms`（mode scope）不同，这些 atom 只对当前 stage 生效。

当用户在画布上点击 stage 节点的 capability 开关时，对应的 atom ID 被加入/移出 `config.atoms`。画布会相应渲染/移除 node attachment 节点。

### 5.2 `customAgentId`

允许用户为特定 stage 指定自定义 agent。runtime 调用 agent 时，会用 `customAgentId` 解析实际的模型、技能和工具配置，同时保留 stage 自身的语义（template、instructions、prompt）。

这个字段独立于 `ModeNodeSpec.ownerAgentId`——后者是 mode profile 层面的绑定，前者是用户级别的 agent 覆盖。

### 5.3 `clarificationQuestion` / `clarificationKey`

用于在 stage 入口触发澄清中断。当节点设置了 `clarificationQuestion`，runtime 会在进入该 stage 前暂停执行，向用户展示问题并等待回答。答案通过 `clarificationKey` 注入到 prompt 变量中。

## 6. Runtime Atom 的双重语义

runtime atom 在编辑态和运行态扮演不同角色：

### 6.1 编辑态（Mode Studio 画布）

- atom 以 synthetic 节点的形式渲染
- 用户通过开关控制 atom 的启用/禁用
- mode-scope atom 出现在 `mode.runtimeAtoms` 数组中
- node-scope atom 出现在对应 `ModeNodeSpec.config.atoms` 中
- 画布的 `buildModeFlowNodes` / `buildModeFlowEdges` 负责将 atom 投影为视觉元素

### 6.2 运行态（Runtime Kernel）

- atom 影响 `projectModeRuntimeTopology` 的投影结果
- `family_capability`：复用 family 内置的 capability 节点（如 `message_bus` 的 `triage_topic`）
- `mode_capability`：投影时新增 `capability:<atomId>` 节点，从 `run` 连过去
- `stage_attachment`：投影时新增 `capability:<nodeId>:<atomId>` 节点，挂到对应 stage 的 owner agent
- atom 也影响 runtime 行为（如 `loop_guard` 控制最大迭代次数、`clarification_interrupt` 启用澄清中断）

### 6.3 校验边界

`validateModeSpec` 对 atom 做以下检查：
- mode-scope atom 必须与原子的 `scope: "mode"` 匹配
- atom 必须兼容当前 family
- atom 的 `requiresFlags` 必须在 `capabilityFlags` 中启用
- node-scope atom 如果已在 mode.runtimeAtoms 中启用，会报警告（冗余）

## 7. 校验链路

### 7.1 `validateModeSpec` 校验内容

```
validateModeSpec(spec) 检查：
  1. mode-scope runtime atoms 兼容性
  2. node IDs 唯一性
  3. node templates 是否在 family allowedTemplates 内
  4. node-scope atoms 兼容性
  5. stage IDs 唯一性、nodeId/speakerId 引用完整性
  6. transcriptLayout 与 stages 一致性
  7. recovery rules 引用完整性、skip 约束
  8. required templates 是否全部有对应 enabled node
  9. stopPolicy type 是否在 family 允许范围内
  10. edge 源/目标引用完整性、自环检测、重复边检测、cycle 检测
  11. edge condition 语法检查
  12. 至少有一个 enabled node
```

### 7.2 校验在保存链路中的位置

校验发生在两个节点：
1. **保存前**：`saveDraft()` 调用 `runtimeClient.validateMode(draft)`，不通过则拒绝保存。
2. **builder 返回后**：`withModeStudioValidation(bundle, deps)` 在 bundle 上附加最新校验结果。

注意：`ModeStudioDraftBundle.validation` 可能与画布当前 draft 不同步——用户在 builder 返回后可能手动编辑了 draft。因此 `saveDraft` 总是重新校验当前 draft。

## 8. 新增系统预设 Mode vs 新增 Family

### 8.1 新增系统预设 Mode（不改 family）

适用场景：需要一个新的 mode，但其拓扑结构可以用已有 family 表达。

步骤：
1. 在 `packages/shared/src/modes.ts` 中添加工厂函数（参考 `createDebateModeSpec`、`createCodeDevelopmentModeSpec`）。
2. 设置 `systemPreset: true`，选择合适的 family。
3. 定义 `nodes`、`edges`、`profiles`、`runtimeAtoms`、`editorConstraints`。
4. 在 `packages/shared/src/primitives.ts` 中添加 mode ID 常量。
5. 在 MVP presets 数组中注册。
6. 如果 mode 有特殊的 Stage Transcript 布局，设置 `transcriptLayout` 和 `stages`。

示例：`debate` mode 基于 `orchestrator_subagent` family，但配置了 `two_sided_duel` 的 transcript layout 和 dual-speaker stages。

### 8.2 新增 Family（新的 coordination pattern）

适用场景：现有的 5 个 family 都无法表达目标拓扑结构。

步骤：
1. 在 `packages/shared/src/primitives.ts` 的 `BuiltInCoordinationPatternSchema` 中添加 family。
2. 在 `packages/shared/src/modes.ts` 的 `MODE_FAMILY_RULES` 中定义模板约束。
3. 在 `MODE_NODE_RUNTIME_TEMPLATE_LIBRARY` 中添加模板定义。
4. 在 `MVP_PATTERN_DEFINITIONS` 中添加 `PatternDefinition`。
5. 添加 runtime atom 兼容性声明。
6. 在 `apps/runtime/src/patterns/` 中实现新的 mode driver。
7. 在 `apps/runtime/src/patterns/mode-driver-registry.ts` 中注册 driver。
8. 更新 `DEFAULT_RESOURCE_BUDGETS`。
9. 在 `apps/desktop/src/lib/modeCanvas.ts` 和 `ModesView.tsx` 中确认 Mode Studio 对新 family 的支持。

## 9. Mode Studio Builder 对话流程

Builder 是 Mode Studio 的 AI 辅助创建路径，完整流程如下：

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

### 9.1 Builder 的 Provider 调用

当 provider 不是 local-smoke 时，builder 调用 LLM：

1. 构造 `modeStudioBuilderSystemPrompt()`（详细的 JSON-only system prompt）
2. 构造 `modeStudioBuilderUserPrompt(params, context)`（包含可用 modes、agents、tools、skills、atoms、transcript layouts 的上下文）
3. 调用 LLM（temperature=0.2, maxTokens=5000, toolChoice="none"）
4. 解析 JSON 响应
5. 如果解析失败，调用 repair（temperature=0）
6. 映射 provider 响应到 `ModeStudioDraftBundle`

### 9.2 Builder 的 Guidance 选择

`modeStudioGuidance(family, text)` 返回 3 个 refine 选择：
- "Make review stricter"：收紧审查标准
- "Use more parallel work"：增加并行度
- "Keep tools minimal"：最小化工具

用户点击 choice 后，choice.prompt 作为新的用户消息追加，触发 refine 流程。

### 9.3 Transcript Layout 的自动推导

`modeStudioStructuredLayoutIntent(text)` 通过关键词匹配推导合适的 transcript layout：

| 关键词 | 推导的 layout style |
| --- | --- |
| debate, red team, 辩论 | `two_sided_duel` |
| rubric, scoring, 评分 | `rubric_matrix` |
| judge, verdict, 评审团 | `judge_panel` |
| evidence, fact check, 证据 | `evidence_board` |
| compare, versus, 对比 | `comparison_table` |
| gallery, artifact, 制品 | `artifact_gallery` |
| kanban, pipeline, 看板 | `kanban_pipeline` |

对于 `two_sided_duel`，`modeStudioStagedDraft` 会进一步生成完整的 stages 配置（opening → response → rebuttal → closing → synthesis），包括 `sideByStance`、`stanceLabels`、`stanceTones`、`summaryStances` 等 transcript layout 细节。

## 10. Mode 与 Runtime 的桥接

编辑完成的 ModeSpec 到 runtime 可执行形态经过两步转换：

### 10.1 `modeSpecToPatternDefinition(mode)`

```
ModeSpec
  → orderedEnabledModeNodes(mode)        // 拓扑排序
  → projectModeRuntimeTopology(mode)      // 投影 runtime topology
  → PatternDefinition {
      topology, profiles, planTemplate,
      defaultStopPolicy, defaultBudget, ...
    }
```

`planTemplate` 由 `orderedNodes` 推导，其中 `dependencies` 来自 `ModeSpec.edges`。

### 10.2 Runtime Kernel 消费

```
PatternDefinition
  → executeRuntimeKernel(..., { definition, modeSpec })
  → injectRootAgentTopology(definition.topology, modeSpec)
    → 添加 Ora 根 agent 节点
    → 建立 run → ora → handoffTarget 边
  → ModeDriverRegistry[modeSpec.family] 执行
```

## 11. 当前边界和容易误解的点

- **`systemPreset` 不可编辑但可 clone**。编辑预设 mode 时，编辑器总是先复制一份 `{ ...base, id: base.id + '-custom', systemPreset: false }`。clone 后与原预设没有任何引用关系。

- **画布中的 synthetic 节点不是 ModeSpec 数据**。`__runtime_anchor__`、`__mode_atom__:*`、`__node_atom__:*` 只存在于 React Flow 渲染层。保存时这些节点不会被写入 ModeSpec。

- **Builder 生成的 draft 仍可手动编辑**。builder 返回 draft 后，用户在画布上的手动修改会覆盖 builder 的生成结果。`applyBuilderBundle` 时会把当前画布 draft 塞回 bundle 再保存。

- **`ModeSpec.family` 决定了运行时 driver**。即使两个 mode 有完全相同的 nodes 配置，只要 family 不同，runtime 会用不同的 driver 执行。family 是与执行语义绑定的，不是纯粹的视觉分组。

- **`editorConstraints` 在 preset 上为只读**。但 clone 后的 custom mode 会重置 `readOnly: false`、`allowDelete: true`、`allowDisable: true`。

- **`transcriptLayout.style` 有 15 种 schema 预留值**，但并非所有都有对应的 renderer 实现。当前桌面端 `StageTranscript.tsx` 实际支持 8 种：`stage_list`、`two_sided_duel`、`rubric_matrix`、`judge_panel`、`evidence_board`、`comparison_table`、`artifact_gallery`、`kanban_pipeline`。`graph_topology` 等 schema 预留值没有接入 renderer。

- **Builder 的 family 推导是启发式的**。`inferModeStudioFamily` 基于关键词匹配，可能不准确。用户可以在画布上通过 `resetModeDraftFamily` 切换 family，但切换会重置 nodes/edges/profiles 为 family 默认值。

- **Mode 的 ID 必须全局唯一**。`ModeSpecSchema.id` 使用 `ModeIdSchema` 校验。builder 生成的 mode ID 通过 `slugifyModeStudio` 处理，中文会被替换为 "guided"。
