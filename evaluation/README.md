# Ora 评估系统

Ora 质量保障和因果策略验证的核心基础设施。两层职责：

1. **回归守卫**：确保模式、prompt、工具策略变更不会导致质量退化
2. **因果 A/B 对比**：量化 causal mainline agent 相对于 legacy baseline 的净提升

评估是 Self-Iteration 闭环的评测门控（Evaluation Gate），也是 Mode Studio 变更的验证手段。

## 目录结构

```
evaluation/
├── datasets/          # JSON 数据集（测试用例集合）
├── fixtures/          # 评估隔离工作区与 fixture manifest
├── scripts/           # 运行脚本
│   └── run-ab-comparison.sh   # A/B 对比一键脚本
└── specs/             # 评估规格文件
    └── causal-ab-comparison.spec.json
```

运行时核心代码（`apps/runtime/src/`）：

| 文件 | 职责 |
| --- | --- |
| `evaluation-compare.ts` | A/B 对比核心：compareEvaluationRuns、Net Lift、verdict |
| `evaluation-store.ts` | Evaluation run 存储管理 |
| `evaluation-blueprint-draft.ts` | AI 辅助生成评估蓝图 |

## 数据集

### 覆盖维度

| 维度 | 数据集 | 关注点 |
| --- | --- | --- |
| 因果决策 | causal-intervention-decision | 干预选择准确性 |
| 输出质量 | output-quality, gaia | 回答正确性 |
| 工具使用 | tool-selection | 工具选择合理性 |
| 安全性 | safety-gate, approval-resume | 审批门控与恢复 |
| Memory | memory-reliability, memory-boundary, memory-long-task-representative | 记忆检索、边界与长任务收益 |
| 效率 | token-efficiency | 成本控制 |
| 鲁棒性 | multi-turn, terminal-bench | 多轮、终态处理 |
| 外部基准 | swe-bench, tau-bench | 第三方标准评测 |

完整数据集列表（23 个）：

| 数据集 | 用例数 | 说明 |
| --- | --- | --- |
| causal-intervention-decision | 101 | 因果决策质量（核心数据集） |
| auto-router | 54 | 自动路由模式选择 |
| tool-reliability | 36 | 工具调用正确性 |
| pattern-correctness | 33 | 五种协调模式拓扑行为 |
| e2e-task | 20 | 端到端任务完成 |
| safety-gate | 19 | 安全门禁系统 |
| fault-tolerance | 15 | 错误处理 |
| approval-resume | 14 | 审批/澄清门禁与恢复 |
| multi-turn | 14 | 多轮对话上下文保持 |
| output-quality | 15 | LLM 评委输出质量 |
| token-efficiency | 13 | Token 效率 |
| tool-selection | 12 | 最优工具选择（反模式检测） |
| self-iteration | 12 | 自我迭代改进 |
| memory-long-task-representative | 12 | 代表性长任务 memory 收益 |
| memory-boundary | 10 | 记忆边界行为 |
| memory-reliability | 10 | 记忆读写可靠性 |
| memory-long-task-smoke | 3 | 长任务 memory A/B 预检子集 |
| observability-replay | 9 | 可观测性追踪 |
| mode-studio | 9 | 模式选择与行为 |
| gaia | 6 | GAIA 风格适配器* |
| swe-bench | 6 | SWE-bench 风格适配器* |
| tau-bench | 6 | tau-bench 风格适配器* |
| terminal-bench | 6 | Terminal-Bench 风格适配器* |

> *标星号为基准适配数据集，非官方基准分割，仅供代表性任务测试。

### 数据集格式

```json
{
  "description": "数据集描述",
  "cases": [
    {
      "id": "case-id",
      "prompt": "给 agent 的自然语言指令",
      "expected": {
        "structured": {
          "assertions": [
            {
              "type": "exists | not_equals | one_of | contains | min | max | not_one_of",
              "path": "run.status",
              "value": "succeeded",
              "failureTag": "tag_name",
              "rationale": "断言原因"
            }
          ]
        }
      },
      "metadata": {
        "category": "分类",
        "difficulty": "easy | medium | hard"
      }
    }
  ]
}
```

### 断言类型

| 类型 | 说明 |
| --- | --- |
| `exists` | 路径值存在且非空 |
| `not_equals` | 路径值不等于指定值 |
| `one_of` | 路径值在允许列表中 |
| `not_one_of` | 路径值不在禁止列表中 |
| `contains` | 路径值包含指定子串 |
| `min` | 路径值 ≥ 指定最小值 |
| `max` | 路径值 ≤ 指定最大值 |

