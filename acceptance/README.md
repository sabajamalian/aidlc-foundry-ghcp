# Executable acceptance checks

One file per approved proposal: `acceptance/proposal-<issue>.mjs`. The Copilot implementer writes it in the same PR as the change, and it encodes the proposal's acceptance criteria one-to-one (`check('AC-1: ...')`).

After a production deployment, `deploy.yml` runs every check whose proposal issue is labeled `implementing`, posts the Markdown result on the proposal issue as evidence, and then labels it `verified` (and closes it) or `verification-failed`.

```bash
API_BASE_URL=http://localhost:3000 node acceptance/proposal-7.mjs
```

Rules for writing checks are in [`.github/instructions/tests.instructions.md`](../.github/instructions/tests.instructions.md). A worked example is in [`docs/agentic-sdlc/sample-run/proposal-example.mjs`](../docs/agentic-sdlc/sample-run/proposal-example.mjs).
