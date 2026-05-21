# Evaluation Report: eval-run-0001

**Generated:** 2026-05-21T11:05:49.083Z
**Generator:** Ora Evaluation v1.0.0
**Status:** succeeded
**Dataset:** causal-intervention-decision-dataset (101 cases)
**Profile:** orchestration

## Scorecard

| Metric | Value |
|--------|-------|
| Overall Score | 0.7101 |
| Pass Rate | 69.8% |
| Average Runtime | 27948ms |
| Average Cost | $0.0023 |
| Regressions | 0 |
| Pending Annotations | 0 |

### Config Summaries

| Config | Score | Pass Rate | Runtime | Cost | Cases | Regressions |
|--------|-------|-----------|---------|------|-------|-------------|
| Record Only | 0.6827 | 65.3% | 29575ms | $0.0036 | 101 | 0 |
| Enforcing | 0.7375 | 74.3% | 26320ms | $0.0010 | 101 | 0 |

### Dual Reporting

| View | Config | Score | Pass Rate | Runtime | Cost | Cases |
|------|--------|-------|-----------|---------|------|-------|
| Legacy Oracle Result | Record Only | 0.6851 | 65.6% | 26299ms | $0.0037 | 90 |
| Legacy Oracle Result | Enforcing | 0.7459 | 76.7% | 27900ms | $0.0010 | 90 |
| Value Aligned Result | Record Only | 0.6777 | 64.6% | 30561ms | $0.0038 | 96 |
| Value Aligned Result | Enforcing | 0.7428 | 76.0% | 26121ms | $0.0010 | 96 |

### Slices

**contextProbeClass:**
- artifact_without_locator: 0.8054 (2 cases, config causal-enforcing)
- artifact_without_locator: 0.2929 (2 cases, config causal-record-only)
- explicit_artifact_handle: 0.8452 (1 cases, config causal-enforcing)
- explicit_artifact_handle: 0.8302 (1 cases, config causal-record-only)
- implicit_context_file: 0.6357 (5 cases, config causal-enforcing)
- implicit_context_file: 0.7785 (5 cases, config causal-record-only)

**decisionSurface:**
- answer_directly: 0.8509 (12 cases, config causal-enforcing)
- answer_directly: 0.8503 (12 cases, config causal-record-only)
- clarify: 0.7558 (30 cases, config causal-enforcing)
- clarify: 0.7101 (30 cases, config causal-record-only)
- plan: 0.5822 (7 cases, config causal-enforcing)
- plan: 0.4432 (7 cases, config causal-record-only)
- read_context: 0.7183 (27 cases, config causal-enforcing)
- read_context: 0.6982 (27 cases, config causal-record-only)
- request_approval: 0.8002 (10 cases, config causal-enforcing)
- request_approval: 0.5145 (10 cases, config causal-record-only)
- search_web: 0.6754 (15 cases, config causal-enforcing)
- search_web: 0.6893 (15 cases, config causal-record-only)

**freshnessClass:**
- freshness_sensitive_query: 0.6394 (9 cases, config causal-enforcing)
- freshness_sensitive_query: 0.6527 (9 cases, config causal-record-only)

**reportingView:**
- legacy_oracle_result: 0.7459 (90 cases, config causal-enforcing)
- legacy_oracle_result: 0.6851 (90 cases, config causal-record-only)
- value_aligned_result: 0.7428 (96 cases, config causal-enforcing)
- value_aligned_result: 0.6777 (96 cases, config causal-record-only)

**scenario:**
- analysis: 0.8009 (16 cases, config causal-enforcing)
- analysis: 0.7395 (16 cases, config causal-record-only)
- career: 0.6303 (12 cases, config causal-enforcing)
- career: 0.6321 (12 cases, config causal-record-only)
- coding: 0.7516 (42 cases, config causal-enforcing)
- coding: 0.6460 (42 cases, config causal-record-only)
- merchant_diagnosis: 0.7673 (17 cases, config causal-enforcing)
- merchant_diagnosis: 0.7489 (17 cases, config causal-record-only)
- search: 0.6783 (14 cases, config causal-enforcing)
- search: 0.6904 (14 cases, config causal-record-only)

**uncertaintyType:**
- context: 0.7183 (27 cases, config causal-enforcing)
- context: 0.6982 (27 cases, config causal-record-only)
- fact: 0.6754 (15 cases, config causal-enforcing)
- fact: 0.6893 (15 cases, config causal-record-only)
- goal: 0.7558 (30 cases, config causal-enforcing)
- goal: 0.7101 (30 cases, config causal-record-only)
- low_value: 0.8141 (15 cases, config causal-enforcing)
- low_value: 0.7562 (15 cases, config causal-record-only)
- risk: 0.7197 (14 cases, config causal-enforcing)
- risk: 0.5077 (14 cases, config causal-record-only)

