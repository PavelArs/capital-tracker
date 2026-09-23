## Context

HistoricalAccountingService already reconstructs effective FIFO positions within
RR READ ONLY; ManualPriceService persists immutable exact-time manual points.
Calling these public methods separately would mix snapshots. Reuse a small
caller-owned historical loader, retaining the existing paginated historical API.

## Goals / Non-Goals

Value the complete supported positive-position set of one account at one instant.
Keep missing price coverage visible. Non-goals are listed in proposal.md; notably
this is not whole-portfolio wealth, sale proceeds/cash, investment profit or return.

## Decisions

### Frozen wire contract

`GET /accounting/accounts/:id/valuation?at=<ISO-with-offset>` accepts only `at`.
Normalize with existing strict `parseAsOf` (UTC milliseconds1970..9999). Duplicate
query keys, paging/revision keys, malformed dates/IDs are400; anonymous/pendingMFA401;
foreign/unknown account404; absent journal or precoverage409. Existing guard,
origin and private no-store behavior applies. No new write endpoint.

Response:
```
{
  accountId, at, coverageFrom, journalRevision,
  basis: 'current-effective-history', originKind, openingRevision,
  priceSource: 'manual', quoteCurrency: 'USD', pricePolicy: 'exact-instant',
  completeness: 'complete' | 'incomplete', missingPriceCount: number,
  pricedSubtotalUsd: string, totalValueUsd: string | null,
  items: [{ instrumentId, instrumentName, instrumentSymbol, quantity, costUsd,
    price: null | { priceUsd: string, observedAt: string, revision: number },
    valueUsd: string | null }]
}
```
Items sorted by instrument UUID; full set returned in one bounded response (at
most1100 positions from100 baseline lots and1000 active trades). No continuation
means no incomplete cross-page price revision token. `price.revision` identifies
the exact used immutable receipt, not the current whole-book revision. A voided
latest point is missing. A correction restates old-date values; there is no claim
about what was known at that historical moment.

### Consistency and arithmetic

One RR READ ONLY transaction verifies ownership and coverage, loads full effective
history and baseline, then queries latest versions at exactly `at` for only those
owned instrument UUIDs. SQL filters voids after choosing latest. No prior/future
price fallback, symbol matching, stablecoin assumption or provider requests.
Prefer a bounded parameterized UUID-array lookup over one query per position.

Multiply canonical scale30 quantity atoms by scale30 price atoms using bigint;
format derived scale60 USD values without rounding, float conversion or narrowing
to input precision. Sum products at scale60. Positive quantity with price0 is known
zero. No positions means complete0, no price needed. Any missing positive position
means totalValueUsd=null; pricedSubtotalUsd remains explicitly partial. Cost basis
is carried through separately and never used as a market price fallback.

### Russian UI and ownership

Add a separate `HistoricalValuation` account-detail section headed `Оценка счёта
на дату`, input label `Момент оценки (ISO)`, button `Рассчитать стоимость` and
explicit `Обновить оценку` after a result. Show UTC instant/coverage/revision,
manual exact-point caveat and account-only scope; render literal labels and exact
strings. Complete total label `Стоимость позиций, USD`; incomplete state `Нет
точной цены`, `Итого недоступно` and `Оценённая часть, USD`. Table `Оценка позиций`
shows quantity, cost, price and value; include price revision/provenance.

Changing input/account/observed journal revision clears previous result; late
response cannot repopulate stale intent or logged-out session. Explicit refresh
reads current prices (no push guarantee); don't reset unsaved trade edits. Keep
no persistent browser storage and provide loading, empty, incomplete and error
states using existing components/styles. No ECharts/Mantine dependency is needed
for this simple form/table.

## Risks / Trade-offs

- Sparse manually dated points → expose missing exact prices, no interpolation.
- Large exact products → retain all60 fractional digits; horizontally scroll table.
- Current corrections restate history → explain basis, include journal/point revisions.
- Shared loader extraction → retain passing historical characterization/PG tests.
- Whole-portfolio misinterpretation → explicit one-account, tracked-positions labels.

## Migration Plan

No migration, dependency or provider/quota change. Code rollback leaves all rows
and18 migrations untouched. Test only isolated synthetic PostgreSQL/HTTPS. Preserve
owner Nginx and existing GHCR release containment; no production rollout.

## Open Questions

None for this bounded slice. Multi-account coverage, charts and automatic provider
ingestion remain later independently specified changes.
