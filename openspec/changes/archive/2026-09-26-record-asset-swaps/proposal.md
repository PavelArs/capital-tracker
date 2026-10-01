## Why

The owner cannot record a crypto-to-crypto or crypto-to-stablecoin exchange without
inventing independent USD trades. That loses the atomic relationship and can
misrepresent unknown consideration or portfolio flows. The existing exact connected
FIFO ledger now provides the prerequisite transfer and missing-cost behavior.

## What Changes

- Record already-executed, same-account, two-instrument exchanges as one immutable
  operation with explicit outgoing/gross incoming quantities, nullable declared USD
  consideration and an optional explicit fee asset/quantity.
- Preserve both legs, fee consumption, original incoming-lot provenance, independent
  unknown evidence, corrections, terminal voids and identical explicit retries.
- Restate connected histories, CSV validation, historical positions and valuations
  with swaps; report swap results separately from actual USD trade totals.
- Provide a protected Russian review/create/correct/void journey with exact data,
  complete review pins and frozen ambiguous-command recovery.
- Add only swap identity/version storage; retain existing rows, receipts and schemas.

## Capabilities

### New Capabilities

- `asset-swaps`: Atomic manual exchanges, fee convention, exact FIFO evidence,
  private immutable persistence and owner review.

### Modified Capabilities

- `usd-fifo-trades`: Shared chronology, connected revisions and swap-origin lots.
- `usd-csv-imports`: Validate candidate and rollback history against effective swaps.
- `owned-account-transfers`: Preserve swap origins and rebuild dependent exchanges.
- `asset-reward-receipts`: Reward corrections validate dependent swaps.
- `historical-accounting`: Restate both legs/fee together and expose swap evidence.
- `historical-account-valuation`: Value swap holdings from the same database snapshot.
- `manual-portfolio-valuation`: Include exchanges exactly once across selected accounts.
- `account-valuation-history`: Reuse loaded exchange histories for every series point.

## Impact

Depends on archived `record-owned-transfers` and `record-asset-rewards`. Extend the
NestJS accounting module, pure FIFO book, connected loader and existing React journal;
add one additive migration and selected real PostgreSQL/HTTPS acceptance. No new
dependency, provider, background job, deployment replacement or paid service.

Non-goals: executing exchanges, tax reporting, inferred USD/stablecoin prices,
cross-account swap settlement, multi-leg routing, exchange/provider import and chain
reconciliation. These remain separately tracked target work; unsupported observations
must never be represented as automatically reconciled. No real owner data or production
access, destructive migration, repository consolidation or folder deletion in this slice.
