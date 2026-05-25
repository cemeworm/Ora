# Ora Evaluation System：评测与 A/B 对比

Ora 的 Evaluation 系统做三件事：跑评测、比结果、把结论喂回 feedback loop。它在 Self-Iteration 闭环里承担评测门控（Evaluation Gate），也是 Mode Studio 变更的验证手段。

读完本文，你会理解怎么用 `compareEvaluationRuns` 和 `compareEvaluationConfigs` 比较两组或多组 evaluation config（比如 `record_only` / `advisory` / `enforcing`），以及 verdict 如何从结果信号、过程信号和成本共同推导。

## 阅读地图

| 关注点 | 对应章节 |
| --- | --- |
| 评估系统在 Ora 中的位置 | [1. 为什么需要评估系统](#1-为什么需要评估系统) |
| 对比引擎与核心类型 | [2. 对比引擎与核心类型](#2-对比引擎与核心类型) |
| Net Lift 与 outcome metrics | [3. Net Lift：结果优先的综合净收益](#3-net-lift结果优先的综合净收益) |
| Verdict 与 multi-config 对比 | [4. Verdict：A/B 与多配置判定](#4-verdictab-与多配置判定) |
| Failure taxonomy | [5. Failure Taxonomy：失败分类体系](#5-failure-taxonomy失败分类体系) |
| 数据集与 specs 目录结构 | [6. 输入：数据集与评估规范](#6-输入数据集与评估规范) |
| 报告格式化 | [7. 输出：报告](#7-输出报告) |
| 源码文件索引 | [核心源码文件](#核心源码文件) |

## 1. 为什么需要评估系统

评估系统是 Ora 的质量保障基础设施，承担两层职责：

1. **回归守卫**：确保模式、prompt、工具策略的变更不会导致质量退化
2. **因果 A/B 对比**：量化 causal mainline agent（带因果决策模块）相对于 legacy baseline 的净提升

这两层职责共同支撑 Self-Iteration 闭环——每次迭代的变更在合入前经过评测门控验证，Mode Studio 的策略调整同理。评估结论不会用完即弃，它们流入 `LocalFeedbackLoopStore`，作为 failure taxonomy 和 intervention insight 的证据来源。

## 2. 对比引擎与核心类型

### 2.1 CaseComparison（单 case 对比）

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

### 2.2 MetricAggregate（跨 case 聚合）

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

### 2.3 compareEvaluationRuns：对比流程

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

对比只处理两个 run 中 `caseId` 相同的 case，只在 A 或只在 B 的 case 会被跳过。

每个 `EvaluationRun` 可以有多个 config（如 `config-0` = baseline, `config-1` = causal）。对比时通过 `configAId` / `configBId` 精确筛选，未指定时使用各 run 的第一个 config。

### 2.4 compareEvaluationConfigs：多配置对比

`compareEvaluationConfigs` 在同一 evaluation run 内比较多组 config（比如 `record_only` / `advisory` / `enforcing`），内部为每对 config 调用 `compareEvaluationRuns`，按 net lift 排名。

```typescript
MultiConfigComparison {
  configs: ["record_only", "advisory", "enforcing"];
  caseComparisons: CaseComparison[];
  metricAggregates: MetricAggregate[];
  netLiftByConfig: Record<string, number>;
  verdictByConfig: Record<string, ComparisonVerdict>;
}
```

对应输出格式：

- `compareEvaluationRuns()`：双 run / 双 config 对比
- `compareEvaluationConfigs()`：同一 evaluation run 内多 config 对比
- `formatComparisonReport()`：A/B 报告
- `formatMultiConfigReport()`：three-way / multi-config 报告

### 2.5 对比的边界

Evaluation Compare 对比的是已完成的评测 run，它本身不执行模型或工具——评测执行由外部 scheduler 或 CLI 触发。Case 按 `caseId` 精确匹配，两个 run 必须使用同一 dataset 才能得出有意义的对比。

## 3. Net Lift：结果优先的综合净收益

### 3.1 三层信号

Net Lift 综合三层信号，结果优先：

| 类别 | 指标 | 含义 |
| --- | --- | --- |
| 结果 | `task_success_rate` | 任务是否按 success criteria 真正完成 |
| 结果 | `llm_judge_score` | 最终答案质量评分；带 provenance（见 3.3） |
| 结果 | `counterfactual_lift` | 干预是否带来可观察的结果提升 |
| 过程 | `effective_intervention` | 干预是否起到了正确作用 |
| 过程 | `intent_resolution` | 是否理解并完成了用户真实意图 |
| 过程 | `clarification_precision` | 澄清是否精准而非噪音 |
| 风险 | `over_action` | 是否出现不必要的动作或过度干预 |
| 成本 | token / latency / tool cost | 提升是否以不可接受的成本换来 |

```typescript
NetLift {
  outcomeLift: number;   // 结果质量提升
  decisionLift: number;  // 决策质量提升
  costPenalty: number;   // 成本惩罚
  netLift: number;       // outcomeLift + decisionLift - costPenalty
}
```

### 3.2 计算逻辑

`computeNetLift()` 按三步推导：

1. **先看 outcome**：`task_success_rate`、`llm_judge_score`、`counterfactual_lift` 的权重最高
2. **再看 intervention quality**：`effective_intervention`、`intent_resolution`、`clarification_precision` 用来解释"为什么好/不好"
3. **最后扣掉风险和成本**：过度操作、明显的 token / latency / tool cost 增长按 penalty 处理

Net Lift 不是固定公式，结果信号权重最高，但具体实现会随评估目标调整。它属于工程决策辅助工具，不是统计显著性检验。

### 3.3 llm_judge_score 的 provenance

`llm_judge_score` 显式记录来源，不同 provenance 的解释权重不同：

- `explicit_llm_judge`：spec 声明了 `kind: "llm_judge"` evaluator 并成功返回评分
- `auto_llm_judge`：spec 没有手写 evaluator，但请求了 `llm_judge_score`，runner 根据 judge config 自动合成了 judge evaluator
- `heuristic_proxy`：未配置可用 judge，或 judge 调用失败，metric 回退到 heuristic proxy

前两种 provenance 可以当作真正的 judge outcome 信号，`heuristic_proxy` 则是代理信号，报告中会区分对待。

### 3.4 Resolver-aware 工具质量指标

评估还会追踪一组工具面的健康指标，回答"这次 run 是否按期望的工具工作流在做事"：

| 指标 | 含义 | 关注点 |
| --- | --- | --- |
| `visible_surface_shrinkage` | root resolver 是否显著收窄默认 visible surface | 是否仍把过宽工具面暴露给 root agent |
| `explore_first_score` | 是否先进入高层 Explore 入口 | 是否优先用 `repo.explore` 等高层入口 |
| `atomic_tool_hops` | 原子 read/list/grep/glob hop 是否过多 | 是否靠大量低层文件 hop 拼仓库理解 |
| `first_locate_success` | 第一次 locate 是否拿到可用证据 | `repo.explore` 的定位质量 |
| `shell_explore_restraint` | shell 是否被当作默认探索入口 | 是否绕过 resolver 设计，把 shell 当侦察工具 |

这些指标的解释边界：它们是 resolver-aware / family-aware 的工作流质量信号，不是任务成功率的替代品；当 `repo.explore` 本轮不可见时，部分指标按"允许原子 fallback"处理，不直接记为失败。

## 4. Verdict：A/B 与多配置判定

### 4.1 A/B verdict

双配置比较给出四种结论：

```typescript
type ComparisonVerdict =
  | "causal_wins"
  | "legacy_wins"
  | "mixed"
  | "inconclusive";
```

Verdict 综合三个维度：outcome 是否更好、成本是否可接受、数据是否足够完整。`missing_causal_data` 这类 failure 会把 verdict 推向 `inconclusive`——对比基础不完整，无法给出可靠结论。

`mixed` 表示在某些维度有改善、某些有退化，需要人工审查具体哪些 case 退化了。

### 4.2 Three-way 判定

同一 spec 下同时跑 `record_only` / `advisory` / `enforcing` 三档 gate 配置时，系统关注：哪个 config 的 outcome 最稳、哪个带来的 over-action / cost penalty 最小、哪个 config 的 failure tags 最集中暴露 semantic gap。

Three-way 产出的不是"永远唯一正确的模式"，而是：
- config 之间的 pairwise compare
- 每个 config 的 net lift
- 每个 config 的 failure profile
- 最终推荐或 `mixed` 结论

Three-way 经常用来回答"哪档 gate 更适合当前 workload"，而不是宣布一种模式永久胜出。

## 5. Failure Taxonomy：失败分类体系

Failure tags 沿两条边界组织：

- **semantic-state gap**：没理解任务
  - `latent_goal_missing`
  - `latent_goal_mismatch`
  - `under_clarification`
- **intervention / outcome gap**：理解了但动作或结果不对
  - `wrong_intervention`
  - `over_clarification`
  - `over_action`
  - `low_counterfactual_lift`
  - `poor_outcome_quality`

这样分类的目的是把"没理解任务"和"理解了但做错了"分开，让 feedback loop 沿这条边界聚合 insight，区分需要改进语义建模的场景和需要调整干预策略的场景。

## 6. 输入：数据集与评估规范

### 6.0 Fixture workspace authority

当 spec 通过 `metadata.fixtureManifest` 请求隔离 workspace 时，runner 的责任不是“复制一份目录”，而是“交付一个可运行、可遍历、可写入的独立 workspace”。这条 authority 有三个要求：

- **源码复制与依赖准备分开**：像 Ora 这样的 pnpm monorepo，`node_modules` 里存在大量依赖宿主仓库 `.pnpm` 布局的符号链接。直接复制这些链接并不能得到可运行副本，因此 fixture 需要先复制源码树，再在副本内重建依赖
- **主聊天/工具读取的是物化后 workspace**：注入给 runtime 的 `projectWorkspace.rootPath` 必须指向 preparation 完成后的副本，而不是半成品目录
- **工具层 hardening 只是降级保护**：`file.glob` / `file.list` 可以在极端情况下跳过 dangling symlink，但这不改变 fixture authority。只要 fixture 声称自己提供的是可运行 workspace，runner 就必须在 attempt 启动前完成验证

对当前 memory 长任务 A/B fixture，runner 会复制源码树、排除所有 `node_modules`，然后在副本根目录执行 `pnpm install --frozen-lockfile`，最后验证关键依赖路径存在且没有逃逸到 workspace 外的符号链接。

### 6.1 目录结构

```
evaluation/
├── specs/
│   ├── causal-ab-comparison.spec.json   # A/B 对比评估规范
│   ├── causal-smoke-three-way.json      # record_only / advisory / enforcing 冒烟比较
│   ├── causal-full-three-way.json       # 三配置完整比较
│   └── ...                              # 共 11 个 spec 文件
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
│   ├── tau-bench-dataset.json                     # Tau-Bench 基准
│   └── ...                                        # 共 24 个数据集文件
└── scripts/                                        # 执行脚本
```

### 6.2 数据集覆盖维度

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

评估数据集独立于 runtime 代码，`evaluation/datasets/` 中的 JSON 文件不参与 runtime 构建，修改数据集不需要重新编译。

## 7. 输出：报告

### 7.1 Markdown 报告

`formatComparisonReport(report, "markdown")` 生成结构化 Markdown 报告，包含：

1. **Overview**：总体得分、通过率、平均耗时、平均成本对比
2. **Metric Deltas**：各指标均值差异、中位差异、win/loss rate
3. **Net Lift**：outcome / intervention / cost 的综合结果
4. **Verdict**：总体结论 + fairness / missing-data 提示
5. **Case-Level Summary**：improved/degraded/unchanged 计数 + 退化最明显的 case
6. **Resolver-aware Recommended Actions**：当 visible surface、explore-first workflow、`repo.explore` locate 质量或 shell restraint 表现差时，报告给出结构化改进建议

### 7.2 Multi-config 报告

`formatMultiConfigReport()` 在 A/B 之外补充：

- config 排名
- pairwise outcome / cost 对照
- 每个 config 的主要 failure tags
- resolver-aware recommended actions
- 对 `record_only` / `advisory` / `enforcing` 的推荐结论

### 7.3 JSON 输出

`formatComparisonReport(report, "json")` 输出完整 JSON 序列化结果，包含原始数据和计算中间值，适合本地排查、切片复核和程序化分析。`evaluation/reports/` 默认只归档面向人工阅读的 markdown 报告，不需要同步保存 `.json` 副本。

## 核心源码文件

| 文件 | 职责 |
| --- | --- |
| `apps/runtime/src/evaluation-compare.ts` | A/B / multi-config 对比核心：`compareEvaluationRuns()`、`compareEvaluationConfigs()`、Net Lift、verdict |
| `apps/runtime/src/evaluation-store.ts` | Evaluation run 存储、causal observation、outcome metrics、failure tags |
| `apps/runtime/src/feedback-loop-store.ts` | 从 failure tags 聚合 semantic/intervention insight |
| `evaluation/specs/` | 评估规范定义（JSON spec 文件） |
| `evaluation/datasets/` | 评估数据集（JSON 数据集文件） |
| `evaluation/scripts/` | 评估执行脚本 |
