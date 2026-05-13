# Ora Tool / Action / Approval 治理链

本文解释 Ora 的工具系统如何从一次模型 tool call 走完 proposal、risk、approval、execution、recovery、ledger、snapshot 和 desktop projection 的完整治理链。它不是简单 tool calling 说明书，而是解释 **Ora 如何在 agent runtime 层面把工具调用变成可恢复、可审计、可治理的执行事实**。

## 阅读地图

### 核心类型

| 类型 | 文件 | 角色 |
| --- | --- | --- |
| `ToolDescriptor` | `packages/shared/src/capabilities.ts` | 共享层工具描述：id、category、riskLevel、parameters schema、prompt snippet |
| `RuntimeToolDefinition` / `RuntimeToolDefinitionV2` | `apps/runtime/src/harness/capability-registries.ts` / `runtime-tool-definition-v2.ts` | 运行层工具定义：executor、动态 riskLevel、approvalRequest 模板、promptExample、resultPreview、argument preparation、continuation handler |
| `ActionRecord` | `packages/shared/src/actions.ts` | 一次工具调用的耐久 action 记录：状态机从 proposed 到 succeeded/failed |
| `OraToolCallEnvelope` | `packages/shared/src/actions.ts` | 单次 tool call 的完整包裹：source、status、result、error、repairReason |
| `PolicyDecision` | `packages/shared/src/actions.ts` | 策略引擎关于是否需要审批的决定 |
| `RecoveryIncident` / `RecoveryDecision` | `apps/runtime/src/harness/recovery-policy.ts` | 恢复分类和决策：retry、alternate_tool、fallback_artifact、fail |
| `ActionApprovalRequestCopy` | `packages/shared/src/actions.ts` | 审批请求的面向用户文案：title、summary、whatWillChange、whyNeeded、riskNote |
| `PermissionProfile` | `packages/shared/src/capabilities.ts` | 按 category × riskLevel 的三态权限矩阵：allow / deny / ask |
| `ActionRiskLevel` | `packages/shared/src/actions.ts` | 运行时三级风险：low / medium / high |
| `OraToolCallSource` | `packages/shared/src/actions.ts` | 工具调用的四种来源：provider_native、json_fallback、manual_repair、replay |
| `WorkspaceOperations` | `apps/runtime/src/harness/workspace-operations.ts` | 工作区文件/搜索/shell 操作后端抽象，默认本地实现 |
| `ApprovedToolContinuationHandler` | `apps/runtime/src/harness/approved-tool-continuation-handler.ts` | approved tool continuation 的 per-tool replay / artifact / continue 策略 |

### 核心服务

| 服务 | 文件 | 职责 |
| --- | --- | --- |
| `RuntimeToolExecutor` | `apps/runtime/src/harness/runtime-tool-executor.ts` | 工具注册、执行、risk 评估、approval copy 生成、pre/post policy hook 调度 |
| `RuntimeToolCallService` | `apps/runtime/src/harness/runtime-tool-call-service.ts` | 单次 tool turn 的编排：propose → approve → execute → record → follow-up model call |
| `RuntimeToolRecoveryService` | `apps/runtime/src/harness/runtime-tool-recovery-service.ts` | 工具执行失败后的恢复：分类 → 决策 → 重试/降级/fallback |
| `RecoveryCoordinator` | `apps/runtime/src/harness/recovery-policy.ts` | 基于 ModeSpec 的恢复策略匹配引擎 |
| `RuntimeToolCallLedger` | `apps/runtime/src/harness/runtime-tool-ledger.ts` | 单次 run 内的 tool call 内存账本 |

### 辅助模块

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| Action Proposal | `apps/runtime/src/harness/runtime-tool-action-proposal.ts` | 从 tool call 创建 ActionRecord 和 tool call envelope |
| Action Runner | `apps/runtime/src/harness/runtime-action-runner.ts` | action 状态转换、审批决议、成功/失败记录 |
| Approval | `apps/runtime/src/harness/runtime-tool-approval.ts` | approval copy 生成、中文/英文自动选择 |
| Interrupts | `apps/runtime/src/harness/runtime-interrupts.ts` | ApprovalInterruptError、ClarificationInterruptError、resume 审批匹配 |
| Boundary | `apps/runtime/src/harness/runtime-tool-boundary.ts` | Code Development mode 下 orchestrator 的工具边界守卫 |
| Recovery Policy | `apps/runtime/src/harness/recovery-policy.ts` | 错误分类引擎、恢复规则匹配、重试退避计算 |

