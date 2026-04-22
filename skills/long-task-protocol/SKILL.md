---
name: long-task-protocol
description: Enforce a resumable long-task workflow using tasks/TASK-*.md as the single source of truth with SAVEPOINT, TODO hygiene, retrospective extraction, checkpoint-based verification, and strict DONE gates. Use when handling complex features, refactors, multi-step debugging, long-running work, or explicit resume/savepoint requests.
---

# Long-task Protocol

Use `tasks/TASK-<YYYYMMDD-HHMM>-<slug>.md` as the only authoritative task state.
Treat chat messages as non-authoritative summaries.

## Quick Commands

- Create journal: `python3 skills/long-task-protocol/scripts/create_journal.py "<slug>"`
- Find latest task: `bash skills/long-task-protocol/scripts/latest_task.sh`
- Scan TODOs: `bash skills/long-task-protocol/scripts/todo_scan.sh`

## Core Rules

### Single Source of Truth

- Persist task state only in `tasks/TASK-*.md`.
- Keep `Active Files`, `Progress Log`, and `Compressed State` current.
- For complex tasks, keep `Retrospective` current enough that another agent can tell which pitfalls are local noise versus reusable guardrails.

### SAVEPOINT (mandatory triggers)

Trigger SAVEPOINT when any condition is met:
- User requests `/save`
- Before reading more than 5 new files in one burst
- Before mass edits or broad refactors
- When context truncation risk is high

Execute SAVEPOINT in this order:
1. Append a timestamped `Progress Log` entry ending with `Next: ...` (top 3 concrete next actions).
2. Rewrite `Compressed State` to the latest truth in <= 20 lines.
3. Persist the journal to disk.
4. If Git is available, prefer commit: `git add tasks/... && git commit -m "SAVEPOINT: <task-id>"`.

Return only `SAVEPOINT created.` when user explicitly triggers `/save`.

### Retrospective Extraction

Before calling a complex task done, or after any meaningful rework loop, extract 0-3 pitfall candidates into `## Retrospective`.

- Record evidence, not just conclusions.
- Promote an item only when it is likely to recur and can be converted into an actionable guardrail.
- Use `Status: local_only | candidate_for_skill | promoted_to_skill`.
- When the user wants durable knowledge, use [`task-retrospective-memory`](/Users/quintenchen/developer/quantfox/.codex/skills/task-retrospective-memory/SKILL.md) to decide whether the lesson should stay in the task or be suggested for skill writeback.

### Strict DONE Gate

Claim DONE only when all gates pass and evidence is written inside the journal.

1. TODO gate
- Run `bash skills/long-task-protocol/scripts/todo_scan.sh`.
- Paste actual output under `Verification`.
- Allow remaining TODOs only when they are `TODO(FOLLOWUP): ...` and mirrored in `Open Issues`.

2. Code verification gate
- Run relevant build/test/lint commands.
- Paste command outputs under `Verification`.
- If commands cannot run, record reason and minimum substitute check.

3. Functional verification gate
- Run behavior-level checks proving the feature works end-to-end.
- Paste outputs/evidence under `Verification`.

4. Retrospective gate
- Confirm `## Retrospective` exists.
- For complex tasks, record 0-3 highest-value pitfalls or explicitly say none were worth promoting.
- If any item is `candidate_for_skill`, include a precise writeback target.

5. Evidence gate
- Record changed file paths.
- Record reproducible verification steps.
- Record functional evidence and residual risks.

## Comparison and Checkpoints

Create and pass checkpoints before DONE:
- Requirement
- Verification method
- Pass criteria

When the task references templates, historical implementations, or analogous features, fill `Comparison` section with:
- Reference source
- Compared points
- Expected/unexpected differences
- Consistency conclusion

## Workflow

1. Start
- If no journal exists, create one using `create_journal.py`.
- Fill Goal/Scope/Plan and `Active Files`.
- Use template: `./TEMPLATE.md`.

2. Work loop
- Execute plan step-by-step.
- Append `Progress Log` after meaningful steps.
- Keep `Compressed State` current.

3. Retrospective extraction
- Near closeout, scan `Progress Log`, `Decisions`, `Open Issues`, `Verification`, and `Compressed State`.
- Capture only the highest-value recurring pitfalls in `## Retrospective`.
- If a pitfall looks reusable, draft a concrete writeback target instead of editing other skills by default.

4. Resume
- Read latest task via `latest_task.sh`.
- Ingest `Compressed State`, `Plan`, latest `Progress Log`, and `Retrospective`.
- Continue from `Next actions (top 3)`.

## References

- Detailed policy and examples: `references/REFERENCE.md`
- Journal template: `TEMPLATE.md`
