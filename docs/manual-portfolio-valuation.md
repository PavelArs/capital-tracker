# Manual portfolio valuation

“Оценка выбранных счетов” previews an explicitly selected set of one to ten
owned manual accounts at one UTC instant. It is a selected subset, not the whole
portfolio or net worth: it does not reconcile overlapping positions across
accounts, include cash or connected wallets, or infer external balances.

Select accounts with “Включить счет <name>”, load more catalog pages as needed,
and enter “Момент оценки (UTC)”. Loading another page keeps the existing
selection; no page is silently added. “Рассчитать оценку” explicitly requests a
preview, and can be used again to refresh that same selection. The form starts
without a result and does not calculate automatically. Editing the date or
selection clears the old result; a delayed response for the previous inputs
cannot restore it.

For each covered account, the preview reconstructs effective holdings at the
requested instant and uses a saved manual USD price only when both the instant
and instrument UUID match exactly. Another instrument with the same symbol, a
nearby timestamp, an external price or a cost basis cannot fill a gap. Results
are computed from one read-only PostgreSQL snapshot and do not write accounting
data or contact external providers.

The view identifies accounts with no journal (“История не инициализирована”) or
an instant before their coverage (“Момент раньше начала истории”). It also
reports the count of held positions with no exact price. “Оценённая часть, USD” is the
subtotal of positions that can be priced; if any account history or position is
unknown, “Оценка выбранных счетов, USD” is “Не определена”. A covered empty
account and an explicitly zero-priced holding are known zero values. Monetary
results retain exact decimal values rather than rounding to cents.

The “Распределение по инструментам выбранных счетов” table groups covered
holdings by instrument UUID across the selected accounts. It adds exact quantities
and USD values, keeping different UUIDs separate even if their symbols match.
An instrument without an exact price keeps its quantity but has an unknown value.
When any selected history or price is missing, or the complete selected total is
zero, every share is “Не определена”. Otherwise each share uses the complete
selected total and is rounded independently to two decimal places, half-up;
displayed shares can therefore sum to 99.99 or 100.01. This table has the same
selected-manual-account scope as the summary, not a whole-portfolio allocation.

The result keeps this scope beside its totals. `Что входит в оценку` discloses the
saved-price and unknown-total explanation on demand. Both evidence tables retain
their existing accessible table names inside separate keyboard-focusable horizontal
scroll regions; the disclosure does not recalculate or clear a result.

The private `POST /api/accounting/manual-valuation-preview` accepts an ISO
instant and one to ten distinct account UUIDs. It requires the normal full
session/MFA, Origin and CSRF protections, rejects extra input, and returns one
404 if any selected account is foreign or missing. There is no pagination inside
the calculation; the selection bounds the work. Invalid saved FIFO history
remains an error instead of being relabeled as an ordinary missing-data gap.

The selected PostgreSQL checks and all three HTTPS acceptance cases passed. See the
[verification record](../openspec/changes/archive/2026-09-24-preview-manual-portfolio-value/verification.md)
for the selected acceptance scope, actual results and unrun checks.
