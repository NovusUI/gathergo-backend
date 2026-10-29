# Operations reviews and calculated settlements

All endpoints below use `/api/v1` and a dashboard session through `Authorization: Bearer <token>`. Users can inspect data; admins perform resolutions and settlement operations. See [dashboard authentication](dashboard-auth.md) for setup and exact contracts.

## User payment risk

`GET /transaction-reference/internal/risk-queue` accepts pagination, independent `riskStatus`, `transactionStatus`, `settlementStatus` and `reviewed` filters, plus `userQuery` (up to 150 characters) and `userRole` (`buyer`, default, or `creator`). Omitting a status filter includes every state; there is no implicit flagged-only or active-payment scope. Risk filters accept every stored risk state, including `BLOCKED`; review decisions remain `CLEAR`, `REVIEW` or `HOLD`. The search matches user ID, full name, username or email. Creator searches include payments with legacy event ownership. Summary counts intersect all selected filters, including risk and manual review state.

`POST /transaction-reference/internal/risk-reviews` accepts:

```json
{"transactionIds":["payment-1","payment-2"],"riskStatus":"CLEAR","note":"Reviewed buyer activity"}
```

The selection must contain 1–50 unique nonempty string IDs. Decisions are `CLEAR`, `REVIEW` or `HOLD`. Each payment uses the same policy and audit history as the single-payment review endpoint. The response is `{succeeded: string[], failed: {id, message}[]}` inside the standard response envelope. Processing continues after an individual failure. Concurrent changes cause a conflict instead of overwriting the newer payment state.

Risk review does not confirm payment or create a settlement. Only successful, pending or awaiting-transfer payments can be risk-reviewed; terminal payment states and payments already in settlement processing are locked. Clearing a pending payment leaves settlement `NOT_READY`. For a creator payment, the risk decision, creator settlement reconciliation and final audit status commit in one database transaction, including Basic KYC cap checks. Reconciliation failures roll back the decision. Queue reads reconcile matching creators with the same wallet rules before applying settlement-state filters or calculating counts. This repairs stale ready/held states, including blocked risk and unpaid legacy records.

Risk and wallet calculations share the same recorded pricing resolvers. Captured checkout gross, buyer charge, platform fee and creator payable are authoritative, including zero values. Existing legacy amounts without `amountUnit: KOBO` are converted once; backfill updates the stored amount together with the unit marker. The dashboard distinguishes buyer charges from net creator payable. Buyer searches remain risk-review views; the creator settlement shortcut requires creator search mode, a successful payment, clear risk and `READY`.

The creator held balance includes successful payments in either `HELD_KYC` or `HELD_RISK`, regardless of their risk status. A `HOLD` risk filter therefore shows only part of that balance when risk-clear payments still await KYC. Pending and terminal payments do not contribute to the held balance.

## Calculated creator settlements

- `GET /wallet/internal/settlement-queue?page=1&pageSize=20&search=...` lists creators with successful payments. Its nested `data` contains `{data,total,page,pageSize}`. Each candidate supplies creator identity, payout destination/status, KYC tier, balances in NGN, eligible payment count, `canSettle` and explicit blockers.
- `GET /wallet/internal/settlements/:creatorId/preview` returns `{candidate,calculation,transactions,evaluatedAt}`. `calculation` uses integer kobo: `grossAmountKobo`, `deductionsKobo`, `netAmountKobo`, plus `transactionCount`. The first 20 eligible payments are shown as a sample; totals cover every eligible payment. Previewing runs the existing wallet backfill, KYC cap and payout eligibility rules.
- `GET /wallet/internal/settlements?page=1&pageSize=20&status=...&creatorId=...` supplies platform-wide settlement history with creator identity. It uses the standard top-level pagination `meta` envelope.
- `POST /wallet/internal/settlements/:creatorId` accepts `expectedAmountKobo` and `expectedTransactionCount` from the reviewed preview. Either supply both or omit both. Existing optional `transactionIds` remain supported. The dashboard always supplies both preview checks. A mismatch returns 409 and requires recalculation.

Only successful, risk-clear, ready, positive-payable and unallocated payments enter a new settlement. The existing stored pricing determines creator payables; checkout fees paid by buyers are not deducted again. Creation rechecks eligibility and claims payments atomically with the settlement record/allocations. Competing claims roll back rather than duplicating allocations.

Reconciliation releases cleared payments from either KYC or risk hold once the creator is eligible, regardless of the order in which the holds were cleared. Unpaid/failed/expired/refunded records cannot contribute to readiness or allocations. Refreshing the dashboard refreshes both creator balances and the open calculation panel.

