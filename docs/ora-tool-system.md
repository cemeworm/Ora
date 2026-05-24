# Ora 工具系统设计说明

本文档是 Ora runtime 工具系统的权威参考，覆盖架构设计、治理链机制、执行管道、基础设施和当前状态。Ora 的工具系统不是一个简单的"函数调用列表"，而是一个以 **runtime governance** 为中心的产品级 agent 工具平台。

## 1. 设计理念与架构概览

### 1.1 核心设计原则

**工具不是孤立函数**。每个工具调用从模型输出那一刻起，就进入一条完整的治理链：

```
policy → approval → action → execution → ledger → snapshot → projection
```

这意味着每个工具调用都是可审计的（有 action ledger 记录）、可恢复的（有 continuation frame）、可观察的（有 snapshot 投影和 desktop Trails 展示）。

**分层定义，各司其职**。工具的定义分成三层：shared contract 保证跨组件兼容、runtime behavior 承载执行逻辑、provider format 对接模型供应商。每层只知道自己需要知道的事。

**安全内建，而非外挂**。权限检查、风险评级、重复守卫、预算控制都是执行管道的内建环节，不是调用前的"检查清单"。

### 1.2 架构分层

```
Desktop UI (Trails, Approval Cards, Tool Renderers)
    ↕ snapshot / events / projection
Runtime Governance (Approval, Policy, Ledger, Middleware, Completion Guards)
    ↕ RuntimeToolDefinition + RuntimeToolExecutor
Tool Implementations (File, Shell, Web, MCP, Skills, Modes, ...)
    ↕ WorkspaceOperations
Provider Adapters (Anthropic, OpenAI, compatible)
```

- **Provider 层**将 Ora 的工具定义翻译为各模型供应商的原生格式，并从模型响应中提取工具调用
- **实现层**是工具的实际执行逻辑，通过 WorkspaceOperations 抽象与具体的工作区后端解耦
- **治理层**是 Ora 的核心竞争力：审批、策略、账本、中间件、守卫、恢复
- **UI 层**将工具调用投影为可读的审批卡片和 Trails 时间线

### 1.3 治理链全景