## 治理链全景

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
  │  │ (capabilities.ts)│    │ (tool-ledger.ts) │    │ (tool.called,    │                     │
  │  │                  │    │                  │    │  action.updated) │                     │
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
  │                    │ (耐久事实沉淀)         │                                                │
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
  │  │ (ApprovalRequest │    │ (tool call       │    │ (attention       │                     │
  │  │  Card.tsx)       │    │  timeline,       │    │  derivation)     │                     │
  │  │                  │    │  evidence)        │    │                  │                     │
  │  └──────────────────┘    └──────────────────┘    └──────────────────┘                     │
  └──────────────────────────────────────────────────────────────────────────────────────────┘
```

## 1. Tool Descriptor 与 Tool Executor 的边界

Ora 的工具定义分两层：**共享描述符**和**运行时执行体**。

### 1.1 ToolDescriptor（共享合约）

定义在 `packages/shared/src/capabilities.ts`，是工具在共享层的**静态描述**：

```ts
interface ToolDescriptor {
  id: string;              // 如 "file.read"、"shell.execute"
  label: string;           // 面向用户标签
  description: string;     // 模型提示描述
  category: ToolCategory;  // file | shell | network | mcp | model | export | internal | package
  riskLevel: ToolRiskLevel;// safe | low_risk | requires_approval（静态分类）
  parameters: Record<string, unknown>; // JSON Schema 参数定义
  promptSnippet?: string;
  promptGuidelines?: string[];
  requiresApproval: boolean;  // 标记是否需要审批（用于 approval copy 注入）
  implemented: boolean;       // 运行时是否已实现
  allowedForProfiles: string[];
}
```

`category` 和 `riskLevel` 共同构成 **PermissionProfile** 三态矩阵的匹配键。

### 1.2 RuntimeToolDefinition（运行时扩展）

定义在 `apps/runtime/src/harness/capability-registries.ts`，在 descriptor 之上叠加**运行时行为**：

```ts
interface RuntimeToolDefinition<TContext> {
  descriptor: ToolDescriptor;
  execute?: (args, context) => Promise<unknown>;  // 真正干活
  riskLevel?: (args, context) => ToolRiskLevel;   // 动态风险覆盖
  actionRiskLevel?: (args, context) => ActionRiskLevel; // 三级风险 (low/medium/high)
  approvalRequest?: (args, context) => ActionApprovalRequestCopy; // 审批文案
  resultPreview?: (result, args) => RuntimeToolResultPreview; // 结构化结果预览
  prepareArguments?: (input, context) => args; // 参数预处理
  continuationHandler?: RuntimeToolContinuationHandler; // approved continuation 策略
  promptSnippet?: string;
  promptGuidelines?: string[];
  promptExample?: string;
  requiresApprovalCopy?: boolean;  // 是否需要在参数 schema 中注入 approvalRequest 字段
}
```

工具的实现体仍按工具族分布在 `runtime-file-tools.ts`、`runtime-shell-tool.ts`、`runtime-mcp-tools.ts` 等文件中，通过 `builtInToolRuntimeFields(toolId)` 按 toolId 聚合到 `buildRuntimeToolDefinitions()`。`RuntimeToolDefinitionV2` 当前是 runtime 内部的演进别名/上转层：先把 preview、argument preparation、continuation hook 纳入同一个 definition 形状，但不破坏 shared `ToolDescriptor` public contract。

### 1.3 RuntimeToolExecutor（执行中枢）

`RuntimeToolExecutor` 是工具系统的**核心调度者**，它承担：

| 方法 | 职责 |
| --- | --- |
| `enabledToolIds()` | 过滤当前模式可用的工具（检查是否已实现、是否匹配 taskIntent） |
| `toolDefinitions()` | 生成 provider native tool definition（含 approvalRequest 参数注入） |
| `systemPrompt()` | 生成 JSON fallback 时的 system prompt（含所有工具列表和使用指南） |
| `extractToolCall()` | 从模型文本中提取 fallback JSON tool call（支持多种格式） |
| `riskLevel()` | 计算运行时风险等级（调用动态 riskLevel 函数或回退到 descriptor） |
| `approvalRequest()` | 生成审批文案（优先使用模型提供的，否则用工具定义中的模板） |
| `executeWithMetadata()` | 完整执行链：pre-tool policy → execute → post-tool policy |

### 容易误解的点

- `ToolDescriptor.riskLevel` 是**静态分类**（safe/low_risk/requires_approval），用于 PermissionProfile 矩阵匹配；`RuntimeToolDefinition.riskLevel()` 是**动态评估**，可以基于实际参数调整风险。
- `ActionRiskLevel`（low/medium/high）是行动级的三级风险，目前在代码中 level 为 `high` 才会触发 approval gate——这是与 `ToolRiskLevel` 的不同粒度概念。
- ToolDescriptor 和 RuntimeToolDefinition 仍是两层合约：shared descriptor 保持稳定，runtime definition 已吸收 V2 字段。后续内聚重点是让更多工具真正消费 `resultPreview` / `prepareArguments` / continuation hooks，而不是把 UI renderer 放进 shared。

## 2. Tool Call 到 Action Proposal

### 2.1 调用来源

Ora 接收四种来源的工具调用：

| 来源 | 场景 | 特征 |
| --- | --- | --- |
| `provider_native` | 模型原生 tool_use（如 Claude、GPT 的 function calling） | 有 `providerCallId`，可直接注入 tool role message |
| `json_fallback` | 模型输出 JSON 代码块或 `<tool_call>` 标签 | 无 providerCallId，结果以 user role message 注入 |
| `manual_repair` | 前一次调用参数错误，手工修正后重试 | JSON fallback 的子类 |
| `replay` | run replay 场景 | 不涉及新的模型调用 |

### 2.2 Proposal 生成

`proposeRuntimeToolAction()`（在 `runtime-tool-action-proposal.ts`）承担三个同步任务：

1. **风险评估**：调用 `runtimeToolExecutor.riskLevel()` 计算 `ActionRiskLevel`
2. **Action 创建**：通过 `actionLedger.propose()` 创建 `ActionRecord`（status: `proposed`），如果 riskLevel === "high" 则附带 `approvalRequest`
3. **Tool Call 记录**：通过 `appendToolCall()` 创建 `OraToolCallEnvelope`（status: `proposed`），建立 actionId ↔ toolCallId 的双向关联

```ts
// 核心流程（简化）
const riskLevel = executor.riskLevel(toolCall);
const action = actionLedger.propose({
  id: `${agentId}-tool-${eventCount}`,
  type: toolCall.tool,
  riskLevel,
  input: toolCall.args,
  approvalRequest: riskLevel === "high" ? executor.approvalRequest(toolCall, prompt) : undefined,
  agentId,
});
const toolCallRecord = appendToolCall({
  toolId: toolCall.tool,
  args: toolCall.args,
  source: toolCall.source,
  status: "proposed",
  actionId: action.id,
});
```

### 容易误解的点

- Approval copy 生成有两种路径：模型可以在 `args.approvalRequest` 中**主动提供**（优先使用），否则由 `executor.approvalRequest()` 使用工具定义中的模板生成。这使模型可以给出更语境化的审批理由。
- Action 和 Tool Call 是**两个不同的实体**：Action 是语义层面的行动（可以被审批、恢复、重试），Tool Call 是技术层面的调用包裹（记录来源、状态、结果）。

## 3. Risk Level、Approval Mode、Policy Hook

### 3.1 三层风险体系

```
ToolDescriptor.riskLevel (静态)
  └─▶ RuntimeToolDefinition.riskLevel(args, context) (动态覆盖)
        └─▶ RuntimeToolExecutor.riskLevel() → ActionRiskLevel (运行时最终评估)
