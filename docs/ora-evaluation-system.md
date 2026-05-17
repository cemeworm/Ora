# Ora Evaluation System：评测与 A/B 对比

本文描述 Ora 的 Evaluation 系统 —— 包括评测数据集管理、Evaluation Compare（A/B 对比分析）、Net Lift 评估，以及评估结果的结构化报告。读完本文，应能理解如何比较两个 evaluation run（如 causal mainline vs legacy baseline），以及 verdict 如何从多维度指标中推导。

> **最近更新 (2026-05-18)**：初始版本。覆盖 evaluation-compare.ts、evaluation/ 目录结构（specs + datasets）、A/B 对比报告、Net Lift 模型、verdict 判定逻辑。

## 阅读地图

| 关注点 | 对应章节 |
| --- | --- |
| 评估系统在 Ora 中的位置 | [1. 定位：评估系统在 Ora 中的角色](#1-定位评估系统在-ora-中的角色) |
| 数据集与 specs 目录结构 | [2. 评估资源组织](#2-评估资源组织) |
| CaseComparison 与 MetricAggregate | [3. 对比核心类型](#3-对比核心类型) |
| 两个 run 的逐 case 对比 | [4. compareEvaluationRuns：对比引擎](#4-compareevaluationruns对比引擎) |
| Net Lift 计算模型 | [5. Net Lift：净提升评估](#5-net-lift净提升评估) |
| Verdict 判定逻辑 | [6. Verdict：六条件判定](#6-verdict六条件判定) |
| 报告格式化 | [7. 报告输出](#7-报告输出) |
| 容易误解的点 | [8. 常见误解与边界](#8-常见误解与边界) |

核心源码文件：

| 文件 | 职责 |
| --- | --- |
| `apps/runtime/src/evaluation-compare.ts` | A/B 对比核心：compareEvaluationRuns、Net Lift、verdict |
| `apps/runtime/src/evaluation-store.ts` | Evaluation run 存储管理 |
| `evaluation/specs/` | 评估规范定义（JSON spec 文件） |
| `evaluation/datasets/` | 评估数据集（19 个 JSON 数据集文件） |
| `evaluation/scripts/` | 评估执行脚本 |

## 1. 定位：评估系统在 Ora 中的角色

评估系统是 Ora 质量保障和因果策略验证的核心基础设施。它有两层职责：

1. **回归守卫**：确保模式、prompt、工具策略的变更不会导致质量退化
2. **因果 A/B 对比**：量化 causal mainline agent（带因果决策模块）相对于 legacy baseline 的净提升

评估不是一次性活动 —— 它是 Self-Iteration 闭环的评测门控（Evaluation Gate），也是 Mode Studio 变更的验证手段。

## 2. 评估资源组织

### 2.1 目录结构

```
evaluation/
├── specs/
│   └── causal-ab-comparison.spec.json   # A/B 对比评估规范
├── datasets/
│   ├── causal-intervention-decision-dataset.json  # 因果干预决策
│   ├── output-quality-dataset.json                # 输出质量
│   ├── tool-selection-dataset.json                # 工具选择
│   ├── multi-turn-dataset.json                    # 多轮对话
│   ├── approval-resume-dataset.json               # 审批恢复
│   ├── safety-gate-dataset.json                   # 安全门控
│   ├── memory-reliability-dataset.json            # Memory 可靠性
│   ├── memory-boundary-dataset.json               # Memory 边界
│   ├── self-iteration-dataset.json                # Self-Iteration
│   ├── pattern-correctness-dataset.json           # 模式正确性
│   ├── auto-router-dataset.json                   # 自动路由
│   ├── mode-studio-dataset.json                   # Mode Studio
│   ├── observability-replay-dataset.json          # 可观测性回放
│   ├── token-efficiency-dataset.json              # Token 效率
│   ├── terminal-bench-dataset.json                # Terminal 基准
│   ├── e2e-task-dataset.json                      # 端到端任务
│   ├── gaia-dataset.json                          # GAIA 基准
│   ├── swe-bench-dataset.json                     # SWE-Bench 基准
│   └── tau-bench-dataset.json                     # Tau-Bench 基准
└── scripts/                                        # 执行脚本
```

### 2.2 数据集覆盖维度

| 维度 | 数据集 | 关注点 |
| --- | --- | --- |
| 因果决策 | causal-intervention-decision | 干预选择准确性 |
| 输出质量 | output-quality, gaia | 回答正确性 |
| 工具使用 | tool-selection | 工具选择合理性 |
| 安全性 | safety-gate, approval-resume | 审批门控与恢复 |
| Memory | memory-reliability, memory-boundary | 记忆检索与边界 |
| 效率 | token-efficiency | 成本控制 |
| 鲁棒性 | multi-turn, terminal-bench | 多轮、终态处理 |
| 外部基准 | swe-bench, tau-bench | 第三方标准评测 |

## 3. 对比核心类型

### 3.1 CaseComparison（单 case 对比）

```typescript
CaseComparison {
  caseId: string;
  scoreA: number;           // Baseline 总分
  scoreB: number;           // Target 总分
  delta: number;            // scoreB - scoreA
  direction: "improved" | "degraded" | "unchanged";  // delta > 0.01 / < -0.01 / 其他
  metricDeltas: MetricDeltaEntry[];  // 逐 metric 差异
  failureTagsA: string[];   // Baseline 失败标签
  failureTagsB: string[];   // Target 失败标签
}
```

### 3.2 MetricAggregate（跨 case 聚合）

```typescript
MetricAggregate {
  metricId: string;
  meanA: number;       // Baseline 均值
  meanB: number;       // Target 均值
  meanDelta: number;   // 平均差异
  medianDelta: number; // 中位差异
  winRate: number;     // B > A 的 case 占比
  lossRate: number;    // B < A 的 case 占比
  tieRate: number;     // delta ≈ 0 的 case 占比
}
```

### 3.3 NetLift（净提升）

```typescript
NetLift {
  outcomeLift: number;   // 结果质量提升
  decisionLift: number;  // 决策质量提升
  costPenalty: number;   // 成本惩罚
  netLift: number;       // outcomeLift + decisionLift - costPenalty
}
```

### 3.4 ComparisonVerdict（最终判定）

```typescript
type ComparisonVerdict = "causal_wins" | "legacy_wins" | "mixed" | "inconclusive";
```

## 4. compareEvaluationRuns：对比引擎

### 4.1 对比流程

```
runA (Legacy/Baseline) + runB (Causal Mainline)
  → 按 configId 筛选 caseResults
  → 按 caseId 匹配两个 run 的 cases
  → 逐对 compareCaseResult()
  → buildMetricAggregates() 聚合
  → computeNetLift() 净提升
  → computeVerdict() 判定
  → EvaluationComparisonReport
```

### 4.2 Config 筛选

每个 `EvaluationRun` 可以有多个 config（如 `config-0` = baseline, `config-1` = causal）。对比时：
- 可指定 `configAId` / `configBId` 精确筛选
- 未指定时使用第一个 config（`firstConfigId`）

### 4.3 Case 匹配

仅对比两个 run 中 `caseId` 相同的 case。只在 A 或只在 B 的 case 被跳过。

## 5. Net Lift：净提升评估

### 5.1 计算公式

```typescript
outcomeLift =
  effective_intervention * 0.4 +
  intent_resolution * 0.2 +
  counterfactual_lift * 0.2;

decisionLift = clarification_precision * 0.2;

costPenalty =
  |min(0, over_action)| * 0.1 +
  max(0, costRatio) * 0.1;
  // costRatio = (avgCostB - avgCostA) / avgCostA

netLift = outcomeLift + decisionLift - costPenalty;
```

### 5.2 指标权重解释

| 指标 | 权重 | 含义 |
| --- | --- | --- |
| `effective_intervention` | 0.4 | 干预是否有效解决了用户问题 |
| `intent_resolution` | 0.2 | 用户意图是否被正确理解并完成 |
| `counterfactual_lift` | 0.2 | 反事实推理的质量提升 |
| `clarification_precision` | 0.2 | 澄清问题的准确性 |
| `over_action` | 0.1（惩罚） | 是否有不必要的过度操作 |
| costRatio | 0.1（惩罚） | 成本相对增长 |

## 6. Verdict：六条件判定

### 6.1 判定条件

| # | 条件 | 阈值 | 不通过的含义 |
| --- | --- | --- | --- |
| 1 | effective_intervention 明显提升 | Δ ≥ +10% | 干预有效性无明显改善 |
| 2 | intent_resolution 不下降 | Δ ≥ -5% | 意图理解退化 |
| 3 | over_action 不明显恶化 | Δ ≥ -10% | 过度操作增加 |
| 4 | 最终答案质量不下降 | improved ≥ degraded | 更多 case 退化而非改善 |
| 5 | 成本增长可接受 | token_efficiency Δ ≥ -30% | 成本超出可接受范围 |
| 6 | 无 missing_causal_data 类 failure | 零出现 | 对比不公平（缺少 causal data） |

### 6.2 判定逻辑

```typescript
overall =
  passedCount === 6  → "causal_wins"    // ✅ Causal Mainline 胜出
  passedCount >= 4   → "mixed"          // ⚠️ 互有胜负
  netLift > 0        → "mixed"          // 净提升为正但未到全通过
  否则               → "legacy_wins"    // ❌ Legacy 更优
```

## 7. 报告输出

### 7.1 输出格式

`formatComparisonReport(report, "markdown")` 生成 Markdown 报告，包含：

1. **Overview**：总体得分、通过率、平均耗时、平均成本对比
2. **Metric Deltas**：所有指标的名称、均值差异、中位差异、win/loss rate
3. **Net Lift**：三项分量的数值
4. **Verdict**：六条件清单（checkbox）+ 总体判定
5. **Case-Level Summary**：improved/degraded/unchanged 计数 + Top 10 退化 case

### 7.2 JSON 输出

`formatComparisonReport(report, "json")` 输出完整的 JSON 序列化结果，包含所有原始数据和计算中间值。

## 8. 常见误解与边界

1. **Evaluation Compare 不执行评测**。`compareEvaluationRuns` 对比已完成的评测 run 的结果，它本身不运行模型或工具。评测执行由外部 scheduler 或 CLI 触发。

2. **Case 按 caseId 精确匹配**。两个 run 必须使用相同的 dataset 才能对比。如果 run B 有 run A 不存在的 case，这些 case 会被忽略。

3. **Net Lift 是加权线性模型**。权重（0.4/0.2/0.2/0.1）是初始值，可随因果策略的迭代调整。这不是统计显著性检验，而是一个实用的决策辅助工具。

4. **Verdict 不是绝对的"好坏"判断**。`mixed` 意味着在某些维度有改善、某些有退化，需要人工审查具体哪些 case 退化来判断是否可接受。

5. **missing_causal_data 条件保证对比公平性**。如果任何一个 case 缺少 causal data，整个 verdict 条件 6 不通过 —— 此时对比结果不可信，因为数据不完整。

6. **评估数据集独立于 runtime 代码**。`evaluation/datasets/` 中的 JSON 文件是评估的输入数据，不参与 runtime 构建。修改数据集不需要重新编译。

---

> **核心判断**：Evaluation 系统是 Ora 质量保障的量化基础。compareEvaluationRuns 提供了一条结构化的 A/B 对比管线：逐 case 对比 → 多 metric 聚合 → 加权 Net Lift → 六条件 verdict。它不替代人工判断，但将"好"和"坏"的讨论从直觉降维到可追溯的数值。
