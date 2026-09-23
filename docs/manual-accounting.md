# Exact manual opening positions

The manual accounting module records exchange/off-chain holdings separately from
legacy assets and watched wallet balances. It does not add those balances together,
assign chain/contract identities or call external providers. No past purchase, cash
flow, valuation or profit is inferred from an opening balance.

## Data and precision

Migration 13 adds manual_accounts, accounting_instruments, account_opening_snapshots
and account_opening_positions. All owner references point to users, not the singleton
authentication binding. Historical migrations and previous rows remain unchanged.
Downgrade refuses to discard accounting history; application rollback alone does
not undo the schema. Use an isolated copy and the migration preflight for upgrades.

Manual instrument UUIDs establish identity. Duplicate names or symbols are allowed;
explicitly select the existing instrument to reuse it. USD/USDC labels do not create
fiat balances, verified tokens or a price mapping. Instruments and account names
are immutable in this slice. There is no account/instrument deletion endpoint.

Quantities and recorded aggregate USD acquisition costs use numeric(78,30): at most
48 integer digits and 30 fractional digits, returned as canonical decimal strings.
Inputs must be strings containing ASCII digits with an optional decimal point and
fraction. No sign, exponent, comma, whitespace, numeric JSON, rounding or coercion.
Submitted scale is checked before trimming zeros. Raw amount text is limited to 256
characters. Quantity must be positive. Known total cost is nonnegative; known zero is
explicitly different from unknown/null. Unknown cost never becomes a zero-cost lot.

An opening has a coverage instant, asOf, with an explicit offset. Valid Gregorian
YYYY-MM-DDTHH:mm:ss[.SSS]Z or +/-HH:mm offsets normalize to UTC milliseconds; accepted
years 1970..9999, fractions 1..3 digits, offsets at most 14:00. No rollover dates, leap
seconds, missing zones or excess precision. This is not an acquisition timestamp.
Aggregate known cost alone does not establish FIFO purchase chronology.

## Private API and safe corrections

All routes require a real full password-plus-MFA owner session. Writes also require
valid Origin and session CSRF. The shared general-route limit remains in force.
Amounts and timestamps have strongly typed projections; owner IDs and stored
canonical request payloads are not exposed. Unknown fields and wrong raw types
return 400; inaccessible account/instrument references return generic 404.

| Route | Purpose |
| --- | --- |
| POST /accounting/accounts | requestId UUIDv4 and name create an empty account |
| GET /accounting/accounts | Owner accounts, exclusive UUID cursor, limit 1..100/default 50 |
| POST /accounting/instruments | requestId, name, optional symbol create a manual identity |
| GET /accounting/instruments | Owner instruments, same bounded cursor contract |
| GET /accounting/accounts/:id | Current revision and complete opening, or revision 0/null |
| POST /accounting/accounts/:id/openings | Append a complete opening replacement |
| GET /accounting/accounts/:id/openings | Descending history, exclusive beforeRevision, limit 1..20/default 10 |

Creation returns 201. Reusing a request UUID with the same normalized payload returns
200 and the original identity; changed payload with that key returns 409. UUID case,
trimmed names, decimal zeros, equivalent UTC offsets and position ordering normalize
before comparison. Names remain case-sensitive; ordinary Unicode is preserved.
Account creation replay reports the current revision, without changing the pointer.
Instrument symbol omitted means null; explicitly supplied null is invalid.

Opening writes require requestId, expectedRevision (raw JSON integer 0..2147483646),
asOf and 1..100 distinct owned instrument positions. Each position supplies
instrumentId, quantity, costStatus (known/unknown) and totalCostUsd (string/null).
Mixed-case spellings of the same UUID still count as a duplicate and return 400.

The service locks the account and checks request replay before revision comparison.
An old replay returns its original snapshot even after a later correction; it never
rewinds the current pointer. A new request must match the current revision. Competing
corrections have one winner; 409 requires reload and review. Snapshot, positions and
pointer commit together. A failed commit consumes no request key. A network failure
may leave an unknown outcome: retry unchanged input with the same key explicitly.
No mutation is automatically retried.

A correction replaces the entire position set; it does not add a trade or increase
quantities. Every previous snapshot remains available through bounded history.
Current and historical positions include immutable instrument labels even beyond
the picker page. Empty account creation is allowed, empty opening replacement is not.
The separate [USD trade journal](usd-trade-journal.md) supports an explicitly attested
empty origin without opening history, or reviewed [known-cost carry-in](known-cost-carry-in.md)
from the current opening. Once initialized, it blocks new opening writes
under the same account lock; old opening receipts retain their replay semantics.
An aggregate opening cannot be converted into ordered acquisition lots. Reviewed
[CSV imports](csv-imports.md) use either supported origin and the same FIFO calculation.
Transfers, valuation and returns remain separate future slices.

## Verification scope

The [archived verification record](../openspec/changes/archive/2026-09-23-record-manual-opening-positions/verification.md)
links actual RED/GREEN and independent review. Real PostgreSQL probes passed
numeric/null/owner constraints, two-process races, deferred COMMIT rollback and
populated 12-to-13 preservation. The complete release-image run passed 85 HTTPS
Chromium cases (74 retained and 11 new), with actual password/MFA, Russian forms,
exact strings, restart, history, conflicts and private access. Only external providers
are stubbed. Accounting flows make no provider requests; the two existing backend
startup price warmups are measured separately. No owner/production data is used.
Hosted CI and full release hardening remain unexecuted.
