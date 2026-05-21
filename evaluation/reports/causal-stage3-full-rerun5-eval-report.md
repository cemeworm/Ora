# Evaluation Report: eval-run-0001

**Generated:** 2026-05-21T12:03:09.926Z
**Generator:** Ora Evaluation v1.0.0
**Status:** succeeded
**Dataset:** causal-intervention-decision-dataset (101 cases)
**Profile:** orchestration

## Scorecard

| Metric | Value |
|--------|-------|
| Overall Score | 0.7218 |
| Pass Rate | 72.3% |
| Average Runtime | 26896ms |
| Average Cost | $0.0028 |
| Regressions | 0 |
| Pending Annotations | 0 |

### Config Summaries

| Config | Score | Pass Rate | Runtime | Cost | Cases | Regressions |
|--------|-------|-----------|---------|------|-------|-------------|
| Record Only | 0.7166 | 71.3% | 28253ms | $0.0045 | 101 | 0 |
| Enforcing | 0.7269 | 73.3% | 25539ms | $0.0011 | 101 | 0 |

### Reporting Membership

Read this section first. It separates explicitly labeled reporting-view cases from shared-default cases so you can see whether dual-reporting aggregates are being diluted by the unlabeled majority.

| Membership | Cases | Record Only | Enforcing | Delta (Enforcing - Record Only) |
| ------ | ------ | ------ | ------ | ------ |
| Explicit Reporting View | 16 | 0.7217 | 0.6846 | -0.0371 |
| Shared Default View | 85 | 0.7157 | 0.7349 | 0.0192 |

### Dual Reporting

Use this aggregate view after checking Reporting Membership above. If the explicit bucket and shared-default bucket pull in different directions, the totals here will mostly reflect whichever bucket has more cases.

| View | Config | Score | Pass Rate | Runtime | Cost | Cases |
|------|--------|-------|-----------|---------|------|-------|
| Legacy Oracle Result | Record Only | 0.7112 | 70.0% | 27135ms | $0.0048 | 90 |
| Legacy Oracle Result | Enforcing | 0.7287 | 73.3% | 26715ms | $0.0010 | 90 |
| Value Aligned Result | Record Only | 0.7209 | 71.9% | 28929ms | $0.0046 | 96 |
| Value Aligned Result | Enforcing | 0.7323 | 76.0% | 25306ms | $0.0011 | 96 |

### Slices

**reportingMembership:**
- explicit_reporting_view: 0.6846 (16 cases, config causal-enforcing)
- explicit_reporting_view: 0.7217 (16 cases, config causal-record-only)
- shared_default_view: 0.7349 (85 cases, config causal-enforcing)
- shared_default_view: 0.7157 (85 cases, config causal-record-only)

**reportingView:**
- legacy_oracle_result: 0.7287 (90 cases, config causal-enforcing)
- legacy_oracle_result: 0.7112 (90 cases, config causal-record-only)
- value_aligned_result: 0.7323 (96 cases, config causal-enforcing)
- value_aligned_result: 0.7209 (96 cases, config causal-record-only)

**contextProbeClass:**
- artifact_without_locator: 0.8102 (2 cases, config causal-enforcing)
- artifact_without_locator: 0.7791 (2 cases, config causal-record-only)
- explicit_artifact_handle: 0.8463 (1 cases, config causal-enforcing)
- explicit_artifact_handle: 0.7500 (1 cases, config causal-record-only)
- implicit_context_file: 0.6235 (5 cases, config causal-enforcing)
- implicit_context_file: 0.6346 (5 cases, config causal-record-only)

**freshnessClass:**
- freshness_sensitive_query: 0.6835 (9 cases, config causal-enforcing)
- freshness_sensitive_query: 0.7560 (9 cases, config causal-record-only)

**decisionSurface:**
- answer_directly: 0.8292 (12 cases, config causal-enforcing)
- answer_directly: 0.8554 (12 cases, config causal-record-only)
- clarify: 0.7492 (30 cases, config causal-enforcing)
- clarify: 0.7414 (30 cases, config causal-record-only)
- plan: 0.5524 (7 cases, config causal-enforcing)
- plan: 0.4851 (7 cases, config causal-record-only)
- read_context: 0.7160 (27 cases, config causal-enforcing)
- read_context: 0.6806 (27 cases, config causal-record-only)
- request_approval: 0.7242 (10 cases, config causal-enforcing)
- request_approval: 0.6986 (10 cases, config causal-record-only)
- search_web: 0.7033 (15 cases, config causal-enforcing)
- search_web: 0.7409 (15 cases, config causal-record-only)

**scenario:**
- analysis: 0.8121 (16 cases, config causal-enforcing)
- analysis: 0.7781 (16 cases, config causal-record-only)
- career: 0.6161 (12 cases, config causal-enforcing)
- career: 0.6823 (12 cases, config causal-record-only)
- coding: 0.7226 (42 cases, config causal-enforcing)
- coding: 0.6853 (42 cases, config causal-record-only)
- merchant_diagnosis: 0.7680 (17 cases, config causal-enforcing)
- merchant_diagnosis: 0.7305 (17 cases, config causal-record-only)
- search: 0.6877 (14 cases, config causal-enforcing)
- search: 0.7528 (14 cases, config causal-record-only)

**uncertaintyType:**
- context: 0.7160 (27 cases, config causal-enforcing)
- context: 0.6806 (27 cases, config causal-record-only)
- fact: 0.7033 (15 cases, config causal-enforcing)
- fact: 0.7409 (15 cases, config causal-record-only)
- goal: 0.7492 (30 cases, config causal-enforcing)
- goal: 0.7414 (30 cases, config causal-record-only)
- low_value: 0.7752 (15 cases, config causal-enforcing)
- low_value: 0.7777 (15 cases, config causal-record-only)
- risk: 0.6737 (14 cases, config causal-enforcing)
- risk: 0.6414 (14 cases, config causal-record-only)