## Failures

61 cases scored below threshold:

- **causal-agent-003** (causal-record-only): score=0.0000, tags=attempt_timeout
  - Rationale: Execution failed: Attempt timed out after 300000ms
- **causal-agent-003** (causal-enforcing): score=0.0000, tags=attempt_timeout
  - Rationale: Execution failed: Attempt timed out after 300000ms
- **causal-agent-004** (causal-record-only): score=0.6306, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, wrong_intervention, skipped_context_read, not_evidence_based, potential_arch_conflict
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-005** (causal-record-only): score=0.6131, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, no_search, missing_verification, hallucination_risk
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-005** (causal-enforcing): score=0.6483, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, did_not_search, relied_on_training_data, intervention_not_executed
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-006** (causal-record-only): score=0.6998, tags=low_output_quality, poor_outcome_quality, missing_causal_data, high_token_load, high_tool_overhead, high_agentic_cost, visible_surface_too_wide, atomic_explore_hops_high, first_locate_failed
  - Rationale: heuristic: task_success_rate: Output matches success criteria (1/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resolution: No causal dec
- **causal-agent-009** (causal-enforcing): score=0.6126, tags=missing_causal_data, wrong_intervention, ignored_context, inefficient_orchestration, unnecessary_blocked_delivery
  - Rationale: heuristic: task_success_rate: Output matches success criteria (2/2 indicators). llm_judge_score: Output quality is acceptable based on heuristic proxy evaluation. intent_resolution: No causal decision
- **causal-agent-010** (causal-record-only): score=0.3161, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, high_token_load, high_tool_overhead, high_agentic_cost, atomic_explore_hops_high, first_locate_failed
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/2 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-014** (causal-enforcing): score=0.3712, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, wrong_intervention, skipped_read_context, premature_clarification
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-015** (causal-enforcing): score=0.6167, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, wrong_intervention, no_clarification, generic_answer
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-016** (causal-record-only): score=0.5434, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, intervention_incorrect, no_evidence, fabricated_actions, missing_clarification
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-020** (causal-enforcing): score=0.5784, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, wrong_intervention, ignored_context, no_context_read
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-021** (causal-record-only): score=0.3988, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, high_token_load, atomic_explore_hops_high, first_locate_failed
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-021** (causal-enforcing): score=0.4589, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, intent_mismatch, latent_goal_mismatch, wrong_intervention, over_action, low_counterfactual_lift
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-022** (causal-enforcing): score=0.6211, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, wrong_intervention, lacks_clarification, generic_advice
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-023** (causal-record-only): score=0.3843, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, high_token_load, high_tool_overhead, high_agentic_cost
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-023** (causal-enforcing): score=0.4461, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, intent_mismatch, latent_goal_mismatch, low_counterfactual_lift, first_locate_failed
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-027** (causal-record-only): score=0.2787, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, high_token_load, high_tool_overhead, high_agentic_cost, atomic_explore_hops_high, first_locate_failed
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-030** (causal-enforcing): score=0.6889, tags=low_output_quality, poor_outcome_quality, missing_causal_data, visible_surface_too_wide, missing_context_gathering, assumed_generic_architecture, no_evidence_naming_gap
  - Rationale: heuristic: task_success_rate: Output matches success criteria (1/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resolution: No causal dec
- **causal-agent-034** (causal-record-only): score=0.5078, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, high_token_load, high_tool_overhead, atomic_explore_hops_high, first_locate_failed, triage_contract_mismatch
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- ... and 41 more failures

## Trace Links

- causal-agent-001/causal-record-only: run `run-0004`
- causal-agent-001/causal-enforcing: run `run-0001`
- causal-agent-002/causal-record-only: run `run-0003`
- causal-agent-002/causal-enforcing: run `run-0002`
- causal-agent-004/causal-record-only: run `run-0007`
- causal-agent-004/causal-enforcing: run `run-0008`
- causal-agent-005/causal-record-only: run `run-0009`
- causal-agent-005/causal-enforcing: run `run-0010`
- causal-agent-006/causal-record-only: run `run-0011`
- causal-agent-006/causal-enforcing: run `run-0012`
- ... and 183 more traces

## Recommended Actions

- [ ] Pass rate below 80%: review failure clusters and consider prompt or mode adjustments.
- [ ] Top failure tags: attempt_timeout, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data. Review relevant scorer rationales.
- [ ] Resolver visible surfaces are still too wide in evaluated runs: audit preset defaults and explicit toolIds overrides.
- [ ] First locate success is low: tune repo.explore ranking, scope heuristics, or escalation hints.
