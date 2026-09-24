## Why

Owned transfers must retain each lot's original allocation coordinates through
partial movement and later disposal. Current FIFO keeps a mutable cumulative
allocation privately; extract the same mathematics before connected-account replay
so a moved fragment cannot accidentally be rebased and lose its final cost atom.

## What Changes

- Represent remaining inventory internally as an interval of the original lot.
- Share exact cost and prefix-split operations across existing trade/carry-in FIFO.
- Retain all public shapes, allocation ordering, bounds and error behavior.
- Preserve passing characterization and add focused internal conservation oracles.

## Capabilities

### New Capabilities
- `fifo-cost-conservation`: Original-coordinate interval accounting and split conservation.

### Modified Capabilities
None. Existing trade, carry-in, CSV, history and valuation requirements stay unchanged.

## Impact

Backend pure FIFO module and small interval helper only. No schema, endpoint,
frontend, provider, dependencies, chart, deployment or saved-data change. Keep the
inspected GHCR/Compose pipeline and guarded manual CD. No artificial RED for this
pure refactor; actual PostgreSQL and existing critical browser paths must stay green.

This is a prerequisite for persisted owned transfers, not delivery of transfers.
Connected replay, correction propagation, fee-asset consumption and revision
invalidation will be specified and implemented next; full brief remains the goal.
