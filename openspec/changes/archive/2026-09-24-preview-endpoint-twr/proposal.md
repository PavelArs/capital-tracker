## Why

The target requires TWR alongside profit and XIRR, with insufficient data made explicit.
Reviewed endpoint valuations already support a useful, bounded case: periods with
no intermediate net external cash flow. This avoids inventing missing valuations.

## What Changes

- Add private `POST /accounting/portfolio/twr-preview` using the same reviewed inputs
  and complete owner flow snapshot as profit, returning exact profit plus period TWR.
- Adjust opening capital for simultaneous flows exactly at the start; return a
  specific unavailable result for intermediate net flows or nonpositive initial capital.
- Round only the final rate using exact integer arithmetic, never accounting amounts.
- Add an explicit Russian TWR action/result to the existing manual period form.

## Capabilities

### New Capabilities
- `endpoint-twr-preview`: Bounded manual TWR from endpoints with explicit unavailable cases.

### Modified Capabilities
None. Existing profit, XIRR, journal and historical-chart contracts remain intact.

## Impact

Depends on the existing reviewed flow journal and profit snapshot. Small domain
projector, controller/service method, API client and existing period form; unit,
real PostgreSQL and selected HTTPS acceptance. No migration, data write, provider,
dependency or deployment change. Keep GHCR/Compose and guarded CD unchanged.

Non-goals: general geometrically linked TWR using intermediate valuations, automatic
prices/cash valuation, chart maximum-period changes, saved reports or consolidation.
No deletion of data, original repositories, owner edits or existing acceptance gates.