```

- 静态 `riskLevel` 定义在 `MVP_TOOLS` 中：读文件 → safe，写文件/patch/shell → requires_approval
- 动态 `riskLevel()` 在 shell tool 中实现：`shellCommandRequiresHighRisk()` 检查命令是否匹配破坏性模式（如 `rm -rf`、`git push --force`）
- 最终转换为 `ActionRiskLevel`：`descriptor.riskLevel === "requires_approval"` → `high`，否则 → `low`

### 3.2 Pre-Tool Policy Hooks

`RuntimeToolExecutor` 内置两个 pre-tool policy hook，按顺序执行：

```
shellDestructiveCommandPolicyHook
  └─▶ 仅对 shell.execute 生效
      └─▶ 命令匹配破坏性模式 → 强制 riskLevel = "requires_approval"

permissionProfilePolicyHook
  └─▶ 基于 PermissionProfile 的三态矩阵
      └─▶ resolveToolPermission(profile, category, riskLevel) → allow | deny | ask
```

Hook 可以修改：`args`（参数重写）、`riskLevel`（风险调整）、`permission`（allow/deny/ask）。

### 3.3 Approval Mode 决策树

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

### 3.4 Permission Profile 三态矩阵

三个内置 profile 定义在 `packages/shared/src/capabilities.ts`：

| Profile | safe | low_risk | requires_approval |
| --- | --- | --- | --- |
| `runtime.full_trust` | allow | allow | allow |
| `runtime.default_policy` | allow | allow | ask |
| `runtime.readonly` | allow (file) / deny (other) | deny | deny |

`permissionProfilePolicyHook` 使用 `resolveToolPermission(profile, category, riskLevel)` 匹配。

### 容易误解的点

- `approvalMode: "high_risk_only"` 中的 "high_risk" 指的是 `PolicyDecision.requiredApproval === true`，而**不是** `ActionRiskLevel === "high"`。当前实现中 `requiredApproval` 只对 `riskLevel === "high"` 返回 true，但这是 policy service 内部的实现细节，不应被外部代码假设。
- Permission Profile 的 `allow` / `deny` / `ask` 是**独立于 approvalMode 的第二层防线**：即使 approvalMode 是 auto，如果 permissionProfile 返回 deny，工具仍然会失败。

## 4. Approval Required → Gate 进入

当 `resolveRuntimeActionApproval()` 判断需要用户审批且无法通过 resume 匹配时：

### 4.1 Interrupt 抛出

```ts
throw new ApprovalInterruptError(action.id);
```

### 4.2 Tool Call Service 拦截

`RuntimeToolCallService.runToolTurn()` 在 catch 中处理：

```ts
.catch((error) => {
  if (error instanceof ApprovalInterruptError) {
    nodeLoopController.emitGateRequired({
      agentId, title, actionId, toolId, detail, iteration,
    });
  }
  throw error; // 继续向上传播
});
```

### 4.3 Node Loop 层中断

`ApprovalInterruptError` 继续向上传播到 node loop 层：

1. Action status 被 action runner 置为 `approval_required`
2. Tool call status 同步置为 `approval_required`
3. `approval.required` 事件发射
4. Gate 打开 (FlowGate.kind = "approval")
5. Node loop 进入暂停状态
6. Snapshot 的 `continuation.frames` 记录暂停点和 `pendingActionIds`
7. Desktop 通过 `deriveRunInteraction()` 检测到 `RunAttentionKind = "needs_approval"`

### 4.4 Resume 时的审批匹配

当用户审批后 resume，`createResumeApprovalMatcher()` 构造匹配器：

- 精确匹配：`approvedActionIds.delete(action.id)`
- 模糊匹配：`stableApprovalActionKey(action)` — 基于 type + riskLevel + input 的稳定 JSON key
- Scope 匹配：单次审批覆盖同路径的后续 `file.write`、同类型的 `skills.create`

### 容易误解的点

- 审批 gate **不是**在 `RuntimeToolExecutor.execute()` 中抛出的。`executeWithMetadata()` 中的 pre-tool policy 只做 `permission === "ask" && allowRisky !== true` 的检查——这是**第二层防线**，用于确保即使 action runner 层错误通过了审批，executor 也会再次拦截。
- `allowRisky` flag 是确定执行的关键：只有 `resolveRuntimeActionApproval()` 返回 `approvedForRiskyExecution: true` 后，这个 flag 才会被传给 executor。

## 5. Tool Result → Snapshot 与 Ledger

### 5.1 成功路径

`recordRuntimeToolActionSucceeded()` 执行三个写入：

1. **Action Ledger**：`actionLedger.transition(actionId, "succeeded", { output, artifactIds })`
2. **Tool Call Ledger**：`appendToolCall({...toolCallRecord, status: "succeeded", result: {...}})`
3. **Runtime Event**：`tool.called` 事件（含 toolId、input、output、fileChange 等） + `action.updated` 事件

事件随后进入 `StateSnapshot`：
```ts
StateSnapshot {
  actions: ActionRecord[]      // ← action ledger 投影
  toolCalls: OraToolCallEnvelope[]  // ← tool call ledger 投影
  events: OraEventEnvelope[]   // ← 事件流
  pendingApprovals: string[]   // ← 待审批 action id 列表
}
```

### 5.2 结果注入消息历史

```ts
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

