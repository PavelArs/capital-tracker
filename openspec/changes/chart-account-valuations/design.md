## Context

Point valuation already combines exact reconstructed holdings with exact-time
manual prices in one RR READ ONLY transaction. Repeated HTTP requests would mix
revisions and perform redundant queries. The series should load history once and
reuse the verified pure accounting and scale60 valuation functions.

## Goals / Non-Goals

Display at most31 coherent observations for one account, with exact accessible
values and no false continuous coverage. Non-goals are in proposal.md.

## Decisions

### Wire and sampling

`GET /accounting/accounts/:id/valuation-history?from=<ISO>&to=<ISO>` accepts only
from/to. Reuse strict UTCms1970..9999 normalization. Require from<=to and duration
<=30*86400000ms. Include from, successive from+n*86400000ms <=to, and to once if
off-grid. Equal endpoints yield one point. Max31 points, ascending unique UTC.
Sampling uses elapsed24h, not local civil days; the final interval can be shorter.
Malformed/duplicate/unknown inputs400; missing/foreign account404; absent journal
or from before declared coverage409. Retain actual auth/MFA/no-store/origin controls.

Response (allowlist):
```
{
  accountId, from, to, coverageFrom, journalRevision,
  originKind, openingRevision, basis: 'current-effective-history',
  priceSource: 'manual', quoteCurrency: 'USD', pricePolicy: 'exact-instant',
  sampling: '24h-from-start-and-end',
  points: [{ at, completeness: 'complete'|'incomplete', missingPriceCount,
             pricedSubtotalUsd: string, totalValueUsd: string|null }]
}
```
These are point observations, never continuous coverage ranges or immutable
valuation receipts. Corrections restate history on explicit reload. Detailed
positions and used price revisions remain available through the existing point
valuation endpoint (a separate later request may reflect newer source revisions).

### Read architecture and limits

One caller-owned RR READ ONLY snapshot for ownership, journal, full effective heads,
baseline and all sampled prices. Extract shared loading for one/many instants;
existing single-point API responses/errors stay compatible. Reconstruct each full
prefix before projection. Query latest exact-time price versions in a batch for
the relevant owned instrument UUIDs and sampled instants, using the existing
point-history index; latest selection precedes void filtering. Prefer indexed
LATERAL LIMIT1 per UUID/time pair to loading all10000 versions per book. No query
per date/instrument, no provider, and no HTTP/service loop that opens transactions.
At most31 snapshots,100 baseline lots and1000 active trades. Keep sums/products
exact; derived strings retain scale60. Complete empty holdings =>0; a missing
positive position =>null total, partial subtotal and missing count; price0 is known.

### Russian UI and rendering boundary

New `ValuationHistory` sibling in TradeJournal, observing actual trade revision.
Region/heading `История стоимости счёта`, ISO inputs `Начало периода (ISO)` and
`Конец периода (ISO)`, button `Показать историю`, explicit `Обновить историю` after
a result. State the30-day limit,24h sampling plus endpoint and manual/account-only
scope. Clear results on period/account/observed revision changes; ignore late
responses/unmount and preserve parent draft. No persistent browser storage.

Use installed Chart.js/react-chartjs-2 scatter, linear timestamp x-axis in UTC,
USD y-axis, showLine=false. Plot ONLY complete points, including true zero; never
plot partial subtotal as total. No connecting segments, interpolation, decimation
or category spacing that hides a short endpoint interval. Retain exact strings in
table/tooltips; Number conversion is confined to chart coordinates. Label plotted
coordinates approximate. Canvas role img with label `График стоимости счёта`;
table caption `Оценки по датам` gives every sampled date/status/exact total/partial
subtotal/missing count. For gaps use `Нет полной оценки` and em dash total; for
complete use `Полная оценка`. No complete points: show `Нет полных оценок для графика`
with the table retained and no chart. Empty covered account plots known zeros.
Loading/error/partial states explicit; narrow screens can scroll/wrap exact values.

## Risks / Trade-offs

- Sparse exact manual points → show gaps explicitly; don't fabricate daily values.
- Chart coordinates approximate decimals → exact table/tooltips are authoritative;
  tiny and large values remain exact on the server, tested at the display boundary.
- Replaying up to31 bounded prefixes costs CPU → load database once, cap duration,
  exercise full31-point max-history fixture and record observed time without SLA.
- Refresh restates corrections → current-effective basis and journal revision shown.
- Current charts do not implement the entire target brief → explicit one-account,
 30-day scope; later ranges/provider collection are separate changes.

## Migration Plan

No schema/dependency or provider/quota change. Code rollback preserves all18
migrations and data. Keep existing CI/GHCR/Compose and owner Nginx unchanged.
Only isolated PostgreSQL/HTTPS synthetic acceptance; no production rollout.

## Open Questions

None for this slice. Longer intervals, zoom and provider coverage remain future work.
