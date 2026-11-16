---
proposal: 1
status: proposed
title: "Catalog-priced order lines and visible order totals"
---

# Plan: catalog-priced order lines and visible order totals

## 1. Summary

Derive new order-line prices from the product catalog on the server, snapshot the discounted unit price, and include totals in order responses. The feature is tracked in [KAN-1](https://saba-demo-project.atlassian.net/jira/browse/KAN-1) and mirrored in GitHub issue [#1](https://github.com/sabajamalian/aidlc-foundry-ghcp/issues/1). The ticket does not imply plan approval.

**Human gate:** this plan is proposed, not approved. A draft implementation can be inspected as a demo preview, but must not be merged until a human approves and merges this plan. Rebind the implementation PR to the resulting main-branch plan commit before requesting final approval.

## 2. Acceptance criteria (verbatim from the proposal)

| ID | Criterion | Proved by (tests / acceptance check) |
|----|-----------|------------------------------------|
| AC-1 | Creating a line for product 1 (price 129.99, discount 0.25), quantity 2, without a client unitPrice returns and stores unitPrice 97.49. | Repository and route tests; acceptance AC-1 |
| AC-2 | A supplied unitPrice never overrides catalog pricing on creation. A direct unitPrice update cannot override the stored server price either. | Create and update repository/route tests; acceptance AC-2 |
| AC-3 | Product 3 with price 89.99 and discount 0 returns unitPrice 89.99. | Repository tests; acceptance AC-3 |
| AC-4 | Both individual and list order reads include totalAmount. An order with two units of product 1 and one of product 3 returns 284.97; an empty order returns 0. | Order repository/route tests, empty and multi-line orders; acceptance AC-4 |
| AC-5 | Creating or changing a line to an unknown product returns 404 and does not persist the change. | Repository and route tests with database assertions; acceptance AC-5 |
| AC-6 | Quantity must be a positive integer; invalid quantities return 400 without persisting changes. | Parameterized repository and route tests; acceptance AC-6 |
| AC-7 | Changing productId recalculates the line price from that product. Quantity-only and notes-only updates preserve the stored price, even after catalog discounts change. | Repository and route tests; acceptance AC-7 |

## 3. Current behavior (brownfield analysis)

`api/src/routes/orderDetail.ts` passes request bodies to `OrderDetailsRepository.create` and `update`. The repository inserts or updates the supplied unit price without consulting the product catalog. Clients can therefore bypass catalog discounts, and a missing unit price produces a database failure.

`api/src/models/order.ts` documents a total in Swagger, but the TypeScript model and `OrdersRepository` reads don't return one. `OrderDetailsRepository.getTotalValueByOrderId` has an unused total query. Reuse or replace that calculation through the shared pricing helper rather than maintaining two definitions.

## 4. Affected components

| Area | Files | Change |
|------|-------|--------|
| Pricing | `api/src/utils/pricing.ts` | Shared discounted-price and rounded-total calculations |
| Data access | `api/src/repositories/orderDetailsRepo.ts`, `ordersRepo.ts` | Snapshot catalog pricing, validate writes, calculate totals without per-order query loops |
| API | `api/src/routes/orderDetail.ts`, `order.ts` | Preserve thin routes, shared error middleware and existing endpoints |
| Types and Swagger | `api/src/models/orderDetail.ts`, `order.ts`, route JSDoc | Request compatibility, server-controlled prices, totalAmount and 400/404 responses |
| Tests | Adjacent repository, route, and helper tests | In-memory SQLite and supertest regression cases |
| Acceptance | `acceptance/proposal-1.mjs` | Seven criterion-linked checks with cleanup |

No schema, seed, frontend, infrastructure, or workflow changes belong in the feature PR.

## 5. Implementation steps

1. Add a shared pricing helper and focused cent-exact tests. Compute the discounted unit price once, round to cents, and derive rounded line amounts and totals from stored prices. Guard against invalid/non-finite catalog values rather than propagating NaN.
2. Refine the creation input type so clients needn't supply unitPrice. Whitelist persistable fields. Validate positive integer quantity and product identity before writes. Fetch the catalog product with a bound parameter and use `NotFoundError` or `ValidationError` for failures.
3. Use the same repository write rules for updates. Ignore client unitPrice, recalculate when productId actually changes, and preserve the stored price for quantity-only or notes-only updates. Validate before executing a write so rejected updates leave the original row unchanged.
4. Return totalAmount on single and list order reads, including 0 for empty orders. Avoid an N+1 query for order lists, and don't accidentally insert the computed field when creating or updating orders.
5. Update Swagger and directly related model documentation. Retain the existing routes and tolerate legacy clients that still send unitPrice, but treat the field as server-controlled.
6. Add repository and route regression tests for AC-1 through AC-7. Add one dependency-free acceptance check per criterion using `acceptance/lib.mjs`; create and clean up only its own records, without changing catalog seed records.
7. Address actual Copilot review and Foundry team-standard findings without editing the plan, policies, or workflows in the implementation PR.

## 6. Data and compatibility

No migration or seed edit is required. Existing stored line prices remain unchanged. The additive totalAmount field uses existing stored line prices, not current catalog prices. Legacy callers may send unitPrice, but it no longer controls billing.

Rollback is a code rollback. Because this plan doesn't backfill historical records, it doesn't require a data rollback. Review clients that deliberately relied on manually supplied prices before merging.

## 7. Test plan

Run the API's existing commands:

```bash
cd api
npm run lint
npm run build
npx vitest run
```

Cover create and update pricing, missing products, invalid quantities, price-only tampering, rounding, unchanged historical prices after catalog edits, empty orders, and single/list totals. Exercise status codes and unchanged persistence through supertest. Use the existing in-memory database setup.

Run `API_BASE_URL=<isolated seeded API> node acceptance/proposal-1.mjs` after the API starts. Every AC must produce a separate result and the check must exit nonzero when any criterion fails. Catalog edits needed to prove historical-price preservation belong in isolated repository tests, not the live acceptance harness.

## 8. Risks and mitigations

The baseline contains real CodeQL findings outside this feature. Keep the demo undeployed and track remediation separately; don't silently fold security fixes into this PR.

Added-line-only Decision judgments can miss relevant context or flag shared helper definitions incorrectly. Keep those rules advisory, expose every outcome and probability, and answer false positives explicitly. CI, tests and human review remain separate evidence.

## 9. Out of scope

UI changes, tax, shipping, currencies, refunds, historical repricing, schema changes, seed changes, catalog-editing features, and unrelated GHAS fixes.

## 10. Open questions for the reviewer

Confirm that ignoring client unitPrice, rejecting non-positive or fractional quantities, and preserving historical prices on quantity-only updates match the intended product contract. Post the mock research to KAN-1 before treating this as the final approved proposal.
