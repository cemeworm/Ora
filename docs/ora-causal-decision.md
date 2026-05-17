# Ora Causal Decision Adapter：因果决策适配器

本文描述 Ora 的因果决策适配器 —— 它从 legacy run 的 trace events 中反向推断因果决策记录，使没有内置因果模块的旧 run 也能参与 causal A/B 对比评估。读完本文，应能理解决策点检测、动作推断、不确定性建模和 CausalDecisionRecord 的完整结构。

> **最近更新 (2026-05-18)**：初始版本。覆盖 adaptCausalDecisionsFromTrace、五种决策点类型、七种 InterventionAction、不确定性六维推断、工具风险分类。

## 阅读地图

| 关注点 | 对应章节 |
| --- | --- |
| 适配器要解决什么问题 | [1. 定位：为什么需要适配器](#1-定位为什么需要适配器) |
| 决策点检测 | [2. 决策点检测：findDecisionPoints](#2-决策点检测finddecisionpoints) |
| 动作推断 | [3. 动作推断：inferAction](#3-动作推断inferaction) |
| 不确定性建模 | [4. 不确定性推断：inferUncertainties](#4-不确定性推断inferuncertainties) |
| CausalDecisionRecord 完整结构 | [5. 构建决策记录：buildDecisionRecord](#5-构建决策记录builddecisionrecord) |
| 工具风险分类 | [6. 工具风险分类](#6-工具风险分类) |
| 兜底策略 | [7. Fallback 决策](#7-fallback-决策) |
| 容易误解的点 | [8. 常见误解与边界](#8-常见误解与边界) |

核心源码文件：

| 文件 | 职责 |
| --- | --- |
| `apps/runtime/src/harness/causal-decision-adapter.ts` | 适配器核心：决策点检测、动作推断、不确定性建模 |
| `packages/shared/src/causal.ts` | CausalDecisionRecord、CausalTaskState、InterventionPolicyDecision 等 shared types |
| `apps/runtime/src/harness/causal-decision-adapter.test.ts` | 适配器测试 |

## 1. 定位：为什么需要适配器

Ora 的 causal agent 在运行时产生 `causal.decision.recorded` 事件，记录每个决策点的完整因果推理链（任务状态 → 不确定性评估 → 策略裁决 → 干预选择）。

但 legacy runs（旧版 agent、无因果模块的 run）没有这些事件。为了使它们也能参与 causal A/B 对比评估（见 `ora-evaluation-system.md`），需要从 trace events 中反向推断近似的 `CausalDecisionRecord`。

```
Legacy Snapshot (StateSnapshot)
  → adaptCausalDecisionsFromTrace()
  → 扫描 events[] 找决策点
  → 推断每点的动作、不确定性
  → 构建 CausalDecisionRecord[]
  → 可与 causal mainline run 在同一 metric 框架下对比
```

所有推断值带有 `[adapter-inferred]` 前缀标记，区分于原生 `causal.decision.recorded` 事件。

## 2. 决策点检测：findDecisionPoints

### 2.1 四类 trace 信号

决策点从 snapshot 的 `events` 和 `toolCalls` 中提取：

| 信号来源 | 检测条件 | 决策点类型 |
| --- | --- | --- |
| `events[type="clarification.required"]` | 首次出现 | clarification |
| `events[type="approval.required"]` | 首次出现 | approval |
| `events[type="plan.updated"]` | payload 中有 `status === "pending"` 的 item | plan_decision |
| `toolCalls[]` | 每种 toolId 首次出现（按 tool 分组） | tool_use |

### 2.2 去重逻辑

- clarification、approval 各只取首次出现（`seen.add("clarify" / "approval")`）
- plan_decision 同上（`seen.add("plan")`）
- 工具调用按 `toolId` 分组（`seen.add("tool:<toolId>")`），同一工具类型的多次调用仅生成一个决策点

### 2.3 DecisionPoint 结构

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

## 3. 动作推断：inferAction

决策点映射到七种 `InterventionAction`：

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

### 3.1 工具识别

**搜索工具**（`isSearchTool`）：
`web.search`, `web.fetch`, `web_search`, `web_fetch`, `search`, `browser.navigate`

**读取工具**（`isReadContextTool`）：
`file.read`, `file.grep`, `file.glob`, `file.list`, `read`, `grep`, `glob`（含变体）

## 4. 不确定性推断：inferUncertainties

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

### 4.1 按动作的推断值

| 动作 | goalU. | factU. | ctxU. | risk | cost | reversibility |
| --- | --- | --- | --- | --- | --- | --- |
| clarify | 0.7 | 0.2 | 0.2 | 0.1 | 0.6 | high |
| search_web | 0.2 | 0.7 | 0.3 | 0.1 | 0.2 | high |
| read_context | 0.2 | 0.3 | 0.6 | 0.1 | 0.1 | high |
| request_approval | 0.4 | 0.2 | 0.2 | 0.8 | 0.5 | low |
| plan | 0.5 | 0.2 | 0.4 | 0.1 | 0.3 | medium |
| use_tool | 0.2 | 0.2 | 0.2 | 0.1-0.5* | 0.1 | low/medium* |
| stop | 0.2 | 0.2 | 0.2 | 0.1 | 0.1 | high |
| answer_directly | 0.2 | 0.2 | 0.2 | 0.1 | 0.1 | high |

\* `use_tool` 的 `actionRisk` 和 `reversibility` 随 `point.toolRisk` 变化（high → 0.5/low, medium → 0.3/medium, low → 0.1/medium）。

### 4.2 关键不确定性提取

`buildKeyUncertainties` 将 ≥ 0.5 的维度翻译为中文标签：

- `goalUncertainty ≥ 0.5` → "用户目标不明确"
- `factUncertainty ≥ 0.5` → "事实信息缺失"
- `contextUncertainty ≥ 0.5` → "上下文不足"
- `actionRisk ≥ 0.5` → "行动风险较高"

### 4.3 wouldChangeOutcomeIfWrong

`actionRisk ≥ 0.5 || goalUncertainty ≥ 0.6` → true，表示错误决策可能改变最终结果。

## 5. 构建决策记录：buildDecisionRecord

### 5.1 CausalDecisionRecord

```typescript
CausalDecisionRecord {
  taskState: CausalTaskState;
  policyDecision: InterventionPolicyDecision;
  chosenIntervention: InterventionAction;
  alternativeInterventions: InterventionAction[];  // 适配器推断为空
  recordedAt: number;
}
```

### 5.2 CausalTaskState

```typescript
CausalTaskState {
  surfaceRequest: string;              // 来自 snapshot.input.prompt
  latentGoalHypotheses: string[];      // 适配器推断为空
  selectedLatentGoal: string;          // 适配器推断为空
  keyUncertainties: string[];          // 来自 inferUncertainties 中文标签
  constraints: string[];               // 适配器推断为空
  candidateInterventions: string[];    // 适配器推断为空
  chosenIntervention: InterventionAction;
  alternativeInterventions: string[];  // 适配器推断为空
  counterfactualRiskIfSkipped: string; // 适配器推断为空
  expectedOutcomeLift: string;         // 适配器推断为空
  confidence: number;                  // answer_directly → 0.7, 其他 → 0.4
  stopCondition: string;               // 适配器推断为空
}
```

### 5.3 InterventionPolicyDecision

```typescript
InterventionPolicyDecision {
  goalUncertainty: number;
  factUncertainty: number;
  contextUncertainty: number;
  actionRisk: number;
  userCost: number;
  reversibility: "low" | "medium" | "high";
  recommendedAction: InterventionAction;
  reason: string;                      // "[adapter-inferred] <推断理由>"
  wouldChangeOutcomeIfWrong: boolean;
}
```

## 6. 工具风险分类

`classifySnapshotToolRisk(toolId)` 将工具 ID 按名称分类：

| 风险等级 | 工具 |
| --- | --- |
| **high** | `shell`, `file.write`, `file.patch`, `file.delete`, `file.move`, `browser` |
| **medium** | `file.create`, `git`, `npm`, `pnpm`, `yarn` |
| **low** | 其他所有工具（`file.read`, `web.search` 等） |

匹配使用前缀比较：`toolId === prefix || toolId.startsWith(prefix + ".")`。

## 7. Fallback 决策

如果 snapshot 中完全没有任何决策点（无事件 + 无工具调用），生成单一 `answer_directly` 兜底记录：

- 所有不确定性 = 0.2
- actionRisk = 0.1, userCost = 0.1
- reversibility = "high"
- confidence = 0.5
- reason = `"[adapter-inferred] no trace signals found, defaulting to answer_directly"`

这确保每个 legacy run 至少有一个决策记录可以参与 causal metric 计算。

## 8. 常见误解与边界

1. **适配器推断的是近似值，不是真实因果推理**。所有推断值标记 `[adapter-inferred]`。原生 causal agent 的 `causal.decision.recorded` 事件包含 LLM 产生的因果推理，适配器只是从 trace 反向拟合。

2. **同类型工具调用被合并为一个决策点**。如果 run 调用了 3 次 `file.read`，仅生成一个 "read_context" 决策点。这是因为适配器关注"是否使用该类工具"而非每次调用。

3. **alternativeInterventions 始终为空**。适配器无法从 trace 推断"当时考虑但未选择的方案"——只有原生 causal agent 的内部推理才知道这些。

4. **latentGoalHypotheses、constraints 等字段为空**。这些需要 LLM 级别的语义理解，trace events 中没有对应信号。

5. **不确定性值是启发式预设，不是统计校准值**。各动作的 goalUncertainty/factUncertainty 等值来自人工定义的经验映射，未来可通过 evaluation 反馈进行校准。

6. **适配器独立于 causal agent**。它只为 legacy runs 提供 bridge，使 A/B 对比在 metric 层面可行。原生 causal agent 仍通过 `causal.decision.recorded` 事件提供完整的因果推理记录。

---

> **核心判断**：Causal Decision Adapter 是评估系统的桥梁 —— 它让没有因果模块的旧 run 能够与 causal mainline run 在同一 metric 框架下对比。所有推断值带有明确标记，区分于原生因果推理。它是 pragmatic 的工程方案，不是 causal reasoning 的替代品。
