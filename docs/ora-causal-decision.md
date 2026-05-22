# Ora Causal Decision：五层因果决策系统

Ora 的 Causal Decision 是一套贯穿 runtime、Trail、Evaluation 和 feedback loop 的五层系统，而不是单一的策略路由器。

## 阅读地图

| 关注点 | 对应章节 |
| --- | --- |
| 为什么需要这套系统 | [1. 系统定位与设计目标](#1-系统定位与设计目标) |
| 五层如何协作 | [2. 五层架构与设计逻辑](#2-五层架构与设计逻辑) |
| 关键设计决策 | [3. 关键设计决策](#3-关键设计决策) |
| runtime 决策如何产生 | [4. Policy Router（第一层）](#4-policy-router第一层) |
| 门控如何控制执行 | [5. Control-flow Gating（第二层）](#5-control-flow-gating第二层) |
| Trail 和 evaluation 为什么都看 episode | [6. Episode Semantics（第三层）](#6-episode-semantics第三层) |
| 评估怎么比较策略优劣 | [7. Evaluation 与 Comparison（第四层）](#7-evaluation-与-comparison第四层) |
| failure 如何回流成 insight | [8. Feedback Loop（第五层）](#8-feedback-loop第五层) |
| 当前边界与已知限制 | [9. 当前边界](#9-当前边界) |

## 核心文件

| 文件 | 职责 |
| --- | --- |
| `apps/runtime/src/harness/causal-policy-router.ts` | runtime 因果策略路由、风险判断、`applyCausalPolicyGate()` |
| `apps/runtime/src/harness/causal-task-state-extractor.ts` | 低频混合语义提取，生成 `Partial<CausalTaskState>` |
| `apps/runtime/src/harness/causal-decision-adapter.ts` | legacy trace -> pseudo causal decisions |
| `packages/shared/src/causal-intervention-episodes.ts` | `deriveCausalInterventionEpisodes()` 共享 episode 语义层 |
| `apps/runtime/src/evaluation-store.ts` | causal observation、metrics、failure tags |
| `apps/runtime/src/evaluation-compare.ts` | A/B compare、three-way config compare、Net Lift、显著性 |
| `apps/runtime/src/feedback-loop-store.ts` | causal insight 归因与推荐动作 |
| `apps/desktop/src/lib/trailViewModel.ts` | Trail 面板消费 episode 并默认过滤无效 follow-up |

## 1. 系统定位与设计目标

### 1.1 系统定位

Causal Decision 在 Ora 里是一种产品能力，不是一个独立技巧。它覆盖了从 runtime 决策、Trail 可解释性、Evaluation 策略比较到 feedback 回流的完整闭环。当前 runtime 默认使用 `router-v2` 路由，若需要阶段性回滚，可通过 `RunConfig.metadata.causalRouterVersion = "v1"` 恢复旧路由。

### 1.2 解决的核心问题

在 Causal Decision 之前，Agent 的决策过程存在几个结构性缺陷：

- **决策不可解释**：Agent 选择某个动作（搜索、澄清、直接回答）的原因没有结构化记录，事后无法审查
- **Trail 与 Evaluation 语义分裂**：Trail 面板看到的"Agent 为什么这么做"和 Evaluation 指标计算的依据是两套东西
- **无反馈闭环**：评估发现的失败模式无法系统性地回流到策略改进
- **无法客观比较策略**：`record_only`、`advisory`、`enforcing` 三种门控级别在不同任务上的效果差异没有量化手段

### 1.3 设计目标

- **闭环**：decision -> recording -> evaluation -> feedback -> improved decisions
- **保守默认**：生产环境默认 `record_only`，实验和验证再显式升级，避免未充分验证的 gate 直接改变所有运行行为
- **优雅降级**：语义提取失败不影响 run 的成败，provider 不可用时自动回退到启发式规则
- **共享语义**：Trail 和 Evaluation 消费同一套 episode 语义层，不再各自解析 raw events
- **Gap 分类**：把"没理解任务"（semantic gap）和"动作选错了"（intervention gap）分开，对应不同的改进路径

## 2. 五层架构与设计逻辑

### 2.1 数据流全景

```text
prompt / clarification / tool context
  -> causal task-state extractor
  -> routeIntervention()
  -> causal.decision.recorded
  -> deriveCausalInterventionEpisodes()
  -> evaluation metrics + failure tags
  -> feedback-loop insights
```

### 2.2 五层概览

1. **Policy Router**：`routeIntervention()` 根据目标不确定性、事实不确定性、上下文不确定性、行动风险来推荐下一步动作
2. **Control-flow Gating**：`causalInterventionLevel` 决定推荐动作是只记录、部分阻塞，还是强制进入 gate
3. **Episode Semantics**：`deriveCausalInterventionEpisodes()` 把 raw decision / gate / tool / answer 串成可解释的干预 episode
4. **Evaluation and Comparison**：不再只看"是否发过 decision event"，而是看 episode、结果指标、三维对照和 Net Lift
5. **Feedback Loop and Insights**：failure tags 聚合为 semantic gap / intervention gap 两类 insight，进入后续自迭代与 dataset 补样

### 2.3 层间协作

每层的输出是下一层的输入：

- Layer 1 产出 action + policyDecision + decisionRecord，交给 Layer 2
- Layer 2 根据门控级别决定哪些推荐实际生效，被 gate 拦截的发出 `causal.decision.rejected`，通过的发出 `causal.decision.recorded`
- Layer 3 消费所有 recording 事件，结构化为 episode，统一 Trail 和 Evaluation 的语义入口
- Layer 4 消费 episode 产出指标和 failure tags
- Layer 5 消费 failure tags 产出 insight，回馈到 Layer 1 的策略迭代和 Layer 3 的语义提取改进

## 3. 关键设计决策

### 3.1 默认保守策略

`causalInterventionLevel` 默认值是 `record_only`，生产环境只记录不干预。需要 `advisory` 或 `enforcing` 时显式升级。这样可以在不改变现有运行行为的前提下积累决策数据，等验证充分后再逐步放量。

### 3.2 Episode 作为共享语义层，而非交互权威

`deriveCausalInterventionEpisodes()` 是 Trail 和 Evaluation 的共同语义层，但它不直接驱动 UI 交互状态。UI 交互态仍以 snapshot / gate projection 为权威，episode 用于解释和评估。这样两条路径各自保持独立的一致性约束。

### 3.3 best-effort 语义提取

`CausalTaskState` 的提取策略是低频混合：先用启发式补基础字段（`surfaceRequest`、`keyUncertainties`、`confidence` 等），只在 `run_start`、`clarification_resume`、首次关键 `tool_request` 且 `selectedLatentGoal` 仍为空时才尝试 LLM 提取。provider 不可用、JSON 不合法、解析失败时自动回退，不让 run 失败。

### 3.4 native vs legacy 双轨

Native causal run 有真实 semantic extractor，`selectedLatentGoal`、`constraints` 等字段逐步可用。Legacy adapter 以 trace 行为拟合为主，只保证动作近似，不保证同等级的语义丰富度。Evaluation 把这两条轨道的缺失和偏差分开对待。

### 3.5 three-way comparison 与 dual reporting 的取舍

Evaluation 支持同一 spec 下比较 `record_only`、`advisory`、`enforcing` 三种配置。dual reporting 的设计重点不是"同一 case 用两套 scorer 重算两次"，而是让 dataset 能把旧 oracle 更在意的 case 和 value-aligned case 切开看，解释为什么某些 rollout 在旧口径和新口径下会出现分歧。

推荐分析顺序：先看 `reportingMembership` 判断显式 split 子集和 shared default 子集方向是否一致，再看 `legacy_oracle_result` / `value_aligned_result` 作为 aggregate 视角，最后下钻 `contextProbeClass` / `freshnessClass` 定位差异来源。当前阶段不默认渲染 `reportingView x reportingMembership` 的完整交叉矩阵，因为 `reportingMembership` 已经能说清 aggregate 被 shared default 稀释的问题，直接上交叉矩阵增加展示复杂度但不一定增加决策信息。

### 3.6 failure taxonomy 的两类 gap

Failure tags 按根因分为两类：semantic-state gap（`latent_goal_missing`、`latent_goal_mismatch`、`under_clarification`）指向"没理解任务"，对应语义提取和澄清策略的改进；intervention gap（`wrong_intervention`、`over_clarification`、`over_action`、`low_counterfactual_lift`、`poor_outcome_quality`）指向"动作选错了或效果不好"，对应 policy router 和结果质量的改进。

## 4. Policy Router（第一层）

### 4.1 `routeIntervention()`

`routeIntervention(input)` 是 runtime 主决策点，同时产出：

- `action`
- `policyDecision`
- `decisionRecord`

当前 runtime 默认使用 `router-v2`。若需要阶段性回滚，可通过 `RunConfig.metadata.causalRouterVersion = "v1"` 显式恢复旧路由。

### 4.2 动作优先级

```text
high action risk                      -> request_approval
high fact uncertainty                 -> search_web
unresolved plan without proposed tool -> plan
high context uncertainty              -> read_context
high goal uncertainty                 -> clarify
tool already proposed                 -> use_tool
diminishing returns                   -> stop
otherwise                             -> answer_directly
```

## 5. Control-flow Gating（第二层）

### 5.1 `causalInterventionLevel`

`RunConfig.causalInterventionLevel` 有三个级别：

| 级别 | 行为 |
| --- | --- |
| `record_only` | 只记录 `causal.decision.recorded`，不改执行 |
| `advisory` | 阻塞最强信号，如 `request_approval` / `stop` |
| `enforcing` | 非 `use_tool` / `answer_directly` 的推荐会真正拦住当前工具请求 |

默认值是 `record_only`，生产环境保持保守，实验和验证时显式升级。

### 5.2 记录点

以下 phase 会发出 `causal.decision.recorded`：

- `run_start`
- `tool_request`
- `completion`
- `clarification_resume`
- `clarification_triggered`
- `approval_triggered`
- `plan_updated`

被 gate 真正拦住时还会发出 `causal.decision.rejected`。

## 6. Episode Semantics（第三层）

### 6.1 `CausalTaskState` 共享 Schema

核心字段：

- `surfaceRequest`
- `latentGoalHypotheses`
- `selectedLatentGoal`
- `keyUncertainties`
- `constraints`
- `candidateInterventions`
- `counterfactualRiskIfSkipped`
- `expectedOutcomeLift`
- `confidence`
- `stopCondition`

### 6.2 语义提取策略

`apps/runtime/src/harness/causal-task-state-extractor.ts` 负责生成 `Partial<CausalTaskState>`，策略是低频混合提取：

- 先用启发式补基础字段：`surfaceRequest`、`keyUncertainties`、`confidence`、clarification 带来的 `counterfactualRiskIfSkipped`
- 只在低频关键点尝试一次 LLM semantic extraction：`run_start`、`clarification_resume`、第一次关键 `tool_request` 且 `selectedLatentGoal` 仍为空
- provider 不可用、JSON 不合法、解析失败时自动回退，不让 run 失败

### 6.3 `deriveCausalInterventionEpisodes()`

`packages/shared/src/causal-intervention-episodes.ts` 是 Trail 和 Evaluation 的共同语义层。它把主决策、runtime follow-up 补记、gate 触发、tool / answer 结果整理成结构化 episode，而不是让每个消费方自己扫 raw events。

### 6.4 消费原则

- Trail 默认只展示 `effective === true` 的 episode
- `runtime_followup` 噪音默认隐藏
- Evaluation 里的 causal metrics 也优先消费有效 episode

"Agent 干预决策"面板看到的和 metric 看到的，不再是两套语义。

### 6.5 native vs legacy 双轨

- **native causal run**：有真实 semantic extractor，`selectedLatentGoal`、`constraints` 等字段逐步可用
- **legacy adapter**：以 trace 行为拟合为主，只保证动作近似，不保证同等级的语义丰富度

Evaluation 把 native semantic 缺失和 legacy 行为拟合分开对待。

## 7. Evaluation 与 Comparison（第四层）

### 7.1 结果导向指标

当前 causal evaluation 的关键指标：

- `intent_resolution`
- `clarification_precision`
- `effective_intervention`
- `over_action`
- `counterfactual_lift`
- `task_success_rate`
- `llm_judge_score`

`task_success_rate` 用 successCriteria + 规则匹配 / fallback 评估任务是否完成，`llm_judge_score` 是结果质量评分。Net Lift 已调整为结果优先，不再主要依赖过程启发式。

### 7.2 three-way comparison

评估层支持同一 spec 下比较 `record_only`、`advisory`、`enforcing` 三种配置。核心入口：

- `compareEvaluationRuns()`
- `compareEvaluationConfigs()`
- `formatComparisonReport()`
- `formatMultiConfigReport()`

对应 spec 文件：

- `evaluation/specs/causal-smoke-three-way.json`
- `evaluation/specs/causal-full-three-way.json`
- `evaluation/specs/causal-ab-comparison.spec.json`

### 7.3 dual reporting 与 dataset split

Dual reporting 结构包括：

- `reportingMembership`：把显式标注的 split case（`explicit_reporting_view`）和未标注、会同时进入两条 view 的 shared case（`shared_default_view`）分开看，主要用途是判断 aggregate 是否被 shared default 大盘稀释
- `EvaluationScorecard.reportingViews`：内建 `legacy_oracle_result` 与 `value_aligned_result` 两种视角
- `report.scorecard.slices`：除了原有 tag / taskType / difficulty，还按 `reportingMembership`、`reportingView`、`scenario`、`uncertaintyType`、`contextProbeClass`、`freshnessClass` 等维度聚合
- `decisionSurface`：如果 dataset metadata 没显式填写，自动从 `expected.structured.expectedIntervention` 推断
- rollout guard：该结构目前 behind `spec.metadata.evalV2Reporting === true`，便于 Stage 3 单独回滚

### 7.4 failure taxonomy

因果相关 failure tags 分为两类：

**semantic-state gap**：

- `latent_goal_missing`
- `latent_goal_mismatch`
- `under_clarification`

**intervention / outcome gap**：

- `wrong_intervention`
- `over_clarification`
- `over_action`
- `low_counterfactual_lift`
- `poor_outcome_quality`

兼容旧 tag 的同时，新的 tags 用于把"没理解任务"与"动作做错了"分开。

## 8. Feedback Loop（第五层）

`apps/runtime/src/feedback-loop-store.ts` 把 causal evaluation 失败拆成两类 insight：

### 8.1 `causal_semantic_state_gap`

聚合 `latent_goal_missing`、`latent_goal_mismatch`、`under_clarification`，指向：

- latent goal 没被稳定写出来
- 澄清策略没真正补上关键变量
- semantic extractor / clarification prompt 需要迭代

### 8.2 `causal_intervention_gap`

聚合 `wrong_intervention`、`over_clarification`、`over_action`、`low_counterfactual_lift`、`poor_outcome_quality`，指向：

- policy router 选错动作
- 动作虽然发生了，但结果没有 lift
- outcome quality 仍不够好

两类 insight 复用现有动作体系，不新增 RPC 或专用 UI 面板。

## 9. 当前边界

1. **semantic extraction 是 best-effort，不是强一致依赖**：provider 不可用时会回退到 heuristics，run 不会因为 semantic extraction 失败而失败

2. **legacy adapter 仍是近似值**：adapter 适合做 A/B 对照，不适合当作高保真 semantic truth

3. **默认生产模式仍然保守**：`record_only` 还是默认值，避免还未充分验证的 gate 直接改变所有运行行为

4. **episode 已经是共享语义层，但不是交互状态权威**：UI 交互态仍然以 snapshot / gate projection 为权威；episode 用于解释和评估，不直接驱动交互状态

5. **failure taxonomy 刚进入可用阶段**：现在已经能区分 semantic gap 与 intervention gap，但还不是完整的长期研究分类法
