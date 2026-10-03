## Context

The owner's goal is address-based import with manual gap filling. The only chain
code today is the legacy `backend/src/crypto` module: a `crypto_wallets` table with a
float balance, an hourly cron that overwrites it from `blockstream.info` or public ETH
RPCs, and no history. The audit marks it for later removal. The E2E provider stub
already terminates `blockstream.info` over the acceptance HTTPS proxy.

## Goals / Non-Goals

Goals: one network end to end; raw observations stored once; resumable incremental
sync; missing USD value visible. Non-goals are listed in the proposal.

## Decisions

**New module, legacy left alone.** Reusing `crypto_wallets` would tie raw history to a
float-balance table, its cron and ETH token handling, and make the later removal of the
legacy module a data migration. A new `wallet-addresses` module with its own two tables
is smaller than adapting it. The legacy module and its table are not changed.

**Network-neutral table names, Bitcoin-only rows.** `wallet_addresses.network` has a
CHECK for `'bitcoin'` only; amounts are integer base units (`numeric(78,0)`, wide enough for wei), so a later
network adds a CHECK value instead of new tables. There is no adapter interface or
registry: one `EsploraClient` class, one service.

**Provider.** `https://blockstream.info/api`, free, keyless, Esplora API. Endpoints:
`/address/{a}/txs/chain` and `/address/{a}/txs/chain/{last_txid}`, 25 confirmed
transactions per page, newest first. Requests are sequential with a 250 ms pause
between pages, an 8 s total deadline per response (abort signal, not only an idle
timeout), a 32 MB body cap for pages of large consolidation transactions, no redirects. 429 stops the sync
(`rate_limited`); nothing is retried automatically. Mempool transactions are not
requested, so stored rows never change after insert.

**Walk state instead of "stop at first known txid".** Stopping at the first known
txid leaves a permanent gap if a sync fails after committing a newer page. Each
address instead keeps:

- `walkTopTxid`: newest txid seen when the current walk started;
- `walkCursorTxid`: last txid of the last committed page of the current walk;
- `completedTopTxid` / `completedAt`: newest txid of the last finished walk.

A walk starts at the top page, commits each page with the new cursor in one
transaction, and finishes when a page contains `completedTopTxid` or is shorter than
25. Then `completedTopTxid := walkTopTxid` and the walk fields are cleared.

Esplora (electrs) answers `200 []` both at the true end of history and when the backend
behind the load balancer is behind and does not know the cursor txid (independent
review finding). An empty page after a cursor therefore ends the walk only if
`chain_stats.tx_count` from `GET /address/{a}` equals the stored count, or the stored
count plus the transactions above `walkTopTxid` on the current top page; otherwise the
sync returns `unavailable` and keeps the cursor. An empty top page after a completed
walk is also treated as `unavailable`. A transaction orphaned by a reorg after being
stored would keep the count higher than the provider's and block completion; reorg
repair stays a non-goal and would be a separate change. An
interrupted walk resumes from its cursor; new transactions that arrive during a walk
are picked up by the next walk. If `completedTopTxid` disappears (reorg), the walk
simply runs to the end of history again; inserts stay idempotent.

**Idempotency and races.** Primary key `(addressId, txid)` with
`INSERT … ON CONFLICT DO NOTHING`. Each page commit locks the address row
(`FOR UPDATE`) and checks that the walk state still equals the state the page was
fetched for; otherwise it returns 409 and writes nothing. No lock is held during HTTP.

**Amounts.** Per address: `received = Σ vout.value where scriptpubkey_address = a`,
`sent = Σ vin.prevout.value where prevout.scriptpubkey_address = a` (coinbase inputs
have no prevout), `fee = tx.fee` (whole transaction). BigInt arithmetic, stored as
integers, formatted to exact 8-decimal strings without floats.

**Validation.** Addresses: base58check (version 0x00/0x05) or bech32/bech32m
(`bc` HRP, witness v0 with BIP-173, v1+ with BIP-350), checksums verified with
`node:crypto`, no new dependency. Provider bodies: strict shape check of every field
used, page length ≤ 25, confirmed status, hex txids and block hashes, safe
non-negative integers. Raw objects are stored as returned once validated.

**API.** `GET/POST /api/wallet-addresses`, `POST /api/wallet-addresses/:id/sync`,
`GET /api/wallet-addresses/:id/transactions?offset&limit`. Sync returns 200 with
`outcome` (`complete`, `partial`, `provider_error`), `reason`, `imported` and the
address summary, because a provider failure after committed pages is a recorded
result, not a failed request. A sync also stops after 25 s of wall time (`partial`), so
the request stays well inside the frontend's per-request timeout (60 s for sync).

## Risks / Trade-offs

- Public Esplora instances can rate-limit or change; the base URL is one constant and
  mempool.space serves the same API if needed.
- Large addresses need several clicks (250 transactions per call); acceptable for a
  single owner, and a background job can come later.
- `fee` is the whole transaction fee even when other inputs paid part of it; it is
  shown as the network fee of that transaction, not as the owner's cost.

## Migration Plan

Migration 23 `AddWalletAddressImport1790400000000` creates two tables and one index.
It touches no existing object; `down` throws like its predecessors. Existing
PostgreSQL probes are updated from 22 to 23 migrations. Rollback of the app keeps the
empty tables harmlessly.
