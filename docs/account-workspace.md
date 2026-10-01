# Account workspace

The individual manual-account page now separates three tasks:

- **Операции**: initialize an explicitly empty journal, record/review trades, inspect effective lots/results, swaps, rewards and CSV. This section opens initially.
- **Аналитика**: choose one task with **Задача анализа** — **Оценка на дату** initially,
  **История стоимости**, or **Учётные позиции**. Each calculation is explicit.
- **Начальные данные**: reviewed carry-in, opening positions, instruments, saved opening snapshot and immutable opening history.

Native buttons expose their selected state and controlled section. Tab/Enter/Space
work without a custom tab-widget contract. Hidden sections remain mounted: switching
or resizing keeps drafts, selected targets, analytical dates/results and original
retry identity. It performs no accounting command or automatic analysis. Journal
refresh, errors, review and original-request recovery remain accessible outside the
selected section. Actual account departure/revision changes retain their existing
invalidation rules; presentation selection is scoped to the account.

Analysis tasks also remain mounted while hidden. Switching between them retains
their entered dates and exact results without a new read or command. Returning to
the outer analytics section retains the selected task; another account starts with
valuation and its own blank analytic inputs. The chart retains the existing30-day
sampling bound; selecting a task does not collect prices.

Short field explanations identify UTC, exact manual prices and sampling. Native
method disclosures contain the full limitations. Results and exact tables precede
secondary coverage/revision evidence; each wide table has a named focusable region
for keyboard scrolling. Unknown cost, missing prices, partial subtotal and known zero
remain distinct. See the [analytics change](../openspec/changes/archive/2026-09-27-redesign-account-analytics/verification.md)
for current verification evidence and limits.

**Сохраненные начальные позиции** is the saved opening snapshot at its stated revision
and coverage boundary, not the effective journal holdings. Exact decimal values and
unknown cost remain distinct. Opening replacement is still blocked after journal
initialization. Instruments and their catalog continuation are under initial data.

This is a bounded hierarchy change, not completion of every operation editor or the
full frontend. Dedicated operation forms, shared analytical context, maximum chart
period and the remaining screens remain tracked in [the redesign plan](frontend-redesign-plan.md).
The persistent local preview has not been rebuilt or reset.

Implementation uses installed React/native controls and existing theme variables,
with no dependency, backend, authentication, schema, deployment or data changes.
See [the archived change](../openspec/changes/archive/2026-09-26-redesign-account-workspace/proposal.md)
and [verification evidence](../openspec/changes/archive/2026-09-26-redesign-account-workspace/verification.md).
Independent review and archive completed on 2026-09-26. Review also added verified
instrument-name/symbol reset on parameter-only SPA account changes; switching sections
within the same account still preserves those drafts. See [the review](reviews/2026-09-26-frontend.md).
