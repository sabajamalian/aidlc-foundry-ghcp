# Foundry policy check

The Copilot code review agent reviews PRs for general quality. The Foundry policy check enforces **this team's** written standards, the ones a generic reviewer can't know. It runs on every PR from [`foundry-policy-check.yml`](../../.github/workflows/foundry-policy-check.yml) and reads rules from [`.github/policies/team-standards.yml`](../../.github/policies/team-standards.yml) at the base commit.

## How a PR is judged

1. The workflow checks out the **base** commit, so the policy file and the checker can't be changed by the PR under review.
2. `gh pr diff` fetches the PR diff as text. Only added lines are judged, except for `when: modified_or_deleted` rules.
3. **Pattern rules** run as regexes. No model call. Same input, same result.
4. **Decision rules** go to Microsoft-Decision on Foundry. For each changed file, one request carries one `choice` question per applicable rule, with options `violation`, `compliant`, `not_applicable`, `cannot_tell`. The model gets the added hunk and the rule text, and picks an option. File and line numbers come from the diff, never from the model. Calls are capped by `decision.max_calls`.
5. The result is PASS (exit 0), FAIL (exit 1, a blocking rule hit), or UNAVAILABLE (exit 2, Decision couldn't be reached or answered, and no blocking hit was found). UNAVAILABLE is reported as a warning, never as a pass.
6. The report goes to the job summary, a single PR comment (updated in place), inline annotations, and a JSON artifact.

Microsoft-Decision fits here because each question is bounded: one rule, one excerpt, a fixed set of answers. It isn't asked to find problems in general or to write fixes. That's Copilot's job.

## Writing a rule

```yaml
- id: MONEY-001                  # stable id, shows up in annotations and repair comments
  title: Money math goes through the shared pricing helper
  kind: decision                 # or: pattern
  enforcement: advisory          # or: blocking
  threshold: 0.8                 # decision only; used when the API returns a probability
  applies_to: ["api/src/**/*.ts"]
  exclude: ["**/*.test.ts"]
  instructions: >-               # decision only; a yes/no question about the added code
    Team rule: ... Does the added code follow this rule?
```

Pattern rules use `pattern` (Python regex over added lines) and `message`. Use `when: modified_or_deleted` for rules about touching existing files, like DB-001.

Tips:

- Prefer a pattern rule whenever a regex can decide it.
- Write decision instructions as the rule, the cases that are fine, then a single question. Name the allowed exceptions; that's where false positives come from.
- Keep one concern per rule. Two concerns in one question make `cannot_tell` more likely.

## Promoting a rule to blocking

Every decision rule starts `advisory`. Before flipping one to `blocking`:

1. Collect at least 20 labeled hunks for it, half violations and half compliant, including the tricky allowed cases.
2. Run the checker on each and record the outcome and any probability returned.
3. Promote only if there are no false positives at the chosen threshold. Then raise the threshold if needed rather than lowering it.
4. Make the change in its own PR so the promotion itself gets reviewed.

The probability field names in the Decision response are parsed tolerantly (see `parse_answer` in [`sdlc/decision_client.py`](../../sdlc/decision_client.py)) and need checking against a live deployment. If no probability comes back, a blocking rule fails only on an explicit `violation` choice.

## Running it locally

```bash
pip install pyyaml
gh pr diff 42 > pr.diff     # or: git diff main...HEAD > pr.diff
python3 -m sdlc.policy_check --policy .github/policies/team-standards.yml --diff pr.diff --markdown report.md
```

Set `FOUNDRY_RESOURCE_ENDPOINT`, `FOUNDRY_DECISION_DEPLOYMENT`, and either `FOUNDRY_DECISION_TOKEN` (from `az account get-access-token --resource https://cognitiveservices.azure.com`) or `FOUNDRY_DECISION_API_KEY` to include decision rules. Without them, decision rules report `unavailable`.

## What the agent does with findings

If the check fails on a PR opened by the Copilot coding agent, [`agent-repair-loop.yml`](../../.github/workflows/agent-repair-loop.yml) posts the report to the PR as an `@copilot` comment. After `REPAIR_MAX_ATTEMPTS` tries it labels the PR `needs-human` instead. An UNAVAILABLE result never triggers a repair, because the agent can't fix an outage.