`path` 支持 JSON 路径表达式，可深入运行时追踪和效率账本：
- `run.status` — 运行结果
- `run.outputText` — Agent 最终输出
- `trace.events[]` — 运行时事件
- `runtime.efficiencyLedger` — 效率指标
- `runtime.modeId` — 选中的协调模式

## A/B 对比

核心功能是因果 A/B 对比流水线：对同一数据集在两个代码版本上运行评估，生成量化对比报告。

### Tool-System 指标

Visibility resolver phase-1 现在额外暴露 5 个工具系统质量指标：

- `visible_surface_shrinkage`: root resolver 是否显著收窄默认 visible surface
- `explore_first_score`: 任务是否先进入高层 Explore 入口，而不是直接落到底层执行
- `atomic_tool_hops`: `file.read/list/glob/grep` 这类原子 hop 是否仍然过多
- `first_locate_success`: 第一次 `repo.explore` 是否就拿到了可用定位证据
- `shell_explore_restraint`: `shell.execute` 是否仍被当作默认探索入口

这些指标会进入 evaluation metric 聚合，也会驱动 report 里的 resolver-aware recommended actions。

### 快速开始

```bash
# 默认配置运行
evaluation/scripts/run-ab-comparison.sh

# 指定 provider 和 model
evaluation/scripts/run-ab-comparison.sh --provider anthropic --model claude-sonnet-4-20250514

# 指定 legacy 基准 commit
evaluation/scripts/run-ab-comparison.sh --legacy-ref abc123def

# 保存报告
evaluation/scripts/run-ab-comparison.sh --output /tmp/ab-report.md
```

脚本流程：自动检测 legacy commit → 导入数据集 → 在当前 commit 运行评估 → checkout legacy commit 重新构建并运行评估 → 切回当前 commit 重新构建 → 对比两次运行输出报告。

### CLI 命令

```bash
# 导入数据集
node apps/runtime/dist/cli.js eval import --file <dataset.json>

# 运行评估
node apps/runtime/dist/cli.js eval run --spec <spec.json>

# 列出评估运行记录
node apps/runtime/dist/cli.js eval list

# 对比两次运行
node apps/runtime/dist/cli.js eval compare --run-a <id> --run-b <id> --format markdown
```

### Long Task Memory A/B

首版长任务 memory A/B 产物：

- 数据集：
  - `evaluation/datasets/memory-long-task-smoke-dataset.json`
  - `evaluation/datasets/memory-long-task-representative-dataset.json`
- 规格：
  - `evaluation/specs/memory-long-task-smoke-ab.json`
  - `evaluation/specs/memory-long-task-full-ab.json`
- fixture：
  - `evaluation/fixtures/memory-long-task-representative/fixture.manifest.json`

运行步骤：

```bash
# 1. 导入 smoke / full 数据集，记录返回的 datasetId
node apps/runtime/dist/cli.js eval import --file evaluation/datasets/memory-long-task-smoke-dataset.json
node apps/runtime/dist/cli.js eval import --file evaluation/datasets/memory-long-task-representative-dataset.json

# 2. 将 spec 中的 datasetId 占位符替换为实际值

# 3. 先跑 smoke，再跑 full
node apps/runtime/dist/cli.js eval run --spec evaluation/specs/memory-long-task-smoke-ab.json
node apps/runtime/dist/cli.js eval run --spec evaluation/specs/memory-long-task-full-ab.json
```

### Fixture 隔离

- 当 spec `metadata.fixtureManifest` 指向一个 fixture manifest 时，evaluation runner 会在每个 attempt 开始前复制一份隔离 workspace
- 长任务 memory A/B 当前使用 `workspace_copy_per_attempt` 策略，materialize 到：
  - `evaluation/fixtures/memory-long-task-representative/workspaces/<evaluationRunId>/<caseId>/<configId>/rep-<n>/`
- 这样可以避免：
  - case 之间文件改动串扰
  - `memory-disabled` 与 `memory-enabled` 共享同一工作区
  - smoke / full 批次互相污染中间产物

## 对比引擎：compareEvaluationRuns

### 对比流程

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

### Config 筛选

每个 `EvaluationRun` 可以有多个 config（如 `config-0` = baseline, `config-1` = causal）。对比时：
- 可指定 `configAId` / `configBId` 精确筛选
- 未指定时使用第一个 config

### Case 匹配

仅对比两个 run 中 `caseId` 相同的 case。只在 A 或只在 B 的 case 被跳过。

