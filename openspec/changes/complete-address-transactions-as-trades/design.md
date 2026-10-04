## Context

`wallet_address_transactions` holds confirmed Bitcoin observations per address with
exact satoshi amounts and a direction (`in`, `out`, `self`). Manual buy trades live in
per-account trade journals (`account_trade_journals`, `account_trades`,
`account_trade_versions`) written by `TradeService.mutate`, which locks the owner's
accounting, checks the optimistic journal revision, projects the connected FIFO
ledger and appends an immutable version. CSV imports already link journal trades to
an external source through `account_csv_import_rows`.

## Decisions

### Write the trade through `TradeService`, link it in the same transaction

`TradeService.create` gains an optional `withinTransaction(manager, receipt)` callback
that runs after the version is appended and before commit, only when the trade was
created (not on a replay). The wallet completion service passes a callback that
checks that the transaction has no active linked trade and inserts the link row. The
callback runs under the owner's accounting lock, which journal voids also take, so the
check cannot race another completion or a void. If the check fails, the whole
transaction rolls back, so no trade exists without its link and no link
exists without its trade. Validation, FIFO projection and journal revision checks stay
in one place.

Alternative considered: create the trade, then link in a second transaction. Rejected
because an interruption between them leaves an unlinked trade and lets the owner
complete the same transaction twice.

### Link table

`wallet_address_trade_links(ownerId, addressId, txid, accountId, tradeId,
createVersion = 1, createdAt)` with:
- primary key `("ownerId", "accountId", "tradeId")`: one transaction per trade;
- index `("addressId", txid, "createdAt")`: a transaction keeps every trade it was
  completed with, so a completion voided in the journal (for example recorded in the
  wrong account) can be followed by a new one. At most one of them is active, enforced
  by the service under the owner lock;
- foreign key `("addressId", txid)` → `wallet_address_transactions` and
  `("ownerId", "accountId", "tradeId", "createVersion")` → `account_trade_versions`,
  both `ON DELETE RESTRICT`.

The trade's current state (active, corrected, voided) is read from the journal, never
copied, so corrections and voids made in the journal show on the address page.

### Request contract

`POST /wallet-addresses/:id/transactions/:txid/trade` with
`{ accountId, trade }`, where `trade` is exactly the existing trade create body
(`requestId`, `expectedJournalRevision`, `instrumentId`, `side`, `occurredAt`,
`orderWithinTimestamp`, `quantity`, `grossUsd`, `feeUsd`). The service:
1. reads the owner's address and transaction (404 if either is not the owner's);
2. requires `direction = 'in'` and `side = 'buy'` (422 otherwise);
3. requires `quantity` to equal the net BTC received, `receivedUnits - sentUnits`,
   compared as exact decimals (422 otherwise);
4. calls `TradeService.create` with the callback. A replay with the same `requestId`
   and payload returns the original receipt with 200 when that trade is this
   transaction's completion (409 otherwise); a new trade returns 201; a transaction
   whose linked trade is still active returns 409.

Account ownership, instrument ownership, journal existence, coverage and revision
checks remain those of `TradeService` (404/409 as today).

### Reads

The transaction list joins the link and the trade's current version. An item gains
`trade: { accountId, tradeId, status: 'active' | 'voided', grossUsd, feeUsd }` or
`null`. `usdValue` is the current version's `grossUsd` when the trade is active, and
`usdValueStatus` becomes `known`; otherwise both stay `null`/`missing`.
`missingUsdValueCount` counts transactions without an active linked trade.

### UI

The page shows «Дополнить» on each incoming row without an active trade. It opens the
existing `TradeForm` under an account selector, prefilled with buy, the received
quantity and the block time, and reads the chosen account's journal state for
`expectedJournalRevision`; saving waits for that read. The account selector defaults to
the account of this address's latest active completion. Retrying the same form keeps
its request id, so a lost response replays instead of being refused. Completed rows
show the USD amount and a link to the account. Voided ones show «Сделка отменена»
with the account link and «Дополнить» again.

Known limit: the completion checks side and quantity when it is recorded; a later
correction in the journal is the owner's own edit and is shown as is.

### Currency

Trades are USD-only today. The paid-currency change for trades adds its fields to the
trade create body and to `TradeForm`. Because this endpoint passes the `trade` body to
`TradeService` unchanged, those fields flow through without a second contract.

## Risks

- A journal that is not initialized, or whose coverage starts after the purchase
  time, refuses the trade (409). The page shows the journal's message and a link to
  the account to initialize it.
- `TradeService` signature change touches a file another change may edit; the hook is
  one optional parameter to keep the merge trivial.

## Migration Plan

Migration 24 on current main (`AddWalletAddressTradeLinks1790600000000`) creates the
link table only. Timestamp 1790500000000 is reserved for the purchase-currency change;
whichever of the two merges second bumps the migration counts in the probes. `down()`
refuses, like the other accounting migrations. Startup never migrates; the explicit
migration CLI applies it.
