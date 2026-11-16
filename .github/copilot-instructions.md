# OctoCAT Supply: repository-wide Copilot instructions

These instructions apply to every Copilot agent working in this repository: the planner, the implementer, and Copilot code review. Path-specific rules live in `.github/instructions/*.instructions.md`. Role-specific behavior lives in `.github/agents/*.agent.md`.

## What this repository is

OctoCAT Supply is an existing (brownfield) supply-chain app that branches use to order products from headquarters suppliers.

- `api/`: Express + TypeScript REST API, SQLite persistence through the repository pattern (`api/src/repositories`), Swagger docs in JSDoc comments on route files, Vitest + supertest tests.
- `frontend/`: React 18 + Vite + Tailwind, data fetching with React Query.
- `api/database/migrations` and `api/database/seed`: sequential SQL migrations and deterministic seed data.
- `infra/`: Azure Container Apps Bicep.
- `sdlc/`, `.github/workflows/`, `.github/policies/`: the agentic SDLC tooling. Product changes must not modify these.

See `docs/architecture.md` and `docs/sqlite-integration.md` before changing data access.

## How work flows here

Work moves through human-approved stages. Respect the stage you were started in:

1. **Proposal** (GitHub issue labeled `proposal`): written by the Foundry discovery agent and edited and approved by a product manager. The acceptance criteria in the approved proposal are the contract.
2. **Plan** (`docs/plans/*.md`): written by the planner agent and approved by a human through a plan-only PR. A merged plan is the approved scope.
3. **Implementation**: done by the implementer agent against a specific plan commit, then checked by CI, Copilot code review, and the Foundry policy check.

### Exception: draft implementation before plan approval

When the user explicitly requests an implementation PR before the plan is approved
and merged, proceed with a **draft** PR. That request authorizes implementation
and review against the proposed scope; it does not approve the plan or authorize
merging. Do not require a separate plan approval to start this draft work.

- Use the linked proposal's acceptance criteria and pin the proposed plan's exact
  file path and commit SHA. Do not broaden the scope.
- State in the PR that the plan is unapproved, link its PR, and keep the
  implementation draft and not merge-ready.
- Request Copilot code review and run the existing Foundry policy check on the
  draft. Verify that Foundry evaluated applicable code, not just that a workflow
  succeeded. Report unavailable judgments honestly.
- Leave plan-guard enabled. An expected failure for an unmerged plan must be
  disclosed, not bypassed or described as a pass.
- Before marking the implementation ready, obtain plan approval and merge,
  rebind the implementation to the merged plan revision, reconcile any scope
  changes, and rerun checks. Neither PR may be merged on the basis of this exception.

Never change acceptance criteria, approved plans, `.github/policies/**`, or `.github/workflows/**` to make a check pass. If the plan is wrong or incomplete, stop and say so in the PR instead of silently widening scope.

## Build and test

```bash
cd api && npm ci && npm run lint && npm run build && npx vitest run
cd frontend && npm ci && npm run lint && npm run build
python -m unittest discover -s sdlc/tests -t .   # SDLC tooling only
```

Run the API and frontend locally with `make dev` (API on 3000, frontend on 5173).

## General coding rules

1. Prefer small, incremental diffs that match existing naming and style.
2. Fix security and data-integrity issues before micro-optimizations.
3. No `any` unless justified in a comment. Add or refine model types when gaps appear.
4. Put shared logic in a repository method or `api/src/utils` helper rather than duplicating it in routes or components.
5. Use the error types in `api/src/utils/errors.ts` and let the error middleware set status codes.
6. Every behavior change ships with tests: repository tests against the in-memory DB and route tests with supertest.
7. Configuration comes from environment variables. No hard-coded paths, URLs, or secrets.
8. Money: keep currency math in a single shared helper and round to cents (2 decimals) once, at the line-item level. Don't duplicate pricing math in the frontend; display values the API returns.

## Review priorities (Copilot code review)

Order feedback by: security and data integrity, functional correctness against the linked plan and acceptance criteria, performance, maintainability, readability, style. Quote only the lines that need to change and give a "because" for non-trivial suggestions. Flag any change that goes beyond the approved plan.
