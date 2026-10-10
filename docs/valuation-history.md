# Account valuation history

> **Screen removed (G1, 2026-10-10).** The Russian browser screen this page describes was removed
> from the application. Accounts are made in Add asset and Add wallet, trades are added in Add
> transaction and the price of a hand-valued asset is changed on its asset page. The wording
> about screens below is historical; the data and API rules still describe the stored records.


This view compares sampled valuations for one account over a bounded period. The
[verification record](../openspec/changes/archive/2026-09-24-chart-account-valuations/verification.md)
tracks the selected checks; consult it for their current status.

On an account detail page, open **Аналитика** and choose **История стоимости** under
**Задача анализа**. Enter `Начало периода (ISO)` and
`Конец периода (ISO)`, then select `Показать историю`. The interval is measured in
elapsed UTC milliseconds, not local calendar days. It may span at most 30 days.
The service samples the start, every 24 hours from the start, and the exact end if
that instant is not already sampled. Equal endpoints produce one point; a request
returns no more than 31 points. A short final interval is retained rather than
shifted to a calendar boundary.

Each point reconstructs the account's effective holdings through that instant,
including trades at the boundary and any carried-in lots. The basis is the
currently effective history: later trade corrections and manual-price corrections
can restate prior points when the owner reloads the series. This is not a record
of what was known at the historical instant.

Only an exact-time manual USD unit price for the held instrument UUID is used.
Prices are never carried forward, interpolated, matched by symbol, or obtained
from an external provider. An explicit zero is known and contributes zero. When a
positive position has no effective point at that exact instant, the row is marked
`Нет полной оценки`; its partial priced subtotal and missing count remain visible,
and the total is shown as an em dash. A complete empty account is a known zero.

The table `Оценки по датам` retains each UTC sample, status, exact total or partial
subtotal, and count without a price. The scatter chart plots only complete points,
including zero; it does not bridge missing dates or claim continuous price
coverage. Chart coordinates are approximate. Exact decimal strings in the table
and tooltips are authoritative; derived arithmetic retains up to 60 fractional
digits. If every point is incomplete, the table stays visible with
`Нет полных оценок для графика` and no chart.

Use `Обновить историю` to read current corrections explicitly. Editing either
period field clears the previous result, and an old response cannot restore it
after the inputs, account, or observed journal revision change. History reads do
not replace an unsaved trade edit. The page stores no chart or valuation result in
browser storage.

The API is `GET /accounting/accounts/:id/valuation-history?from=<ISO>&to=<ISO>`.
It accepts only `from` and `to`, normalizes offset timestamps to UTC milliseconds,
and returns account/revision metadata with the ordered point summaries. Invalid,
duplicate, reversed, over-30-day, or unexpected query values return 400; missing or
foreign accounts return 404; an absent journal or start before coverage returns 409.
The owner-scoped read uses one PostgreSQL `REPEATABLE READ`, `READ ONLY` snapshot
for holdings and sampled prices, preserves authentication/MFA and private
no-store responses, and makes no business-data writes.

This is one account's tracked positions only. It does not include cash proceeds,
other accounts, wallet balances, investment profit, or return calculations. It
uses the existing Chart.js stack and adds no database migration or price provider.
