## Context

The external-flow journal is owner-scoped, bounded (1000 active flows / 10000 versions), exact at scale 30, and explicitly unreconciled. It already reads effective corrected heads and origin in one read-only repeatable-read transaction. Household metrics use floating amounts and provider prices; FIFO history supplies cost, not a marked valuation.

## Goals / Non-Goals

**Goals:** Make the brief's period-profit formula usable with honest manual boundary valuations, exact current flows and authenticated Russian UI; preserve existing flow reads and writes.

**Non-Goals:** Rates/XIRR/TWR, negative portfolio valuations, historical market valuation, saved reports, charts, prices, migration or new providers. The whole performance brief remains incomplete.

## Decisions

1. POST `/accounting/portfolio/profit-preview` returns 200; it is a calculation, never a ledger mutation. Body is exactly `{from,to,openingValueUsd,closingValueUsd,assertReviewed:true}`. Existing explicit-zone UTC parser (1970..9999, millisecond precision) and decimal parser (strings, up to 48 integer / 30 fraction digits, nonnegative including zero) apply. Reject unknown fields including owner IDs, numbers, signs/exponents, invalid/reversed/equal dates and absent review with 400. Request values are not persisted. POST avoids valuations in query URLs; global auth, MFA, CSRF/origin and private no-store policies remain mandatory.
2. Opening value means total owned portfolio immediately before all flows at `from`; closing value means total owned portfolio immediately before flows at `to`. Period is `[from,to)`. A flow exactly at `from` is included; exactly at `to` is excluded. No derived cash balance, solvency constraint or inferred market price. Zero/manual losses are valid; negative supplied valuations are explicitly unsupported in this slice and rejected, never clamped.
3. Add a small exact projection/input module; reuse current service's manager-owned journal/head reads in a shared private period helper. Both list and preview keep a single `REPEATABLE READ` / `SET TRANSACTION READ ONLY` snapshot. Never call the paginated public list or open nested transactions. Absent journal or period before coverage is 409. Every eligible current head contributes before pagination; corrections restate and terminal voids exclude, using the existing projection. A captured revision is metadata, not a promise that later edits cannot restate it.
4. Result: `{from,to,coverageFrom,journalRevision,basis:'manual-usd-valuations',flowBasis:'owner-declared-usd-flows',completeness:'unreconciled',openingValueUsd,closingValueUsd,flows:{contributionsUsd,withdrawalsUsd,netContributionsUsd,flowCount},profitUsd}`. Canonical money strings use BigInt atoms and permit derived signed/wider totals without truncation. `profit = closing - opening - contributions + withdrawals`. No income/holdings/FIFO lookup, floats, rate/percentage, provider or write.
5. Russian `/period-profit` page and navigation `Прибыль за период`: explicit manual inputs, UTC boundaries, total portfolio scope, required reviewed assertion, disclosed temporary preview and unreconciled journal, formula and raw exact USD strings. Link to existing external flows for journal setup/corrections. Results include the submitted period/valuations and journal revision. Editing any input immediately clears the result and review assertion; unchecked review prevents submission. Loading/errors clear old result. Ignore late replies after an edit/new submission/unmount. A fresh explicit calculation is required after changes or authentication failure; no automatic POST, storage or hidden reuse of valuations. App navigation/remount can clear the draft.

## Keep / Simplify / Defer Inventory

| Decision | Existing code / reason |
| --- | --- |
| Keep | `portfolio-flow.ts`, `money.ts`, strict input parsers: exact period semantics and current corrections. |
| Simplify | `PortfolioFlowService.list` period loading becomes a small shared private helper; passing characterization stays green. No generic journal abstraction. |
| Keep | Authenticated API client, protected layout, real MFA/HTTPS fixtures, PostgreSQL scripts and existing deployment pipeline. |
| Defer | Household `MetricsService`, floating FX/crypto values and FIFO cost are unsuitable portfolio-value sources; retain them for their existing users. |
| Defer | Persisted valuations/prices, XIRR/TWR, providers, deletion and consolidation until separately verified requirements. |

## Risks / Trade-offs

- Owner can enter incomplete/wrong valuations or omit flows → label both manual and unreconciled, require review; no claim of verified return.
- Concurrent corrections → one repeatable-read snapshot and displayed journal revision, plus a deterministic PostgreSQL barrier test.
- A late UI reply could mislabel old data → invalidate on every edit and verify with a delayed real backend response.
- Wider totals and tiny precision → exact integer arithmetic and fixed independent examples, including a result wider than 48 integer digits.
- Read-only POST still consumes existing request/security budgets → no new polling/provider quotas, bounded journal work and no new rate policy.

## Migration Plan

No schema, dependency, deployment or owner-data changes. Existing migration 17 remains current. Rollback removes this endpoint/page; no stored result needs reversal. Production deployment and final repository consolidation are outside this change.

## Open Questions

None blocking this bounded slice. Signed portfolio valuations and return-rate policy require later explicit contracts.
