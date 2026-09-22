## Why

Legacy wallet balances and household-finance amounts cannot establish acquisition
history or exact cryptocurrency accounting. The owner needs a small, usable way
to record manual opening positions without silently inventing costs or gains.

## What Changes

- Add a protected Russian manual-account page with owner-scoped manual instrument
  identities and exact opening quantities, known total USD cost, or explicit
  unknown cost. Preserve distinct instruments even when their symbols match.
- Store exact amounts as PostgreSQL numerics and API strings. Record an explicit
  UTC coverage boundary; it is neither an acquisition date nor a contribution.
- Support complete opening-state replacement using optimistic revisions, retaining
  every prior snapshot. Database-backed request identities make retries safe.
- Add only migration13 and new routes. Preserve all prior owner/authentication,
  financial and wallet rows, configurations and existing authenticated journeys.

This slice deliberately excludes CSV import, trades, FIFO, transfers, prices,
valuation, profit, XIRR/TWR, chain connections and legacy balance conversion. Those
remain required later slices. No provider call or new package is needed here.

## Capabilities

### New Capabilities

- `manual-opening-positions`: Exact, private manual accounts and opening-state
  revisions with explicit provenance, identity and cost completeness.

### Modified Capabilities

- `explicit-migrations`: Extend the verified twelve-migration history with one
  additive manual-account migration and populated predecessor preservation.

## Impact

One narrow Nest accounting module and React page/API, existing authenticated
layout wiring, an additive migration, independent decimal/time tests and real
PostgreSQL/HTTPS acceptance. Reuse the established session, CSRF and generic-route
guard; introduce no public route or authentication exception. Existing provider
adapters, household totals and wallet observations remain separate.

Implementation depends on verified closure of `persist-auth-request-limits`.
This proposal is prepared independently while that release-image suite runs;
no accounting behavior, schema or user data has changed. All verification uses
the isolated synthetic stack. Production release and final repository consolidation
remain outside this change.
