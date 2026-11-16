---
description: "Guidance for writing and reviewing tests and executable acceptance checks."
applyTo: "api/src/**/*.test.ts, acceptance/**"
---
# Tests and acceptance checks

## Unit and route tests (`api/src/**/*.test.ts`)
- Use Vitest and the in-memory SQLite database. Run migrations before repository tests, following `api/src/repositories/suppliersRepo.test.ts`.
- Route tests use supertest against the real Express router, following `api/src/routes/branch.test.ts`. Assert status code and response shape.
- Cover the happy path, a not-found case, and a validation failure for every new or changed endpoint.
- Money assertions compare exact cent values (`toBe(97.49)`), never `toBeCloseTo` with a loose precision.

## Acceptance checks (`acceptance/proposal-<N>.mjs`)
- One file per approved proposal issue `<N>`. It encodes that proposal's acceptance criteria and nothing else.
- Plain Node 20+ ESM with no dependencies. Import the helpers from `acceptance/lib.mjs`.
- Read the target from `API_BASE_URL`. Never hard-code a host.
- Each criterion is one `check('AC-n: <criterion text>', async () => { ... })` call, so verification evidence maps 1:1 to the proposal.
- Checks must be safe to run against production: create their own test data with a recognizable `acceptance-` prefix and delete it afterwards. Never mutate seed records.