### 5.3 进入 Ledger 投影

Snapshot 中的 `actions` 和 `toolCalls` 随后通过 `RuntimeSessionLedger` 沉淀为耐久事实，再通过 `deriveSessionProjection()` / `deriveRunProjection()` 生成 desktop 可消费的 read model。

### 容易误解的点

- Snapshot 是**内存 live 视图**，Ledger 是**耐久事实**。恢复时应该信 Ledger projection，而不是直接信快照。`continuation.frame` 中的 `pendingActionIds` 和 `approvedActionIds` 是 resume 的关键锚点。
- Tool result 有两条可见路径：运行中通过 `OraToolCallEnvelope.result` / `tool.called` 事件进入 live snapshot；终态和 reload 后以 `RuntimeToolResultLedgerEntry` / `snapshot.toolResults` 为 durable 结果来源。Tools tab 会合并两者，ledger-backed result 不应被 live envelope 覆盖。

## 6. Tool Recovery 与 Provider Recovery

### 6.1 错误分类

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

### 6.2 恢复决策

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

### 6.3 Tool Recovery vs Provider Recovery 的区别

| 维度 | Tool Recovery | Provider Recovery |
| --- | --- | --- |
| 触发层 | `RuntimeToolRecoveryService.recoverToolFailure()` | Node loop 层的 provider 调用异常 |
| 错误表面 | surface = "tool" | surface = "provider" / "transport" / "sidecar" |
| 恢复后行为 | 自动 retry / 切换 alternate tool / fallback artifact | 由 node loop 的 continuation dispatcher 决定 |
| 对 tool call ledger 的影响 | 失败记录 + 可能的 recovery action record | 不影响 tool call ledger（provider 调用未产生 tool call） |

