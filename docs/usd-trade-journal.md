# USD trade journal and exact FIFO

This incremental accounting slice records manual USD purchases and sales separately
from legacy balances. It calculates recorded acquisition cost and realized journal
results. It does not calculate market value, portfolio return, cash balances or tax
liability. It never calls a provider or infers trades from blockchain observations.

The [verification record](../openspec/changes/archive/2026-09-23-record-usd-fifo-trades/verification.md)
records actual RED/GREEN and resolved independent review findings. All 101 HTTPS
Chromium cases passed without retries, including 85 retained cases and 16 USD cases,
alongside real PostgreSQL and migration prerequisites. Full release hardening remains;
no production migration or deployment has been performed.

## Coverage and identity

The owner must explicitly confirm an empty beginning and enter its UTC coverage
instant. Only accounts without a current opening and without any opening history
are eligible. A known zero opening, unknown cost or a manually cleared pointer does
not establish empty history. Aggregate opening cost cannot determine FIFO order.

Initialization and opening replacement lock the same account. At most one can win.
Once initialized, a journal retains its origin permanently, even after every trade
is void. New opening replacements are then refused; pre-existing request receipts
retain their original replay semantics. Accounts with opening history remain usable
for opening corrections and show why journal carry-in is not supported yet.

Instrument UUIDs establish identity, including instruments with identical symbols.
Select an existing instrument to reuse it. Labels do not establish a blockchain,
token contract, price mapping, stablecoin parity or fiat balance.

## Exact input and execution order

Every trade records an owned instrument, buy/sell side, execution timestamp, integer
order within that timestamp, positive quantity, positive gross total USD amount,
and a separate nonnegative USD fee. Gross is the actual total, not the unit price.
Buy cost is gross plus fee; sale proceeds are gross minus fee and may be negative.

Amounts are decimal strings with up to 48 significant integer and 30 fractional digits, without
rounding. Numeric JSON, signs, exponent notation, commas, whitespace and excess
submitted scale are refused. Leading zeroes are accepted. Raw strings are limited to 256
characters. Buy gross plus fee must fit the same 78-digit atom bound. Output uses canonical exact strings;
quantities and monetary amounts are never converted to floating-point numbers.

Timestamps follow the same explicit-offset Gregorian contract as manual openings:
years 1970..9999, millisecond precision, normalized to UTC. The chronological key is
timestamp plus order 0..2147483647; active trades across the whole account must have
distinct keys. Submission arrival and UUID ordering do not determine execution.
Every active trade must lie on or after the declared coverage instant.

## Cost allocation and corrections

FIFO is computed independently for each instrument over the complete effective
history. With original lot quantity Q and cost C represented as integer atoms,
cumulative sold quantity q receives floor(C*q/Q) cost atoms. Each match consumes
the difference between successive cumulative allocations. The last portion takes
the residual, preserving exact lot cost without repeated rounding.

For buys of 1 unit for $100 and 1 for $200, selling 1.5 for gross $450 with zero fees
consumes $200 cost, realizes $250 and leaves 0.5 units with $100 cost. Fees of $1/$2/$3
instead produce consumed cost $202, net proceeds $447, realized $245 and remaining
cost $101. These are journal results, not investment return. A 3-unit lot costing $1
allocates successive one-unit sales
0.333333333333333333333333333333, the same again, then
0.333333333333333333333333333334.

A correction supplies every execution field and appends a complete immutable
version. A void appends a terminal version retaining the old execution fields;
there is no restoration or deletion endpoint. All affected history is recomputed
before committing any write, including backdated purchases, corrections and voids.
Any intermediate negative holding rejects the entire command, even if the final
quantity would be positive. Voiding a consumed purchase may therefore be refused.

The journal permits at most 1000 active trades and 10000 immutable versions, including
voids. At the version cap every new command, including another void, is refused.
An already accepted command remains replayable. These explicit bounds also bound
exact arithmetic: up to 81 atom digits in sums and 156 in allocation products.

## Protected API and receipts

All paths below extend `/accounting/accounts/:id`, with the `/api` prefix at the HTTPS
deployment edge. Existing full password/MFA
sessions, Origin/CSRF protection, generic route quotas and owner isolation apply.
Malformed raw values return 400; inaccessible resources return generic 404; stale
revision, chronology, holdings, eligibility and capacity conflicts return 409.

| Path | Behavior |
| --- | --- |
| GET /trade-journal | Eligibility, immutable origin, current revision/counts/limits and exact summary |
| POST /trade-journal | requestId, coverageFrom and literal assertEmpty:true initialize the origin |
| POST /trades | requestId, expectedJournalRevision and complete execution create a trade |
| POST /trades/:tradeId/corrections | Same command fields append a full correction |
| POST /trades/:tradeId/voids | requestId and expectedJournalRevision append a terminal void |
| GET /trades | Current heads, including voids |
| GET /trade-lots | Nondepleted FIFO lots with original and remaining quantity/cost |
| GET /trade-realizations | Active sales with net proceeds, consumed cost and realized result |
| GET /trades/:tradeId/matches | Cost matches with exact buy/sell identity and version provenance |
| GET /trades/:tradeId/versions | Complete immutable history with owned instrument labels |

New writes return 201. Replaying the same normalized command/key returns 200 and its
original receipt. Changed payload with an accepted key returns 409. Trade keys are
shared across create/correct/void within an account; initialization has a separate
namespace. Replay is checked under the account lock before live revision, capacity
or target-state checks. It never rewinds a pointer or creates a duplicate version.
Failed transactions reserve no request key. No mutation is automatically retried.

A receipt describes the original accepted revision. The browser then reads current
state; it must not replace newer results with a replayed older receipt. After a lost
response, only an explicit repeat of the complete original command can safely resolve
its outcome. A refresh or stale read must not silently change its key or revision.
Unseen target changes require review before a new correction/void command. A failed
current-state read after a known successful write blocks further writes until review.

Current projections use real read-only repeatable-read transactions. Pages accept
limit 1..100 (default 50), offset 0..9999 and journalRevision 0..10000. Continuations require
the revision; drift returns 409 and the browser discards accumulated current pages
before reloading. Calculation always uses full history, regardless of page size.
Version history instead uses limit 1..20 (default 10) and an exclusive beforeVersion
cursor 1..10001, and never rewrites older versions.

## Storage and remaining work

Migration 14 adds account_trade_journals, account_trades and account_trade_versions.
Composite owner/account/instrument/version foreign keys use RESTRICT. The head
reference is deferred to commit so identity and its first full version can be
inserted together without allowing an orphaned committed head. Numeric/time checks
reject nonfinite values. Existing migrations and previous rows are preserved.
Downgrade refuses to erase accounting history; application rollback does not undo
the schema. Validate upgrades and recovery on an isolated copy.

The verified [CSV import slice](csv-imports.md) adds reviewed purchases/sales to this
same journal, retaining original evidence and conditional whole-batch rollback. Its
complete 124-case HTTPS suite and actual PostgreSQL/migration checks passed. Acquisition-lot carry-in, crypto swaps,
token-denominated fees, owned transfers, external contributions/withdrawals, valuations,
returns and reconciliation remain separate incremental work. This journal does not
establish complete investment history or make legacy observations part of its results.