```
                        ┌──────────────────────────────────────────────────────────────────┐
                        │                      NODE MODEL-TOOL LOOP                          │
                        │                                                                     │
  ┌─────────────────┐   │   ┌──────────────┐    ┌────────────────┐    ┌──────────────────┐  │
  │  Model Response  │───▶  │  Tool Call    │───▶│ Action Proposal │───▶│ Approval         │  │
  │  (native or      │      │  Extraction   │    │ + Risk Assess  │    │ Resolution       │  │
  │   JSON fallback) │      │  (executor)   │    │ (action-propos) │    │ (action-runner)  │  │
  └─────────────────┘   │   └──────────────┘    └────────────────┘    └───────┬──────────┘  │
                        │                                                       │              │
                        │                                         ┌─────────────┴──────────┐  │
                        │                                         │                        │  │
                        │                                    approved                approval_required
                        │                                         │                        │  │
                        │                                         ▼                        ▼  │
                        │                              ┌──────────────────┐    ┌──────────────┐
                        │                              │ Tool Execution   │    │ Gate Opened  │
                        │                              │ (executor +      │    │ (approval    │
                        │                              │  middleware)     │    │  interrupt)  │
                        │                              └────────┬─────────┘    └──────┬───────┘
                        │                                       │                      │
                        │                           ┌───────────┴──────────┐           │
                        │                           │                      │           │
                        │                      succeeded                failed         │
                        │                           │                      │           │
                        │                           ▼                      ▼           │
                        │              ┌──────────────────┐   ┌──────────────────────┐  │
                        │              │ Record Success   │   │ Recovery Service     │  │
                        │              │ (action-runner)  │   │ (recovery-service)   │  │
                        │              └────────┬─────────┘   └──────────┬───────────┘  │
                        │                       │                        │              │
                        │                       │              ┌─────────┴─────────┐    │
                        │                       │              │                   │    │
                        │                       │          retry/            fallback/
                        │                       │       alternate           fail/throw
                        │                       │              │                   │    │
                        │                       ▼              ▼                   ▼    │
                        │              ┌──────────────────────────────────────────────┐  │
                        │              │         TOOL RESULT → MESSAGE HISTORY        │  │
                        │              └──────────────────────────────────────────────┘  │
                        │                                 │                                │
                        │                                 ▼                                │
                        │                    ┌────────────────────────┐                   │
                        │                    │ Follow-up Model Call   │                   │
                        │                    │ or Forced Final Answer │                   │
                        │                    └────────────────────────┘                   │
                        └──────────────────────────────────────────────────────────────────┘
                                                          │
                                                          ▼
  ┌──────────────────────────────────────────────────────────────────────────────────────────┐
  │                              PERSISTENCE & PROJECTION LAYER                               │
  │                                                                                           │
  │  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐                     │
  │  │ Action Ledger    │    │ Tool Call Ledger │    │ Runtime Events   │                     │
  │  └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘                     │
  │           │                       │                        │                               │
  │           └───────────────────────┼────────────────────────┘                               │
  │                                   ▼                                                        │
  │                        ┌──────────────────┐                                                │
  │                        │  StateSnapshot   │                                                │
  │                        │  .actions[]      │                                                │
  │                        │  .toolCalls[]    │                                                │
  │                        │  .events[]       │                                                │
  │                        │  .pendingApprovals│                                               │
  │                        │  .continuation   │                                                │
  │                        └────────┬─────────┘                                                │
  │                                 ▼                                                          │
  │                    ┌──────────────────────┐                                                │
  │                    │ RuntimeSessionLedger │                                                │
  │                    └──────────┬───────────┘                                                │
  │                               ▼                                                            │
  │                    ┌──────────────────────┐                                                │
  │                    │ Session / Run        │                                                │
  │                    │ Projection           │                                                │
  │                    └──────────┬───────────┘                                                │
  └───────────────────────────────┼────────────────────────────────────────────────────────────┘
                                  ▼
  ┌──────────────────────────────────────────────────────────────────────────────────────────┐
  │                              DESKTOP UI LAYER                                              │
  │                                                                                           │
  │  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐                     │
  │  │ Approval Card    │    │ Trails Tabs      │    │ Session List     │                     │
  │  └──────────────────┘    └──────────────────┘    └──────────────────┘                     │
  └──────────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. 阅读地图

### 2.1 核心类型

| 类型 | 文件 | 角色 |
| --- | --- | --- |
| `ToolDescriptor` | `packages/shared/src/capabilities.ts` | 共享层工具描述：id、category、riskLevel、parameters schema、prompt snippet |
| `RuntimeToolDefinition` | `apps/runtime/src/harness/capability-registries.ts` | 运行层工具定义：executor、动态 riskLevel、approvalRequest 模板、promptExample、resultPreview、argument preparation、continuation handler |
| `RuntimeToolDefinitionV2` | `apps/runtime/src/harness/runtime-tool-definition-v2.ts` | V2 内部演进别名，当前与 RuntimeToolDefinition 同形 |
| `ActionRecord` | `packages/shared/src/actions.ts` | 一次工具调用的耐久 action 记录：状态机从 proposed 到 succeeded/failed |
| `OraToolCallEnvelope` | `packages/shared/src/actions.ts` | 单次 tool call 的完整包裹：source、status、result、error、repairReason |
| `PolicyDecision` | `packages/shared/src/actions.ts` | 策略引擎关于是否需要审批的决定 |
| `RecoveryIncident` / `RecoveryDecision` | `apps/runtime/src/harness/recovery-policy.ts` | 恢复分类和决策：retry、alternate_tool、fallback_artifact、fail |
| `ActionApprovalRequestCopy` | `packages/shared/src/actions.ts` | 审批请求的面向用户文案：title、summary、whatWillChange、whyNeeded、riskNote |
| `PermissionProfile` | `packages/shared/src/capabilities.ts` | 按 category × riskLevel 的三态权限矩阵：allow / deny / ask |
| `ActionRiskLevel` | `packages/shared/src/actions.ts` | 运行时三级风险：low / medium / high |
| `OraToolCallSource` | `packages/shared/src/actions.ts` | 工具调用的四种来源：provider_native、json_fallback、manual_repair、replay |
| `WorkspaceOperations` | `apps/runtime/src/harness/workspace-operations.ts` | 工作区文件/搜索/shell 操作后端抽象，默认本地实现 |
| `ShellSnapshot` | `apps/runtime/src/harness/shell-snapshot.ts` | 登录 shell 环境快照：捕获用户 shell 完整环境变量，30min 缓存，敏感变量过滤 |
| `ApprovedToolContinuationHandler` | `apps/runtime/src/harness/approved-tool-continuation-handler.ts` | approved tool continuation 的 per-tool replay / artifact / continue 策略 |

### 2.2 核心服务

| 服务 | 文件 | 职责 |
| --- | --- | --- |
| `RuntimeToolExecutor` | `apps/runtime/src/harness/runtime-tool-executor.ts` | 工具注册、执行、risk 评估、approval copy 生成、pre/post policy hook 调度 |
| `RuntimeToolCallService` | `apps/runtime/src/harness/runtime-tool-call-service.ts` | 单次 tool turn 的编排：propose → approve → execute → record → follow-up model call |
| `RuntimeToolRecoveryService` | `apps/runtime/src/harness/runtime-tool-recovery-service.ts` | 工具执行失败后的恢复：分类 → 决策 → 重试/降级/fallback |
| `RecoveryCoordinator` | `apps/runtime/src/harness/recovery-policy.ts` | 基于 ModeSpec 的恢复策略匹配引擎 |
| `RuntimeCompletionController` | `apps/runtime/src/harness/runtime-completion.ts` | 工具预算控制、重复检测、强制终结 |
| `RuntimeToolCallLedger` | `apps/runtime/src/harness/runtime-tool-ledger.ts` | 单次 run 内的 tool call 内存账本 |

### 2.3 辅助模块

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| Action Proposal | `apps/runtime/src/harness/runtime-tool-action-proposal.ts` | 从 tool call 创建 ActionRecord 和 tool call envelope |
| Action Runner | `apps/runtime/src/harness/runtime-action-runner.ts` | action 状态转换、审批决议、成功/失败记录 |
| Approval | `apps/runtime/src/harness/runtime-tool-approval.ts` | approval copy 生成、中文/英文自动选择 |
| Interrupts | `apps/runtime/src/harness/runtime-interrupts.ts` | ApprovalInterruptError/ClarificationInterruptError（Symbol.for() 双重识别）、resume 审批匹配 |
| Boundary | `apps/runtime/src/harness/runtime-tool-boundary.ts` | Code Development mode 下 orchestrator 的工具边界守卫 |
| Recovery Policy | `apps/runtime/src/harness/recovery-policy.ts` | 错误分类引擎、恢复规则匹配、重试退避计算 |
| Tool Loop | `apps/runtime/src/harness/runtime-tool-loop.ts` | Tool attempt 选择、缓存键生成、重复调用检测 |
| Middleware | `apps/runtime/src/harness/runtime-middleware.ts` | 模型调用/工具执行/工具失败/模型响应的拦截管道 |

## 3. 工具定义三层体系

Ora 的工具定义分三层：**共享描述符**（静态身份）、**运行时执行体**（动态行为）、**供应商格式**（模型对接）。三层各司其职，互不污染。

### 3.1 ToolDescriptor — 共享合约

定义在 `packages/shared/src/capabilities.ts`，是工具的跨组件共享描述：

```typescript
ToolDescriptorSchema = z.object({
  id: z.string().min(1),               // "file.read"
  label: z.string().min(1),             // "Read File"
  description: z.string().min(1),       // 人类可读描述
  category: z.enum(["file", "shell", "network", "mcp", "model", "export", "internal", "package"]),
  riskLevel: z.enum(["safe", "low_risk", "requires_approval"]),
  parameters: z.record(z.unknown()).default({}),   // JSON Schema
  promptSnippet: z.string().min(1).optional(),     // 注入 system prompt 的使用提示
  promptGuidelines: z.array(z.string().min(1)).optional(),
  requiresApproval: z.boolean().default(false),
  implemented: z.boolean().default(true),
  allowedForProfiles: z.array(z.string().min(1)).default([]),
});
```

`category` 和 `riskLevel` 共同构成 **PermissionProfile** 三态矩阵的匹配键。所有 MVP 工具在 `MVP_TOOLS` 数组中静态定义。ToolDescriptor 不含任何执行逻辑 — 它只描述工具的"身份"和"契约"。

### 3.2 RuntimeToolDefinition — 运行时行为

定义在 `apps/runtime/src/harness/capability-registries.ts`，在 ToolDescriptor 基础上增加完整的运行时语义：

```typescript
interface RuntimeToolDefinition<TContext, TArgs, TResult> {
  descriptor: ToolDescriptor;                    // 指向共享描述符
  promptSnippet?: string;
  promptGuidelines?: string[];
  promptExample?: string;                        // 给模型的 JSON 示例
  requiresApprovalCopy?: boolean;               // 是否需要模型在参数中提供审批文案
  actionRiskLevel?: (args, context) => ActionRiskLevel;
  approvalRequest?: (args, context) => ActionApprovalRequestCopy;
  riskLevel?: (args, context) => ToolDescriptor["riskLevel"];
  execute?: (args, context) => TResult | Promise<TResult>;
  resultPreview?: (result, args) => RuntimeToolResultPreview;
  prepareArguments?: (input, context) => TArgs;
  continuationHandler?: RuntimeToolContinuationHandler;
}
```

关键设计：

- **execute** 是工具的唯一执行入口，接收类型化参数和执行上下文
- **prepareArguments** 在 execute 之前调用，兼容模型偶发 JSON string 参数等边界情况
- **resultPreview** 在 execute 之后调用，生成结构化预览元数据供桌面端消费
- **approvalRequest** 生成审批卡片的用户可读文案，支持中英文自动切换
- **riskLevel / actionRiskLevel** 支持基于参数的动态风险判定
- **continuationHandler** 定义审批通过后的恢复策略

工具的实现体按工具族分布在 `runtime-file-tools.ts`、`runtime-shell-tool.ts`、`runtime-mcp-tools.ts` 等文件中，通过 `builtInToolRuntimeFields(toolId)` 按 toolId 聚合到 `buildRuntimeToolDefinitions()`。`RuntimeToolDefinitionV2` 是 runtime 内部的演进别名/上转层：先把 preview、argument preparation、continuation hook 纳入同一个 definition 形状，但不破坏 shared `ToolDescriptor` public contract。

### 3.3 ModelToolDefinition — 供应商格式

发送给模型供应商的精简格式，只包含 `{id, description, parameters}`。各 provider 独立转换：

- Anthropic: `anthropicTools()` 映射为 `{name, description, input_schema}`
- OpenAI: `openAiResponsesTools()` 映射为 `{type: "function", name, description, parameters}`

工具名通过 `providerToolName()` 做 wire-format 规范化（特殊字符替换为 `__`），返回结果时通过 `runtimeToolIdFromProviderName()` 反向映射。

### 容易误解的点

- `ToolDescriptor.riskLevel` 是**静态分类**（safe/low_risk/requires_approval），用于 PermissionProfile 矩阵匹配；`RuntimeToolDefinition.riskLevel()` 是**动态评估**，可以基于实际参数调整风险。
- `ActionRiskLevel`（low/medium/high）是行动级的三级风险，与 `ToolRiskLevel` 是不同粒度的概念。当前代码中 level 为 `high` 才会触发 approval gate。
- ToolDescriptor 和 RuntimeToolDefinition 仍是两层合约：shared descriptor 保持稳定，runtime definition 已吸收 V2 字段。后续内聚重点是让更多工具真正消费 `resultPreview` / `prepareArguments` / continuation hooks。

## 4. 工具注册与发现

注册链从静态到动态分三步：

1. **MVP_TOOLS** 数组（`packages/shared/src/capabilities.ts`）定义所有工具的 ToolDescriptor
2. **RuntimeToolRegistry**（`apps/runtime/src/harness/capability-registries.ts`）接收 ToolDescriptor 或 RuntimeToolDefinition，构建 `Map<toolId, RuntimeToolDefinition>`
3. **RuntimeToolExecutor** 构造时调用 `buildRuntimeToolDefinitions()`，将静态 descriptor 与各工具族的动态 RuntimeToolDefinition 合并

各工具族的 runtime fields 由专门的 builder 函数提供：

| Builder | 文件 | 覆盖工具 |
|---------|------|---------|
| `fileToolRuntimeFields` | `runtime-file-tools.ts` | file.read, file.list, file.glob, file.grep, file.write, file.patch, file.apply_patch |
| `shellToolRuntimeFields` | `runtime-shell-tool.ts` | shell.execute |
| `webDocumentToolRuntimeFields` | `runtime-web-document-tools.ts` | web.fetch, web.search, document.extract |
| `skillToolRuntimeFields` | `runtime-skill-tools.ts` | skills.* |
| `mcpToolRuntimeFields` | `runtime-mcp-tools.ts` | mcp.listTools, mcp.readResource, mcp.call |
| `packageToolRuntimeFields` | `runtime-package-tools.ts` | package.* |
| `modeToolRuntimeFields` | `runtime-mode-tools.ts` | modes.* |
| `selfIterationToolRuntimeFields` | `runtime-self-iteration-tools.ts` | selfIteration.* |
| `automationToolRuntimeFields` | `runtime-automation-tools.ts` | automations.* |
| `planToolRuntimeFields` | `runtime-plan-tool.ts` | plan.update |
| `clarificationToolRuntimeFields` | `runtime-clarification-tool.ts` | user.clarify |

**工具过滤**：

- `enabledToolIds()` 过滤出已实现、已注册、且对当前 `taskIntent` 可用的工具
- `setActiveTools()` 允许 mode/agent 裁剪可用工具集
- `toolAvailableForTaskIntent()` 处理特殊情况（如 plan intent 下禁用 plan.update 避免递归）

当前共 **62 个**已实现的 runtime tool ID。

### 4.1 Visibility resolver 与默认工具面

从 2026-05-20 起，工具“看得见什么”不再由 root prompt、preset mode、child bundle 各自维护并行规则。当前统一走 shared/runtime 共用的 visibility resolver：

```text
(availableToolIds, tool metadata, preset/override, taskIntent, hard boundary)
  -> { visibleToolIds, hiddenToolIds, decisionSource, appliedConstraints, presetId? }
