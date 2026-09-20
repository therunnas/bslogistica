---
name: project-preflight
description: Use when about to implement, fix, refactor, or migrate a managed project and readiness must be confirmed against the current repository state.
---

# Project Preflight

## Goal

Decide from durable evidence whether a bounded implementation can start. Run
this read-only gate immediately before editing a managed project.

`READY` applies only to the authorized implementation scope; it does not permit
commit, push, deploy, destructive action, or Production change.

Use `continue-project` for state-only recovery; use this skill before
implementation begins or resumes.

## Procedure

1. Identify one exact target project and the bounded task.
2. Read the control-plane `AGENTS.md`, then the project's `PROJECT.md` and
   `STATUS.md`.
3. Read the product instructions and task-relevant documentation named by
   `PROJECT.md`.
4. Inspect locally, or through GitHub/`gh` without a usable checkout:
   - branch, HEAD, upstream divergence and recent commits;
   - working tree and whether existing changes overlap the task;
   - open PRs or branches that change the same area;
   - relevant tests, CI and documented quality gates.
5. Determine relevance from real task dependencies and claims, not labels:
   inspect migrations for schema, RLS, database-function, or migration-order
   dependencies; inspect Production for deployed-state or
   environment-configuration dependencies.
6. Compare documentation with actual evidence. Never resolve a conflict by
   guessing.

Do not run the full suite. Identify gates for `verify-change` after implementation.

## Working tree rule

Local changes are not an automatic blocker. Record their files, known owner and
interaction with the task. Preserve them.

- Unrelated changes: report the risk and continue if the task can be isolated.
- Overlap, generated collision or overwrite risk: do not edit until resolved.
- Never stash, discard, reset, reformat, stage, or commit existing work to make
  the tree clean.

## Verdict

Return exactly one status:

| Status | Meaning |
| --- | --- |
| `READY` | Evidence agrees; scope is bounded; existing work can be preserved. |
| `BLOCKED` | A prerequisite, inaccessible required evidence, or conflict makes work unsafe. |
| `NEEDS_DECISION` | Evidence exists, but a user choice or new authority is required. |

A documentation/repository divergence is never `READY`: use `BLOCKED` for an
objective prerequisite and `NEEDS_DECISION` when the safe state or scope must be
chosen.

## Required output

Return before implementation:

### Verdict
One status and its decisive reason.

### Evidence
Project, repository, branch, HEAD, upstream/PR state, working-tree risk, and
relevant migration/Production state or why it is not applicable.

### Implementation scope
Bounded task, allowed areas, exclusions, and existing work to preserve.

### Read before editing
Exact task-relevant instructions and documentation.

### Quality gates
Commands or checks required after the change. Identify only.

### Risks or decisions
Conflicts, blockers, missing authority, and next action.

If the verdict is `BLOCKED` or `NEEDS_DECISION`, stop before editing.

## Common mistakes

- Treating a clean tree as the goal instead of preserving others' work.
- Auditing every migration or Production for a task unrelated to them.
- Calling the task ready while durable sources disagree.
- Treating `READY` as permission for commit, push, deploy, or Production.
