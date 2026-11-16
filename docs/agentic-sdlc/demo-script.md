# Demo script

About 20 minutes live, or 10 if you use the rehearsal paths. The story: a brownfield ordering app overcharges branches, and agents find, plan, fix, check, ship, and prove the fix while humans make every decision that matters.

## Before you start

- Repo configured per [setup.md](setup.md), labels created.
- Optional safety net: run the whole flow once a day ahead and keep the issues and PRs open in tabs.

## 1. A human sets direction (1 min)

Open a new issue with the **Direction** form:

> Branches should be able to trust what they're charged for an order.

Pick evidence pack `order-discounts`. Point out that the direction says nothing about discounts or code. Show the pack: [branch feedback](../../sdlc/evidence/order-discounts/branch-feedback.md), [support tickets](../../sdlc/evidence/order-discounts/support-tickets.csv), [order line export](../../sdlc/evidence/order-discounts/order-lines-export.csv).

## 2. Foundry finds the problem (2 min)

The **Foundry discovery** run starts. When it finishes there's a new `proposal` issue labeled `needs-pm-review`. Walk through it: root cause (client-supplied `unitPrice`, discount ignored, `totalAmount` missing), the 852.50 overcharge quantified from the export, numbered acceptance criteria, and the PM checklist.

Rehearsal: run the workflow manually with "Rehearsal mode" checked, or locally:

```bash
python3 -m sdlc.discovery --evidence sdlc/evidence/order-discounts \
  --direction "Branches should be able to trust what they're charged for an order." \
  --from-json docs/agentic-sdlc/sample-run/01-discovery-output.json --markdown /tmp/proposal.md
```

## 3. Gate 1: the PM approves (1 min)

Edit one acceptance criterion so the audience sees the PM owns the contract. Add `pm-approved`. Show the approval comment with the text digest, the label move to `planning`, and Copilot assigned with the **planner** agent.

## 4. Copilot plans (3 min, or show a prepared PR)

Copilot opens a plan-only PR adding `docs/plans/proposal-N-*.md`. Show that it follows [the template](../plans/TEMPLATE.md), maps every AC to steps and tests, and lists out-of-scope items. **Plan guard** is green because the PR touches only the plan.

## 5. Gate 2: a human edits and approves the plan (2 min)

Make a real edit, for example "round each line to cents before summing" under Implementation steps. Approve and merge. Show the new implementation issue with `Plan: docs/plans/...@<sha>` and Copilot assigned with the **implementer** agent.

Say why the SHA matters: if anyone edits the plan later, the plan guard fails the implementation PR.

## 6. Copilot implements, three reviewers check (5 min)

Copilot's PR changes the order-details route and models, adds tests, and adds `acceptance/proposal-N.mjs`. Show the checks:

- **CI** builds, lints, tests.
- **Copilot code review** comments on quality.
- **Foundry policy check** applies team rules. Show the PR comment: deterministic findings with exact lines, and Decision findings with the rule, outcome, and confidence.
- **Plan guard** confirms the plan binding.

To show the repair loop without waiting, run the checker on the sample diff:

```bash
python3 -m sdlc.policy_check --policy .github/policies/team-standards.yml \
  --diff docs/agentic-sdlc/sample-run/sample-pr.diff --annotations
```

It fails on LOG-001 (`console.log` in a route) and flags TS-001 as advisory. On a real PR, [agent-repair-loop.yml](../../.github/workflows/agent-repair-loop.yml) posts that report as an `@copilot` comment, Copilot pushes a fix, and the check reruns. After three tries it stops and labels `needs-human`.

## 7. Gates 3 and 4: merge and release (2 min)

A human approves and merges. **Deploy and verify** waits on the `production` environment, which a human approves.

## 8. Evidence goes back to the PM (2 min)

After deploy, the verify job runs `acceptance/proposal-N.mjs` against the live API and comments a pass or fail table on the proposal. All pass: the proposal is labeled `verified` and closed. Anything fails: `verification-failed` and `needs-human`.

Rehearsal: run the illustrative check against a local API. On the unfixed baseline it fails all five criteria, which is the point.

```bash
cd api && npm ci && npm run db:seed:dev && npx tsx src/index.ts &
API_BASE_URL=http://localhost:3000 node docs/agentic-sdlc/sample-run/proposal-example.mjs
```

## Closing line

Humans chose the outcome, approved the contract, edited the plan, merged, and released. Agents did the discovery, planning, coding, checking, repair, and verification, and every step left a reviewable artifact.
