# Historical account valuation

The account-detail section “Оценка счёта на дату” combines reconstructed holdings
with saved manual USD unit prices at the selected instant. The
[verification record](../openspec/changes/archive/2026-09-23-value-historical-account/verification.md)
records exact arithmetic, real PostgreSQL and three selected HTTPS checks.

For several sampled dates in one coherent read, use the separate
[account valuation history](valuation-history.md) view, limited to 30 elapsed days.

Open **Аналитика** and its default **Оценка на дату** task. Enter an ISO timestamp
including its time-zone offset and request the calculation.
The view uses effective trades up to and including the normalized UTC instant and
any immutable known-cost carry-in lots. It shows only the tracked positions in
this account. It does not add proceeds as cash, combine other accounts, infer
blockchain balances or calculate investment profit/annualized return.

Every positive position needs a manual price for its instrument UUID at exactly
that same instant. An earlier/later observation or another asset with the same
symbol cannot substitute. There is no carry-forward, interpolation or assumed
stablecoin price. Each used point shows its manual provenance and immutable price
revision. Corrected trades/prices restate historical results; this is not a record
of what the application knew at that past time.

A missing or excluded point displays “Нет точной цены”. The priced subtotal is
explicitly partial and the total remains unavailable until every held position is
priced. An explicit zero price is available data and contributes zero. An account
with complete empty accounting history has value zero without needing prices.
Unknown accounting coverage or an instant before coverage is unavailable; no
holdings, acquisition costs or prices are invented.

Quantity, cost, unit price and value are exact decimal strings. Multiplication and
summation retain up to60 fractional digits without rounding to cents or losing tiny
values. Cost basis is shown separately and never substituted for price.

Use “Обновить оценку” after changing prices. Price edits in another tab are not
pushed into an already displayed result. Editing the instant, switching accounts
or observing a new journal revision clears the old result; a late response cannot
restore it. Calculations and refreshes preserve unsaved trade edits. No valuation
is stored in browser storage.

The API reads the complete bounded account snapshot in one read-only PostgreSQL
REPEATABLE READ transaction. It makes no provider requests or business-data writes.
Normal authenticated session/admission bookkeeping still applies. No migration,
dependency, provider, production configuration or deployment change is required.
