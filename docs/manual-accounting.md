# Exact manual opening positions

The manual accounting module records exchange/off-chain holdings separately from
legacy assets and watched wallet balances. It does not add those balances together,
assign chain/contract identities or call external providers. No past purchase, cash
flow, valuation or profit is inferred from an opening balance.

## Data and precision

Migration13 adds manual_accounts, accounting_instruments, account_opening_snapshots
and account_opening_positions. All owner references point to users, not the singleton
authentication binding. Historical migrations and previous rows remain unchanged.
Downgrade refuses to discard accounting history; application rollback alone does
not undo the schema. Use an isolated copy and the migration preflight for upgrades.

Manual instrument UUIDs establish identity. Duplicate names or symbols are allowed;
explicitly select the existing instrument to reuse it. USD/USDC labels do not create
fiat balances, verified tokens or a price mapping. Instruments and account names
are immutable in this slice. There is no account/instrument deletion endpoint.

Quantities and recorded aggregate USD acquisition costs use numeric(78,30): at most
48 integer digits and30 fractional digits, returned as canonical decimal strings.
Inputs must be strings containing ASCII digits with an optional decimal point and
fraction. No sign, exponent, comma, whitespace, numeric JSON, rounding or coercion.
Submitted scale is checked before trimming zeros. Raw amount text is limited to256
characters. Quantity must be positive. Known total cost is nonnegative; known0 is
explicitly different from unknown/null. Unknown cost never becomes a zero-cost lot.

An opening has a coverage instant, asOf, with an explicit offset. Valid Gregorian
YYYY-MM-DDTHH:mm:ss[.SSS]Z or +/-HH:mm offsets normalize to UTC milliseconds; accepted
years1970..9999, fractions1..3digits, offsets at most14:00. No rollover dates, leap
seconds, missing zones or excess precision. This is not an acquisition timestamp.
Aggregate known cost alone does not establish FIFO purchase chronology.

## Private API and safe corrections

All routes require a real full password-plus-MFA owner session. Writes also require
valid Origin and session CSRF. The shared general-route limit remains in force.
Amounts and timestamps have strongly typed projections; owner IDs and stored
canonical request payloads are not exposed. Unknown fields and wrong raw types
return400; inaccessible account/instrument references return generic404.

| Route | Purpose |
| --- | --- |
| POST /accounting/accounts | requestId UUIDv4 and name create an empty account |
| GET /accounting/accounts | Owner accounts, exclusive UUID cursor, limit1..100/default50 |
| POST /accounting/instruments | requestId, name, optional symbol create a manual identity |
| GET /accounting/instruments | Owner instruments, same bounded cursor contract |
| GET /accounting/accounts/:id | Current revision and complete opening, or revision0/null |
| POST /accounting/accounts/:id/openings | Append a complete opening replacement |
| GET /accounting/accounts/:id/openings | Descending history, exclusive beforeRevision, limit1..20/default10 |

Creation returns201. Reusing a request UUID with the same normalized payload returns
200 and the original identity; changed payload with that key returns409. UUID case,
trimmed names, decimal zeros, equivalent UTC offsets and position ordering normalize
before comparison. Names remain case-sensitive; ordinary Unicode is preserved.
Account creation replay reports the current revision, without changing the pointer.
Instrument symbol omitted means null; explicitly supplied null is invalid.

Opening writes require requestId, expectedRevision (raw JSON integer0..2147483646),
asOf and1..100 distinct owned instrument positions. Each position supplies
instrumentId, quantity, costStatus (known/unknown) and totalCostUsd (string/null).
Mixed-case spellings of the same UUID still count as a duplicate and return400.

The service locks the account and checks request replay before revision comparison.
An old replay returns its original snapshot even after a later correction; it never
rewinds the current pointer. A new request must match the current revision. Competing
corrections have one winner;409 requires reload and review. Snapshot, positions and
pointer commit together. A failed commit consumes no request key. A network failure
may leave an unknown outcome: retry unchanged input with the same key explicitly.
No mutation is automatically retried.

A correction replaces the entire position set; it does not add a trade or increase
quantities. Every previous snapshot remains available through bounded history.
Current and historical positions include immutable instrument labels even beyond
the picker page. Empty account creation is allowed, empty opening replacement is not.
CSV, operations/FIFO, transfers, valuation and returns are separate future slices.

## Verification scope

The active change record links exact RED/GREEN and retained-test evidence. Real
PostgreSQL probes cover numeric/null/owner constraints, two-process request races,
actual deferred COMMIT rollback and populated12-to13 preservation. Browser acceptance
uses actual password/MFA, HTTPS and PostgreSQL; it must cover exact strings and
restart, Russian forms, conflicts and private access. No owner/production data is
used. Full release-image acceptance and independent review are required before archive.
