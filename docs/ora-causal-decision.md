# Ora Causal Decision：因果决策系统

Ora 的因果决策系统包含策略路由器（causal-policy-router）、回溯适配器（causal-decision-adapter）和控制流集成（causalInterventionLevel）三个模块。

> **最近更新 (2026-05-18)**：控制流集成、不确定性模型统一、causalTaskState ledger 投影、gate 触发点覆盖、代码审查修复（工具风险扩充、Router/Adapter 工具定义统一、schema 验证、enforcing 反馈注入、clarificationCount 动态获取）。

## 阅读地图

| 关注点 | 对应章节 |
| --- | --- |
| 系统总览 | [1. 系统架构总览](#1-系统架构总览) |
| 策略路由器如何工作 | [2. 策略路由器：routeIntervention](#2-策略路由器routeintervention) |
| 控制流集成 | [3. 控制流集成：causalInterventionLevel](#3-控制流集成causalinterventionlevel) |
| 适配器如何反推 legacy run | [4. 适配器：adaptCausalDecisionsFromTrace](#4-适配器adaptcausaldecisionsfromtrace) |
| 决策点检测 | [5. 决策点检测：findDecisionPoints](#5-决策点检测finddecisionpoints) |
| 动作推断 | [6. 动作推断：inferAction](#6-动作推断inferaction) |
| 不确定性建模 | [7. 不确定性推断：inferUncertainties](#7-不确定性推断inferuncertainties) |
| CausalDecisionRecord 完整结构 | [8. 构建决策记录](#8-构建决策记录) |
| 工具风险分类 | [9. 工具风险分类](#9-工具风险分类) |
| 事件发射架构 | [10. causal.decision.recorded 发射点](#10-causaldecisionrecorded-发射点) |
| 常见误解 | [11. 常见误解与边界](#11-常见误解与边界) |

核心源码文件：

| 文件 | 职责 |
| --- | --- |
| `apps/runtime/src/harness/causal-policy-router.ts` | 策略路由器核心：`routeIntervention`、不确定性估算函数、`applyCausalPolicyGate` |
| `apps/runtime/src/harness/causal-decision-adapter.ts` | 适配器核心：从 legacy trace 反向推断因果决策记录 |
| `packages/shared/src/interventions.ts` | CausalDecisionRecord、CausalTaskState、InterventionPolicyDecision 等 shared types |
| `packages/shared/src/tool-risk.ts` | 统一工具风险分类 `classifyToolRisk` + 工具类别判断 `isSearchTool` / `isReadContextTool`（router 和 adapter 共用） |
| `apps/runtime/src/harness/node-runtime-loop.ts` | 工具请求和完成阶段的因果决策调用点 + 控制流门控 |
| `apps/runtime/src/harness/runtime-kernel-runner.ts` | run_start 和 clarification_resume 调用点 |
| `apps/runtime/src/harness/runtime-clarifications.ts` | clarification.required 触发时发出 causal.decision.recorded |
| `apps/runtime/src/harness/runtime-action-runner.ts` | approval.required 触发时发出 causal.decision.recorded |
| `apps/runtime/src/harness/runtime-kernel.ts` | plan.updated 触发时发出 causal.decision.recorded |
| `packages/shared/src/runtime-ledger.ts` | causalTaskState 在 StateSnapshot 中的投影 |
| `apps/runtime/src/harness/causal-policy-router.test.ts` | 策略路由器测试 |
| `apps/runtime/src/harness/causal-decision-adapter.test.ts` | 适配器测试 |

---

## 1. 系统架构总览

Ora 的因果决策系统由两条轨道组成：

```
原生轨道 (causal runs)                    回溯轨道 (legacy runs)
     │                                         │
     ▼                                         ▼
 routeIntervention()                   adaptCausalDecisionsFromTrace()
 运行时信号 → 不确定性估算                   trace events → 决策点检测
     │                                         │
     ▼                                         ▼
 causal.decision.recorded 事件           [adapter-inferred] 标记的记录
     │                                         │
     └──────────────┬──────────────────────────┘
                    ▼
              evaluation 框架统一对比
```

**原生轨道**在运行时通过 `routeIntervention()` 产生因果决策记录，可以通过 `causalInterventionLevel` 配置实际干预工具执行（见第 3 章）。

**回溯轨道**从 legacy run 的 trace events 中反向推断近似的 `CausalDecisionRecord`，让旧 run 也能参与 causal A/B 对比评估，所有推断值带有 `[adapter-inferred]` 前缀标记。

---

## 2. 策略路由器：routeIntervention

`routeIntervention(input: PolicyRouterInput): PolicyRouterOutput` 是因果决策的核心引擎。

### 2.1 输入：PolicyRouterInput

```typescript
interface PolicyRouterInput {
  surfaceRequest: string;
  taskState: Partial<CausalTaskState> | undefined;
  proposedToolId?: string;
  proposedToolRisk: "low" | "medium" | "high";
  toolCallCount: number;
  clarificationCount: number;
  hasPendingApprovals: boolean;
  hasPendingPlanDecisions: boolean;
  hasUnresolvedPlanItems: boolean;
  modelResponseText: string;
  decisionContext?: CausalDecisionContext;
}
```

### 2.2 不确定性估算

五个维度各有独立的估算函数：

| 函数 | 估算依据 | 典型值 |
| --- | --- | --- |
| `estimateGoalUncertainty` | clarificationCount、toolCallCount、taskState.confidence | 无信号→0.7，已澄清→0.3 |
| `estimateFactUncertainty` | modelResponseText 中的猜测标记词（"probably"、"might be" 等） | 3+标记→0.7，1个→0.4，无→0.2 |
| `estimateContextUncertainty` | hasUnresolvedPlanItems、proposedToolId（通过 `isReadContextTool` 识别） | read 工具→0.2，有未解决 plan→0.6 |
| `estimateActionRisk` | proposedToolRisk | high→0.8, medium→0.4, low→0.1 |
| `estimateUserCost` | action 类型 + clarificationCount | clarify→0.3+, approval→0.5 |

### 2.3 动作推荐优先级

`recommendAction(input)` 同时计算所有不确定性值并返回 `{ action, goalUncertainty, factUncertainty, contextUncertainty, actionRisk }` 结构体，`routeIntervention` 直接解构复用，避免重复计算。

```
actionRisk >= 0.7                          → request_approval
factUncertainty >= 0.5 && !isSearchTool()  → search_web
hasUnresolvedPlanItems && !proposedToolId  → plan
contextUncertainty >= 0.5 && proposedToolId → read_context
goalUncertainty >= 0.7                     → clarify
proposedToolId present                      → use_tool
toolCallCount >= 3                          → stop
otherwise                                   → answer_directly
```

> `search_web` 推荐使用 `isSearchTool()`（定义在 `tool-risk.ts`，Router 和 Adapter 共用）判断模型是否已经在尝试搜索，而非仅检查 `"web.search"` 字面量。

### 2.4 输出增强

`routeIntervention` 自动填充以下字段：

- **keyUncertainties**：从 policyDecision 的不确定性值计算中文标签（≥0.5 的维度）
- **confidence**：`1 - goalUncertainty`（除非 `taskState.confidence` 已提供）
- **alternativeInterventions**：最多 2 个基于上下文的备选干预方案

---

## 3. 控制流集成：causalInterventionLevel

通过 `RunConfig.causalInterventionLevel` 控制因果决策对运行时行为的干预程度：

| 级别 | 行为 | 适用场景 |
| --- | --- | --- |
| `"record_only"`（默认） | 仅记录 `causal.decision.recorded` 事件，不干预执行 | 生产环境、数据收集 |
| `"advisory"` | 阻塞 `request_approval` 和 `stop` 推荐，其他不阻塞 | 评估、灰度验证 |
| `"enforcing"` | 阻塞所有非 `use_tool`/`answer_directly` 的工具调用 | 严格模式、实验对比 |

### 3.1 门控函数

`applyCausalPolicyGate(result, level): CausalPolicyBlockResult` 判断是否应阻塞当前工具调用。

当工具被阻塞时，在 `enforcing` 模式下会：
1. 发出 `causal.decision.rejected` 事件
2. 将 causal 建议原因注入 conversation messages（例如 "`[Causal Policy] Your attempt to use shell was blocked. Reason: ... Recommended action: Clarify with user.`"），让模型在 forced final 调用中基于完整上下文生成最终回答
3. 触发 forced final provider call（`toolChoice: "none"`，用模型文本响应完成 run）

### 3.2 配置方式

```typescript
// 在 RunConfig 中设置
config: {
  // ...
  causalInterventionLevel: "enforcing"  // 或 "record_only" | "advisory"
}
```

---

## 4. 适配器：adaptCausalDecisionsFromTrace

### 4.1 定位

legacy runs（旧版 agent、无因果模块的 run）没有 `causal.decision.recorded` 事件。适配器从 trace events 中反向推断近似的 `CausalDecisionRecord`，让它们也能参与 causal A/B 对比评估。

```
Legacy Snapshot (StateSnapshot)
  → adaptCausalDecisionsFromTrace()
  → 扫描 events[] 找决策点
  → 推断每点的动作、不确定性
  → 构建 CausalDecisionRecord[]
  → 可与 causal mainline run 在同一 metric 框架下对比
```

所有推断值带有 `[adapter-inferred]` 前缀标记。

### 4.2 不确定性模型

适配器的不确定性推断使用与策略路由器相同的估算函数作为基础值：

1. 从 `DecisionPoint` 和 `StateSnapshot` 构建 `PolicyRouterInput`
2. 调用路由器的 `estimateGoalUncertainty`、`estimateFactUncertainty`、`estimateContextUncertainty`、`estimateActionRisk`
3. 叠加 **action-semantic override**：选择某些动作本身就携带语义信息

| 动作 | Override | 原因 |
| --- | --- | --- |
| `clarify` | goalUncertainty = max(base, 0.7) | 澄清意味着目标不明确 |
| `request_approval` | actionRisk = max(base, 0.8) | 审批意味着风险高 |
| `plan` | goalUncertainty = max(base, 0.5) | 制定计划意味着需要结构化 |
| `search_web` | factUncertainty = max(base, 0.7) | 搜索意味着事实不确定 |
| `read_context` | contextUncertainty = max(base, 0.6) | 读取意味着上下文不足 |

`userCost` 和 `reversibility` 仍由适配器基于动作类型自主决定。

---

## 5. 决策点检测：findDecisionPoints

### 5.1 四类 trace 信号

决策点从 snapshot 的 `events` 和 `toolCalls` 中提取：

| 信号来源 | 检测条件 | 决策点类型 |
| --- | --- | --- |
| `events[type="clarification.required"]` | 首次出现 | clarification |
| `events[type="approval.required"]` | 首次出现 | approval |
| `events[type="plan.updated"]` | payload 中有 pending item | plan_decision |
| `toolCalls[]` | 每种 toolId 首次出现（按 tool 分组） | tool_use |

### 5.2 去重逻辑

- clarification、approval 各只取首次出现（`seen.add("clarify" / "approval")`）
- plan_decision 同上（`seen.add("plan")`）
- 工具调用按 `toolId` 分组（`seen.add("tool:<toolId>")`），同一工具类型的多次调用仅生成一个决策点

### 5.3 DecisionPoint 结构

```typescript
DecisionPoint {
  eventType?: string;          // 触发事件类型
  toolId?: string;             // 工具 ID（tool-based 决策点）
  toolRisk?: "low" | "medium" | "high";
  hasClarification: boolean;
  hasApproval: boolean;
  hasPlanDecision: boolean;
  timestamp: number;
}
```

所有决策点按 `timestamp` 升序排列。

---

## 6. 动作推断：inferAction

决策点映射到八种 `InterventionAction`：

```typescript
type InterventionAction =
  | "clarify"           // 需要澄清
  | "request_approval"  // 需要审批
  | "plan"              // 计划决策
  | "search_web"        // Web 搜索
  | "read_context"      // 读取上下文
  | "use_tool"          // 使用工具（通用）
  | "answer_directly"   // 直接回答
  | "stop";             // 停止
```

推断优先级：

```
hasApproval      → request_approval
hasClarification → clarify
hasPlanDecision  → plan
toolId is search → search_web
toolId is read   → read_context
toolId present   → use_tool
otherwise        → answer_directly
```

### 6.1 工具识别

`isSearchTool` 和 `isReadContextTool` 定义在 `packages/shared/src/tool-risk.ts`，Router 和 Adapter 共用同一实现，确保两边工具分类一致：

**搜索工具**（`isSearchTool`）：
`web.search`, `web.fetch`, `web_search`, `web_fetch`, `search`, `browser.navigate`

**读取工具**（`isReadContextTool`）：
`file.read`, `file.grep`, `file.glob`, `file.list`, `read`, `grep`, `glob`（含下划线变体 `file_read`、`file_grep` 等兼容形式）

---

## 7. 不确定性推断：inferUncertainties

每个决策点推断六个不确定性维度：

```typescript
{
  goalUncertainty: number;       // 目标不确定性 (0–1)
  factUncertainty: number;       // 事实不确定性 (0–1)
  contextUncertainty: number;    // 上下文不确定性 (0–1)
  actionRisk: number;            // 行动风险 (0–1)
  userCost: number;              // 用户成本 (0–1)
  reversibility: "low" | "medium" | "high";
  wouldChangeOutcomeIfWrong: boolean;
}
```

### 7.1 估算方式

适配器的不确定性推断采用**双层模型**（详见 4.2 节）：

1. **Base 层**：调用 `causal-policy-router` 的 `estimate*` 函数，基于 trace 重构的 `PolicyRouterInput`
2. **Override 层**：基于 action 语义的最低值保证

### 7.2 userCost 映射

| 动作 | userCost |
| --- | --- |
| clarify | 0.3 + clarificationCount × 0.15（上限 0.9） |
| request_approval | 0.5 |
| plan | 0.3 |
| search_web | 0.2 |
| stop | 0.1 |
| 其他 | 0.05 |

### 7.3 关键不确定性提取

`buildKeyUncertainties` 将 ≥ 0.5 的维度翻译为中文标签：

- `goalUncertainty ≥ 0.5` → "用户目标不明确"
- `factUncertainty ≥ 0.5` → "事实信息缺失"
- `contextUncertainty ≥ 0.5` → "上下文不足"
- `actionRisk ≥ 0.5` → "行动风险较高"

### 7.4 wouldChangeOutcomeIfWrong

`actionRisk ≥ 0.5 || goalUncertainty ≥ 0.6` → true，表示错误决策可能改变最终结果。Router 和 adapter 使用相同阈值。

---

## 8. 构建决策记录

### 8.1 CausalDecisionRecord

```typescript
CausalDecisionRecord {
  taskState: CausalTaskState;
  policyDecision: InterventionPolicyDecision;
  chosenIntervention: InterventionAction;
  alternativeInterventions: InterventionAction[];  // Router 自动填充最多 2 个；Adapter 为空
  recordedAt: number;
  decisionContext?: CausalDecisionContext;  // phase、turnIndex、toolId、agentId、nodeId 等
}
```

**decisionContext.phase** 的可能值：

| Phase | 发射位置 | 说明 |
| --- | --- | --- |
| `run_start` | runtime-kernel-runner | Run 启动时的初始决策 |
| `tool_request` | node-runtime-loop | 每次工具请求时的决策 |
| `completion` | node-runtime-loop | Run 完成时的决策 |
| `clarification_resume` | runtime-kernel-runner | 澄清后恢复时的决策 |
| `clarification_triggered` | runtime-clarifications | 澄清门触发时的决策 |
| `approval_triggered` | runtime-action-runner | 审批门触发时的决策 |
| `plan_updated` | runtime-kernel | 计划有 pending items 时的决策 |

### 8.2 CausalTaskState

```typescript
CausalTaskState {
  surfaceRequest: string;              // 来自 snapshot.input.prompt
  latentGoalHypotheses: string[];      // 需要 LLM 级别推理，当前为空
  selectedLatentGoal: string;          // 需要 LLM 级别推理，当前为空
  keyUncertainties: string[];          // Router 自动计算中文标签
  constraints: string[];               // 需要 LLM 级别推理，当前为空
  candidateInterventions: string[];    // 需要 LLM 级别推理，当前为空
  chosenIntervention: InterventionAction;
  alternativeInterventions: string[];  // 从 input.taskState 透传
  counterfactualRiskIfSkipped: string; // 需要 LLM 级别推理，当前为空
  expectedOutcomeLift: string;         // 需要 LLM 级别推理，当前为空
  confidence: number;                  // Router: 1 - goalUncertainty；Adapter: answer_directly→0.7, 其他→0.4
  stopCondition: string;               // 需要 LLM 级别推理，当前为空
}
```

`causalTaskState` 通过 `extractCausalTaskState()` 在 ledger 投影时从 **最新**（最后一条）`causal.decision.recorded` 事件中提取，代表 agent 对任务的最终理解，填充到 `StateSnapshot.causalTaskState`。需要完整因果决策路径的消费者（如 evaluation 框架）应直接扫描 events 数组中的所有 `causal.decision.recorded` 事件。

### 8.3 InterventionPolicyDecision

```typescript
InterventionPolicyDecision {
  goalUncertainty: number;
  factUncertainty: number;
  contextUncertainty: number;
  actionRisk: number;
  userCost: number;
  reversibility: "low" | "medium" | "high";
  recommendedAction: InterventionAction;
  reason: string;                      // Router: "<action>: <reasons>"；Adapter: "[adapter-inferred] <理由>"
  wouldChangeOutcomeIfWrong: boolean;  // Router 和 Adapter 统一使用 actionRisk≥0.5 || goalUncertainty≥0.6
}
```

---

## 9. 工具风险分类

`classifyToolRisk(toolId)` 位于 `packages/shared/src/tool-risk.ts`，router 和 adapter 共用同一实现：

| 风险等级 | 工具 |
| --- | --- |
| **high** | `shell`, `file.write`, `file.patch`, `file.apply_patch`, `file.delete`, `file.move`, `browser` |
| **medium** | `file.create`, `git`, `npm`, `pnpm`, `yarn`, `agent.spawn`, `plan.update`, `mcp.call` |
| **low** | 其他所有工具（`file.read`, `web.search`, `mcp.listTools`, `mcp.readResource` 等） |

匹配逻辑：`toolId === prefix || toolId.startsWith(prefix + ".")`，同时支持裸工具 ID 和带命名空间的变体。

---

## 10. causal.decision.recorded 发射点

因果决策记录在以下时机被发射到事件流：

| 时机 | 文件 | Phase | 触发条件 |
| --- | --- | --- | --- |
| Run 启动 | `runtime-kernel-runner.ts` | `run_start` | 每次 run 启动 |
| 工具请求 | `node-runtime-loop.ts` | `tool_request` | 每次模型提议工具调用 |
| Run 完成 | `node-runtime-loop.ts` | `completion` | Run 自然完成 |
| 澄清恢复 | `runtime-kernel-runner.ts` | `clarification_resume` | 意图澄清后恢复执行 |
| 澄清触发 | `runtime-clarifications.ts` | `clarification_triggered` | 单个或批量澄清门触发 |
| 审批触发 | `runtime-action-runner.ts` | `approval_triggered` | 审批门触发（非 resume 路径） |
| 计划更新 | `runtime-kernel.ts` | `plan_updated` | plan 中有未完成项时 |

此外，当 `causalInterventionLevel` 为非 `record_only` 且工具被门控阻塞时，会发出 `causal.decision.rejected` 事件。

---

## 11. 常见误解与边界

1. **适配器推断的是近似值，不是真实因果推理**。所有推断值标记 `[adapter-inferred]`。原生 causal agent 的 `causal.decision.recorded` 事件通过 `routeIntervention` 在运行时产生，适配器只从 trace 反向拟合。

2. **同类型工具调用被合并为一个决策点**。如果 run 调用了 3 次 `file.read`，仅生成一个 "read_context" 决策点。这是因为适配器关注"是否使用该类工具"而非每次调用。

3. **Router 的 alternativeInterventions 会被自动填充**。原生 `routeIntervention` 会基于上下文计算最多 2 个备选干预方案。Adapter 的备选方案仍为空（无法从 trace 反推）。

4. **latentGoalHypotheses、constraints 等 LLM 级字段为空**。这些需要 LLM 级别的语义理解，当前未实现 LLM 认知状态提取。

5. **不确定性值在 Router 和 Adapter 之间共享估算函数**。Adapter 使用与 Router 相同的 `estimate*` 函数作为基础值，叠加 action-semantic override，两个轨道在相同场景下产生一致的不确定性评估。

6. **Router 和 Adapter 服务于不同目的**。Router 在运行时产生原生因果记录并可干预控制流（通过 `causalInterventionLevel`）；Adapter 为 legacy run 提供 bridge，让 A/B 对比在 metric 层面可行。

7. **causalTaskState 在 ledger 投影中自动提取**。`StateSnapshot.causalTaskState` 从最新 `causal.decision.recorded` 事件中提取，不依赖额外的持久化机制。

8. **控制流干预默认关闭**。`causalInterventionLevel` 默认为 `"record_only"`，保持向后兼容。升级到 `"advisory"` 或 `"enforcing"` 需要显式配置。

9. **`clarificationCount` 在工具请求阶段是动态的**。`node-runtime-loop` 的 `tool_request` 和 `completion` phase 从事件流中实时计数 `clarification.required` 事件，而非硬编码为 0。Preflight 阶段发生过的意图澄清会被正确反映在不确定性估算中。

10. **Gate 触发点的手动 record 均经过 schema 验证**。`clarification_triggered`、`approval_triggered`、`plan_updated` 三个 phase 手动构建的 `CausalDecisionRecord` 均通过 `CausalDecisionRecordSchema.parse()` 校验，与 `routeIntervention` 输出的 record 享受相同的类型安全保障。

11. **enforcing 模式会注入因果反馈到对话上下文**。工具被阻塞时，causal 建议原因作为 user message 注入 conversation，模型在 forced final 调用中能看到完整的阻塞理由和建议动作，生成更有依据的最终回答。

12. **同一工具调用可能在多个 phase 产生 record**。例如 `tool_request` + `approval_triggered` 会产生两条 `causal.decision.recorded` 事件。两者 phase 不同，属于不同决策维度，evaluation 层面按 phase 区分处理。

---

