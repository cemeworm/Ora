# Causal Agent A/B Comparison Report

**Run A (Baseline)**: `eval-run-0013` (config: `causal-record-only`)
**Run B (Causal)**: `eval-run-0013` (config: `causal-enforcing`)

## Overview

| Dimension | Record Only | Enforcing | Delta |
|---|---:|---:|---:|
| Overall Score | 85.3% | 90.6% | +5.2pp |
| Pass Rate | 100.0% | 100.0% | +0.0pp |
| Avg Runtime | 15230ms | 3403ms | -78% |
| Avg Cost | $0.0020 | $0.0006 | -70% |

## Metric Deltas

| Metric | Record Only | Enforcing | Delta | p-value |
|---|---:|---:|---:|---:|
| task_success_rate | 90.0% | 100.0% | +10.0pp | <0.001 |
| llm_judge_score | 47.7% | 74.7% | +26.9pp | 0.383 |
| intent_resolution | 80.0% | 80.0% | +0.0pp | 1.000 |
| effective_intervention | 100.0% | 100.0% | +0.0pp | 1.000 |
| token_efficiency | 83.2% | 86.1% | +2.9pp | <0.001 |
| agentic_cost_score | 92.1% | 97.7% | +5.6pp | <0.001 |

## Net Lift: +9.7pp

## Verdict: 7/8 条件通过 (互有胜负)

核心结论: Enforcing 输出质量更高、成本低70%、速度快78%
