# Focused account operations

An initialized account now offers **Вид операций** within its operations section:
Сделки в USD, Обмены активов, Вознаграждения and Импорт CSV. Trades open by default.
Only the selected workflow is visible. Shared journal totals, lots and trade history
remain below it; selecting correction or void from that history opens the trade editor.
The action still needs its existing explicit review and submission.

Switching keeps all workflows mounted, including exact independent drafts, selected
CSV File, reviewed state and unresolved commands. It does not submit, refresh or
cancel anything. Hidden unresolved CSV operations still block incompatible trade
writes. Return to the relevant workflow for its existing recovery action; the same
rule applies after a permitted SPA return. Shared journal feedback and original trade
retry remain above the account section selector.

This slice changes composition only: original trade, swap, reward, CSV and result
controllers are retained. It adds no library, backend, schema, auth, price/provider or
deployment change. The persistent preview remains unchanged. Field ergonomics and
remaining screens are still part of [the redesign plan](frontend-redesign-plan.md).

See [the specification](../openspec/changes/archive/2026-09-26-focus-account-operation-workflows/specs/account-operation-workflows/spec.md)
and [actual verification](../openspec/changes/archive/2026-09-26-focus-account-operation-workflows/verification.md).
Independent review and archive completed on 2026-09-26; see [the review](reviews/2026-09-26-frontend.md).
The remaining frontend redesign and owner visual approval are still outstanding.