```

关键合同：

- `availableToolIds` 是硬上界；resolver 不能凭空引入新工具
- `ToolDescriptor.family` 现在显式区分 `explore / execute / coordinate / environment / evolve`
- `ToolVisibilityPresetId` 当前包括 `root_default`、`coding_root`、`single_agent_implement`、`self_builder_root`、`self_builder_build`、`self_builder_review`、`builder_write`、`review_readonly`、`research_readonly`、`repo_forensics`、`system_evolution`
- `decisionSource` 用来标记本次 visible surface 主要来自 `explicit_override`、`bundle_preset`、`resolver_default` 或 `legacy_fallback`
- `appliedConstraints` 记录 task intent 收缩、hard boundary 等实际生效的限制

其中几组新增 preset 的职责边界是：

- `single_agent_implement`：`single_agent + implement` 的 root 工具面。它表达“单智能体直接施工”，不是 child builder preset。
- `self_builder_root` / `self_builder_build` / `self_builder_review`：`ora_self_builder` 的 package/self-upgrade 专用 stage preset，分别对应 root promotion、builder candidate build、review/verify。

它的职责只是“收缩当前 agent 可见工具面”，不替代 approval、budget、result validation 或 runtime 末端 safety gate。`RuntimeToolExecutor.systemPrompt()`、provider tool list、child bundle resolution 现在都应消费 resolver 的 `visibleToolIds`，而不是序列化全量工具列表。

### 4.2 `repo.explore` 的正式地位

`repo.explore` 已不是 skill wrapper 或纯文案建议，而是正式进入 Ora runtime tool 管线的高层只读探索入口：

- family 属于 `explore`
- 请求 contract 以 `goal + kind + subject + optional scope` 为中心，覆盖 `locate / understand / trace / compare / verify`
- 响应 contract 统一返回 `status`、`answer`、`evidence`、`gaps`、`nextActions`
- 当前状态值是：
  - `answered`
  - `insufficient_evidence`
  - `needs_escalation`
- 它是 root / review / research / builder 这些 preset 的优先读仓入口，用来减少直接拼接 `file.list` / `file.glob` / `file.grep` / `file.read` 的原子 hop

因此 `repo.explore` 的意义不只是“多一个工具”，而是 visibility resolver phase-1 的第一位 Explore consumer：默认探索面先给高层只读入口，再按需要升级到底层 Execute 或 Environment。

### RuntimeToolExecutor 核心方法

| 方法 | 职责 |
| --- | --- |
| `enabledToolIds()` | 过滤当前模式可用的工具（检查是否已实现、是否匹配 taskIntent） |
| `toolDefinitions()` | 生成 provider native tool definition（含 approvalRequest 参数注入） |
| `systemPrompt()` | 生成 JSON fallback 时的 system prompt（含所有工具列表和使用指南） |
| `extractToolCall()` | 从模型文本中提取 fallback JSON tool call |
| `riskLevel()` | 计算运行时风险等级（调用动态 riskLevel 函数或回退到 descriptor） |
| `approvalRequest()` | 生成审批文案（优先使用模型提供的，否则用工具定义中的模板） |
| `executeWithMetadata()` | 完整执行链：pre-tool policy → prepareArguments → execute → resultPreview → post-tool policy |

## 5. 工具执行管道与治理链

单个工具调用从模型响应到结果记录，经历完整的流程。编排在 `node-runtime-loop.ts` 和 `RuntimeToolCallService.runToolTurn()` 中完成。

### 5.1 Tool Call 来源

Ora 接收四种来源的工具调用：

| 来源 | 场景 | 特征 |
| --- | --- | --- |
| `provider_native` | 模型原生 tool_use（如 Claude、GPT 的 function calling） | 有 `providerCallId`，可直接注入 tool role message |
| `json_fallback` | 模型输出 JSON 代码块或 `<tool_call>` 标签 | 无 providerCallId，结果以 user role message 注入 |
| `manual_repair` | 前一次调用参数错误，手工修正后重试 | JSON fallback 的子类 |
| `replay` | run replay 场景 | 不涉及新的模型调用 |

### 5.2 完整流程

```
1. selectRuntimeToolAttempt()
   优先 native tool call，fallback JSON 解析
    │
2. registerRuntimeToolAttempt()
   重复调用检测 + 预算检查 (RuntimeCompletionController)
    │
3. codeDevelopmentToolBoundaryError()
   Code Development mode 下 orchestrator 工具边界守卫
    │
4. proposeRuntimeToolAction()
   风险评估 → 创建 ActionRecord → 创建 OraToolCallEnvelope
    │
5. resolveRuntimeActionApproval()
   策略评估 → approved / approval_required / interrupted
    │
6. transitionRuntimeAction("running")
   状态转换 + emit gate 事件
    │
7. invokeRuntimeToolExecution()
   进入 middleware chain
    │
8. RuntimeToolExecutor.executeWithMetadata()
   pre-tool policy hooks → prepareArguments → execute → resultPreview → post-tool policy hooks
    │
9. recordRuntimeToolActionSucceeded() / recordRuntimeToolActionFailed()
   写 action ledger、tool ledger、event
    │
10. 工具结果进入 message 列表 → invokeFollowUpModel()
    或 forced final answer
```

### 5.3 Action Proposal 细节

`proposeRuntimeToolAction()`（`runtime-tool-action-proposal.ts`）承担三个同步任务：

1. **风险评估**：调用 `runtimeToolExecutor.riskLevel()` 计算 `ActionRiskLevel`
2. **Action 创建**：通过 `actionLedger.propose()` 创建 `ActionRecord`（status: `proposed`），如果 riskLevel === "high" 则附带 `approvalRequest`
3. **Tool Call 记录**：通过 `appendToolCall()` 创建 `OraToolCallEnvelope`（status: `proposed`），建立 actionId ↔ toolCallId 的双向关联

Action 和 Tool Call 是**两个不同的实体**：Action 是语义层面的行动（可以被审批、恢复、重试），Tool Call 是技术层面的调用包裹（记录来源、状态、结果）。

### 5.4 RuntimeToolExecutor 终端执行

`executeWithMetadata()` 是工具执行的最终环节：

1. 检查 AbortSignal — 已取消的 run 直接抛错
2. 运行 pre-tool policy hooks：`shellDestructiveCommandPolicyHook` → `permissionProfilePolicyHook` → 动态 hooks
3. 权限为 `deny` → 抛错；权限为 `ask` 且非 risky → 抛 `ApprovalInterruptError`
4. `definition.prepareArguments()` 预处理参数
5. `definition.execute(args, context)` 实际执行
6. `definition.resultPreview(result, args)` 生成预览元数据
7. 运行 post-tool policy hooks

### 5.5 Middleware 管道

定义在 `apps/runtime/src/harness/runtime-middleware.ts`，四个拦截点：

| Hook | 用途 |
|------|------|
| `wrapModelCall` | 包装模型调用 |
| `wrapToolExecution` | 包装工具执行 |
| `wrapToolFailure` | 包装工具失败恢复 |
| `wrapModelResponse` | 包装模型响应处理 |

内建 middlewares：

- `dangling_tool_call_repair`（优先级 -100）：修复缺失的 provider tool result
- `context_compaction`（优先级 -50）：追溯性工具结果截断，管理上下文窗口
- `batch_clarification_response`（优先级 -10）：合并多个 user.clarify 调用
- `clarification_tool`（优先级 -25）：处理 user.clarify 语义
- `tool_recovery`（优先级 25）：通过 RuntimeToolRecoveryService 做失败恢复

### 5.6 结果注入消息历史

```typescript
// provider_native 来源
messages.push(
  { role: "assistant", content: response.text, toolCalls: [...] },
  { role: "tool", toolCallId: providerCallId, toolName: tool, content: resultText }
);

// json_fallback 来源
messages.push(
  { role: "assistant", content: response.text },
  { role: "user", content: "Workspace tool result for ${tool}:\n${resultText}" }
);
```

关键区别：native tool call 可以使用标准 `tool` role message，fallback 必须用 `user` role 注入。

## 6. 分类、风险等级与权限

### 6.1 分类

| Category | 工具 | 说明 |
|----------|------|------|
| `file` | file.read, file.list, file.glob, file.grep, file.write, file.patch, file.apply_patch, file.delete, document.extract | 文件系统操作 |
| `shell` | shell.execute | 命令执行 |
| `network` | web.fetch, web.search | 网络访问 |
| `mcp` | mcp.listTools, mcp.readResource, mcp.call | MCP 协议工具 |
| `model` | agent.spawn, model.handoff | 模型调度 |
| `internal` | user.clarify, skills.*, modes.*, selfIteration.*, automations.*, plan.update, message.send | 内部治理工具 |
| `package` | package.list, buildCandidate, verify, promote, switch, rollback | 包管理 |
| `export` | export.report | 导出（未实现） |

### 6.2 三层风险体系

```
ToolDescriptor.riskLevel (静态)
  └─▶ RuntimeToolDefinition.riskLevel(args, context) (动态覆盖)
        └─▶ RuntimeToolExecutor.riskLevel() → ActionRiskLevel (运行时最终评估)
```

| 风险等级 | 含义 | 典型工具 |
|---------|------|---------|
| `safe` | 只读，无副作用 | file.read, file.list, file.glob, file.grep, web.search |
| `low_risk` | 有限副作用，可自动批准 | web.fetch, mcp.listTools, mcp.readResource |
| `requires_approval` | 修改文件系统或执行命令 | file.write, file.patch, shell.execute, skills.create |

风险等级支持**动态判定**：`RuntimeToolDefinition.riskLevel(args, context)` 可根据参数上下文返回不同等级。

当前 `ActionRiskLevel` 实际只有 low/high 两值在使用，medium 未启用。`descriptor.riskLevel === "requires_approval"` → `high`，否则 → `low`。

### 6.3 Pre-Tool Policy Hooks

`RuntimeToolExecutor` 内置两个 pre-tool policy hook，按顺序执行：

**shellDestructiveCommandPolicyHook**：仅对 shell.execute 生效，命令匹配破坏性模式（如 `rm -rf`、`git reset --hard`、`git push --force`）时强制 `riskLevel = "requires_approval"`。

**permissionProfilePolicyHook**：基于 PermissionProfile 的三态矩阵，调用 `resolveToolPermission(profile, category, riskLevel)` 返回 allow / deny / ask。

Hook 可以修改：`args`（参数重写）、`riskLevel`（风险调整）、`permission`（allow/deny/ask），后一个 hook 的结果覆盖前一个。

### 6.4 Permission Profile 三态矩阵

三个内置 profile 定义在 `packages/shared/src/capabilities.ts`：

| Profile | safe | low_risk | requires_approval |
| --- | --- | --- | --- |
| `runtime.full_trust` | allow | allow | allow |
| `runtime.default_policy` | allow | allow | ask |
| `runtime.readonly` | allow (file) / deny (other) | deny | deny |

### 6.5 Approval Mode 决策树

`resolveRuntimeActionApproval()` 的决策逻辑：

```
1. policyService.evaluate(action) → PolicyDecision { requiredApproval: boolean }
2. 判断 approvalMode:
   ├─ "auto"                → 跳过审批
   ├─ "high_risk_only"      → 仅 requiredApproval === true 时审批
   └─ "manual"              → 始终审批
