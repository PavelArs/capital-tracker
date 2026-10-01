## Why

The brief requires EUR/RUB display backed by stored observations. Existing legacy
FX reads use a current-rate memory/Redis path and may call the provider. A small,
separate indicative conversion view can establish reliable daily collection without
changing USD accounting or claiming unavailable historical exchange rates.

## What Changes

- Opt-in daily collection from the fixed no-key ExchangeRate-API open USD endpoint,
  with PostgreSQL coordination, bounded attempts and preservation of last-good data.
- Immutable exact EUR/RUB observation batches, publication/fetch timestamps and
  persistent collection health. Database-only authenticated personal USD conversion.
- Russian Settings panel with exact indicative results, attribution, freshness,
  explicit collection and database refresh actions.
- Additive migration 19, fresh/populated-18 preservation and targeted real PG/HTTPS
  acceptance. No paid plans, keys, new dependencies or production rollout.

## Capabilities

### New Capabilities
- `daily-display-fx`: Stored daily indicative USD to EUR/RUB conversion for the owner.

### Modified Capabilities
None. Legacy currency consumers, manual USD prices, accounting, profit/XIRR and
the account chart contract remain unchanged.

## Impact

New backend display-fx module, two additive tables, Settings panel, environment
flag, isolated provider fixture and test-runner wiring. Keep existing Compose/GHCR
deployment. No deletion of old rates, financial data or unrelated work.

Non-goals: crypto quote ingestion, historical FX backfill/export/general rate feed,
automatic historical currency substitution, legacy Redis removal, whole-portfolio
conversion or changing the chart maximum period. The owner deferred chart review
until the overall refactor is ready (2026-09-24).

Provider docs/terms were rechecked2026-09-24: open access needs no key, daily updates,
attribution and permits stored customer end use, forbidding redistribution. This
private indicative conversion is an end-use feature, not a reusable rate service.
CoinGecko permanent retention remains unapproved; no claim that FX solves it.
