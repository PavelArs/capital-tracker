# Focused account operations

> **Screen removed (G1, 2026-10-10).** The Russian browser screen this page describes was removed
> from the application. Accounts are made in Add asset and Add wallet, trades are added in Add
> transaction and the price of a hand-valued asset is changed on its asset page. The wording
> about screens below is historical; the data and API rules still describe the stored records.


An initialized account now offers **Вид операций** within its operations section:
Сделки в USD, Обмены активов, Вознаграждения and Импорт CSV. Trades open by default.
Only the selected workflow is visible. Shared journal totals, lots and trade history
remain below it; selecting correction or void from that history opens the trade editor.
The action still needs its existing explicit review and submission.

Initialized journals show a short USD accounting-scope notice. **Параметры и правила
учёта** opens exact coverage/revision/counts and the full accounting explanation on
demand. It works with the keyboard and retains its open state while switching account
sections or workflows; a real account remount starts closed. Reading these details
preserves drafts and the selected CSV File. Initialization warnings and shared errors,
receipts and original-request recovery stay visible outside the disclosure.
See the [context verification](../openspec/changes/archive/2026-09-26-compact-journal-context/verification.md).

Trade entry groups instrument/direction, amounts and execution time. Hints attached to
the fields clarify total USD, separate fee, UTC and equal-time order. Selecting a
history correction or void focuses and reveals its editor; cancellation returns to
that history action, or to the workbench after an explicit refresh replaced the row.
Shared results keep exact semantic tables with contained scrolling and consistent
theme-aware action controls. See [workbench verification](../openspec/changes/archive/2026-09-26-redesign-trade-workbench/verification.md).

Swap entry now groups assets/quantities, USD valuation, fee source and execution time.
Attached descriptions explain gross incoming quantity, unknown versus zero and the
difference between held-asset and incoming-asset fees. Reward entry groups receipt,
independent basis/income and time; unknown values and unclassified rewards remain
explicit. Trade, swap and reward share responsive form styles in both themes while
keeping exact strings and the existing review/retry controls. See
[acquisition-entry verification](../openspec/changes/archive/2026-09-26-redesign-acquisition-entry/verification.md).

CSV import has a visible file → mapping → review guide, grouped mapping fields and
attached interpretation hints. Selected-batch IDs/hash are available on demand;
source, exact preview, receipts and complete rollback evidence remain accessible.
See the [CSV workflow](csv-imports.md) for explicit upload/review/confirmation steps.

Switching keeps all workflows mounted, including exact independent drafts, selected
CSV File, reviewed state and unresolved commands. It does not submit, refresh or
cancel anything. Hidden unresolved CSV operations still block incompatible trade
writes. Return to the relevant workflow for its existing recovery action; the same
rule applies after a permitted SPA return. Shared journal feedback and original trade
retry remain above the account section selector.

These slices change presentation and guidance: original trade, swap, reward, CSV and result
controllers are retained. It adds no library, backend, schema, auth, price/provider or
deployment change. The persistent preview remains unchanged. Remaining operation
editors and screens are still part of [the redesign plan](frontend-redesign-plan.md).

See [the specification](../openspec/changes/archive/2026-09-26-focus-account-operation-workflows/specs/account-operation-workflows/spec.md)
and [actual verification](../openspec/changes/archive/2026-09-26-focus-account-operation-workflows/verification.md).
Independent review and archive completed on 2026-09-26; see [the review](reviews/2026-09-26-frontend.md).
The remaining frontend redesign and owner visual approval are still outstanding.
