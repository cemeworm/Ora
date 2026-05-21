# Ora Causal Decision：当前结构说明

Ora 的 Causal Decision 已经不是单一的策略路由器，而是一套贯穿 runtime、Trail、Evaluation 和 feedback loop 的五层系统。

> **最近更新（2026-05-21）**：`router-v2` 已成为 runtime 默认主线，`freshness_block_policy` 与 `context_probe_policy` 仍保留为显式实验开关；最新 isolated smoke 只支持继续保守保留 `router-v2`，暂不支持把两类 Stage 2 boundary 作为默认行为放量。

## 阅读地图

| 关注点 | 对应章节 |
| --- | --- |
| 系统全貌 | [1. 五层系统总览](#1-五层系统总览) |
| runtime 决策如何产生 | [2. Runtime 主链路](#2-runtime-主链路) |
| `CausalTaskState` 现在怎么填 | [3. 语义状态提取](#3-语义状态提取) |
| Trail 和 evaluation 为什么都看 episode | [4. Episode 共享语义](#4-episode-共享语义) |
| 评估怎么比较策略优劣 | [5. Evaluation 与 Comparison](#5-evaluation-与-comparison) |
| failure 如何回流成 insight | [6. Feedback Loop](#6-feedback-loop) |
| 当前边界与已知限制 | [7. 当前边界](#7-当前边界) |

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

## 1. 五层系统总览

当前 Causal Decision 的完整链路是：

```text
prompt / clarification / tool context
  -> causal task-state extractor
  -> routeIntervention()
  -> causal.decision.recorded
  -> deriveCausalInterventionEpisodes()
  -> evaluation metrics + failure tags
  -> feedback-loop insights
```

这五层分别是：

1. **Policy Router**
   `routeIntervention()` 根据目标不确定性、事实不确定性、上下文不确定性、行动风险来推荐下一步动作。
2. **Control-flow Gating**
   `causalInterventionLevel` 决定推荐动作是只记录、部分阻塞，还是强制进入 gate。
3. **Episode Semantics**
   `deriveCausalInterventionEpisodes()` 把 raw decision / gate / tool / answer 串成可解释的干预 episode。
4. **Evaluation and Comparison**
   Evaluation 不再只看“是否发过 decision event”，而是看 episode、结果指标、三维对照和 Net Lift。
5. **Feedback Loop and Insights**
   failure tags 会继续聚合为 semantic gap / intervention gap 两类 insight，进入后续自迭代与 dataset 补样。

## 2. Runtime 主链路

### 2.1 `routeIntervention()`

`routeIntervention(input)` 是 runtime 主决策点。它会同时产出：

- `action`
- `policyDecision`
- `decisionRecord`

当前 runtime 默认使用 `router-v2`。若需要阶段性回滚，可通过 `RunConfig.metadata.causalRouterVersion = "v1"` 显式恢复旧路由。

动作优先级当前是：

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

### 2.2 `causalInterventionLevel`

`RunConfig.causalInterventionLevel` 仍然是三档：

| 级别 | 行为 |
| --- | --- |
| `record_only` | 只记录 `causal.decision.recorded`，不改执行 |
| `advisory` | 阻塞最强信号，如 `request_approval` / `stop` |
| `enforcing` | 非 `use_tool` / `answer_directly` 的推荐会真正拦住当前工具请求 |

默认值仍是 `record_only`。这意味着生产默认仍偏保守，实验和验证再显式升级。

### 2.3 记录点

当前会发出 `causal.decision.recorded` 的 phase：

- `run_start`
- `tool_request`
- `completion`
- `clarification_resume`
- `clarification_triggered`
- `approval_triggered`
- `plan_updated`

被 gate 真正拦住时还会发出 `causal.decision.rejected`。

## 3. 语义状态提取

### 3.1 `CausalTaskState`

共享 schema 没变，核心字段还是：

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

### 3.2 当前提取策略

`apps/runtime/src/harness/causal-task-state-extractor.ts` 现在负责生成 `Partial<CausalTaskState>`。

策略是 **低频混合提取**：

- 先用启发式补基础字段
  - `surfaceRequest`
  - `keyUncertainties`
  - `confidence`
  - clarification 带来的 `counterfactualRiskIfSkipped`
- 只在低频关键点尝试一次 LLM semantic extraction
  - `run_start`
  - `clarification_resume`
  - 第一次关键 `tool_request` 且 `selectedLatentGoal` 仍为空
- provider 不可用、JSON 不合法、解析失败时自动回退，不让 run 失败

### 3.3 native vs legacy

这里必须区分两条轨道：

- **native causal run**
  有真实 semantic extractor，`selectedLatentGoal`、`constraints` 等字段应该逐步变得可用。
- **legacy adapter**
  仍然以 trace 行为拟合为主，只保证“动作近似”，不保证同等级的 semantic richness。

这也是为什么 evaluation 现在会把 native semantic 缺失和 legacy 行为拟合分开对待。

## 4. Episode 共享语义

### 4.1 `deriveCausalInterventionEpisodes()`

`packages/shared/src/causal-intervention-episodes.ts` 现在是 Trail 和 Evaluation 的共同语义层。

它会把：

- 主决策
- runtime follow-up 补记
- gate 触发
- tool / answer 结果

整理成结构化 episode，而不是让每个消费方自己扫 raw events。

### 4.2 当前消费原则

- Trail 默认只展示 `effective === true` 的 episode
- `runtime_followup` 噪音默认隐藏
- evaluation 里的 causal metrics 也优先消费有效 episode

这意味着 “Agent 干预决策” 面板看到的和 metric 看到的，不再是两套语义。

## 5. Evaluation 与 Comparison

### 5.1 结果导向指标

当前 causal evaluation 已不是只看过程信号。

关键指标包括：

- `intent_resolution`
- `clarification_precision`
- `effective_intervention`
- `over_action`
- `counterfactual_lift`
- `task_success_rate`
- `llm_judge_score`

其中：

- `task_success_rate` 用 successCriteria + 规则匹配 / fallback 评估任务是否完成
- `llm_judge_score` 是结果质量评分

Net Lift 已调整成 **结果优先**，不再主要依赖过程启发式。

### 5.2 three-way comparison

评估层已经支持同一 spec 下比较：

- `record_only`
- `advisory`
- `enforcing`

核心入口在：

- `compareEvaluationRuns()`
- `compareEvaluationConfigs()`
- `formatComparisonReport()`
- `formatMultiConfigReport()`

当前仓库里也已经有对应 spec：

- `evaluation/specs/causal-smoke-three-way.json`
- `evaluation/specs/causal-full-three-way.json`
- `evaluation/specs/causal-ab-comparison.spec.json`

### 5.3 dual reporting 与 dataset split

Stage 3 现在已经补上了最小 dual reporting 结构：

- `reportingMembership`
  - 默认解释入口，先把显式标注的 split case（`explicit_reporting_view`）和未标注、会同时进入两条 view 的 shared case（`shared_default_view`）分开看
  - 主要用途不是替代 `legacy_oracle_result` / `value_aligned_result`，而是先判断 aggregate 是否被 shared default 大盘稀释
- `EvaluationScorecard.reportingViews`
  - 当前内建两种视角：`legacy_oracle_result` 与 `value_aligned_result`
- `report.scorecard.slices`
  - 除了原有 tag / taskType / difficulty，现还会按 `reportingMembership`、`reportingView`、`scenario`、`uncertaintyType`、`contextProbeClass`、`freshnessClass` 等维度聚合
- `decisionSurface`
  - 如果 dataset metadata 没显式填写，会自动从 `expected.structured.expectedIntervention` 推断，避免为了切片把所有旧 case 全手工重写一遍
- rollout guard
  - 该结构目前 behind `spec.metadata.evalV2Reporting === true`，便于 Stage 3 单独回滚

当前设计重点不是“同一 case 用两套 scorer 重算两次”，而是让 dataset 能把旧 oracle 更在意的 case 和 value-aligned case 切开看，从而解释为什么某些 rollout 在旧口径和新口径下会出现分歧。

在当前实现里，推荐的阅读顺序是：

1. 先看 `reportingMembership`
   - 判断显式 split 子集和 shared default 子集是否方向一致
2. 再看 `legacy_oracle_result` / `value_aligned_result`
   - 只把它们当作 aggregate 视角，而不是第一层结论
3. 最后再下钻 `contextProbeClass` / `freshnessClass`
   - 定位到底是哪类 case 在拉动差异

当前阶段先不默认渲染 `reportingView × reportingMembership` 的完整交叉矩阵。

- Why:
  - `reportingMembership` 已经能把“aggregate 被 shared default 稀释”这件事说清楚
  - 直接上交叉矩阵会增加展示复杂度，但不一定增加新的决策信息
  - 只有在 membership + view 仍不足以解释时，才值得把矩阵提升为默认展示

### 5.4 failure taxonomy

目前因果相关 failure tags 已经开始区分：

- semantic-state gap
  - `latent_goal_missing`
  - `latent_goal_mismatch`
  - `under_clarification`
- intervention / outcome gap
  - `wrong_intervention`
  - `over_clarification`
  - `over_action`
  - `low_counterfactual_lift`
  - `poor_outcome_quality`

兼容旧 tag 的同时，新的 tags 用于把“没理解任务”与“动作做错了”分开。

## 6. Feedback Loop

`apps/runtime/src/feedback-loop-store.ts` 现在会把 causal evaluation 失败拆成两类 insight：

### 6.1 `causal_semantic_state_gap`

聚合：

- `latent_goal_missing`
- `latent_goal_mismatch`
- `under_clarification`

它指向的问题是：

- latent goal 没被稳定写出来
- 澄清策略没真正补上关键变量
- semantic extractor / clarification prompt 需要迭代

### 6.2 `causal_intervention_gap`

聚合：

- `wrong_intervention`
- `over_clarification`
- `over_action`
- `low_counterfactual_lift`
- `poor_outcome_quality`

它指向的问题是：

- policy router 选错动作
- 动作虽然发生了，但结果没有 lift
- outcome quality 仍不够好

两类 insight 仍复用现有动作体系，不新增新的 RPC 或专用 UI 面板。

## 7. 当前边界

当前系统已经能工作，但还有几条边界需要明确：

1. **semantic extraction 是 best-effort，不是强一致依赖**
   provider 不可用时会回退到 heuristics，run 不会因为 semantic extraction 失败而失败。

2. **legacy adapter 仍是近似值**
   adapter 适合做 A/B 对照，不适合当作高保真 semantic truth。

3. **默认生产模式仍然保守**
   `record_only` 还是默认值，避免还未充分验证的 gate 直接改变所有运行行为。

4. **episode 已经是共享语义层，但不是交互状态权威**
   UI 交互态仍然以 snapshot / gate projection 为权威；episode 用于解释和评估，不直接驱动交互状态。

5. **failure taxonomy 刚进入可用阶段**
   现在已经能区分 semantic gap 与 intervention gap，但还不是完整的长期研究分类法。

## 8. 当前判断

如果把 Causal Decision 看成产品能力而不是单一技巧，Ora 现在已经完成了第一阶段闭环：

- runtime 会做因果决策并可进入 gate
- Trail 能展示有效 intervention episode
- Evaluation 能比较策略、看结果 lift、看显著性
- feedback loop 已经能把 failure 回流成下一轮改进入口

当前真正的主战场，已经从“有没有 causal router”转到：

- `CausalTaskState` 的语义质量够不够稳定
- failure taxonomy 能不能指导下一轮 harness 迭代
- `record_only / advisory / enforcing` 哪种策略在不同任务上最有 lift

这也是为什么这份文档现在要作为 **当前结构说明**，而不是未来路线草稿。
