## Why

Bitcoin transactions imported from a wallet address show every USD value as missing.
The owner wants to complete them by hand: say what he paid for the coins that arrived,
so the purchase becomes an ordinary buy trade in his manual accounting journal, exactly
as if he had entered it there. Until then the imported history cannot feed FIFO cost,
realized or unrealized results.

## What Changes

- For an incoming (`in`) transaction the owner chooses one of his manual accounts and
  records a buy trade through the existing trade form. The form is prefilled from the
  chain: buy, the received BTC quantity and the block time.
- The backend writes the trade through the same journal path as a manual trade and,
  in the same database transaction, links it to the imported transaction. A replay of
  the same request returns the same trade; a second, different completion of a
  transaction whose trade is still active is refused.
- The quantity must equal the BTC the transaction brought to the address. The trade's
  time stays editable, because a purchase can predate the withdrawal to the wallet.
- The address page shows a completed transaction's USD value from its trade and
  counts only uncompleted transactions as missing. A trade voided later in the
  journal shows as voided and counts as missing again; the owner can then complete the
  transaction anew (for example in the right account).
- The purchase is recorded in USD, like every trade today. When the paid currency
  arrives on the trade form (separate change), this completion passes it through.

## Capabilities

### New Capabilities
- `wallet-address-trade-completion`: completing an imported incoming Bitcoin address
  transaction as a manual buy trade, with an exact, replay-safe link between the
  two and the completion state shown on the address page.

### Modified Capabilities
- `wallet-address-import`: ADDR-4 reports a transaction's USD value as missing only
  until the owner completes it; transaction items gain the `trade` field.
  `usd-fifo-trades` keeps its requirements; this change calls its existing write path.

## Impact

- Backend: a completion endpoint and service in `backend/src/wallet-addresses`; a
  narrow hook in `TradeService` so a caller can add rows inside the trade's own
  transaction. No change to trade validation or FIFO.
- Database: additive migration creating `wallet_address_trade_links`. No existing
  row, column or constraint changes.
- Frontend: the address page reuses `TradeForm` and `tradesApi` unchanged.
- Tests: Jest, a real PostgreSQL probe, page tests and one Playwright journey.

## Data Impact

Additive only. Existing trades, imported transactions and addresses are untouched.
A link row references an existing trade version and an existing imported transaction.

## Non-goals

- Outgoing and self transactions (sale or own transfer completion).
- Linking an address to an account permanently, xpub/descriptor wallets, other
  networks, automatic prices, a paid currency other than USD in this change.