Database regression tests use the dedicated local database `gathergo_risk_settlement_test` via `RISK_SETTLEMENT_TEST_DATABASE_URL` and `src/modules/wallet/service/risk-settlement.integration.spec.ts`. They are skipped when the variable is absent. The test harness rejects other database names and non-loopback hosts and uses synthetic users/payments; external collection and identity providers are not called.

Creation prepares a pending settlement; it does not initiate a bank transfer. Existing `POST /wallet/internal/settlements/:settlementId/complete` records a verified provider outcome. Successful records cannot be reversed through this endpoint; repeated success is idempotent. Failed/cancelled allocations remain attached to their original record for reconciliation and cannot enter a second settlement. Reopening that record as pending/processing reserves its allocated payments again.

The dashboard uses its staff session for these operations. Actual provider transfer execution is a separate integration.

## Creator directory and profiles

Both dashboard roles can read `GET /dashboard/internal/creators` and `GET /dashboard/internal/creators/:id` with their dashboard session. App users have no separate creator role: directory membership means at least one created event, creator payment/settlement record, or a payout/KYC/ALAT status beyond `NOT_STARTED`. Merely having an empty onboarding row does not make a user a creator.

The directory accepts `page` (1+), `pageSize` (1–50, default 20), `search` (creator ID, name, username or email; up to 150 characters), `kycStatus` and `payoutStatus` using existing Prisma status enums. `NOT_STARTED` includes absent profiles. The standard response's `data` contains `{data,total,page,pageSize,summary:{eventCreatorCount,verifiedKycCount,payoutActiveCount}}`; rows and counts share the same filters. Rows expose only selected identity/status fields, masked bank details and event/follower counts.

Creator detail returns `{creator,recentEvents,liveUpcomingEvents,payments,evaluatedAt}`. It includes the five most recently created events (past events included), a contact/bio profile and recorded payment totals: `successfulCount`, `grossAmountKobo`, `creatorPayableKobo`, `settledAmountKobo`. These totals use successful payments and successful settlement records; legacy payments with null `creatorId` use their event's creator. They are not the live eligible wallet balance; use the existing settlement preview for that. Missing or non-creator users return 404. Passwords, reset tokens, raw bank account numbers and raw KYC identifiers are not selected. This feature adds no schema migration.

The KYC and payout directories now accept optional `userId` (up to 100 characters) for exact creator links. A KYC `userId` also removes the default pending-review-only scope so a verified creator's record remains inspectable; explicit status filters still apply. Payout links send `needsAction=false` to inspect the selected submitted profile. Reviews retain their existing admin-only permission. Creator risk and settlement links use the existing `userQuery`/`userRole=creator` and settlement creator filters.

## Platform events

Both staff roles can read `GET /dashboard/internal/events` and `GET /dashboard/internal/events/:id`. This directory includes all creators and past events, independently of the overview's 12 live/upcoming records. Query parameters are `page` (1+), `pageSize` (1–50, default 20), `search` (up to 150 characters; event ID/title/location or creator ID/name/username/email), `creatorId`, `registrationType` (`ticket`, `registration`, `donation`, `volunteer`) and `status` (`UPCOMING`, `LIVE`, `ENDED`). Events are ordered by start date descending, then ID. The standard response's `data` contains `{data,total,page,pageSize,summary:{upcomingCount,liveCount,endedCount}}`; summary counts use the same filters as the rows. Ended means end date before the evaluation time; live includes both schedule boundaries.

Rows share the overview event shape and add `ENDED` to the possible statuses. Detail adds `description`, `isPhysicalEvent`, `links`, `tags` and `updatedAt`. Missing events return 404. Donation totals count completed donations only; donation amounts and targets are converted from kobo to NGN. Ticket and registration metrics retain their existing recorded pricing; volunteer metrics reuse the shared volunteer summary.

Admins can `PATCH /dashboard/internal/events/:id` with required `expectedUpdatedAt` from the reviewed detail and any of `title`, `description`, `startDate`, `endDate`, `isPhysicalEvent`, `location`, `links`, `tags`. Dates are ISO instants; historical events can be corrected. Title must be nonempty (up to 200 characters), description up to 10,000 characters, end must follow start, and physical events need a location. Link/tag/boolean normalization follows the existing event update DTO. Creator, event type and financial configuration fields are rejected by the whitelist.

Admin edits reuse the existing event update service, including volunteer constraints and expiry scheduling. The existing organiser endpoint still checks ownership. The reviewed `updatedAt` is compared inside the event row lock before writing; concurrent changes return 409 and require a refresh. Regular dashboard users receive 403 for edits. Event creation/deletion and cancellation workflows are not exposed by these staff endpoints. No additional migration or production dependency is needed.
