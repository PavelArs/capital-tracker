# Manual period profit preview

Implementation/verification is in progress under `preview-period-profit`; this
guide describes its specified contract, not a completed release.

The Russian **Прибыль за период** page (`/period-profit`) calculates:

`profit = closing value - opening value - contributions + withdrawals`

Supply the total portfolio value in USD at both boundaries and review the external
flow journal. Opening value is **immediately before** any flow exactly at the start.
Closing value is **immediately before** any flow exactly at the end. The interval
includes its start and excludes its end, `[from,to)`. Times have explicit zones and
are returned/displayed in UTC. For example, opening1000 + contribution1000 with
closing2000 produces profit0. A withdrawal increases the formula's result because
that value has left the portfolio without itself being an investment loss.

This is a temporary calculation using **manual total valuations** and
**owner-declared, unreconciled flows**. It does not discover missing flows, fetch
prices or derive values from cost or current holdings. The owner is responsible
for including all owned positions and cash once. The journal must already have a
reviewed coverage boundary at or before the selected start. Missing coverage is
an error, not an assumed empty period. Use **Вводы и выводы** to review/setup flows.

The result identifies the journal revision it read. Later corrections and voids
restate subsequent calculations; the displayed revision is not a saved historical
report. Changing any input clears the result and its review assertion. Submission
is explicit, old delayed replies are ignored, and failures hide earlier results.
Values/results are not persisted in the database or browser storage. Navigation,
reload and authentication loss can clear the form. No valuation or return rate is
silently recovered or posted after login.

## API

Authenticated `POST /accounting/portfolio/profit-preview`, status200. Existing
password/MFA, CSRF, Origin and private no-store rules apply. Body:

```json
{
  "from": "2025-01-01T00:00:00.000Z",
  "to": "2026-01-01T00:00:00.000Z",
  "openingValueUsd": "1000",
  "closingValueUsd": "2000",
  "assertReviewed": true
}
```

Amounts are nonnegative decimal strings, including zero, with at most48 integer
and30 fractional digits. Negative manual valuations are unsupported and rejected,
never converted to zero. Positive duration and explicit-zone valid timestamps
are required (1970–9999, at most millisecond precision). Unknown fields, missing review, JSON numeric amounts, signs and
exponents are400. An absent journal or start before coverage is409.

Response contains `from`, `to`, `coverageFrom`, `journalRevision`, canonical
`openingValueUsd`/`closingValueUsd`, `profitUsd`, and `flows` with
`contributionsUsd`, `withdrawalsUsd`, `netContributionsUsd`, `flowCount`. It also
contains `basis: manual-usd-valuations`, `flowBasis: owner-declared-usd-flows`,
`completeness: unreconciled`. Profit can be negative; computed totals can exceed
input precision without rounding. All monetary fields remain exact strings.

One read-only repeatable-read snapshot reads the complete eligible current flow
set; the preview is unpaginated. Household income, asset trades and unrelated owners do not contribute.
No schema migration, provider call or stored valuation is introduced. XIRR, TWR,
marked values, gains by lot, signed portfolio valuations and charts remain future
contracts; profit here is an absolute USD amount, not a percentage or tax report.

## Verification

The change's verification document maps pure arithmetic/input cases, actual
PostgreSQL snapshot/read-only/isolation checks, and two critical HTTPS Playwright
journeys. The full acceptance runner includes `period-profit-db.cjs`; it refuses
any environment except the exact synthetic settings and a fresh fixture database.
Its database is temporary with the isolated PostgreSQL container. Current-slice
verification is targeted; a full E2E run is not a requirement for this increment.
