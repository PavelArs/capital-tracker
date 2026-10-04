# wallet-address-import Specification

## Purpose
Let the owner register Bitcoin addresses and import their confirmed on-chain history
from a free Esplora provider, incrementally and replay-safely, showing every missing
USD value as missing rather than zero.
## Requirements
### Requirement: ADDR-1 Owner-scoped Bitcoin address registration
The system SHALL let the authenticated owner register a Bitcoin mainnet address
(P2PKH `1…`, P2SH `3…`, bech32/bech32m `bc1…`). Bech32 addresses SHALL be stored in
lowercase; mixed-case bech32 and every other format SHALL be rejected with 400 before
any row is written or any provider is called. Registering an address the owner already
has SHALL return the existing row with 200 instead of creating a second one, enforced
by a database uniqueness constraint on owner, network and address.

#### Scenario: ADDR-ADD Valid, duplicate and invalid addresses
- **GIVEN** an owner with no addresses
- **WHEN** they register `BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ` (upper-case bech32), then `bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq`, then `bc1qAr0s…` (mixed case) and `not-an-address`
- **THEN** the first returns 201 with the lowercase address and sync state `never`, the second returns 200 with the same id, both invalid inputs return 400, exactly one row exists and the provider received no request.

### Requirement: ADDR-2 Incremental idempotent history sync
The system SHALL read confirmed history for a registered address from the Esplora
endpoints `GET /address/{address}/txs/chain` and `GET /address/{address}/txs/chain/{last_txid}`
(25 transactions per page, newest first). For each transaction it SHALL store the
validated provider object as a raw observation together with the block height, block
hash, block time, the exact satoshis this address received (sum of outputs paying it),
sent (sum of spent outputs it owned) and the transaction fee. Each sync walks from the
newest transaction down until it reaches the newest transaction of the previous
completed walk or the end of history, committing each page together with its cursor
in one database transaction. Because Esplora also answers an empty page when a lagging
backend does not know the cursor, an empty page after a cursor SHALL end the walk only
when the address's confirmed transaction count (`GET /address/{address}`) equals the
stored count plus the transactions newer than the walk's top; otherwise the sync stops
with `provider_error`/`unavailable` and keeps the cursor. An empty top page for an
address that already completed a walk SHALL likewise stop without changing state.
Rows SHALL be unique per address and txid in the database, so replaying a page never
duplicates or changes a stored row. One sync call SHALL fetch at most 10 pages and
return `partial` when more remain.

#### Scenario: ADDR-SYNC-PAGES First sync across pages
- **GIVEN** a registered address whose provider history holds 60 confirmed transactions
- **WHEN** the owner runs one sync
- **THEN** the provider receives exactly three page requests (top, then after the 25th and 50th txid), 60 rows are stored with exact satoshi amounts, the outcome is `complete` with `imported` 60 and the address state is `complete`.

#### Scenario: ADDR-SYNC-REPLAY Unchanged history
- **GIVEN** the address above after a complete sync
- **WHEN** the owner syncs again and the provider history is unchanged
- **THEN** exactly one page request is made, `imported` is 0 and every stored row is byte-for-byte unchanged.

#### Scenario: ADDR-SYNC-INCREMENTAL New transactions only
- **GIVEN** a completed address and 3 new confirmed transactions on top of its history
- **WHEN** the owner syncs
- **THEN** one page request is made, exactly the 3 new rows are added and the 60 earlier rows are unchanged.

#### Scenario: ADDR-AMOUNTS Exact per-address amounts
- **GIVEN** provider transactions where the address receives, spends with change, sends to itself, appears among several inputs, and receives a coinbase output
- **WHEN** they are synced
- **THEN** received, sent and fee are stored as exact integer satoshis summed only over inputs and outputs of this address, displayed as exact 8-decimal BTC strings; direction is `self` when the address funded the transaction, every non-zero output pays it back and it did not gain, otherwise `in` when received exceeds sent and `out` when it does not.

