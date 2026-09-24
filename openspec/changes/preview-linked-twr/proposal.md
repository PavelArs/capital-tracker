## Why

Endpoint TWR correctly refuses periods needing intermediate valuations. The owner
needs to supply those values and calculate a linked period return from the existing
reviewed flow journal, without inventing prices or changing saved accounting data.

## What Changes

- Add a private read-only boundary plan and reviewed linked-TWR preview, pinned to
  the same flow-journal revision, supporting up to32 nonzero interior net-flow instants.
- Geometrically link exact rational subperiod factors and round the final rate once.
- Add a separate Russian section to the existing manual period screen for boundary
  valuations, explicit review and supported/unavailable results.
- Preserve the existing endpoint TWR, profit and XIRR contracts and passing tests.

## Capabilities

### New Capabilities
- `linked-twr-preview`: Reviewed manual flow-boundary valuations and coherent linked period return.

### Modified Capabilities
None. Existing TWR arithmetic formatting may be shared as a pure refactor only.

## Impact

Small accounting parser/projector, portfolio-flow controller/service, API client
and frontend section. No migration, stored plan, data write, provider, dependency,
chart or deployment change. Keep GHCR/Compose and the guarded production rollout.

Depends on the existing owner flow journal and exact profit snapshot. Non-goals:
automatic valuations, interpolation, annualization, saved reports, chart maximum
period, blockchain synchronization, original-repository consolidation or deletion.
