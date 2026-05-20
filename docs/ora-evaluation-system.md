# Ora Evaluation System：评测与 A/B 对比

本文描述 Ora 的 Evaluation 系统 —— 包括评测数据集管理、Evaluation Compare（A/B 与多配置对比）、结果导向 Net Lift、failure taxonomy，以及评估结果的结构化报告。读完本文，应能理解如何比较两个或多个 evaluation config（如 `record_only` / `advisory` / `enforcing`），以及 verdict 如何从 outcome、过程信号与成本共同推导。

> **最近更新 (2026-05-19)**：three-way comparison、结果优先的 Net Lift、causal outcome metrics、semantic-state / intervention failure taxonomy、multi-config 报告。

## 阅读地图

| 关注点 | 对应章节 |
| --- | --- |
| 评估系统在 Ora 中的位置 | [1. 定位：评估系统在 Ora 中的角色](#1-定位评估系统在-ora-中的角色) |
| 数据集与 specs 目录结构 | [2. 评估资源组织](#2-评估资源组织) |
| CaseComparison 与 MetricAggregate | [3. 对比核心类型](#3-对比核心类型) |
| 两个 run 的逐 case 对比 | [4. compareEvaluationRuns：对比引擎](#4-compareevaluationruns对比引擎) |
| Net Lift 与 outcome metrics | [5. Net Lift：结果优先的净提升](#5-net-lift结果优先的净提升) |
| Verdict 与 multi-config 对比 | [6. Verdict：A/B 与 Three-way 判定](#6-verdictab-与-three-way-判定) |
| 报告格式化 | [7. 报告输出](#7-报告输出) |
| failure taxonomy 与常见边界 | [8. Failure Taxonomy 与常见边界](#8-failure-taxonomy-与常见边界) |

核心源码文件：

| 文件 | 职责 |
| --- | --- |
| `apps/runtime/src/evaluation-compare.ts` | A/B / multi-config 对比核心：`compareEvaluationRuns()`、`compareEvaluationConfigs()`、Net Lift、verdict |
| `apps/runtime/src/evaluation-store.ts` | Evaluation run 存储、causal observation、outcome metrics、failure tags |
| `apps/runtime/src/feedback-loop-store.ts` | 从 failure tags 聚合 semantic/intervention insight |
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
│   ├── causal-ab-comparison.spec.json   # A/B 对比评估规范
│   ├── causal-smoke-three-way.json      # record_only / advisory / enforcing 冒烟比较
│   └── causal-full-three-way.json       # 三配置完整比较
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

### 3.5 MultiConfigComparison（多配置比较）

当前 evaluation compare 不再只支持 A/B。对于同一 spec，它还可以直接比较多组 config：

```typescript
MultiConfigComparison {
  configs: ["record_only", "advisory", "enforcing"];
  caseComparisons: CaseComparison[];
  metricAggregates: MetricAggregate[];
  netLiftByConfig: Record<string, number>;
  verdictByConfig: Record<string, ComparisonVerdict>;
}
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

### 4.4 Three-way comparison

当前 causal 评估的主用法已经不是只有 “legacy vs causal” 两组，而是同一 spec 下比较：

- `record_only`
- `advisory`
- `enforcing`

对应入口：

- `compareEvaluationRuns()`：双 run / 双 config 对比
- `compareEvaluationConfigs()`：同一 evaluation run 内多 config 对比
- `formatComparisonReport()`：A/B 报告
- `formatMultiConfigReport()`：three-way / multi-config 报告

## 5. Net Lift：结果优先的净提升

当前 Net Lift 已经从“主要看过程启发式”改成 **结果优先**。

### 5.1 当前主指标

causal 评估现在同时看结果、过程和成本三层信号：

| 类别 | 指标 | 含义 |
| --- | --- | --- |
| 结果 | `task_success_rate` | 任务是否按 success criteria 真正完成 |
| 结果 | `llm_judge_score` | 最终答案质量评分；必须带 provenance（`explicit_llm_judge` / `auto_llm_judge` / `heuristic_proxy`） |
| 结果 | `counterfactual_lift` | 干预是否带来可观察的结果提升 |
| 过程 | `effective_intervention` | 干预是否起到了正确作用 |
| 过程 | `intent_resolution` | 是否理解并完成了用户真实意图 |
| 过程 | `clarification_precision` | 澄清是否精准而非噪音 |
| 风险 | `over_action` | 是否出现不必要的动作或过度干预 |
| 成本 | token / latency / tool cost | 提升是否以不可接受的成本换来 |

### 5.2 Net Lift 的当前口径

`computeNetLift()` 的主导思想是：

1. **先看 outcome**
   `task_success_rate`、`llm_judge_score`、`counterfactual_lift` 现在比单纯过程信号更重要。
2. **再看 intervention quality**
   `effective_intervention`、`intent_resolution`、`clarification_precision` 用来解释“为什么好/不好”。
3. **最后扣掉风险和成本**
   过度操作、明显的 token / latency / tool cost 增长会被当成 penalty。

因此 Net Lift 现在更像“结果优先的综合净收益”，而不是一条固定权重永不变化的线性打分公式。

### 5.3 `llm_judge_score` provenance

`llm_judge_score` 不再默认等同于“真实 LLM 裁判分”。当前口径要求它显式记录来源：

- `explicit_llm_judge`
  - spec 显式声明了 `kind: "llm_judge"` evaluator，并成功返回评分。
- `auto_llm_judge`
  - spec 没有手写 evaluator，但请求了 `llm_judge_score`，runner 根据 judge config 自动合成了 judge evaluator 并成功评分。
- `heuristic_proxy`
  - 当前没有可用 judge，或 judge 调用失败，metric 回退到 heuristic proxy；报告必须把它视为代理信号，而不是把它表述成真实 judge。

因此在阅读 compare/report 时，`llm_judge_score` 要同时看数值和 provenance；只有前两者才能当作真正的 judge outcome 信号。

## 6. Verdict：A/B 与 Three-way 判定

### 6.1 A/B verdict

双配置比较仍会给出：

```typescript
type ComparisonVerdict =
  | "causal_wins"
  | "legacy_wins"
  | "mixed"
  | "inconclusive";
```

当前 verdict 不是死板地看单一公式，而是综合三件事：

1. outcome 是否更好
2. 风险/成本是否可接受
3. 数据是否足够公平和完整

`missing_causal_data` 这类 failure 仍然会把 verdict 往 `inconclusive` 推，因为那代表对比基础不完整。

### 6.2 Three-way 判定

当同一 spec 下同时跑 `record_only` / `advisory` / `enforcing` 时，系统更关注：

- 哪个 config 的 outcome 最稳
- 哪个 config 带来的 over-action / cost penalty 最小
- 哪个 config 的 failure tags 最集中暴露 semantic gap，哪个更像 intervention gap

three-way 不会强行产出一个“永远唯一正确”的模式，而是输出：

- config 之间的 pairwise compare
- 每个 config 的 net lift
- 每个 config 的 failure profile
- 最终推荐或 `mixed` 结论

## 7. 报告输出

### 7.1 输出格式

`formatComparisonReport(report, "markdown")` 生成 Markdown 报告，包含：

1. **Overview**：总体得分、通过率、平均耗时、平均成本对比
2. **Metric Deltas**：所有指标的名称、均值差异、中位差异、win/loss rate
3. **Net Lift**：outcome / intervention / cost 的综合结果
4. **Verdict**：总体结论 + fairness / missing-data 提示
5. **Case-Level Summary**：improved/degraded/unchanged 计数 + Top 退化 case

### 7.2 Multi-config 报告

`formatMultiConfigReport()` 在 A/B 之外还会补出：

- config 排名
- pairwise outcome / cost 对照
- 每个 config 的主要 failure tags
- 对 `record_only` / `advisory` / `enforcing` 的推荐结论

### 7.3 JSON 输出

`formatComparisonReport(report, "json")` 输出完整的 JSON 序列化结果，包含所有原始数据和计算中间值。

## 8. Failure Taxonomy 与常见边界

### 8.1 当前 failure taxonomy

causal 相关 failure tags 现在已经不只是一堆平铺的错误名，而是开始分成两大类：

- **semantic-state gap**
  - `latent_goal_missing`
  - `latent_goal_mismatch`
  - `under_clarification`
- **intervention / outcome gap**
  - `wrong_intervention`
  - `over_clarification`
  - `over_action`
  - `low_counterfactual_lift`
  - `poor_outcome_quality`

这样做的目的，是把“没理解任务”与“理解了但动作做错/结果不够好”分开。后续 feedback loop 也正是沿这条边界聚合 insight。

### 8.2 常见误解与边界

1. **Evaluation Compare 不执行评测**。`compareEvaluationRuns` 对比已完成的评测 run 的结果，它本身不运行模型或工具。评测执行由外部 scheduler 或 CLI 触发。

2. **Case 按 caseId 精确匹配**。两个 run 必须使用相同的 dataset 才能对比。如果 run B 有 run A 不存在的 case，这些 case 会被忽略。

3. **Net Lift 不再只是旧版固定线性权重**。当前更强调 outcome 优先，具体实现会随评估目标演进。这不是统计显著性检验，而是一个工程决策辅助工具。

4. **Verdict 不是绝对的"好坏"判断**。`mixed` 意味着在某些维度有改善、某些有退化，需要人工审查具体哪些 case 退化来判断是否可接受。

5. **Three-way 不是强行选一个冠军**。它经常用于回答“哪档 gate 更适合当前 workload”，而不是宣布一种模式永久胜出。

6. **failure taxonomy 不是纯展示标签**。这些 tags 会继续流入 feedback loop，用来区分 semantic-state gap 和 intervention gap。

7. **评估数据集独立于 runtime 代码**。`evaluation/datasets/` 中的 JSON 文件是评估的输入数据，不参与 runtime 构建。修改数据集不需要重新编译。

---

> **核心判断**：Evaluation 系统现在不只是“做一份 causal vs legacy 的比分表”，而是 Ora 用来比较多档 gate 配置、追踪结果质量、定位 semantic/intervention failure，并把这些结论继续回流给 feedback loop 的量化基础设施。
