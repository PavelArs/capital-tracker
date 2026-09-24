## Context

Existing historical-account valuation reconstructs effective FIFO holdings from
stored journal/baseline history and matches exact-instant manual USD prices by
instrument UUID. Each read already supports a caller-owned repeatable-read
transaction. The account catalog is paged and unbounded overall; silently summing
one page would misrepresent the owner's tracked assets.

## Goals / Non-Goals

Preview an explicitly selected set of1..10 distinct owned manual accounts at one
UTC instant. Preserve exactness, per-account provenance, missing coverage and price
gaps. This is a selected manual subset, not net worth or a claim of reconciled
whole-portfolio holdings. No inferred USD cash, external balances, providers,
allocation chart, new persistence, automatic refresh, historical FX or chart-range
change. Current individual valuation/accounting remains compatible.

## Decisions

### Strict bounded private request

`POST /accounting/manual-valuation-preview`, HTTP200, strict body `{at,accountIds}`,
empty query only. `at` uses existing parseAsOf (UTC milliseconds,1970..9999).
`accountIds` is a dense array1..10 of distinct UUIDs, canonicalized and sorted;
duplicates (including casing equivalents), extra/missing keys and wrong types400.
The existing full owner session/MFA, Origin/CSRF and private no-store controls apply
even though this POST only computes a read. Anonymous/pending401; absentCSRF403.
Resolve every requested account under the owner before reading any history;
foreign/missing ID gives the same404 for the entire request, never partial results.

Explicit selection bounds work at10 accounts * existing per-account100 baseline
lots+1000 trades. There is no pagination within a sum. Retain generic409 for invalid
persisted FIFO history; SQL/programming errors remain private500. Missing journal
or precoverage is ordinary unavailable data, identified explicitly, never by a
blanket catch of409. No new request/provider budget is needed for this bounded
database-only operation.

### One database snapshot and shared arithmetic

One `REPEATABLE READ` transaction, `SET TRANSACTION READ ONLY` before business
queries. Load requested account names and journal coverage in that snapshot.
For covered accounts, reuse `readHistoricalState` with that same manager; it keeps
existing accounting failures meaningful. Load exact-time prices once for the union
of instrument UUIDs. Reuse `projectValuation` on each covered account and on the
flattened covered positions for the exact aggregate; no Number conversion or
addition of rounded/scale30 subtotals. A shared UUID across accounts uses the same
point; different UUIDs sharing a symbol never inherit that price.

Response contract (all monetary values canonical strings):

```
{
 at,accountIds,scope:'selected-manual-accounts',basis:'current-effective-history',
 priceSource:'manual',quoteCurrency:'USD',pricePolicy:'exact-instant',
 completeness:'complete'|'incomplete',unavailableAccountCount,missingPriceCount,
 pricedSubtotalUsd,totalValueUsd:null|string,
 accounts:[{
   accountId,name,coverage:'covered'|'missing-journal'|'before-coverage',
   coverageFrom:null|string,journalRevision:null|number,
   completeness:'complete'|'incomplete',missingPriceCount:null|number,
   pricedSubtotalUsd:null|string,totalValueUsd:null|string,
   items:[<existing valuation position/quantity/cost + exact price/revision/value>]
 }]
}
```

Accounts follow sorted accountIds; positions retain the existing deterministic
instrument ordering. Uncovered accounts have `items:[]`, unknown counts/subtotal/
total null and incomplete status, never an invented zero holding. Before-coverage
still exposes the saved journal's actual coverageFrom/revision. Aggregate
missingPriceCount counts unpriced covered account-position rows (not symbols or
unknown holdings); unavailableAccountCount covers unknown histories separately.
Aggregate pricedSubtotal includes only known priced positions. Total is null if
either count is nonzero, else equals subtotal. Covered empty journals and saved
zero prices produce known zero. No cost/profit/return inference or balance changes.

### Russian UI on ManualAccounts

Add independent region/heading `Оценка выбранных счетов` below the account list.
Selection uses the already-loaded account catalog; allow loading further catalog
pages through the existing button, never auto-select or silently include a page.
Checkbox accessible label `Включить счет <name>`, show selected count/limit10.
Field `Момент оценки (UTC)` accepts explicit ISO text; initial value empty (no
automatic report request). Button `Рассчитать оценку` explicitly previews; repeat
click refreshes the same selection. No provider or storage writes.

Display `Полная оценка выбранных счетов` / `Неполная оценка выбранных счетов`, exact
`Оценка выбранных счетов, USD` (unknown `Не определена`),
`Оценённая часть, USD`, `Счетов без истории`, `Позиций без цены`.
Table `Оценка по счетам`: account name, coverage/revision, completeness, exact
subtotal and total. Missing journal `История не инициализирована`; before coverage
`Момент раньше начала истории`; missing price explicit. Individual account links
provide existing detailed holdings/valuation. API retains exact position/price
provenance; no new allocation/chart UI in this slice.

Explain: only selected nonoverlapping manual holdings, manual exact-instant prices,
no inferred cash/connected wallets, no claim of whole net worth. Inputs/selection
remain editable during requests. Any edit immediately clears old result and
invalidates pending responses; unmount also invalidates. Reusing the unchanged
selection for a newer read only accepts the latest request. Keep account creation,
catalog paging and their drafts unaffected. No browser storage for selections/data.

## Risks / Trade-offs

- Overlapping real holdings in distinct accounts cannot yet be reconciled → explicit
  subset label and nonoverlap caveat; exact-ID duplicate selection is refused.
- Missing or future-created account history → per-account unavailable, not zero.
- Concurrent changes across accounts/prices → one actual RR snapshot with barrier
  acceptance; never call separate service transactions and combine their results.
-10accounts can produce11000 position rows → bounded input and existing journal
  caps; test boundary and latency observation, do not claim an unmeasured SLA.

## Migration Plan

No DDL or dependency change; use existing schema19. Keep passing characterization
for shared historical/valuation code. The old application ignores the new route.
No production rollout, owner data access or deployment replacement authorized.

## Open Questions

No blocker for this bounded preview. Automatic all-account allocation, cash tracking,
transfer reconciliation and provider historical retention require later changes.
