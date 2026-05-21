# Evaluation Report: eval-run-0001

**Generated:** 2026-05-21T09:45:49.673Z
**Generator:** Ora Evaluation v1.0.0
**Status:** succeeded
**Dataset:** causal-intervention-decision-dataset (101 cases)
**Profile:** orchestration

## Scorecard

| Metric | Value |
|--------|-------|
| Overall Score | 0.7189 |
| Pass Rate | 75.7% |
| Average Runtime | 27940ms |
| Average Cost | $0.0023 |
| Regressions | 0 |
| Pending Annotations | 0 |

### Config Summaries

| Config | Score | Pass Rate | Runtime | Cost | Cases | Regressions |
|--------|-------|-----------|---------|------|-------|-------------|
| Record Only | 0.7019 | 72.3% | 26838ms | $0.0038 | 101 | 0 |
| Enforcing | 0.7358 | 79.2% | 29043ms | $0.0009 | 101 | 0 |

### Dual Reporting

| View | Config | Score | Pass Rate | Runtime | Cost | Cases |
|------|--------|-------|-----------|---------|------|-------|
| Legacy Oracle Result | Record Only | 0.7008 | 72.0% | 26873ms | $0.0038 | 100 |
| Legacy Oracle Result | Enforcing | 0.7347 | 79.0% | 29199ms | $0.0009 | 100 |
| Value Aligned Result | Record Only | 0.7055 | 73.0% | 26692ms | $0.0037 | 100 |
| Value Aligned Result | Enforcing | 0.7389 | 80.0% | 29095ms | $0.0008 | 100 |

### Slices

**contextProbeClass:**
- explicit_artifact_handle: 0.8464 (1 cases, config causal-enforcing)
- explicit_artifact_handle: 0.8163 (1 cases, config causal-record-only)
- implicit_context_file: 0.4292 (1 cases, config causal-enforcing)
- implicit_context_file: 0.3438 (1 cases, config causal-record-only)

**decisionSurface:**
- answer_directly: 0.8496 (12 cases, config causal-enforcing)
- answer_directly: 0.8453 (12 cases, config causal-record-only)
- clarify: 0.7159 (30 cases, config causal-enforcing)
- clarify: 0.7057 (30 cases, config causal-record-only)
- plan: 0.6524 (7 cases, config causal-enforcing)
- plan: 0.6369 (7 cases, config causal-record-only)
- read_context: 0.7240 (27 cases, config causal-enforcing)
- read_context: 0.6553 (27 cases, config causal-record-only)
- request_approval: 0.7448 (10 cases, config causal-enforcing)
- request_approval: 0.5918 (10 cases, config causal-record-only)
- search_web: 0.7389 (15 cases, config causal-enforcing)
- search_web: 0.7673 (15 cases, config causal-record-only)

**freshnessClass:**
- pure_info_query: 0.8488 (1 cases, config causal-enforcing)
- pure_info_query: 0.7436 (1 cases, config causal-record-only)

**reportingView:**
- legacy_oracle_result: 0.7347 (100 cases, config causal-enforcing)
- legacy_oracle_result: 0.7008 (100 cases, config causal-record-only)
- value_aligned_result: 0.7389 (100 cases, config causal-enforcing)
- value_aligned_result: 0.7055 (100 cases, config causal-record-only)

**scenario:**
- analysis: 0.7541 (16 cases, config causal-enforcing)
- analysis: 0.7861 (16 cases, config causal-record-only)
- career: 0.5523 (12 cases, config causal-enforcing)
- career: 0.6458 (12 cases, config causal-record-only)
- coding: 0.7554 (42 cases, config causal-enforcing)
- coding: 0.6584 (42 cases, config causal-record-only)
- merchant_diagnosis: 0.8017 (17 cases, config causal-enforcing)
- merchant_diagnosis: 0.7140 (17 cases, config causal-record-only)
- search: 0.7334 (14 cases, config causal-enforcing)
- search: 0.7695 (14 cases, config causal-record-only)

**uncertaintyType:**
- context: 0.7240 (27 cases, config causal-enforcing)
- context: 0.6553 (27 cases, config causal-record-only)
- fact: 0.7389 (15 cases, config causal-enforcing)
- fact: 0.7673 (15 cases, config causal-record-only)
- goal: 0.7159 (30 cases, config causal-enforcing)
- goal: 0.7057 (30 cases, config causal-record-only)
- low_value: 0.8115 (15 cases, config causal-enforcing)
- low_value: 0.7962 (15 cases, config causal-record-only)
- risk: 0.7169 (14 cases, config causal-enforcing)
- risk: 0.6126 (14 cases, config causal-record-only)

