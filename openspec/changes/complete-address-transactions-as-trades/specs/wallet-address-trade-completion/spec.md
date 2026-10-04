## ADDED Requirements

### Requirement: ADDRT-1 Complete an incoming address transaction as a buy trade
The system SHALL let the authenticated owner complete an imported incoming (`in`)
Bitcoin address transaction by recording a buy trade in one of their manual accounts
through `POST /wallet-addresses/{id}/transactions/{txid}/trade` with
`{ accountId, trade }`, where `trade` is the existing trade create body. The trade SHALL
be written through the same journal path, validation, FIFO projection and optimistic
revision check as a manual trade, and the link between the transaction and the trade
SHALL be written in the same database transaction. A transaction SHALL have at most one
active linked trade: another completion SHALL be refused with 409 while it is active and
allowed after it is voided in the journal. The trade side SHALL be `buy` and
its quantity SHALL equal exactly the BTC the transaction brought to the address
(received minus sent); otherwise the request SHALL be rejected with 422 before any row
is written. The trade time SHALL be the owner's input (prefilled from the block time).

#### Scenario: ADDRT-COMPLETE Owner records the purchase behind a received transaction
- **GIVEN** an owner with an imported incoming transaction that brought `0.00918359` BTC to their address, a manual account with an initialized trade journal at revision 0 and a BTC instrument
- **WHEN** they complete it with a buy of `0.00918359` at `2025-06-13T00:00:00.000Z` for gross `1000` USD and fee `0`
- **THEN** the response is 201 with the trade receipt, the account journal is at revision 1 with that active buy trade, exactly one link row joins the transaction to the trade, and the account's FIFO remaining cost includes `1000`.

#### Scenario: ADDRT-REPLAY Replay and double completion
- **GIVEN** the transaction completed in ADDRT-COMPLETE
- **WHEN** the owner repeats the identical request, then sends a different completion (new request id, gross `900`) for the same transaction
- **THEN** the replay returns 200 with the same trade id and changes nothing, the second completion returns 409 in the same account and in another account, and the journal still holds exactly one trade and revision 1.

#### Scenario: ADDRT-INVALID Wrong direction, side or quantity
- **GIVEN** an owner with an imported outgoing transaction and an incoming one that received `0.0125` BTC
- **WHEN** they try to complete the outgoing one, the incoming one as a `sell`, and the incoming one with quantity `0.0124`
- **THEN** each request returns 422 and no trade, version or link row is written.

#### Scenario: ADDRT-ATOMIC A refused trade leaves no link
- **GIVEN** an incoming transaction and an account whose journal is not initialized, and another account whose journal coverage starts after the trade time
- **WHEN** the owner tries to complete the transaction in either account
- **THEN** each request returns 409 and no trade, version or link row exists.

### Requirement: ADDRT-2 Completion state on the address transactions
Each transaction returned by `GET /wallet-addresses/{id}/transactions` SHALL carry
`trade: { accountId, tradeId, status, grossUsd, feeUsd }` from the linked trade's current
version, or `null` when not completed. A transaction with an active linked trade SHALL
report `usdValue` equal to the current gross USD and `usdValueStatus: 'known'`; every
other transaction SHALL keep `usdValue: null` and `usdValueStatus: 'missing'`.
`missingUsdValueCount` SHALL count transactions without an active linked trade.
Corrections and voids made in the account journal SHALL show here without a separate
update.

#### Scenario: ADDRT-STATE Completed, corrected, voided and redone transactions
- **GIVEN** an address with 3 imported transactions, two of them incoming, one completed as in ADDRT-COMPLETE
- **WHEN** the owner reads the transactions, then corrects the trade's gross to `1010` in the journal and reads again, then voids it in the journal and reads again, then completes the transaction again in a second account for `990`, tries a third completion and reads again
- **THEN** the first read shows the completed one with `usdValue` `1000`, `known`, status `active` and `missingUsdValueCount` 2; the second shows `1010`; the third shows status `voided`, `usdValue` null, `missing` and `missingUsdValueCount` 3; the new completion returns 201, the third returns 409, and the last read shows the second account's active trade with `usdValue` `990` and `missingUsdValueCount` 2.

### Requirement: ADDRT-3 Private completion and additive storage
Completion and reads SHALL be visible only to the owning session: anonymous requests
SHALL get 401, unsafe requests without the CSRF token 403, and another owner's address,
transaction, account or instrument SHALL be indistinguishable from a missing one (404).
The link SHALL be stored by an additive migration in a table whose primary key is the
trade reference, indexed by the imported transaction, with restricting foreign keys to
the imported transaction and the trade's first version; no existing table, column or row
SHALL change.

#### Scenario: ADDRT-PRIVATE Foreign and anonymous access
- **GIVEN** a second owner's address, transaction and manual account
- **WHEN** the owner completes the foreign transaction, completes their own transaction into the foreign account, and an anonymous client and a request without CSRF try to complete their own transaction
- **THEN** the foreign requests return 404, the anonymous one 401, the one without CSRF 403, and no trade or link row is written.

#### Scenario: ADDRT-MIGRATION Additive link table
- **GIVEN** a database migrated through migration 23 with addresses, imported transactions and trades present
- **WHEN** the explicit migration CLI applies the new migration
- **THEN** the link table exists with its trade-reference primary key and both restricting foreign keys, every pre-existing row is byte-for-byte unchanged, and `down()` refuses without an explicit recovery plan.

#### Scenario: ADDRT-UI Owner completes a received transaction on the page
- **GIVEN** an owner with an imported address history, a manual account with an initialized journal and a BTC instrument
- **WHEN** they press «Дополнить» on an incoming row, choose the account, keep the prefilled quantity and time, enter the USD amount and save
- **THEN** the row shows the USD amount and the account name instead of «не указана», «Без стоимости в USD» drops by one, and the account's trade journal page lists the same buy trade.
