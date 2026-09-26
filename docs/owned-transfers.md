# Owned-account transfers

Implemented and verified with real PostgreSQL and selected HTTPS Playwright journeys.
See the [change and evidence](../openspec/changes/archive/2026-09-24-record-owned-transfers/verification.md).
This records already-performed movements; it does not imply production rollout.

The transfer journal records a movement that has already happened between two
manual accounts owned by the same user. It sends no funds and does not connect to
a wallet, exchange, bank, blockchain, or other external provider. A transfer is
not an external contribution or withdrawal, and it does not create a synthetic
trade or investment gain.

On the protected **Переводы между счетами** page, enter both accounts, the asset,
credited quantity, UTC time/order, and optional fee asset/quantity. **Проверить
счета** loads both account revisions; **Записать перевод** is available after
review and the internal-transfer attestation. For an existing transfer, **Исправить**
or **Отменить перевод** first loads its current version and account pins. The
correction is saved with **Сохранить исправление**; terminal void uses
**Подтвердить отмену**. The separate **Показать разбор лотов** action loads
current FIFO allocation.

The editor groups accounts/recipient quantity, UTC/order and fee fields. Associated
guidance explains principal versus fee and the historical fee-basis meaning. Selecting
a correction or void moves keyboard focus to its heading; cancellation returns to the
originating history action when available. History leads with quantity/asset and account
direction; **Идентификатор перевода** reveals the full copyable identity. Current
allocation and version history remain separate from the saved command receipt. See the
[transfer workbench verification](../openspec/changes/archive/2026-09-26-redesign-transfer-workbench/verification.md)
for the scoped real browser checks and responsive evidence.

Both accounts must have an initialized journal with a declared-empty or known-cost
opening. Unknown-cost holdings cannot be converted by creating a transfer. The
movement instant must be at or after both accounts' coverage boundaries. The
same UTC millisecond and order slot cannot already be used by a trade or transfer
in either account. Select the instrument by its owner-scoped UUID; equal symbols
do not identify the same asset.

Enter the quantity credited to the receiving account. Enter any fee separately:
the fee is consumed from the sending account after the principal debit and before
the receiver is credited. A positive fee requires an explicit instrument UUID and
can use the principal instrument or another asset. A zero fee has no fee asset.
The reported `feeConsumedBasisUsd` is the historical acquisition cost removed by
FIFO. It is not a market-valued network fee, a profit measure, or an additional
deduction from trade profit or external-flow return calculations.

Review both current account revisions and attest that the movement is internal
before saving. A successful command has an immutable receipt with the movement,
version, and saved account pins. The receipt is command history: a later source
trade correction may change the current derived FIFO allocation without rewriting
the transfer receipt. The separately loaded current allocation reports principal
basis, fee basis, and FIFO fragments with their source account, original trade or
opening lot, original interval, and latest arrival transfer. Round trips retain
original quantities, costs, and provenance; arrival timing still controls when a
received fragment can be consumed.

Correct a movement by reviewing its current version and both account revisions.
The account pair is fixed; a correction can change the movement details, not
redirect the identity to another pair. Void is terminal. Connected trade or CSV
edits replay the full affected history, so an old correction can restate a
recipient's later sale. A correction, void, or upstream edit is rejected with a
conflict when it would make any connected account's chronological holdings
negative. Previously saved history is not frozen to avoid such a conflict.

On ambiguous delivery, retry the exact unchanged command to recover its saved
receipt. Do not change the draft or create a new request until that result is
resolved. A stale revision requires an explicit refresh and a new review. The
current allocation is derived from live connected history; it is not stored as a
second set of mutable lots.

## Limits and accounting boundaries

Owner limits are 1,000 active transfer identities and 10,000 transfer versions.
The affected connected component is bounded at 32 accounts, 10,000 active trades,
1,000 active transfers, and 100 carry-in lots per account. Each replay is bounded
at 100,000 allocation matches and 100,000 simultaneously held fragments. Exceeding an applicable bound is an explicit
conflict; no financial result is silently truncated.

Account journals have a separate 10,000-revision budget. A source trade uses one
revision, a source CSV import uses its existing contiguous command range, and
each other account invalidated by the connected replay uses one revision. Passive
connected revisions consume that budget. The displayed local `versionCount`
remains the number of saved versions of that account's own trades; it does not
count passive revision ticks.

Decimal inputs use the existing exact string rules. FIFO basis is allocated in
scale-30 units by original quantity intervals, preserving every atom when lots
are split or moved. Allocation pages are limited to 100 rows and are pinned to
both current account revisions after the first page; stale continuation requests
must be refreshed and restarted. The full allocation totals accompany each page.

Migration 20 is additive and stores immutable transfer identities and command
versions, not derived FIFO fragments. Existing trades, openings, CSV imports,
prices, external flows, and authentication rows are preserved. Downgrade refuses
while the transfer ledger exists rather than deleting accounting history. This
slice does not add cash balances, currency swaps, rewards, external flows, transfer
CSV import, market-fee valuation, or unknown-cost conversion.