### 6.4 恢复后的消息注入

- **retry**：不修改消息历史，直接重新执行同一个 tool call
- **alternate_tool**：创建新的 recovery action，执行替代工具，结果注入消息
- **fallback_artifact**：注入降级消息标记 `[recovery:fallback]` 或 `[tool-error-boundary]`，用 degraded output 继续

### 容易误解的点

- Tool recovery **只在 `nodeLoopController.state === "tool_running"` 时有效**。如果 tool recovery 被错误路由（state 不是 tool_running），会发出诊断警告并直接 throw。
- `boundary_violation` 错误即使在 recovery policy 中配置了 fallback，也会在 fallback 后 throw——不会继续执行模型调用。

## 7. Code Development Boundary

### 7.1 问题

Ora 的 Code Development mode 中，orchestrator 节点的职责是**规划和最终交付**，代码变更应该由 Builder 节点执行。但模型可能错误地在 orchestrator 中调用文件写入工具。

### 7.2 实现

`codeDevelopmentToolBoundaryError()` 检查两个条件：

```ts
if (modeSpec.id !== CODE_DEVELOPMENT_MODE_ID || agentId !== "orchestrator") {
  return undefined; // 不是 Code Dev 模式的 orchestrator，放行
}
```

阻止的工具列表：
```ts
CODE_DEVELOPMENT_ORCHESTRATOR_BLOCKED_TOOLS = [
  "file.write",
  "file.patch",
  "file.apply_patch",
  "file.delete",
  "modes.applyDraft",
  "selfIteration.apply",
  "skills.create",
  "skills.update",
  "skills.setEnabled",
];
```

