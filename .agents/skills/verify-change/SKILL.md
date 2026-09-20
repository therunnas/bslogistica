---
name: verify-change
description: Use when an implemented managed-project change must be validated before it can be considered complete.
---

# Verify Change

## Goal

Validate change with target-bound evidence. Run only applicable gates.

Do not edit or mutate working tree, index, HEAD, or branch; never stage, stash,
reset, commit, push, merge, deploy, or alter Production.

## Establish the target

Read instructions, task contract, done criteria, and docs.

- Branch or PR: use the merge-base with the target branch and inspect
  `merge-base...HEAD`.
- Working tree: use current `HEAD` as base and inspect unstaged, staged, and
  untracked changes.
- Record exact HEAD and, for a working tree, its diff.
- If the base cannot be determined without guessing, return
  `NEEDS_DECISION`.

Inspect status and diff. Run `git diff --check` for tracked text; validate
untracked text equivalently without staging it.

## Select and run gates

Derive applicability from changed behavior and claims, not labels:

- lint and typecheck when configured and affected;
- focused/relevant tests and build when impact requires;
- dependency audit when dependencies/lockfiles change or policy requires it;
- security checks for auth, secrets, sensitive data, trust boundaries, or
  external exposure;
- migrations/database tests only for schema, RLS, functions, persistence, or
  migration-order impact;
- documentation when required by done criteria or changed behavior;
- independent review when rules, task, or material risk require;
- read-only Production evidence only when the conclusion depends on it.

Run the full suite only when rules, task, or broad impact require.

## Evidence contract

Report one state per gate:

| State | Meaning |
| --- | --- |
| `RUN/PASS` | Check during this verification passed on the recorded target, or trusted CI passed for its exact HEAD. |
| `RUN/FAIL` | Current execution failed; include command, exit status, and output evidence. |
| `FAIL` | Required target-bound evidence or another objective requirement is missing. |
| `N/A` | Gate is irrelevant; state why. |
| `DECISION_REQUIRED` | A real human choice or authority is required. |

PR descriptions, author comments, and earlier local runs are never `RUN/PASS`
evidence. Earlier CI counts only when trusted and bound to the exact HEAD. A
known non-blocking failure stays so only while cause and signature are unchanged.

If required Production evidence is unavailable, use `DECISION_REQUIRED`, not
`FAIL`. If Production is irrelevant, use `N/A`. Missing or incorrect required
documentation is `FAIL`, not a decision.

## Verdict

Return exactly one:

- `PASS`: every applicable gate passed with target-bound evidence, each `N/A` is
  justified, and no decision remains.
- `FAIL`: a gate failed, lacks required target-bound evidence, or an objective
  requirement is unmet. Name the exact gate and evidence.
- `NEEDS_DECISION`: conclusion depends on a real human decision, waiver, or
  unavailable required Production authority/evidence.

## Required output

### Verdict
Status and reason.

### Target
Project, base, HEAD, diff, and tree state.

### Gate matrix
Gate, applicability, state, check, evidence.

### Regression risks
Affected flows, coverage, risk, and review.

### Next action
Exact failing gate or decision needed; `None` for `PASS`.
