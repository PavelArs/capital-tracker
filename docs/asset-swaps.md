# Manual asset exchanges

> **Endpoints removed (G1 backend, 2026-10-10).** The manual swap endpoints (`/accounting/accounts/:id/swaps`) were removed (G1 backend). Swaps made by classifying blockchain legs, and the ones already stored, are unchanged.

Status: independently reviewed and archived on 2026-09-26. Populated21 upgrade, SQL
constraints, concurrency, bounds, connected CSV and coherent snapshots are verified.
The final review closed two CSV evidence gaps; see the linked verification and review.
This is not production rollout approval.

In a manual account with an initialized journal, use **Обмены активов** to record an
already-executed exchange within that account. Select two different instrument UUIDs,
the outgoing quantity, gross incoming quantity, timezone-qualified instant and order.
The form does not execute a trade or contact providers. Equal symbols do not establish
equal identity. Keep the ordinary USD trade editor for actual purchases/sales in USD.

Declare the total USD consideration for the gross incoming quantity, or leave its
status unknown. Known zero is explicit. The outgoing FIFO proceeds and the incoming
original lot basis use this same declared amount. Neither outgoing acquisition cost
nor a stablecoin symbol supplies a missing consideration or market price.

Select the fee source explicitly:

- **Без комиссии** records exact zero with no fee asset.
- **Из имеющегося остатка** consumes held FIFO inventory after outgoing principal and
  before the incoming acquisition; it can use either principal asset or a third asset.
- **Из получаемого актива** consumes only the prefix of the new original incoming lot,
  even when older holdings of the same asset exist. A fee equal to the gross incoming
  quantity is allowed and leaves no new holding.

The separate swap result is consideration minus consumed principal basis minus consumed
fee basis. This fee figure is historical book cost, not market fee value or a separate
tax calculation. For example, outgoing basis100, incoming gross3 at consideration150,
and incoming fee0.1 yields fee basis5, remaining2.9/basis145 and swap result45. An older
incoming-asset lot is unaffected. Required unknown evidence makes the result unknown;
the UI shows known subtotals and missing counts separately. Actual USD trade totals and
external flows do not receive invented swap entries. Portfolio market value still needs
independent price observations.

Review displays normalized exact amounts, UTC time, asset UUIDs and current version/
journal pins. Changing input or refreshing the journal invalidates review. This is input
review, not an executable price quote; authoritative FIFO validation occurs on save.
Corrections append complete immutable versions, and cancellation is terminal for that
swap identity. Downstream sales/transfers can make a correction or cancellation invalid.
Old command receipts remain unchanged while current allocations can be restated.

If a response is lost, the editor retains the original body, request key and review pins.
Use **Повторить тот же запрос** explicitly; navigating away/back within the SPA preserves
this pending command for the same owner/account. A full browser reload does not provide
durable pending-command recovery. After acceptance the editor refreshes current state;
ordinary USD trade drafts remain separate. The allocation view includes original lot
identity, exact original intervals, latest transfer arrival and complete totals across
pages. History shows saved versions separately from current FIFO evidence.

Row correction/void actions move focus to the named editor. Cancelling the edit
returns focus to its row action and restores the original blank new-exchange form;
the independent USD trade draft is retained. Opening history focuses its heading.
**Закрыть историю** returns to the history button even while loading; a late response
cannot reopen the closed panel or move focus away from another control. These
navigation actions do not save or send financial commands.

Limits:1000 active swaps per owner/account/component,10000 swap versions per owner/account,
10000 shared revision ticks per participant and32 connected accounts. Other documented
trade/reward/transfer/replay limits remain. Exact stored retries precede live capacity
checks. Migration22 adds two swap tables without deleting previous data. Previous images
must not write a ledger containing swaps; destructive downgrade is refused.

See [active specifications](../openspec/changes/archive/2026-09-26-record-asset-swaps/specs/asset-swaps/spec.md),
[verification evidence](../openspec/changes/archive/2026-09-26-record-asset-swaps/verification.md) and
[isolated test procedure](testing-and-migrations.md). Broad import, chain reconciliation,
automatic price collection and release/backup hardening remain separate work.