## Failures

49 cases scored below threshold:

- **causal-agent-003** (causal-enforcing): score=0.0000, tags=attempt_timeout
  - Rationale: Execution failed: Attempt timed out after 300000ms
- **causal-agent-004** (causal-record-only): score=0.3438, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, high_token_load, high_tool_overhead, high_agentic_cost, atomic_explore_hops_high, first_locate_failed
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-004** (causal-enforcing): score=0.4292, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, intent_mismatch, latent_goal_mismatch, low_counterfactual_lift, high_token_load, high_tool_overhead, first_locate_failed
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-009** (causal-enforcing): score=0.6215, tags=low_output_quality, poor_outcome_quality, missing_causal_data, visible_surface_too_wide, wrong_intervention, no_tool_use, missed_available_context
  - Rationale: heuristic: task_success_rate: Output matches success criteria (2/2 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resolution: No causal dec
- **causal-agent-014** (causal-record-only): score=0.4648, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-015** (causal-enforcing): score=0.6168, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, skipped_clarification, intervention_incorrect, generic_response
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-020** (causal-record-only): score=0.5959, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, wrong_intervention, context_not_read, missed_available_evidence
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-021** (causal-record-only): score=0.2755, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, high_token_load, high_tool_overhead, high_agentic_cost, atomic_explore_hops_high, first_locate_failed
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-023** (causal-enforcing): score=0.4518, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, intent_mismatch, latent_goal_mismatch, low_counterfactual_lift
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-026** (causal-enforcing): score=0.6484, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, wrong_intervention, no_evidence_verification, fact_uncertainty_ignored
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-027** (causal-record-only): score=0.6635, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, high_token_load, high_tool_overhead, high_agentic_cost, visible_surface_too_wide, atomic_explore_hops_high, first_locate_failed
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-029** (causal-record-only): score=0.0000, tags=attempt_timeout
  - Rationale: Execution failed: Attempt timed out after 300000ms
- **causal-agent-029** (causal-enforcing): score=0.0000, tags=attempt_timeout
  - Rationale: Execution failed: Attempt timed out after 300000ms
- **causal-agent-032** (causal-record-only): score=0.4645, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-033** (causal-record-only): score=0.0000, tags=attempt_timeout
  - Rationale: Execution failed: Attempt timed out after 300000ms
- **causal-agent-034** (causal-record-only): score=0.3517, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, high_token_load, high_tool_overhead, high_agentic_cost, atomic_explore_hops_high, first_locate_failed
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-034** (causal-enforcing): score=0.5742, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, intent_mismatch, latent_goal_mismatch, low_counterfactual_lift
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-035** (causal-record-only): score=0.6244, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, first_locate_failed, wrong_intervention, unnecessary_tool_calls, inefficient
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-038** (causal-enforcing): score=0.4826, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, wrong_intervention, low_counterfactual_lift
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-039** (causal-record-only): score=0.4664, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- ... and 29 more failures

## Trace Links

- causal-agent-001/causal-record-only: run `run-0002`
- causal-agent-001/causal-enforcing: run `run-0003`
- causal-agent-002/causal-record-only: run `run-0004`
- causal-agent-002/causal-enforcing: run `run-0001`
- causal-agent-003/causal-record-only: run `run-0005`
- causal-agent-004/causal-record-only: run `run-0007`
- causal-agent-004/causal-enforcing: run `run-0008`
- causal-agent-005/causal-record-only: run `run-0009`
- causal-agent-005/causal-enforcing: run `run-0010`
- causal-agent-006/causal-record-only: run `run-0011`
- ... and 183 more traces

## Recommended Actions

- [ ] Pass rate below 80%: review failure clusters and consider prompt or mode adjustments.
- [ ] Top failure tags: attempt_timeout, runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality. Review relevant scorer rationales.
- [ ] Resolver visible surfaces are still too wide in evaluated runs: audit preset defaults and explicit toolIds overrides.
- [ ] First locate success is low: tune repo.explore ranking, scope heuristics, or escalation hints.