以及**高风险 shell 命令**。

### 7.3 与审批的关系

Boundary check 在 `RuntimeToolCallService.runToolTurn()` 中**先于** action proposal 和审批执行。这意味着：

1. Boundary 是第一道防线：orchestrator 根本**不能**发起这些工具调用
2. 审批是第二道防线：Builder 可以发起但需要审批
3. Boundary 错误被归类为 `boundary_violation`，进入 recovery → fallback_artifact → throw

### 容易误解的点

- Boundary 只检查 modeId === `CODE_DEVELOPMENT_MODE_ID`，对其他 mode 没有此限制。这意味着如果在其他 mode 中使用 orchestrator，它可以自由调用文件写入工具。
- Boundary 错误**不会**进入 approval gate，而是直接进入 recovery。模型会收到 fallback 消息并被迫调整路径。

## 8. Ora 与 Pi Tool 设计对比

已有文档 `ora-pi-tool-design-analysis.md` 做了详尽对比。本文仅提取治理链相关结论：

### Ora 已落地的优势

| 能力 | 实现状态 |
| --- | --- |
| Action Ledger（行动耐久记录） | ✅ `RuntimeActionDeps.actionLedger` |
| Policy Decision（策略决策） | ✅ `PolicyService.evaluate()` |
| Approval Mode（审批模式） | ✅ auto / manual / high_risk_only |
| Permission Profile（权限矩阵） | ✅ full_trust / default_policy / readonly |
| Resume 审批匹配 | ✅ `ResumeApprovalMatcher`（精确 + 模糊 + scope 匹配） |
| Gate 系统 | ✅ ApprovalInterrupt → node loop 暂停 → continuation frame |
| Recovery 策略引擎 | ✅ RecoveryCoordinator + 9 条默认规则 |
| Code Development Boundary | ✅ orchestrator mutation 守卫 |
| Tool Call Ledger | ✅ `RuntimeToolCallLedger` |
| Snapshot + Desktop Projection | ✅ StateSnapshot → Trails / ApprovalCard |

### 后续改造方向（按优先级）

| 优先级 | 改进项 | 说明 |
| --- | --- | --- |
| 已完成 | 补齐 implemented tool 参数 schema | file/web/document 以及 skills/mcp/package/modes/selfIteration/automations 已有 JSON Schema；未实现的预留工具仍可保持 `{}` |
| 已完成 | `RuntimeToolDefinitionV2` 内部形状 | runtime definition 已增加 `resultPreview`、`prepareArguments`、`continuationHandler`，V2 作为内部 upcast 层 |
| 已完成 | Per-file mutation queue | `file.write` / `file.patch` / `file.apply_patch` 经 `withWorkspaceFileMutationQueue(path, fn)` 串行化同文件写入 |
| 已完成 | AbortSignal 贯通核心工具 | `RuntimeToolExecutionContext.signal` 传入 shell/web/MCP/document；shell abort 会尝试 kill process tree |
| 已完成 | `file.patch` 多 edit 升级 | `edits[]` 参数、唯一匹配、diff metadata、firstChangedLine、additions/deletions 已落地 |
| 已完成 | `file.apply_patch` unified diff 工具 | 支持多文件 unified diff 应用、新文件创建、context 精确匹配、workspace path guard；暂不支持 rename/delete patch |
| 已完成 | Shell 环境快照机制 | `shell-snapshot.ts` 通过登录 shell 捕获完整环境变量，替代静态白名单；30min 缓存、敏感 key 过滤、失败回退 `process.env` |
| 已完成 | Shell login shell 参数 | `shell.execute` 新增 `login` 和 `shell` 参数；bash/zsh login 路径增加 bootstrap + eval 策略保证 alias/function 可用 |
| 已完成 | Shell 输出截断 | stdout/stderr 独立 1MB 硬截断，各自超限时追加 truncation notice，UTF-8 安全裁切；保留 `fullOutputPath` spill |
| 已完成 | Workspace operations adapter | `WorkspaceOperations` + `localWorkspaceOperations` 已接入 executor context，为 remote/container backend 预留 |
| 已完成 | `agent.spawn` 工具 | agent 可通过 tool call 动态 spawn 子 agent（同步/异步），最大深度 3 层；支持上下文继承、内联 profile、`message.send` 通信 |
| 部分完成 | result preview / renderer | file 和 shell definition 产出结构化 result preview；desktop 有 `toolRendererRegistry` 描述符，但 Trails/approval card 真实 React 渲染仍需继续接线 |

