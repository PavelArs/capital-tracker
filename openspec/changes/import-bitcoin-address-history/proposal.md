## Why

The owner wants to give the app a wallet address and have it pull the transaction
history itself, then fill in what the chain cannot know (for example the purchase
price). Today nothing reads history from any chain: the legacy `crypto` module only
polls a BTC/ETH balance. This change is the first vertical slice toward that goal,
for one network (Bitcoin), so the storage, sync and missing-data contract can be
proven end to end before other networks are added.

## What Changes

- Owner can register a Bitcoin mainnet address (validated, normalized, one row per
  owner and address).
- Owner can run a sync that reads confirmed history from a free Esplora-compatible
  API (`blockstream.info`, no key) page by page, newest first, and stores each
  transaction once as a raw observation plus its exact per-address amounts in
  satoshis.
- Sync is incremental and resumable: progress is committed per page, an interrupted
  sync resumes from its cursor, a finished sync only reads new transactions next time,
  and a replay of the same data never duplicates or changes rows (database uniqueness).
- Provider failures (rate limit, server error, timeout, malformed body) stop the sync
  with an explicit outcome; already committed pages remain, nothing partial is stored.
- A protected Russian page lists addresses, sync state and imported transactions.
  Every imported transaction shows its USD value as missing ("не указана"), never zero.

## Capabilities

### New Capabilities
- `wallet-address-import`: Bitcoin address registration, incremental idempotent
  history sync through a free Esplora adapter, private reads and the Russian page that
  shows imported transactions with their missing-data state.

### Modified Capabilities
None. Accounting, valuation, CSV import and the legacy `crypto` module keep their
contracts; imported observations do not create trades yet.

## Impact

- Backend: new `wallet-addresses` module (adapter, service, controller, input), one
  additive migration (`wallet_addresses`, `wallet_address_transactions`), migration
  count 22 -> 23 in existing PostgreSQL probes.
- Frontend: new page `/wallet-addresses` and one navigation link.
- Tests: Jest adapter/input/sync tests against a local HTTP fixture server, a real
  PostgreSQL probe, Esplora fixtures in the E2E provider stub, one Playwright journey
  added to the critical manifest (20 -> 21 cases).
- No new dependency, no API key, no paid service, no environment variable.

Data impact: additive tables only; no existing row, table or column changes. Down
migration refuses automatic destructive rollback, like the existing migrations.

Dependencies: none. Independent of `show-unrealized-pnl` (PR #30); does not touch
valuation code.

Non-goals: Ethereum, Solana and Zcash (Zcash shielded history cannot be read from an
address at all; only transparent t-addresses could be added later); xpub/HD wallet
discovery; mempool (unconfirmed) transactions; reorg repair beyond what a later full
re-walk provides; USD prices or editing missing values (next slice); turning
observations into trades or FIFO lots; background/scheduled sync; deleting addresses;
removing the legacy `crypto` module; production deployment.
