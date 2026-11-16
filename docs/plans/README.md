# Implementation plans

Each file here is a plan written by the Copilot **planner** agent for one PM-approved proposal issue, then reviewed and edited by a human.

- **Naming:** `proposal-<issue>-<slug>.md`, using [`TEMPLATE.md`](TEMPLATE.md).
- **Approval:** a plan is approved when its plan-only PR is merged with at least one human approval. The `plan-guard` check rejects plan PRs that touch anything else or have invalid front matter.
- **Binding:** on merge, `start-implementation.yml` creates an implementation issue that pins the plan path **and merge commit SHA**, then assigns it to the Copilot **implementer** agent. Later edits to the plan need a new plan PR and a new approval.
