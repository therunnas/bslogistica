---
name: plan-task
description: Use when a managed-project request must be classified and fully delimited before implementation begins.
---

# Plan Task

## Goal

Turn one request into a reviewable task contract before implementation. Planning
does not authorize edits, branches, commits, pushes, deploys, or Production
changes.

Use `continue-project` first when current state is unknown. Use
`project-preflight` only after a task is ready to proceed.

## Procedure

1. Identify one exact project and candidate task.
2. Read the control-plane `AGENTS.md`, the project's `PROJECT.md` and
   `STATUS.md`, product instructions, and task-relevant documentation.
3. If durable sources disagree, stop and report the divergence. Never plan from
   guessed state.
4. Determine the primary deliverable, known implementation path, and genuinely
   unresolved decisions.
5. Return exactly one classification and the complete task contract below.

## Classification

| Class | Use when | Gate |
| --- | --- | --- |
| `SPIKE` | The deliverable is evidence or an answer to material uncertainty. | Investigate only; do not implement product changes. |
| `BOUNDED` | Desired behavior, dependencies, impact, and implementation path are clear, with no architectural decision pending. | May proceed to `project-preflight`. |
| `ARCHITECTURAL` | Implementation depends on a genuinely unresolved structural decision about boundaries, contracts, ownership, integration, or trust. | Record the decision durably and approve a plan before editing code. |

A `BOUNDED` task may span several files or touch security, database, or multiple
components. Those facts alone do not make it `ARCHITECTURAL`. Existing approved
decisions are dependencies, not pending decisions.

If investigation is the deliverable, choose `SPIKE`. Any implementation found
during a spike is a new task and must be classified separately.

## Required output

### Classification
Class and decisive reason.

### Objective
One observable outcome.

### Scope
Included behavior and areas.

### Out of scope
Explicit exclusions.

### Risks
Technical, operational, security, and work-preservation risks that apply.

### Dependencies
Required code, documentation, decisions, services, migrations, or environments.

### Decisions required
Only unresolved decisions that block the stated path, or `None`.

### Definition of done
Observable completion conditions.

### Quality gates
Applicable checks to run after implementation; identify them without running the
full suite during planning.

### Next action
For `SPIKE`, state the investigation and stopping condition. For `BOUNDED`, run
`project-preflight`. For `ARCHITECTURAL`, resolve only the pending structural
decisions, record them durably, approve an implementation plan, and decompose it
into bounded tasks.

## Stop rules

- `SPIKE`: stop before product implementation.
- `BOUNDED`: stop if any required field remains materially unclear.
- `ARCHITECTURAL`: stop before code until the plan and actual pending decisions
  are approved.
- Never treat classification as authorization for an external mutation.
