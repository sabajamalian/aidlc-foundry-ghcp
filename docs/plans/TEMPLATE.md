---
proposal: 0            # proposal issue number
status: proposed       # approval happens by merging the plan PR with a human approval
title: ""
---

# Plan: <title>

## 1. Summary
Two or three sentences: what changes and why, in terms of the proposal.

## 2. Acceptance criteria (verbatim from the proposal)
| ID | Criterion | Proved by (tests / acceptance check) |
|----|-----------|---------------------------------------|
| AC-1 | | |

## 3. Current behavior (brownfield analysis)
What the code does today, with file paths and function names. Include the root cause if this is a defect.

## 4. Affected components
| Area | Files | Change |
|------|-------|--------|
| API | | |
| Database | | |
| Frontend | | |
| Docs / Swagger | | |

## 5. Implementation steps
Numbered, ordered, and small enough to review commit by commit.

1.

## 6. Data and compatibility
Migrations (new sequential file only), seed changes, API response compatibility for existing consumers, and the rollback approach.

## 7. Test plan
Unit tests, route tests, and the executable acceptance check `acceptance/proposal-<N>.mjs`.

## 8. Risks and mitigations

## 9. Out of scope
Things noticed while planning that this change deliberately won't touch.

## 10. Open questions for the reviewer
