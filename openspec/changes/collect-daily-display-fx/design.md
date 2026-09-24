## Context

The private single-owner app has exact USD accounting and manual price history,
but its legacy currency updater uses Redis/current-number rates. Replacing every
consumer at once would mix display changes with financial changes. Add a bounded
display-fx module and private Settings converter, retaining old consumers for now.

## Goals / Non-Goals

Collect daily indicative USD/EUR/RUB observations without credentials, retain them
durably, coordinate replicas/restarts, and convert the owner's entered USD amount
from the latest saved observation. USD accounting and historical results do not
consume these rates. No history export/feed, crypto prices, graph-period change,
paid service, new dependency, arbitrary endpoint or historical-rate substitution.

## Decisions

### Provider and input boundary

Fixed `https://open.er-api.com/v6/latest/USD`; Axios text response, 5s timeout,
64KiB maximum, no redirects and no immediate HTTP retry. Direct mode explicitly
disables Axios environment proxies and uses an HTTPS-agent lookup that rejects all
non-public A/AAAA destinations, including mapped IPv4, at connection time while
retaining hostname/TLS validation. `DISPLAY_FX_TRUST_PROXY=true` instead explicitly
delegates destination resolution/enforcement to a server-managed HTTP(S) egress
proxy from existing proxy environment configuration. It defaults false. This is an
operational trust boundary, not a browser-controlled bypass; the isolated test
fixture is such an allowlisted proxy and never opens upstream sockets. Only HTTP200 with
`result=success`, `base_code=USD`, USD rate1 and positive EUR/RUB rates is accepted.
Preserve JSON number lexemes through Node22 JSON.parse reviver `context.source`,
then validate exact non-exponent decimal strings (up to48 integer/30 fractional
digits); unsupported exponent/precision is an explicit invalid-data result rather
than rounded storage. Provider currently returns ordinary decimal rate numbers.
Timestamps are safe integer Unix seconds in1970..9999: publication not >5min ahead
or >48h old; next update after publication and <=48h later; EOL0 or a future epoch.
Reject malformed/missing/string rate values, wrong base, nonfinite/negative/zero
rates, expired EOL and out-of-range dates. Never expose provider bodies/errors.

Official docs/terms checked2026-09-24:
https://www.exchangerate-api.com/docs/free and https://www.exchangerate-api.com/terms.
No-key open access has daily updates, attribution and customer-end-use storage;
no redistribution/general rate service. Limit this feature to the authenticated
owner's indicative conversion. Normal collection is31 calls/31days; worst-case
3 attempts per rolling24h window is93/31days, with no paid fallback.

### Additive storage and coordination

Migration19 adds `display_fx_observations`: fixed provider/base, primary publication
instant, fetchedAt/nextUpdateAt/endOfLifeAt, EUR/RUB numeric(78,30), positive/finite
constraints. Store both rates atomically. Same timestamp/same payload is idempotent;
same timestamp/changed rates or publication metadata is invalid and never rewrites
the original. Replay comparison excludes the newly generated fetch timestamp.
Reject an older-than-latest publication. Original fetch timestamp is immutable.

`display_fx_collection` has one fixed-provider row, created only on collection:
lastAttemptAt/lastSuccessAt/nextAttemptAt, lastOutcome, reservedAttempts (<=3 timestamps),
leaseId/leaseUntil. Short transactions lock this row, reserve an attempt/cooldown
and a30s lease before HTTP; no open DB transaction during HTTP. Max3 attempts per
rolling24h interval: under the row lock retain timestamps >now-24h; three retained
reservations block until the oldest+24h. No fixed-window reset. Minimum20min between attempts. Success schedules >=24h after the
attempt and >=provider nextUpdateAt. Failure retains the reservation, with429
respecting the greater of20min, valid Retry-After seconds/HTTP date and budget end.
All HTTP failures/malformed data consume the reserved attempt. A crashed process
does not refund it; only matching unexpired lease can commit data/status. Concurrent
or delayed workers cannot overwrite a newer result. No in-memory-only mutex.

`DISPLAY_FX_ENABLED` strictly accepts true/false, defaults false. A15-minute Cron
checks the persistent deadline when enabled and BACKGROUND_JOBS_ENABLED allows jobs.
No constructor/startup HTTP call. Explicit authenticated refresh shares exactly
the same lease/budget path. Disabling collects nothing and retains all stored data.