### 核心类型

**CaseComparison**（单 case 对比）：

```typescript
CaseComparison {
  caseId: string;
  scoreA: number;           // Baseline 总分
  scoreB: number;           // Target 总分
  delta: number;            // scoreB - scoreA
  direction: "improved" | "degraded" | "unchanged";
  metricDeltas: MetricDeltaEntry[];
  failureTagsA: string[];
  failureTagsB: string[];
}
```

**MetricAggregate**（跨 case 聚合）：

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

## Net Lift：净提升评估

### 计算公式

```
outcomeLift =
  effective_intervention * 0.4 +
  intent_resolution * 0.2 +
  counterfactual_lift * 0.2

decisionLift = clarification_precision * 0.2

costPenalty =
  |min(0, over_action)| * 0.1 +
  max(0, costRatio) * 0.1
  // costRatio = (avgCostB - avgCostA) / avgCostA

netLift = outcomeLift + decisionLift - costPenalty
```

### 指标权重

| 指标 | 权重 | 含义 |
| --- | --- | --- |
| `effective_intervention` | 0.4 | 干预是否有效解决了用户问题 |
| `intent_resolution` | 0.2 | 用户意图是否被正确理解并完成 |
| `counterfactual_lift` | 0.2 | 反事实推理的质量提升 |
| `clarification_precision` | 0.2 | 澄清问题的准确性 |
| `over_action` | 0.1（惩罚） | 是否有不必要的过度操作 |
| costRatio | 0.1（惩罚） | 成本相对增长 |

## Verdict：六条件判定

### 判定条件

| # | 条件 | 阈值 | 不通过的含义 |
| --- | --- | --- | --- |
| 1 | effective_intervention 明显提升 | Δ ≥ +10% | 干预有效性无明显改善 |
| 2 | intent_resolution 不下降 | Δ ≥ -5% | 意图理解退化 |
| 3 | over_action 不明显恶化 | Δ ≥ -10% | 过度操作增加 |
| 4 | 最终答案质量不下降 | improved ≥ degraded | 更多 case 退化而非改善 |
| 5 | 成本增长可接受 | token_efficiency Δ ≥ -30% | 成本超出可接受范围 |
| 6 | 无 missing_causal_data 类 failure | 零出现 | 对比不公平（缺少 causal data） |

### 判定逻辑

```
passedCount === 6  → "causal_wins"    // Causal Mainline 胜出
passedCount >= 4   → "mixed"          // 互有胜负
netLift > 0        → "mixed"          // 净提升为正但未到全通过
否则               → "legacy_wins"    // Legacy 更优
```

## 报告输出

`formatComparisonReport(report, "markdown")` 生成 Markdown 报告，包含：

1. **Overview**：总体得分、通过率、平均耗时、平均成本对比
2. **Metric Deltas**：所有指标的名称、均值差异、中位差异、win/loss rate
3. **Net Lift**：三项分量的数值
4. **Verdict**：六条件清单（checkbox）+ 总体判定
5. **Case-Level Summary**：improved/degraded/unchanged 计数 + Top 10 退化 case

`formatComparisonReport(report, "json")` 输出完整 JSON，包含所有原始数据和计算中间值。

## 常见误解与边界

1. **Evaluation Compare 不执行评测**。`compareEvaluationRuns` 对比已完成的评测 run 的结果，它本身不运行模型或工具。评测执行由外部 scheduler 或 CLI 触发。

2. **Case 按 caseId 精确匹配**。两个 run 必须使用相同的 dataset 才能对比。如果 run B 有 run A 不存在的 case，这些 case 会被忽略。

3. **Net Lift 是加权线性模型**。权重（0.4/0.2/0.2/0.1）是初始值，可随因果策略的迭代调整。这不是统计显著性检验，而是一个实用的决策辅助工具。

4. **Verdict 不是绝对的"好坏"判断**。`mixed` 意味着在某些维度有改善、某些有退化，需要人工审查具体哪些 case 退化来判断是否可接受。

5. **missing_causal_data 条件保证对比公平性**。如果任何一个 case 缺少 causal data，整个 verdict 条件 6 不通过 —— 此时对比结果不可信。

6. **评估数据集独立于 runtime 代码**。`evaluation/datasets/` 中的 JSON 文件是评估的输入数据，不参与 runtime 构建。修改数据集不需要重新编译。

## 开发

```bash
cd apps/runtime
pnpm install
pnpm build
pnpm vitest run   # 运行测试
```