3. 判断 permissionMode:
   ├─ "full_access"         → 跳过审批
   ├─ "auto_review"         → 自动 approved，但记录审批决议
   └─ "default"             → 按步骤 2 决定
4. 需要审批时:
   ├─ resume approvals 中有匹配 → 自动通过
   └─ 无匹配 → 抛出 ApprovalInterruptError → 进入 Gate
```

**容易误解**：`approvalMode: "high_risk_only"` 中的 "high_risk" 指的是 `PolicyDecision.requiredApproval === true`，而**不是** `ActionRiskLevel === "high"`。Permission Profile 的 allow / deny / ask 是**独立于 approvalMode 的第二层防线**：即使 approvalMode 是 auto，如果 permissionProfile 返回 deny，工具仍然会失败。

## 7. 审批与中断体系

### 7.1 Interrupt 抛出

```typescript
throw new ApprovalInterruptError(action.id);
```

`ApprovalInterruptError` 和 `ClarificationInterruptError` 使用 `Symbol.for()` 全局标记，全仓库使用 `isApprovalInterruptError()` / `isClarificationInterruptError()` / `isAnyInterruptError()` 三个 helper 函数识别（`Symbol.for()` + `instanceof` 双重检查）。使用 `Symbol.for()` 而非裸 `instanceof` 是为了跨模块边界、打包 sidecar、热重载路径的可靠性。

### 7.2 Tool Call Service 拦截

`RuntimeToolCallService.runToolTurn()` 在 catch 中处理：

```typescript
.catch((error) => {
  if (isApprovalInterruptError(error)) {
    nodeLoopController.emitGateRequired({
      agentId, title, actionId, toolId, detail, iteration,
    });
  }
  throw error; // 继续向上传播
});
```

### 7.3 Node Loop 层中断

`ApprovalInterruptError` 继续向上传播到 node loop 层：

1. Action status 被 action runner 置为 `approval_required`
2. Tool call status 同步置为 `approval_required`
3. `approval.required` 事件发射
4. Gate 打开 (FlowGate.kind = "approval")
5. Node loop 进入暂停状态
6. Snapshot 的 `continuation.frames` 记录暂停点和 `pendingActionIds`
7. Desktop 通过 `deriveRunInteraction()` 检测到 `RunAttentionKind = "needs_approval"`

**注意**：审批 gate **不是**在 `RuntimeToolExecutor.execute()` 中抛出的。`executeWithMetadata()` 中的 pre-tool policy 只做 `permission === "ask" && allowRisky !== true` 的检查——这是**第二层防线**，用于确保即使 action runner 层错误通过了审批，executor 也会再次拦截。

### 7.4 Resume 时的审批匹配

`createResumeApprovalMatcher()` 构造匹配器，支持四种匹配方式：

1. **精确 action ID 匹配**：`approvedActionIds.delete(action.id)`
2. **Stable key 匹配**：基于 type + riskLevel + input 的稳定 JSON key（去除 approvalRequest）
3. **Scope key 匹配**：针对 file.write / file.apply_patch，按 `type + riskLevel + path` 匹配本次及后续同文件操作
4. **Batch scope key 匹配**：针对 skills.create / skills.patch，按 `type + riskLevel + agentId` 批量匹配

守卫指纹在跨重试时通过 `replace(/\s*\([^)]+\)/g, "")` 剥离动态 ID，防止计数器重置。

### 7.5 审批文案

- 模型可在 `args.approvalRequest` 中提供自定义审批文案（**优先使用**）
- 若未提供，由 `RuntimeToolDefinition.approvalRequest(args, context)` 生成
- 文案根据 `userPrompt` 自动检测语言偏好，输出中文或英文
- `requiresApprovalCopy: true` 的工具，其参数 schema 会自动注入 `approvalRequest` 字段（通过 `toolParametersForApproval()`）

### 7.6 auto_review Gate 关闭

`auto_review` 权限模式下，`runtime-action-runner.ts` 主动扫描 ledger 中所有 `approval_required` 的残留 action 并自动关闭对应 gate。这是防御性修复——确保 ledger 中无残余 gate，审计日志与用户感知一致。

## 8. 缓存与重复守卫

### 8.1 工具结果缓存

`runtimeToolResultCache`（`Map<string, unknown>`）缓存只读工具的返回结果。

**缓存键**由 `cacheKeyForRuntimeTool()`（`apps/runtime/src/harness/runtime-tool-loop.ts`）生成，所有影响输出内容的参数必须包含在键中：

| 工具 | 缓存键参数 |
|------|-----------|
| `file.read` | path, offset, limit |
| `file.list` | path, limit |
| `file.glob` | pattern, path, limit |
| `file.grep` | pattern, path, include, caseSensitive, limit |
| `web.fetch` | url, maxBytes |
| `web.search` | 规范化 query, limit |

**缓存失效**由 `invalidatesRuntimeToolCache()` 定义。以下工具执行后清空整个缓存：`file.write`, `file.patch`, `file.apply_patch`, `shell.execute`, `skills.*`, `package.*`, `modes.applyDraft`, `selfIteration.apply`。

这是保守策略 — 任何写操作都清空全部缓存，避免局部失效的复杂性。

### 8.2 重复工具调用检测

`stableKeyForRuntimeTool()` 为任意工具调用生成稳定指纹：

1. 只读工具 → 复用 `cacheKey`
2. 写工具 → `writeToolContentKey()` 基于内容哈希：
   - `file.patch`：对 `oldText` 使用 DJB2 哈希（32 位，无外部依赖）。仅使用 oldText（而非完整编辑内容），因为同一位置的重复尝试应计入重复计数
   - `file.write`：对 content 使用 DJB2 哈希
   - `file.apply_patch`：对 patch 内容使用 DJB2 哈希
3. 其他工具 → 基于 salient args（path, url, query, command, pattern, name 等）的稳定 JSON（键排序、确定性序列化）

### 8.3 重复工具决策统一

重复工具守卫的所有阈值和历史追踪收拢到单一决策点 `decideRepeatedToolAttempt()`（`runtime-completion.ts`）。原先 `registerToolAttempt()` 和 `markToolResultObserved()` 使用不同的比较运算符（`>` vs `>=`），统一后缓存命中观察仅为元数据记录，不影响重复计数阈值。

### 8.4 工具预算控制

`RuntimeCompletionController`（`apps/runtime/src/harness/runtime-completion.ts`）统一管理：

- **`runToolBudget`**：默认 256 次（`DEFAULT_MAX_TOOL_CALLS`），每次工具调用消耗预算
- **`TOOL_TYPE_HARD_LIMIT`**：单类工具 256 次上限，达到时触发 `forceFinalAnswer("tool_frequency_exhausted")`，50% 时提前警告
- **作用域隔离**：预算可按 `agentId`/`nodeId` 做 scope 隔离，子 agent 的工具预算独立计算

强制终结的原因包括：`repeated_tool_blocked`、`tool_frequency_exhausted`、`tool_budget_exhausted`、`context_limit`、`low_model_credit`、`security_policy`。

### 8.5 Completion Guards

`assertRunCanBecomeTerminal()` 执行严格终态断言，检查：
- 未完成的 plan list steps
- 未完成的 todo/progress items
- 待审批的 actions
- 待处理的 clarifications
- 非终态的 actions/tool calls
- 活跃的 continuation frames

`finalOutputGuard` 拒绝空内容或过短（<60 chars）的最终输出。

## 9. 文件操作与变更队列

### 9.1 只读工具

`file.read`、`file.list`、`file.glob`、`file.grep` 为只读操作，`safe` 风险等级，支持结果缓存。默认跳过 `.git`、`node_modules`、`dist`、`.next` 等目录，以及 `.db`、`.sqlite` 等二进制文件后缀。

`file.grep`/`file.glob` 的 bare glob/include 在非 root `path` 下做 scoped 匹配。

从用户视角看，这里最重要的不是“参数有哪些”，而是 **Ora 现在如何理解一次文件读取失败**。当前系统刻意把三类情况分开：

1. **repo 内语义 miss**
   - 模型想读的是仓库里的某个文件或目录，但路径写错了、目录层级猜错了、或者目标根本不存在
   - 这类情况不应一律上升成环境故障
2. **真实环境错误**
   - 没有 workspace、权限不允许、scope 越界、底层文件系统不可用
   - 这类情况仍然是硬错误
3. **项目外只读访问**
   - 用户或工具明确要读项目根目录以外的本地文件
   - 只读访问可以放宽，写访问仍然不能越界

这样拆分的原因很直接：读错 repo 内路径，本质上更接近“目标解析失败”，不是“环境坏了”。

### 9.1.1 repo 内只读 miss 的语义恢复

`file.read` / `file.grep` / `file.glob` 在 repo 内读取目标时，当前主路径优先把失败理解成**目标解析语义**，而不是立刻抛成 `ENOENT -> env_unavailable -> run.failed`。

- `file.read`
  - 如果存在单一高置信候选，可以做保守自动纠偏
  - 如果没有高置信候选，返回结构化 miss，让上层决定是否继续澄清或换策略
- `file.grep` / `file.glob`
  - 当目标目录不存在时，返回结构化 miss，不把它伪装成环境不可用

这里的保守边界也很明确：

- 不做全仓模糊搜索
- 不静默纠偏到多个候选中的任意一个
- 只有在“单一高置信候选”时才允许自动纠偏

### 9.1.2 自动纠偏与 clarification 的边界

自动纠偏和 clarification 不是一回事：

- **自动纠偏** 只用于单一高置信候选，系统可以安全地替用户补正
- **clarification** 只在必须由用户在多个候选里做决策时才介入

这条边界很重要，因为 Gate 的语义是“等待外部决策”。多数 repo 内 miss 只是模型找错路径，不值得 durable 化成新的 gate。

### 9.1.3 workspace scope 下的项目外只读文件

当前 workspace scope 对只读能力做了有意放宽：

- `read` / `list` / `search` 可以读取项目外、但本机上真实存在的文件
- `write` / `patch` 仍然严格限制在项目根目录内
- 这条放宽不走 host grant 系统，也不改变写工具的安全沙箱

对用户来说，可以这样理解：

- 想**看**项目外的本地文件，Ora 可以帮你读
- 想**改**项目外的本地文件，Ora 仍然不会在 workspace scope 下直接写

### 9.2 file.write

- 风险等级：`requires_approval`
- `requiresApprovalCopy: true`，模型需提供审批文案
- `actionRiskLevel: () => "high"`
- 通过 `withWorkspaceFileMutationQueue` 串行化同文件写入
- 结果包含 `fileChange` 元数据：beforeContent, afterContent, additions, deletions, sizeBytes, created

### 9.3 file.patch

支持 `edits[]` 数组格式：

```json
{
  "path": "src/file.ts",
  "edits": [
    { "oldText": "待替换的原文", "newText": "替换后的新内容" }
  ]
}
```

规则：

- 每个 `oldText` 必须在文件中**唯一出现**
- 不允许重叠 edit（两个 edit 不能匹配同一段文本）
- 多个 edit 都基于**原始文件**匹配，非增量串联
- 保留 BOM 和原始 line ending
- 结果包含 unified diff、`firstChangedLine`、`additions`/`deletions`

同时保留旧 `{search, replace}` 兼容格式。

### 9.4 file.apply_patch

接受 unified diff 格式的 patch 文本，应用到目标文件。支持多文件 unified diff 应用、新文件创建、context 精确匹配、workspace path guard。当前不支持 rename/delete patch，多文件 patch 要求同目标文件只有一个 patch block。

### 9.5 同文件变更队列

`withWorkspaceFileMutationQueue(absolutePath, fn)`（`apps/runtime/src/harness/runtime-file-mutation-queue.ts`）将同一文件的写操作串行化为 Promise chain。不同文件的操作仍可并行。这解决了 agent 并行或连续 tool call 中的同文件竞态问题。

## 10. 工作区操作抽象

`WorkspaceOperations` 接口（`apps/runtime/src/harness/workspace-operations.ts`）将文件系统和 shell 操作抽象为可插拔接口：

```typescript
interface WorkspaceOperations {
  readFile(rootPath: string, relativePath: string, maxBytes: number): WorkspaceFileContent;
  writeFile(rootPath: string, relativePath: string, content: string): void;
  listFiles(rootPath: string, relativePath: string): WorkspaceFileEntry[];
  globFiles(rootPath: string, pattern: string, basePath?: string): string[];
  grepFiles(rootPath: string, pattern: string, options: WorkspaceGrepOptions): WorkspaceGrepMatch[];
  exec(rootPath: string, command: string, options: WorkspaceExecOptions): Promise<WorkspaceExecResult>;
}
```

默认实现 `localWorkspaceOperations` 使用本地 `fs` 和 `child_process.spawn`。

设计意图：同一套 tool definition 可通过注入不同的 `WorkspaceOperations` 适配器连接到 SSH workspace、容器 workspace、cloud sandbox 等远程后端，而无需修改工具定义和执行管道。

`RuntimeToolExecutionContext` 中注入 `operations` 和 `signal`，所有工具执行函数通过 context 获取。当前 executor context 已携带 adapter，默认本地实现可用；部分 file tool 仍直接使用本地 fs/path helper，后续迁移应按工具族小步推进。

## 11. 流式输出与上下文管理

### 11.1 流式事件分类

流式事件按结构性分类而非白名单：

| 事件类别 | 语义 | 处理策略 |
|---------|------|---------|
| `delta` | 高频文本增量（message.delta） | 直接推 UI，不做完整解析 |
| `passive_accumulation` | 低频状态更新（node.updated, context.usage.updated, agent.message） | 跳过完整 Zod parse 和 snapshot 投影 |
| `durable_projection` | 需要持久化的状态变更 | 触发 snapshot 更新和 ledger flush |

### 11.2 Shell 流式输出

`shell.execute` 通过 `child_process.spawn` 执行，支持：

- **超时控制**：`timeoutMs` 参数
- **输出大小限制**：stdout/stderr 独立 1MB 硬截断，超出时标记 `truncated: true`，UTF-8 安全裁切，截断提示尾部注入
- **AbortSignal 中断**：收到 abort 信号时尝试 kill process tree，返回 `interrupted: true`
- **完整日志**：输出过大时写入临时完整日志文件（`fullOutputPath`）
- **login/shell 参数**：schema 暴露 `login`/`shell` 可选字段，支持 POSIX login shell、PowerShell、cmd 分支

### 11.3 Shell 环境快照

`shell-snapshot.ts` 通过登录 shell 捕获完整环境变量（含 nvm/fnm/volta PATH），30min 缓存，敏感 key 过滤，失败回退 `process.env`。`shell.execute` 与 `workspace exec` 基于登录 shell 快照构建环境变量，不再依赖静态白名单 PATH。

### 11.4 工具结果截断

`truncateToolResultForContext()`（`apps/runtime/src/harness/tool-result-truncation.ts`）对进入 LLM 上下文的结果做截断：

- 默认 2000 token budget，head/tail 各 50%
- `plan.update` 和 `user.clarify` **永不截断**（规划数据需要完整保留）
- 完整结果保留在 **action ledger** 和 **runtimeToolResultCache** 中，上下文截断不影响审计和缓存

### 11.5 AbortSignal 贯通

`RuntimeToolExecutionContext.signal` 已贯通以下工具：

- `shell.execute`：abort 时尝试 kill process tree
- `web.fetch`：abort 时中断 HTTP 请求
- `web.search`：abort 时中断搜索
- `mcp.call`：abort 时中断 MCP 工具调用
- `document.extract`：abort 时中断文档提取

取消语义不是所有工具等价：registry、skills、package、automation 这类同步或内部操作仍需按工具族判断是否有可中断边界。

### 11.6 Image 内容块支持

Ora 支持用户粘贴截图作为 agent 上下文输入：

- **Desktop 层**：粘贴处理 + ImagePill 渲染 → `ChatInput.tsx` / `ChatView.tsx`
- **状态层**：`pastedImages` 数组（base64 data URLs） → `state.tsx` reducer
- **Runtime 上下文**：`buildDesktopRunContext` 提取图像 → `workspaceContext`
- **系统提示词**：`attachedImagesSystemPrompt` 注入用法说明 → `runtime-prompts.ts`
- **Provider 层**：`ModelImageBlock` 类型 + Anthropic provider 图像内容块构建 → `providers/anthropic.ts`

## 12. 工具恢复

### 12.1 错误分类

`classifyRecoveryError()` 将错误归类为 17 种 `RecoveryErrorType`：

```
surface === "provider" / "transport" / "sidecar"
  ├─ quota/billing/credit → provider_quota
  ├─ api key/auth/forbidden → provider_auth
  ├─ busy/overloaded/429 → provider_busy
  ├─ timeout/50x → provider_transient
  ├─ unknown provider → provider_config_error
  └─ 其他 → provider_transient (兜底)

