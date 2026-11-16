# Setup

What you need to run the full loop in your own copy of this repo. The offline rehearsal in [demo-script.md](demo-script.md) needs none of this.

## 1. Microsoft Foundry

1. Create a Foundry resource and project in a region that offers both your chat model and Microsoft-Decision.
2. Deploy a chat model for the discovery agent (for example `gpt-4.1`). Note the deployment name.
3. Deploy **Microsoft-Decision** on the same resource. Note the deployment name.
4. Note two endpoints:
   - Project endpoint, for the Agent Service: `https://<resource>.services.ai.azure.com/api/projects/<project>`
   - Resource endpoint, for Decision: `https://<resource>.services.ai.azure.com`

The discovery runner creates or updates a prompt agent named `octocat-discovery` on each run, using [`sdlc/agents/discovery-agent.md`](../../sdlc/agents/discovery-agent.md) as its instructions and a JSON schema for structured output. You don't create it by hand.

## 2. Azure identity for GitHub Actions (OIDC)

1. Create an Entra app registration (or user-assigned managed identity).
2. Add federated credentials for this repo: `repo:<owner>/<repo>:ref:refs/heads/main`, `repo:<owner>/<repo>:pull_request`, `repo:<owner>/<repo>:environment:production`. Issue-triggered runs use the default-branch ref.
3. Grant roles:
   - **Azure AI User** on the Foundry project (discovery agent).
   - **Cognitive Services User** on the Foundry resource (Decision).
   - **Contributor** and **AcrPush** on the resource group and registry used for deployment.

## 3. Deployment target (optional)

You need a resource group, an Azure Container Registry with the admin user enabled (the bicep uses registry credentials), and a Container Apps environment. [`infra/container-apps.bicep`](../../infra/container-apps.bicep) creates the two apps.

## 4. Repository variables and secrets

| Name | Kind | Used by |
|---|---|---|
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | variable | all Azure logins |
| `FOUNDRY_PROJECT_ENDPOINT` | variable | discovery |
| `FOUNDRY_MODEL_DEPLOYMENT` | variable | discovery |
| `FOUNDRY_RESOURCE_ENDPOINT` | variable | policy check |
| `FOUNDRY_DECISION_DEPLOYMENT` | variable | policy check |
| `POLICY_UNAVAILABLE_FAILS` | variable, optional | set `true` to fail the check when Decision is down |
| `REPAIR_MAX_ATTEMPTS` | variable, optional | repair loop bound, default 3 |
| `AZURE_RESOURCE_GROUP`, `ACR_NAME`, `ACA_ENVIRONMENT_ID`, `DEMO_INSTANCE_NAME` | variable | deploy |
| `COPILOT_ASSIGN_TOKEN` | secret | assigning Copilot and posting `@copilot` repair comments |

`COPILOT_ASSIGN_TOKEN` must be a user token (fine-grained PAT with read and write on issues and pull requests, or a classic PAT with `repo`) from someone with write access and a Copilot coding agent seat. `GITHUB_TOKEN` can't assign Copilot, and Copilot ignores `@copilot` mentions from bots. Without this secret the workflows still run and post instructions for doing those steps by hand.

## 5. GitHub settings

1. **Labels:** `scripts/bootstrap-labels.sh owner/repo`.
2. **Copilot coding agent:** enable it for the repo. The [`copilot-setup-steps.yml`](../../.github/workflows/copilot-setup-steps.yml) workflow prepares its environment.
3. **Copilot code review:** add a branch ruleset on `main` with "Automatically request Copilot code review" turned on, including new pushes.
4. **Branch protection on `main`:** require one approving review, and require the `api`, `frontend`, `sdlc`, `plan-guard`, and `policy` checks. Leave `policy` advisory at first if you prefer; see [policy-check.md](policy-check.md).
5. **Environment `production`:** add required reviewers. This is release gate G4.
6. **Actions:** decide whether to require approval for workflows on Copilot's PRs. If you keep the default, someone clicks "Approve and run workflows" after each Copilot push, and that's a visible human step in the demo.

## 6. Smoke test

1. Run **Foundry discovery** from the Actions tab with "Rehearsal mode" checked. You should get a `proposal` issue without calling Azure.
2. Run it again unchecked. You should get a proposal from the live agent.
3. Open any small PR. **Foundry policy check** should post a comment that says PASS, FAIL, or UNAVAILABLE.