### Private HTTP contract

`GET /reporting/usd-display?amountUsd=<decimal>` accepts only required amountUsd,
using existing canonical nonnegative48/30 decimal input. One RR READ ONLY snapshot
of latest observation/state; never calls a provider or writes business data.

```
{
 amountUsd, enabled, source:'exchangerate-api-open', kind:'indicative-daily',
 basis:'latest-stored-observation', status:'unavailable'|'fresh'|'stale',
 observation:null|{observedAt,fetchedAt,nextUpdateAt,endOfLifeAt:null|string,
                   eurRate,rubRate,eurAmount,rubAmount},
 collection:{lastAttemptAt:null|string,lastSuccessAt:null|string,
             nextAttemptAt:null|string,outcome,inProgress:boolean}
}
```
Rates and converted amounts are canonical decimal strings; exact multiplication
keeps scale60. Last-good data stays visible and status is stale after a failed or
unfinished attempt, at next publication time, after48h or after EOL. Disabled flag
is independent of observation freshness. No observation means unavailable, not0.
Outcome: idle/running/ok/provider-error/rate-limited/invalid-data/interrupted; an
expired running lease is reported interrupted. No token/internal counter leakage.

`POST /reporting/usd-display/refresh` accepts empty body/query only, returns200
`{outcome:'collected'|'cooldown'|'in-progress'|'disabled'|'failed'|'rate-limited'|'superseded'}`.
Existing real MFA/session/CSRF/origin/private no-store protections apply. Anonymous
or MFA-pending401; malformed/extra query/body400; missingCSRF403. No requestId is
needed: reserved cooldown prevents duplicate delivery from refetching. No override
for URL, delay, budget, quote, base or authentication exists in production.

### Russian Settings panel

Settings nav button `Курсы для отображения`, region/heading `Пересчёт USD в EUR и RUB`.
Field `Сумма в USD`, initial1; `Рассчитать по сохранённым курсам` performs only GET.
Initial panel load reads amount1 from DB. `Обновить из базы` repeats that read;
`Получить свежие курсы` explicitly POSTs, then rereads DB, disabled if flag is off
or already collecting. Show cooldown outcome and next attempt timestamp; server
enforces it even if client bypassed. Never auto-POST on load/input/refresh.
Table `Справочный пересчёт` columns currency/rate per1USD/exact converted amount;
rows EUR/RUB. Show publication and fetch UTC, daily indicative/latest basis,
status `Нет сохранённых курсов` / `Данные устарели` / `Сохранённые курсы актуальны`,
`Сбор курсов отключён` when disabled. Provider errors preserve last-good display
with explicit warning. Fixed attribution link `Rates By Exchange Rate API` to
https://www.exchangerate-api.com (no provider-supplied link).
Explain it is illustrative conversion, not a transaction quote or historical FX,
and does not alter USD accounting/profit/XIRR. Display future EOL if supplied.
Clear conversion on amount edits; generation guards ignore late reads/unmount,
and a post-write reread must not replace newer amount intent. No browser storage.

## Risks / Trade-offs

- Upstream terms/availability may change: opt-in, attribution, no key/billing path,
  preserve observations and report errors; no live-provider success claim from stubs.
- Daily data cannot price arbitrary historical instants: no backward fill or USD
  accounting integration in this slice. Later historical conversion needs its own spec.
- Lease-expired completion: reject rather than silently publish uncoordinated data.
- Unknown provider numerics: fail visibly rather than lose decimal precision.
- Legacy collectors remain: this slice replaces no consumers or unrelated data.

## Migration Plan

Additive empty tables only; explicit migration CLI, never synchronize/startup DDL.
Test fresh19 and populated18 upgrade with unchanged prior rows/schema/session data,
replay and downgrade refusal. Previous application images can ignore these tables;
no automated down/drop/restore. Preserve Compose/GHCR and owner Nginx; flag remains
off in production examples. Test provider host is outbound-fixture-only.

## Open Questions

No blocker for private indicative conversion. CoinGecko durable retention, older
RUB history, legacy currency retirement and chart period tuning remain separate.
