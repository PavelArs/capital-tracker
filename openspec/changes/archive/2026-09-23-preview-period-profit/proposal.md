## Why

Recorded external USD flows now have exact, owner-scoped history, but the owner cannot yet distinguish new capital from period profit. The target brief requires ending value minus starting value minus contributions plus withdrawals. A manual valuation preview makes this rule usable without inventing historical prices.

## What Changes

- Add a read-only period profit preview using explicitly reviewed opening and closing total USD valuations and the complete current external-flow history for the selected period.
- Add a Russian form that explains valuation boundaries, unreconciled data, exact amounts and temporary results.
- Preserve existing journal and accounting behavior with focused characterization checks.

## Capabilities

### New Capabilities

- `period-profit-preview`: Exact manual-valuation period profit, owner snapshot isolation, strict inputs and honest UI states.

### Modified Capabilities

None. Existing external-flow semantics remain unchanged.

## Impact

Backend accounting projection/service/controller and a small frontend page/API binding; focused pure, PostgreSQL and real HTTPS acceptance tests. Depends on the archived external USD flow change. No migration, persisted valuations, new dependency, provider call, deployment change or data mutation. Existing deployment pipeline stays intact.

Non-goals: XIRR/TWR, automatic marked valuations, historical price providers, realized/unrealized gains, tax claims, negative manual valuations, transfers/rewards, charts and test-suite deletion. These remain separate changes; this preview is not completion of the whole performance requirement.