surface === "tool"
  ├─ approval/denied/risky → tool_policy_denied
  ├─ EACCES/EPERM/no project folder → env_unavailable
  └─ 其他 → tool_error

surface === "model" → model_output_invalid
其他 → node_exception / node_timeout
```

### 12.2 恢复决策

`RecoveryCoordinator.resolve()` 从 `ModeSpec.recoveryPolicy`（或默认策略）中匹配规则：

| 规则 ID | 错误类型 | 动作 | 重试 |
| --- | --- | --- | --- |
| `provider-transient-retry` | provider_transient, provider_busy | retry | 最多 3 次，指数退避 |
| `provider-hard-fallback` | provider_auth, provider_quota | fallback_artifact | — |
| `provider-config-fail` | provider_config_error | fail | — |
| `env-unavailable-fail` | env_unavailable | fail | — |
| `boundary-violation-degrade` | boundary_violation | fallback_artifact | — |
| `tool-error-fallback` | tool_error, tool_output_invalid | fallback_artifact | — |
| `tool-policy-fail` | tool_policy_denied | fail | — |
| `runtime-node-fail` | model_output_invalid, node_exception, node_timeout, loop_detected, subagent_limit | fail | — |
| `human-interrupt` | approval_required, clarification_required | interrupt | — |

### 12.3 Tool Recovery vs Provider Recovery

| 维度 | Tool Recovery | Provider Recovery |
| --- | --- | --- |
| 触发层 | `RuntimeToolRecoveryService.recoverToolFailure()` | Node loop 层的 provider 调用异常 |
| 错误表面 | surface = "tool" | surface = "provider" / "transport" / "sidecar" |
| 恢复后行为 | 自动 retry / 切换 alternate tool / fallback artifact | 由 node loop 的 continuation dispatcher 决定 |
| 对 tool call ledger 的影响 | 失败记录 + 可能的 recovery action record | 不影响 tool call ledger |

### 12.4 恢复后的消息注入

- **retry**：不修改消息历史，直接重新执行同一个 tool call
- **alternate_tool**：创建新的 recovery action，执行替代工具，结果注入消息
- **fallback_artifact**：注入降级消息标记 `[recovery:fallback]` 或 `[tool-error-boundary]`，用 degraded output 继续

### 容易误解的点

- Tool recovery **只在 `nodeLoopController.state === "tool_running"` 时有效**。如果 tool recovery 被错误路由（state 不是 tool_running），会发出诊断警告并直接 throw。
- `boundary_violation` 错误即使在 recovery policy 中配置了 fallback，也会在 fallback 后 throw——不会继续执行模型调用。

## 13. Code Development 模式工具边界

### 13.1 问题

Ora 的 Code Development mode 中，orchestrator 节点的职责是**规划和最终交付**，代码变更应该由 Builder 节点执行。但模型可能错误地在 orchestrator 中调用文件写入工具。

### 13.2 实现

`codeDevelopmentToolBoundaryError()` 检查两个条件：

```typescript
if (modeSpec.id !== CODE_DEVELOPMENT_MODE_ID || agentId !== "orchestrator") {
  return undefined; // 不是 Code Dev 模式的 orchestrator，放行
}
```

阻止的工具列表：
```typescript
CODE_DEVELOPMENT_ORCHESTRATOR_BLOCKED_TOOLS = [
  "file.write", "file.patch", "file.apply_patch", "file.delete",
  "modes.applyDraft", "selfIteration.apply",
  "skills.create", "skills.update", "skills.setEnabled",
];
```

以及**高风险 shell 命令**。

### 13.3 与审批的关系

Boundary check 在 `RuntimeToolCallService.runToolTurn()` 中**先于** action proposal 和审批执行：

1. Boundary 是第一道防线：orchestrator 根本**不能**发起这些工具调用
2. 审批是第二道防线：Builder 可以发起但需要审批
3. Boundary 错误被归类为 `boundary_violation`，进入 recovery → fallback_artifact → throw

### 容易误解的点

- Boundary 只检查 modeId === `CODE_DEVELOPMENT_MODE_ID`，对其他 mode 没有此限制。
- Boundary 错误**不会**进入 approval gate，而是直接进入 recovery。模型会收到 fallback 消息并被迫调整路径。

## 14. 桌面端工具渲染

### 14.1 ToolRendererRegistry

`ToolRendererRegistry`（`apps/desktop/src/lib/toolRendererRegistry.ts`）管理工具特定的 UI 渲染器：

```typescript
interface ToolRendererDescriptor {
  match: string;      // 工具 ID 或前缀
  label: string;      // 渲染器名称
  component: string;  // React 组件标识
  icon: string;       // 图标标识
}
```

已注册的渲染器：

| 工具 | 组件 | 说明 |
|------|------|------|
| `file.patch` | FileDiffPreview | Diff 预览 |
| `file.write` | FileWritePreview | 文件写入预览 |
| `file.read` | FileReadPreview | 代码预览 |
| `shell.execute` | ShellOutputPreview | 命令输出预览 |
| `web.fetch` | WebFetchPreview | 网页内容预览 |

通过 `toolRendererRegistry.get(toolId)` 查找，支持精确匹配和前缀匹配。

### 14.2 resultPreview

`RuntimeToolDefinition.resultPreview()` 在工具执行后生成结构化预览元数据：

```typescript
interface RuntimeToolResultPreview {
  kind: string;                        // 工具类型标签
  summary: string;                     // 单行摘要
  detail?: Record<string, unknown>;    // 结构化详情
  preview?: unknown;                   // 渲染器特定数据
}
```

当前已覆盖：`file.read`、`file.list`、`file.glob`、`file.grep`、`file.write`、`file.patch`、`shell.execute`。

### 14.3 Snapshot 与桌面投影

工具调用进入以下 snapshot 结构：

- `StateSnapshot.toolCalls`：工具调用记录
- `StateSnapshot.actions`：action 账本
- `StateSnapshot.events`：事件流
- `pendingApprovals`：待审批项
- `continuation.frames`：恢复帧

Snapshot 是**内存 live 视图**，Ledger 是**耐久事实**。恢复时应该信 Ledger projection，而不是直接信快照。

Desktop 通过 `trailViewModel.ts`、`ApprovalRequestCard.tsx`、`TrailsDrawer.tsx`、`TrailsTabs.tsx` 将工具调用、审批、agent lane、semantic timeline 投影为可交互 UI。

Tool result 有两条可见路径：运行中通过 `OraToolCallEnvelope.result` / `tool.called` 事件进入 live snapshot；终态和 reload 后以 `RuntimeToolResultLedgerEntry` / `snapshot.toolResults` 为 durable 结果来源。Tools tab 会合并两者，ledger-backed result 不应被 live envelope 覆盖。

### 14.4 skills.patch 工具

`skills.patch` 供 agent 修改/创建 skill：

- **分层模糊匹配**：精确 ID 匹配 → 空白归一化匹配 → 预览报错
- **动态 approval 策略**：`background_auto` 创建的 skill 走低风险审批路径
- **Provance 检查前置**：在 execute 阶段检查 provenance，而非在 patch 阶段
- **并行批量审批**：同 run 内的多个 skill 修改合并为单次审批

## 15. 状态机速查

### 15.1 ActionRecord 状态机

```
proposed ──▶ approval_required ──▶ approved ──▶ running ──▶ succeeded
   │              │                    │            │
   │              │                    │            └──▶ failed
   │              │                    │
   │              └──▶ denied          └──▶ denied
   │
   └──▶ skipped
   └──▶ reverted