## Failures

56 cases scored below threshold:

- **causal-agent-003** (causal-enforcing): score=0.0000, tags=attempt_timeout
  - Rationale: Execution failed: Attempt timed out after 300000ms
- **causal-agent-004** (causal-enforcing): score=0.4627, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, intent_mismatch, latent_goal_mismatch, low_counterfactual_lift
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-005** (causal-enforcing): score=0.6131, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, no_search_for_freshness_query, relied_on_training_data
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-007** (causal-enforcing): score=0.6031, tags=low_output_quality, poor_outcome_quality, missing_causal_data, visible_surface_too_wide, intervention_incorrect, missing_clarification, guessed_location, unnecessary_tool_use
  - Rationale: heuristic: task_success_rate: Output matches success criteria (1/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resolution: No causal dec
- **causal-agent-009** (causal-record-only): score=0.5354, tags=low_output_quality, poor_outcome_quality, missing_causal_data, visible_surface_too_wide, no_context_read, hallucination, wrong_file
  - Rationale: heuristic: task_success_rate: Output matches success criteria (1/2 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resolution: No causal dec
- **causal-agent-010** (causal-enforcing): score=0.3012, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, wrong_intervention, incomplete_output, no_clarification, risk_not_addressed
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/2 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-014** (causal-record-only): score=0.4260, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, first_locate_failed
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-014** (causal-enforcing): score=0.6124, tags=low_output_quality, poor_outcome_quality, missing_causal_data, visible_surface_too_wide, context_ignored, unnecessary_clarification, should_have_read_context
  - Rationale: heuristic: task_success_rate: Output matches success criteria (1/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resolution: No causal dec
- **causal-agent-017** (causal-record-only): score=0.6833, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, wrong_intervention, no_search, not_evidence_based
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-017** (causal-enforcing): score=0.6482, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, missing_search, intervention_incorrect, evidence_not_verified
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-020** (causal-enforcing): score=0.5767, tags=low_output_quality, poor_outcome_quality, missing_causal_data, visible_surface_too_wide, ignored_context, wrong_intervention, no_tool_use_when_needed
  - Rationale: heuristic: task_success_rate: Output matches success criteria (1/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resolution: No causal dec
- **causal-agent-021** (causal-record-only): score=0.3585, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, high_token_load, high_tool_overhead, high_agentic_cost, atomic_explore_hops_high, first_locate_failed
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-021** (causal-enforcing): score=0.4589, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, intent_mismatch, latent_goal_mismatch, wrong_intervention, over_action, low_counterfactual_lift
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-022** (causal-record-only): score=0.6248, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, wrong_intervention, missed_clarification, guessed_background, not_personalized
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-022** (causal-enforcing): score=0.6562, tags=task_not_successful, poor_outcome_quality, low_output_quality, missing_causal_data, visible_surface_too_wide, wrong_intervention, missing_clarification, generic_advice
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/0 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-023** (causal-record-only): score=0.0000, tags=attempt_timeout
  - Rationale: Execution failed: Attempt timed out after 300000ms
- **causal-agent-023** (causal-enforcing): score=0.4469, tags=runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality, intent_mismatch, latent_goal_mismatch, low_counterfactual_lift, first_locate_failed
  - Rationale: heuristic: task_success_rate: Output does not clearly satisfy success criteria (0/1 indicators). llm_judge_score: Output quality is below threshold based on heuristic proxy evaluation. intent_resoluti
- **causal-agent-024** (causal-enforcing): score=0.6298, tags=missing_causal_data, visible_surface_too_wide, intervention_incorrect, context_ignored, no_read_context
  - Rationale: heuristic: task_success_rate: Output matches success criteria (2/2 indicators). llm_judge_score: Output quality is acceptable based on heuristic proxy evaluation. intent_resolution: No causal decision
- **causal-agent-029** (causal-record-only): score=0.0000, tags=attempt_timeout
  - Rationale: Execution failed: Attempt timed out after 300000ms
- **causal-agent-029** (causal-enforcing): score=0.0000, tags=attempt_timeout
  - Rationale: Execution failed: Attempt timed out after 300000ms
- ... and 36 more failures

## Trace Links

- causal-agent-001/causal-record-only: run `run-0002`
- causal-agent-001/causal-enforcing: run `run-0001`
- causal-agent-002/causal-record-only: run `run-0003`
- causal-agent-002/causal-enforcing: run `run-0004`
- causal-agent-003/causal-record-only: run `run-0006`
- causal-agent-004/causal-record-only: run `run-0007`
- causal-agent-004/causal-enforcing: run `run-0008`
- causal-agent-005/causal-record-only: run `run-0009`
- causal-agent-005/causal-enforcing: run `run-0010`
- causal-agent-006/causal-record-only: run `run-0011`
- ... and 186 more traces

## Recommended Actions

- [ ] Pass rate below 80%: review failure clusters and consider prompt or mode adjustments.
- [ ] Top failure tags: attempt_timeout, runtime_failed, task_not_successful, poor_outcome_quality, low_output_quality. Review relevant scorer rationales.
- [ ] Resolver visible surfaces are still too wide in evaluated runs: audit preset defaults and explicit toolIds overrides.
- [ ] First locate success is low: tune repo.explore ranking, scope heuristics, or escalation hints.
