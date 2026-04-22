# Long-task Protocol Reference

## Naming
- `tasks/TASK-<YYYYMMDD-HHMM>-<slug>.md` keeps tasks sortable and avoids same-day collisions.

## Compressed State (must stay <=20 lines)
Hard format:
- Objective:
- Done:
- In-progress:
- Active files:
- Next actions (top 3; exact file/function/line anchor if possible):
- Blockers/Risks:
- Verification status:

## TODO whitelist
Allowed:
- `TODO(FOLLOWUP): ...`

Not allowed (blocks DONE):
- `TODO: ...`
- `// TODO ...`
- `# TODO ...` without `(FOLLOWUP)`

## Savepoint content quality bar
Each SAVEPOINT must enable a cold start with minimal context:
- exact next actions
- exact active files
- explicit blockers/assumptions
- verification status

## Retrospective promotion bar
Promote a pitfall to `candidate_for_skill` only if at least one is true:
- it caused rework, misreads, or a wrong branch of investigation
- it is a workflow, contract, interface, artifact, or environment issue rather than a one-off business fact
- it can be stopped by a short operational rule
- it is likely to recur in similar tasks

Keep an item `local_only` when:
- it depends on one-off dirty data or an external outage
- the evidence is incomplete
- the lesson cannot yet be compressed into a reusable guardrail

## Retrospective writeback quality bar
For each high-value item, record:
- symptom
- root cause
- reusable guardrail
- exact evidence path or command
- suggested writeback target if the item is reusable

Default to 0-3 items. More usually means the extraction is not prioritizing.

## Verification guidance
Prefer recording:
- build/test/lint command + complete terminal output
- version info if relevant (node/python/go)
- any skipped checks with reason + substitute

## Suggested writeback targets
Use the smallest durable target that can prevent the same mistake:
- task-only local history: keep in `## Retrospective`
- generic task workflow lesson: update `long-task-protocol`
- domain workflow lesson: update the relevant domain skill's `Default Rules`, `Workflow`, or `Common Traps`
- repo-specific edge case with long shelf life: add a reference note instead of bloating the top-level skill