## 9. 状态机速查

### ActionRecord 状态机

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

### OraToolCallEnvelope 状态机

```
proposed ──▶ approval_required ──▶ approved ──▶ running ──▶ succeeded
   │              │                    │            │
   │              └──▶ denied         │            └──▶ failed
   │                                   │            └──▶ interrupted
   │                                   └──▶ denied       └──▶ repaired
   └──▶ interrupted
```

### RecoveryAction 决策路径

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

## 10. 关键文件索引

| 文件 | 内容 |
| --- | --- |
| `packages/shared/src/capabilities.ts` | ToolDescriptor、PermissionProfile、MVP_TOOLS、内置权限矩阵 |
| `packages/shared/src/actions.ts` | ActionRecord、OraToolCallEnvelope、PolicyDecision、RecoveryRule、ActionRiskLevel |
| `packages/shared/src/runtime.ts` | StateSnapshot、RunContinuation、FlowGate、RunAttention、所有事件类型 |
| `apps/runtime/src/harness/runtime-tool-executor.ts` | RuntimeToolExecutor、pre/post policy hooks、riskLevel/approvalRequest 实现 |
| `apps/runtime/src/harness/runtime-tool-call-service.ts` | 单次 tool turn 编排（propose → approve → execute → record → follow-up） |
| `apps/runtime/src/harness/runtime-tool-action-proposal.ts` | proposeRuntimeToolAction、proposeRuntimeRecoveryToolAction |
| `apps/runtime/src/harness/runtime-action-runner.ts` | resolveRuntimeActionApproval、transitionRuntimeAction、recordRuntimeToolActionSucceeded/Failed |
| `apps/runtime/src/harness/runtime-tool-approval.ts` | genericApprovalRequest、中文/英文自动选择 |
| `apps/runtime/src/harness/runtime-tool-recovery-service.ts` | RuntimeToolRecoveryService（retry / alternate / fallback 编排） |
| `apps/runtime/src/harness/recovery-policy.ts` | classifyRecoveryError、RecoveryCoordinator、默认恢复策略 |
| `apps/runtime/src/harness/runtime-tool-ledger.ts` | RuntimeToolCallLedger（单 run 工具调用内存账本） |
| `apps/runtime/src/harness/runtime-tool-boundary.ts` | codeDevelopmentToolBoundaryError（Code Dev orchestrator 守卫） |
| `apps/runtime/src/harness/runtime-interrupts.ts` | ApprovalInterruptError、ClarificationInterruptError、ResumeApprovalMatcher |
| `apps/runtime/src/harness/capability-registries.ts` | RuntimeToolDefinition 类型 |
| `apps/runtime/src/harness/runtime-tool-definition-v2.ts` | RuntimeToolDefinitionV2 内部演进类型和 V1 upcast |
| `apps/runtime/src/harness/workspace-operations.ts` | WorkspaceOperations 本地适配器 |
| `apps/runtime/src/harness/shell-snapshot.ts` | 登录 shell 环境快照捕获、缓存、敏感 key 过滤、回退 |
| `apps/runtime/src/harness/runtime-file-mutation-queue.ts` | 同文件 mutation queue |
| `apps/runtime/src/harness/approved-tool-continuation-handler.ts` | approved tool continuation handler registry |
| `apps/runtime/src/harness/file-continuation-handler.ts` | file.write / file.patch / file.apply_patch continuation + artifact 生成 |
| `apps/runtime/src/harness/generic-continuation-handler.ts` | shell/skills/mcp/package continuation 通用 replay |
| `apps/runtime/src/harness/runtime-file-tools.ts` | 文件工具实现体 |
| `apps/runtime/src/harness/runtime-patch-tool.ts` | unified diff 应用工具（多文件 patch、context 校验、workspace path guard） |
| `apps/runtime/src/harness/runtime-shell-tool.ts` | Shell 工具实现体 + 破坏性命令检测 |
| `apps/runtime/src/harness/runtime-mcp-tools.ts` | MCP 工具实现体 |
| `apps/runtime/src/harness/runtime-skill-tools.ts` | Skill 工具实现体 |
| `apps/runtime/src/harness/runtime-tool-loop.ts` | Tool attempt 选择、重复调用检测、循环边界 |
| `apps/runtime/src/harness/runtime-middleware.ts` | RuntimeToolExecutionRequest / RuntimeToolExecutionResult 类型 |
| `apps/runtime/src/run-projections.ts` | toFlowRunDetail、toSessionTurn、deriveRunAttention |
| `apps/desktop/src/lib/toolRendererRegistry.ts` | Desktop 工具 renderer / approval preview registry |
| `apps/desktop/src/components/ApprovalRequestCard.tsx` | 审批卡片 UI |
| `apps/desktop/src/components/TrailsTabs.tsx` | Trails 工具时间线 UI |
| `docs/ora-pi-tool-design-analysis.md` | Ora 与 Pi tool 设计对比及迭代建议 |

