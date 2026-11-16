#!/usr/bin/env bash
# Creates the labels the agentic SDLC workflows use. Safe to rerun.
# Usage: scripts/bootstrap-labels.sh [owner/repo]
set -euo pipefail
repo="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

while IFS='|' read -r name color desc; do
  gh label create "$name" -R "$repo" --color "$color" --description "$desc" --force
done <<'EOF'
direction|0E8A16|Human-set direction; starts Foundry discovery
proposal|1D76DB|Proposal drafted by the Foundry discovery agent
needs-pm-review|FBCA04|Waiting for a product manager
pm-approved|0E8A16|PM approved the proposal; starts planning
planning|C5DEF5|Copilot planner is drafting the plan PR
implementing|5319E7|Plan approved; Copilot implementer is working
agent-repair|D4C5F9|Findings were sent back to the agent
needs-human|B60205|Agents stopped; a human must decide
verified|0E8A16|Acceptance criteria pass in production
verification-failed|B60205|Acceptance criteria failed after deploy
EOF
