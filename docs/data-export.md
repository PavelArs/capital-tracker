# Data export

Settings → Data (M19, PR-EXP-1) gives the owner two downloads. Both are read in one
read-only, repeatable-read transaction, change nothing, are never cached
(`Cache-Control: no-store`) and need a full owner session like every other private route.

| Button | Route | File |
|---|---|---|
| Export CSV | `GET /export/csv` | `capital-tracker-export-YYYY-MM-DD.zip` |
| Export backup | `GET /export/backup` | `capital-tracker-backup-YYYY-MM-DD.json` |

The date in the name is the UTC date of the export.

## CSV archive (EXP-CSV)

A ZIP archive with one CSV per entity. Every CSV is UTF-8 with a byte order mark (so
spreadsheet apps read Cyrillic names), comma-separated, CRLF line ends and RFC 4180 quoting.
Amounts are exact decimals with a dot, times ISO 8601 in UTC. A text cell that a spreadsheet
would run as a formula (starting with `=`, `+`, `-`, `@`, tab or carriage return, and not a
number) is written with a leading `'`.

| File | One row per | Notes |
|---|---|---|
| `assets.csv` | asset | type, valuation currency and price source as in Portfolio. |
| `accounts.csv` | account | |
| `wallets.csv` | tracked address | network, address, wallet label and the account it belongs to. |
| `operations.csv` | journal entry | every buy, sell, income, expense, gift, fee, transfer, swap, reward, opening balance, deposit and withdrawal. |
| `chain-transactions.csv` | raw blockchain transaction leg | amounts in coins, the owner's classification and the operation it produced. |

`operations.csv` holds active **and voided** entries. `status` is `active` or `voided`; a
voided entry shows what it said before it was deleted. `source` is `manual`, `csv` (imported
from a CSV file) or `chain` (produced by classifying a blockchain transaction, whose txid is
in `chain_txid`). `id` matches the Transactions list (`trade:<uuid>`, `transfer:<uuid>`, …), and
`chain-transactions.csv` links to it in `operation_id`; both transactions of a blockchain
swap (CLS-SWAP) link to the one `swap:<uuid>`, whose `chain_txid` is the receipt. A pool
deposit (POOL-DEPOSIT) produces no entry; a pool withdrawal that returned more than its deposit
links to the `reward:<uuid>` of that pool income, and its `classification_details` name the
deposit. Values
are in USD as recorded; a trade paid in RUB or EUR also carries `paid_currency`,
`paid_amount`, `paid_fee` and the rate.

`classification_status` is `unclassified`, `classified` or `hidden`; the computed "Dust"
status depends on the current price and threshold and is not exported.

## JSON backup (EXP-JSON)

```json
{"format":"capital-tracker-backup","formatVersion":1,"exportedAt":"…","tables":{"owner_settings":[…],…}}
```

`tables` holds every row of the owner in each table listed in
`backend/src/owner-export/backup-tables.ts`, including every version of every journal entry
(the audit history), the raw chain transactions, classifications and the uploaded CSV files
(`originalBytes`, base64). Rows keep the database column names without `ownerId`; decimals are
strings so 30-place amounts stay exact; times are ISO 8601 in UTC.

Never in the backup: password hashes, the TOTP secret, recovery codes, sessions, password
reset links and sign-in limits. Market prices, Bank of Russia rates, portfolio snapshots and
sync state are left out too: they are collected or rebuilt again.

The legacy tables behind the screens retired in M20 (old assets, liabilities, crypto wallets
and currency visibility) and the capitals, reports and subscriptions no screen used stay in
the database untouched (their backend modules and APIs were removed later in M20); their rows join the backup under the same `tables` key, listed in
`legacyTables`. They belong to the owner by `userId`, which is left out like `ownerId`; the
shared legacy currency list contributes only the currencies those rows name (`currencies`).
The owner-export probe fails when a new table is neither backed up nor listed as left out
with its reason.

Restoring from the backup is not built yet; `formatVersion` changes when the layout does.