```

### 15.2 OraToolCallEnvelope 状态机

```
proposed ──▶ approval_required ──▶ approved ──▶ running ──▶ succeeded
   │              │                    │            │
   │              └──▶ denied         │            └──▶ failed
   │                                   │            └──▶ interrupted
   │                                   └──▶ denied       └──▶ repaired
   └──▶ interrupted
```

### 15.3 RecoveryAction 决策路径

```
error
  └─▶ classifyRecoveryError()
        └─▶ RecoveryIncident { errorType, surface, detail, toolId, agentId }
              └─▶ RecoveryCoordinator.resolve()
                    ├─▶ retry (指数退避, 最多 maxAttempts 次)
                    ├─▶ alternate_tool (切换替代工具)
                    ├─▶ fallback_artifact (降级继续)
                    ├─▶ skip_node
                    ├─▶ interrupt (进入 gate)
                    └─▶ fail
```

## 16. 关键文件索引

| 文件 | 内容 |
| --- | --- |
| `packages/shared/src/capabilities.ts` | ToolDescriptor、PermissionProfile、MVP_TOOLS、内置权限矩阵 |
| `packages/shared/src/actions.ts` | ActionRecord、OraToolCallEnvelope、PolicyDecision、RecoveryRule、ActionRiskLevel |
| `packages/shared/src/runtime.ts` | StateSnapshot、RunContinuation、FlowGate、RunAttention、所有事件类型 |
| `apps/runtime/src/harness/runtime-tool-executor.ts` | RuntimeToolExecutor、pre/post policy hooks、riskLevel/approvalRequest 实现 |
| `apps/runtime/src/harness/runtime-tool-call-service.ts` | 单次 tool turn 编排（propose → approve → execute → record → follow-up） |
| `apps/runtime/src/harness/runtime-tool-action-proposal.ts` | proposeRuntimeToolAction |
| `apps/runtime/src/harness/runtime-action-runner.ts` | resolveRuntimeActionApproval、transitionRuntimeAction、recordRuntimeToolActionSucceeded/Failed |
| `apps/runtime/src/harness/runtime-tool-approval.ts` | genericApprovalRequest、中文/英文自动选择 |
| `apps/runtime/src/harness/runtime-tool-recovery-service.ts` | RuntimeToolRecoveryService（retry / alternate / fallback 编排） |
| `apps/runtime/src/harness/recovery-policy.ts` | classifyRecoveryError、RecoveryCoordinator、默认恢复策略 |
| `apps/runtime/src/harness/runtime-tool-ledger.ts` | RuntimeToolCallLedger |
| `apps/runtime/src/harness/runtime-tool-boundary.ts` | codeDevelopmentToolBoundaryError |
| `apps/runtime/src/harness/runtime-interrupts.ts` | ApprovalInterruptError、ClarificationInterruptError、ResumeApprovalMatcher |
| `apps/runtime/src/harness/capability-registries.ts` | RuntimeToolDefinition 类型、RuntimeToolRegistry |
| `apps/runtime/src/harness/runtime-tool-definition-v2.ts` | RuntimeToolDefinitionV2 内部演进类型 |
| `apps/runtime/src/harness/workspace-operations.ts` | WorkspaceOperations 接口 + 本地适配器 |
| `apps/runtime/src/harness/shell-snapshot.ts` | 登录 shell 环境快照捕获、缓存、敏感 key 过滤 |
| `apps/runtime/src/harness/runtime-file-mutation-queue.ts` | 同文件 mutation queue |
| `apps/runtime/src/harness/runtime-completion.ts` | RuntimeCompletionController、工具预算、重复检测 |
| `apps/runtime/src/harness/runtime-completion-guards.ts` | 终态守卫（plan list、progress、pending work、final output） |
| `apps/runtime/src/harness/runtime-tool-loop.ts` | Tool attempt 选择、缓存键、stable key |
| `apps/runtime/src/harness/approved-tool-continuation-handler.ts` | approved tool continuation handler registry |
| `apps/runtime/src/harness/runtime-middleware.ts` | Middleware 管道（context compaction、tool recovery、clarification batching） |
| `apps/runtime/src/harness/runtime-file-tools.ts` | 文件工具实现体 |
| `apps/runtime/src/harness/runtime-patch-tool.ts` | unified diff 应用工具 |
| `apps/runtime/src/harness/runtime-shell-tool.ts` | Shell 工具实现体 + 破坏性命令检测 |
| `apps/runtime/src/harness/tool-result-truncation.ts` | 工具结果截断 |
| `apps/runtime/src/harness/runtime-mcp-tools.ts` | MCP 工具实现体 |
| `apps/runtime/src/harness/runtime-skill-tools.ts` | Skill 工具实现体 |
| `apps/runtime/src/run-projections.ts` | toFlowRunDetail、toSessionTurn、deriveRunAttention |
| `apps/desktop/src/lib/toolRendererRegistry.ts` | Desktop 工具 renderer registry |
| `apps/desktop/src/components/ApprovalRequestCard.tsx` | 审批卡片 UI |
| `apps/desktop/src/components/TrailsTabs.tsx` | Trails 工具时间线 UI |

## 17. 当前状态

### 17.1 已实现的 62 个工具

```
file:        read, list, glob, grep, repo.explore, write, patch, apply_patch
shell:       execute
network:     web.fetch, web.search
document:    extract
mcp:         listTools, readResource, call
skills:      list, get, checkName, create, update, setEnabled, patch
package:     list, buildCandidate, verify, promote, switch, rollback
modes:       list, generateDraft, refineDraft, validate, applyDraft
selfIteration: list, get, scan, evaluate, apply
automations: list, get, previewSchedule, create, update, pause, resume, delete, runNow
widgets:     getSelectedContext, get, todo.addItem
internal:    user.clarify, plan.update, agent.spawn, agent.wait, message.send
computer:    permissionStatus, observe, click, type, press, scroll, window
```

### 17.2 已实现的关键机制

**治理链**：
- 完整审批链（policy → approval → interrupt → resume matching，四种匹配方式）
- Pre/post tool policy hook 链（shell destructive command 检测 + permission profile + 动态 hooks）
- Action Ledger + Tool Call Ledger + Runtime Events 三层耐久记录
- `Symbol.for()` 全局中断标记（跨模块边界可靠识别）
- `auto_review` 模式残留 gate 自动关闭

**安全与守卫**：
- Code Development 模式 orchestrator 工具边界守卫
- Completion guards（plan list, legacy progress, pending work, final output）
- 工具预算控制与强制终结（runToolBudget + TOOL_TYPE_HARD_LIMIT + scope isolation）
- 重复工具调用检测（stableKey + decideRepeatedToolAttempt，阈值统一）

**缓存与性能**：
- 工具结果缓存与缓存失效（read-only cache key + write-tool content hash）
- 上下文截断（head/tail 保留，plan/clarify 永不被截断）

**文件操作**：
- `file.patch` 多 edit 支持（edits[] + 唯一匹配 + 原始文件基准 + unified diff）
- `file.apply_patch` unified diff 应用（多文件、context 校验、workspace path guard）
- 同文件变更队列（`withWorkspaceFileMutationQueue`，串行化同文件写入）
- `file.grep`/`file.glob` scoped path 语义

**工作区与执行**：
- `WorkspaceOperations` 可插拔抽象（6 个操作接口 + localWorkspaceOperations 默认实现）
- Shell 环境快照（登录 shell 捕获、30min 缓存、敏感变量过滤、回退 process.env）
- Shell login/shell 参数（POSIX login shell、PowerShell、cmd 分支）
- Shell 输出截断（stdout/stderr 独立 1MB 硬截断、UTF-8 安全裁切）
- `AbortSignal` 贯通（shell/web/MCP/document，shell abort 时 kill process tree）

**扩展与呈现**：
- visibility resolver（family-aware 工具面求值、preset 收敛、taskIntent 收缩、hard boundary 记录）
- `repo.explore` 正式 runtime tool（结构化只读探索、preview、telemetry、升级建议）
- `agent.spawn` / `agent.wait` 协作工具（职责型 tool bundle、显式 fan-out / fan-in、子结果有效性校验）
- widget runtime tools（`widgets.getSelectedContext`、`widgets.get`、`widgets.todo.addItem`）
- `skills.patch` 工具（分层模糊匹配、动态 approval、并行批量审批）
- Image 内容块支持（粘贴截图 → base64 data URL → provider 图像内容块）
- Middleware 管道（context compaction, tool recovery, clarification batching, dangling repair）
- 工具结果结构化预览（`resultPreview`，7 个工具族已覆盖）
- 桌面端 `ToolRendererRegistry`（5 个渲染器已注册）
- 审批文案中英文自动切换
- `RuntimeToolDefinitionV2` 内部形状（resultPreview、prepareArguments、continuationHandler）

### 17.3 `agent.spawn` / `agent.wait` / `message.send` / widget tools 的运行时语义

这些工具都属于 agent coordination / turn-local execution 语义，但它们的回传方式和权威目标解析并不相同：

- `agent.spawn`
  - `prompt` 是子任务主体，必须自包含；它不是“自动共享父对话”的开关。
  - `agent_type` 提供时会复用现有 agent profile；未提供时，runtime 会基于 root profile 注册一个 synthetic subagent。
  - `system_prompt` 会覆盖默认 profile system prompt。
  - `tool_bundle` 是首选的职责分配方式，当前维护的 bundle 包括 `research_readonly`、`repo_forensics`、`review_readonly`、`builder_write`。
  - `tool_ids` 仍可用，但更适合高级覆盖；runtime 会先把 bundle 解析成维护好的工具集合，再与当前 run allowed tools 求交。
  - `tool_bundle` 在真正启动 child 前会经过 `spawnPreflight`。这一步不是执行期失败后的补救，而是 launch-time 工具面预检：
    - `status = ready`：请求 preset 可直接满足
    - `status = degraded`：仍可启动，但会记录 `appliedDegradations`、`missingCapabilities`，并把较弱的 `resolvedPreset` / `resolvedToolIds` 明确投影出来
    - `status = blocked`：不能安全启动，直接返回结构化 blocked 结果
  - `spawnPreflight` 还会写出 `requestedPreset`、`resolvedPreset`、`missingToolIds`、`recommendedAlternativePreset`，并进入 `ChildSessionSummary.spawnPreflight`
  - `spawn_contract` 是新的结构化 delegation contract，可显式声明 `required_affordances`、`subject`、`resource_bindings`、`side_effect_policy`、`result_rules`、`validation_policy`。如果调用方未显式提供，runtime 也会对 URL / shell-script 类 prompt 做有限推断。
  - `subject` 现在支持显式 `normalization`。当前模式集是 `auto`、`none`、`url_canonical`、`path_canonical`、`casefold`；runtime 会把归一化结果写回 `normalizedValue`，避免 prompt wording 和证据形态的表层差异被误判成 drift。
  - `resource_bindings` 现在是 value/handle 双形态：
    - `locator=value` 绑定 URL、file、document、artifact 等值型资源，并支持 normalization。
    - `locator=handle` 绑定 runtime-native handle，例如 `artifact`、`browser_session`、`browser_snapshot`、`child_session`、`run`。
  - `agent.spawn` 只适用于 `dynamic_spawn` authority：它永远不能绕过 invoking agent 当前工具边界去拿到更强 preset。
  - mode topology 自己派发的 child 不走这条 authority 规则；那是独立的 `mode_stage` contract。
  - `mode_stage` 与 `dynamic_spawn` 现在也不共享同一套 preflight：
    - `dynamic_spawn` 读取调用方请求的 `tool_bundle` / `spawn_contract`
    - `mode_stage` 读取 `ModeNodeSpec.config.requiredCapabilityGroups`
    - stage contract 不满足时，runtime 会在 launch-time 直接 block，并发出 `mode_stage_preflight.completed`
  - blocked 的 `mode_stage` 不会把 stage prompt 发给模型。相关结构事实会写入 child session 的 `modeStagePreflight` / `modeStageDiagnostic`，供 Trails 和协作区消费。
  - `result_contract` 用来声明子 agent 产出期望，比如 `final_answer`、`evidence_report`、`diff_report`、`plan_only`。runtime 现在会同时结合 `spawn_contract` 做结果有效性校验。
  - `task_intent`（新增，可选）显式覆盖 child agent 的 task intent。允许值为 `chat` | `plan` | `implement`。仅影响 spawned child，不改变 parent run 的 `metadata.taskIntent`。
    - 显式 override 与 contract/tool surface 冲突时，launch-time 直接 block（`diagnostic_type = spawn_task_intent_contract_mismatch`），不启动 child。
    - 未显式提供时，runtime 只根据 `resultContract`、`spawnContract.sideEffectPolicy`、resolved tool surface 是否包含变更能力，来决定 child 的默认 task intent，**不依赖 prompt 文案或任务措辞**。
    - **默认 child intent 矩阵**：

      | `resultContract` | sideEffectPolicy / tool surface | 默认 `childTaskIntent` |
      |---|---|---|
      | `plan_only` | 任意 | `plan` |
      | `diff_report` | 任意 | `implement` |
      | `final_answer` / `evidence_report` | `sideEffectPolicy = none` 或 `draft_artifact` | `chat` |
      | `final_answer` / `evidence_report` | `sideEffectPolicy = workspace_mutation` 或 `external_mutation` | `implement` |
      | `final_answer` / `evidence_report` | sideEffectPolicy 未声明，resolved tools 含 `file.write`/`file.patch`/`file.apply_patch`/`shell.execute` | `implement` |
      | `final_answer` / `evidence_report` | sideEffectPolicy 未声明，resolved tools 只读 | `chat` |

    - **显式 override 判定矩阵**：

      | 显式 `task_intent` | 约束条件 | 结果 |
      |---|---|---|
      | `plan` | `result_contract === "plan_only"` | 允许 |
      | `plan` | `result_contract !== "plan_only"` | block |
      | `implement` | mutation-capable contract 或 tool surface | 允许 |
      | `implement` | 只读 contract / 只读 tool surface | block |
      | `chat` | 任意非变更型 child | 允许 |

- `message.send`
  - 不会立刻驱动目标 agent 执行。
  - 它会同时做两件事：发出 `agent.message` 事件供 UI / snapshot 可见，以及把消息写入目标 agent 的消息队列，供后续 prompt 注入。
- `agent.wait`
  - 是父 agent 的显式 fan-in 原语。
  - 支持等待全部 active background children，或等待指定 child ids。
  - 返回结构化结果 envelope，包括 `child_session_id`、`tool_bundle`、`result_contract`、`status`、`result_text`、`used_tool_count`、`artifact_ids`、`duration_ms`。
- widget runtime tools
  - `widgets.getSelectedContext` 读取当前回合的 `selectedWidgetContext`。
  - `widgets.get` 读取指定 widget。
  - `widgets.todo.addItem` 是当前已落地的最小真实写操作：在选中 Todo widget 或显式给定 `widgetId` 时，真实写入 `WidgetStore`。

`agent.spawn` 的返回语义也要和 UI 文案区分开：

- 默认同步模式：subagent 输出文本会直接作为本次 `agent.spawn` tool result 返回给父 agent。
- `run_in_background: true`：当前 tool result 只会返回 `async_launched`；真正的 subagent 结果会先进入 background result 队列，并在 child session 上投影为 `awaiting_pickup`。
- 父 agent 可以后续显式调用 `agent.wait` 做 fan-in；被消费后的 child delivery status 会变成 `consumed`。
- 如果 `tool_bundle` 请求超出 invoking agent 当前 authority，tool result 会直接返回结构化 blocked envelope，当前至少包含：
  - `authority_source=dynamic_spawn`
  - `diagnostic_type=spawn_authority_mismatch`
  - `requested_tool_preset` / `resolved_tool_preset`
  - `recommended_alternative_preset`（若存在）
- `spawnPreflight.status = degraded` 时，tool call 仍可继续，但 child session / Trails 会保留“请求 preset 与实际 resolved preset 不完全一致”的结构事实，避免 UI 把降级后的 child 误渲染成按原 bundle 完整运行
- 如果 `spawn_contract` 与实际 resolved tool surface 不兼容，tool result 也会直接返回结构化 blocked envelope，当前包括：
  - `diagnostic_type=spawn_affordance_mismatch | spawn_side_effect_violation | spawn_resource_binding_missing | spawn_subject_unbound`
  - `spawn_contract`
  - `contract_violations`
- 上述 blocked envelope 仍属于 launch-time structural enforcement，不受 `validation_policy` 影响。

子结果不是“只要 loop 结束就算成功”。当前 runtime 还会做一层有效性收口：

- 输出仍是 `<tool_calls>` / `<tool_call>` 等内部工具协议文本时，不记为有效成功结果
- `result_contract !== "plan_only"` 时，纯 `<proposed_plan>` 属于 **structural contract failure**，不参与 recovery retry（不同于 provider transient error）
- 要求 repo / shell / forensics 取证的 bundle，如果 child 没有任何真实工具证据，也不能靠空口回答通过
- 当 `spawn_contract.result_rules` 要求 `subject_match_required` / `resource_binding_match_required` / `source_reference_required` 时，runtime 会基于 child 实际工具证据检查是否发生 subject drift 或资源污染；这层结果级校验会生成结构化 `spawnValidation`
- `spawnValidation` 现在显式包含：
  - `policy=enforce | diagnostics_only`
  - `effect=none | warning | blocked`
  - `observedUrls` / `observedPaths` / `observedHandles`
- 默认策略：
  - 显式 `spawn_contract` 默认 `validation_policy = enforce`
  - runtime 推断出的 `spawn_contract` 默认 `validation_policy = diagnostics_only`
- 结果行为：
  - `effect = blocked` 时，`agent.spawn` 失败，污染结果不会交回父 agent
  - `effect = warning` 时，tool result 仍返回，但会带 warning banner，并把完整 `spawnValidation` 投影到 child session / Trails

**Child result recovery 分类矩阵**：

| child 结果 | `resultContract` | 分类 | recovery |
|---|---|---|---|
| 纯 `<proposed_plan>` | `plan_only` | success | 无 |
| 纯 `<proposed_plan>` | 非 `plan_only` | structural contract failure (`SpawnContractViolationError`) | 不重试 |
| 仅内部工具协议文本 | 任意 | structural result failure | 不重试 |
| spawn contract `effect=blocked` | 任意 | structural contract failure | 不重试 |
| 工具/环境瞬时错误 | 任意 | operational/provider failure | 维持现有 recovery 规则 |

当前实现边界：

- `inherit_context` 的实现弱于字面文案：当前只会把父 agent 最近一次任务 prompt 注入 `<inherited-context>`，不会自动继承完整 conversation，也不会把 `lastCallAgentSystem` 一起继承。
- runtime 内部确实保留 `MAX_SPAWN_DEPTH` 计数，但 nested subagent 当前还受 `isNestedAgentSpawn` 工具边界约束，默认拿不到 `agent.spawn` 工具，因此不能把“可继续 spawn 到 3 层”当成当前已开放能力。
- background child 结果当前以内存队列 + snapshot 投影为主，`awaiting_pickup` / `consumed` 提供的是当前 run 期语义，不是跨重启持久消息总线。
- `code_development.debug` 现已固定到 `repo_forensics`，因为它需要运行诊断性命令和日志检查；但该 preset 仍显式阻断 `file.write` / `file.patch` / `file.apply_patch`，所以 debug 不能直接越权修改代码。
- `code_development` 的 root `coding_root` preset 现已默认隐藏 `agent.spawn`。结构化协作应通过 mode-owned `build/review/debug` stage 完成，而不是让 orchestrator 保留一个默认可见的只读动态委派出口。
- widget 对话写操作当前只开放 Todo 的 `addItem`；其他 widget kind 还没有对称的写工具。
- 需要完整时序、child session 与 UI 投影细节时，参见 [ora-runtime-loop.md](/Users/quintenchen/developer/ora/docs/ora-runtime-loop.md) 中的“动态 subagent 调用链路”。

### 17.4 当前实现的保守边界

1. **预留工具仍可能没有 schema**：implemented tools 的 JSON Schema 已补齐；`file.delete`、`model.handoff`、`message.publish`、`shared_state.write`、`export.report` 等未实现预留工具仍为 `{}`
2. **`file.apply_patch` 不等于完整 git patch**：支持 unified diff 修改与新文件创建，显式拒绝 rename/delete patch；多文件 patch 要求同目标文件只有一个 patch block
3. **RiskLevel 二值化**：当前 ActionRiskLevel 实际只有 low/high 两值在使用，medium 未启用
4. **Approval copy 从参数注入**：模型需要在 `args.approvalRequest` 中提供审批文案，若模型不提供则回退到通用模板
5. **取消语义不是所有工具等价**：shell/web/MCP/document 已消费 AbortSignal；registry、skills、package、automation 这类同步或内部操作仍需按工具族判断是否有可中断边界
6. **Shell 环境依赖快照可用性**：shell snapshot 默认 30 分钟缓存 + 登录 shell 捕获；如果捕获失败回退 `process.env`，可能缺少 nvm/fnm/volta 等版本管理器的 PATH 注入
7. **WorkspaceOperations 尚未全面替换旧实现**：executor context 已携带 adapter，部分 file tool 仍直接使用本地 fs/path helper
8. **Renderer registry 只是描述层**：desktop 已有 tool renderer registry 和 approval preview shape，但具体 Trails/ApprovalCard 的富 UI 渲染仍需接线
9. **Recovery policy 仅基于 mode 的 runtime atom**：`recovery_policy` 和 `tool_error_boundary` 是两个独立的 atom
10. **`agent.spawn` 的递归边界**：runtime 内部保留最大深度 3 层计数，但 nested subagent 当前还会被 `isNestedAgentSpawn` 工具边界阻止再次调用 `agent.spawn`
11. **后台 child 队列无跨重启保证**：`awaiting_pickup` / `consumed` 当前服务于单次 run 内 fan-in；进程重启不会把内存态 async queue 恢复成完整消息总线
12. **widget tool 能力面仍很窄**：当前只有 `widgets.todo.addItem` 是真实写工具；不能把“selected widget 已进入 prompt”误解成“所有 widget 都可执行修改”
13. **搜索路径作用域语义**：`file.grep`/`file.glob` 的 bare glob/include 已做 scoped 匹配，但 `workspace-operations.ts` 尚未同步同语义

## 18. 未来迭代方向

### 18.1 工具定义内聚

- **扩大 resultPreview 覆盖**：当前 file/shell 已覆盖，skills、package、modes、automations、agent.spawn 等尚未提供 `resultPreview`
- **完善 prepareArguments 消费**：处理模型偶发 JSON string 参数等边界情况
- **补齐未实现预留工具 schema**：当 `file.delete`、model/message/shared_state/export 工具实现时同步补 schema 和 policy 测试

### 18.2 执行可靠性

- **可中断边界审查**：长时间运行的 skills、package、automation 操作需要确认是否需要在关键步骤检查 AbortSignal
- **WorkspaceOperations 迁移**：将 file/shell 工具的内部实现逐步从直接 fs/path 操作迁移到通过 WorkspaceOperations 接口
- **Remote adapter 测试**：为 SSH/container/cloud sandbox workspace adapter 增加 fake adapter 和集成测试
- **扩展 `file.apply_patch`**：支持 rename/delete patch 和同文件多 patch block 兼容性

### 18.3 可观察性与交互体验

- **TrailsTabs 消费 toolRendererRegistry**：将 `resultPreview` 和 `ToolRendererRegistry` 串联到审批卡片和 Trails 中，实现富内容渲染
- **统一 preview metadata 管道**：tool result ledger、artifact preview、desktop renderer 共用同一套结构化 preview metadata
- **Recovery policy Mode Studio 可视化**：在 Mode Studio 中可视化编辑恢复规则

### 18.4 架构演进

- **多 agent 并行工具执行**：当前同文件 mutation queue 已为并行做好准备，需要在调度层支持真正的并行 tool execution
- **工具执行超时策略**：为不同工具族定义差异化的默认超时和重试策略
- **Remote workspace 支持**：基于 WorkspaceOperations 抽象实现 SSH workspace adapter