## 11. 保守边界与演进方向

### 当前实现的保守边界

1. **预留工具仍可能没有 schema**：implemented tools 的 JSON Schema 已补齐；`file.delete`、`model.handoff`、`message.publish`、`shared_state.write`、`export.report` 等未实现预留工具仍为 `{}`。
2. **RiskLevel 二值化**：当前 ActionRiskLevel 实际只有 low/high 两值在使用，medium 未启用。
3. **Approval copy 从参数注入**：模型需要在 `args.approvalRequest` 中提供审批文案，这依赖模型理解——若模型不提供，回退到通用模板。
4. **取消语义不是所有工具等价**：shell/web/MCP/document 已消费 AbortSignal；registry、skills、package、automation 这类同步或内部操作仍需按工具族判断是否有可中断边界。
5. **Shell 环境依赖快照可用性**：shell snapshot 默认 30 分钟缓存 + 登录 shell 捕获；如果捕获失败回退 `process.env`，可能缺少 nvm/fnm/volta 等版本管理器的 PATH 注入。
6. **`file.apply_patch` 不支持 rename/delete**：当前仅支持 unified diff 的修改和新文件创建；rename/delete patch 会被显式拒绝。
7. **WorkspaceOperations 尚未全面替换旧实现**：executor context 已携带 adapter，默认本地实现可用；部分 file tool 仍直接使用本地 fs/path helper，后续迁移应按工具族小步推进。
8. **Renderer registry 只是描述层**：desktop 已有 tool renderer registry 和 approval preview shape，但具体 Trails/ApprovalCard 的富 UI 渲染仍需接线。
9. **Recovery policy 仅基于 mode 的 runtime atom**：`recovery_policy` 和 `tool_error_boundary` 是两个独立的 atom，不在 mode 配置中显式可见。
10. **`agent.spawn` 的递归边界**：最大深度 3 层 + `isNestedAgentSpawn` 双重保护；异步 spawn 队列无持久化，进程重启会丢失。

### 建议演进方向

1. **把 renderer registry 接到真实 UI** → Trails / ApprovalCard 使用 file diff、shell output、file read、web fetch 等 tool-specific renderer
2. **扩大 resultPreview 消费面** → action ledger、tool result ledger、artifact preview 使用同一份结构化 preview metadata
3. **继续迁移 WorkspaceOperations** → file/shell 工具逐步通过 adapter 执行，便于 remote/container workspace
4. **补齐未实现预留工具 schema** → 当 `file.delete`、model/message/shared_state/export 工具实现时同步补 schema 和 policy 测试
5. **Recovery policy Mode Studio 可视化** → 在 Mode Studio 中可视化编辑恢复规则