#### Scenario: ADDR-SYNC-END End of history versus a lagging backend
- **GIVEN** an address with exactly 50 transactions, and another with 60 whose provider answers `[]` for the second page and then gains 3 new transactions
- **WHEN** each is synced until complete
- **THEN** the first completes after an empty third page because the provider count is 50; the second stops with `provider_error`/`unavailable` and 25 rows, then resumes below its cursor to all 60 rows without a gap, and the next sync adds exactly the 3 new rows; an empty top page later leaves the completed state unchanged.

#### Scenario: ADDR-SYNC-LIMIT Page budget per call
- **GIVEN** an address with 300 transactions
- **WHEN** the owner syncs twice
- **THEN** the first call makes 10 page requests and returns `partial` with 250 imported; the second completes with the remaining 50.

#### Scenario: ADDR-DB Database uniqueness and concurrent syncs
- **GIVEN** a stored transaction and two sync calls racing on the same address
- **WHEN** a duplicate (address, txid) row is inserted directly, and the two syncs run concurrently
- **THEN** the direct insert fails on the database constraint, and after both syncs each txid exists exactly once; a sync whose cursor was advanced by the other returns 409 without writing.

### Requirement: ADDR-3 Explicit provider failure and resume
The system SHALL stop a sync without storing anything from a failed page when the
provider returns a non-2xx status, times out, or returns a body that is not a list of
at most 25 confirmed transactions with valid txids, heights, times and integer
values. The sync SHALL return 200 with outcome `provider_error` and a reason
(`rate_limited` for 429, `unavailable` for other failures, `invalid_response` for
malformed bodies), keep every page committed before the failure and resume from the
committed cursor on the next sync without gaps or duplicates.

#### Scenario: ADDR-SYNC-RESUME Failure on the second page
- **GIVEN** a 60-transaction history and a provider that answers 429 to the second page request
- **WHEN** the owner syncs, and then syncs again after the provider recovers
- **THEN** the first call returns `provider_error`/`rate_limited` with 25 rows stored and state `partial`; the second call requests only pages after the 25th txid, ends `complete` with 60 rows and no duplicates.

#### Scenario: ADDR-SYNC-INVALID Malformed provider body
- **GIVEN** a provider that returns a transaction with a non-integer value or a non-hex txid
- **WHEN** the owner syncs
- **THEN** the outcome is `provider_error`/`invalid_response`, no row from that page is stored and the cursor does not move.

### Requirement: ADDR-4 Private reads and honest missing data
The system SHALL serve addresses and their transactions only to the authenticated
owner (existing session, MFA, CSRF and origin rules), return 404 for unknown or
foreign ids and read transactions from PostgreSQL only, newest block first, paged by
`offset`/`limit` (default 50, maximum 100). Every transaction SHALL report
`usdValue: null` with `usdValueStatus: "missing"`; the system SHALL never present a
missing value as zero.

#### Scenario: ADDR-PRIVATE Denials
- **GIVEN** anonymous and pending-MFA clients, a request without CSRF token and another owner's address id
- **WHEN** they list, register, sync or read transactions
- **THEN** the existing 401/403 denials apply, the foreign id returns 404 and no row is written or provider called.

#### Scenario: ADDR-UI Russian page shows imported history with missing values
- **GIVEN** the authenticated owner and a provider history of 60 transactions
- **WHEN** they open «Адреса кошельков», add the address and press «Загрузить транзакции»
- **THEN** the page reports «Загружено полностью» and 60 transactions, the newest rows show exact BTC amounts, direction and date, each shows «не указана» as its USD value, the summary reads «Без стоимости в USD: 60 из 60», and after a reload the same data is shown without a provider request.

#### Scenario: ADDR-MIGRATION Additive schema
- **GIVEN** a populated database at migration 22
- **WHEN** the migration CLI runs
- **THEN** it applies migration 23 creating only the two empty new tables, every previous row and schema object is unchanged, a rerun applies nothing, and the down migration refuses without changing data.

