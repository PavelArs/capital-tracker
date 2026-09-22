## Context

Legacy asset DTOs convert amounts to Number; legacy balances do not establish
acquisition cost or investment history. This change follows verified archive of
persist-auth-request-limits and creates an independent exact manual opening boundary.
No existing balances, prices, currencies or dates are reinterpreted as purchases.

## Goals / Non-Goals

**Goals:** Useful protected manual accounts, exact positions and explicit cost
completeness, durable correction history, safe retries and owner isolation.

**Non-Goals:** CSV, trades/FIFO, cash flows, transfers, price/FX collection, valuation,
returns, chain identities, account/address linking, legacy aggregation or migration,
DELETE, public routes, dependencies, production rollout. These remain future work.

## Decisions

### Small accounting module and explicit identity

Use one Nest accounting module/controller/service with narrow DTOs and pure decimal/
time validators, plus React manual-account list/detail pages and API types. Reuse
CurrentUser, default-deny sessions/MFA, CSRF client, protected layout and existing
form/table styles. No generic repository, event framework, arithmetic library or
UI-library migration is needed to store exact values. Existing global implicit DTO
conversion remains; preserve original JSON field types before decimal validation,
using the established raw-type defense rather than IsString alone.

Four additive tables: manual_accounts, accounting_instruments,
account_opening_snapshots, account_opening_positions. Every object belongs to an
owner UUID. Instrument UUID is immutable identity in namespace manual; name/symbol
are labels, never fiat, blockchain, contract or price-provider identity. Duplicate
names/symbols are allowed; explicit reuse selects the existing UUID. A symbol USD
is not automatically a fiat asset and USDC is never equivalent to USD cash.
Known cost is explicitly denominated in actual accounting USD independently of labels.

Accounts/instruments have immutable generated UUIDs, ownerId, requestId and canonical
creation payload, createdAt, name (trimmed nonempty1..120 characters); instruments
optionally have trimmed nonempty symbol1..32. Absent symbol canonicalizes to null;
explicit null is rejected. Reject control characters and preserve ordinary Unicode;
no case folding or Unicode normalization. There are no rename/delete endpoints here.

Accounts have currentRevision nullable in SQL (API0 means no opening). Snapshot key
(ownerId,accountId,revision), revision positive bounded integer, includes requestId,
canonical payload, asOf and createdAt. Positions reference snapshot and instrument
through composite owner foreign keys; unique snapshot/instrument, quantity, costStatus
and totalCostUsd. Add owner/id unique constraints where needed to support composite
references. Account (ownerId,id,currentRevision) references its own snapshot; create
account with null pointer, insert snapshot and positions, then set pointer in the
same transaction. Snapshot/account foreign keys do not cascade-delete history.

### Exact values and chronology

PostgreSQL numeric(78,30), at most48 integer digits and30 fractional digits. Require
plain decimal JSON strings: digits with optional decimal point followed by digits;
no signs, whitespace, exponent, commas, NaN/Infinity, raw numbers or coercible objects.
Count submitted fractional digits before canonicalization, so excess trailing zeros
also fail. Remove leading integer zeros and trailing fraction zeros for canonical API
strings; compare integer precision after removing leading zeros. Bound raw decimal
text to256 characters. Quantity must be positive; known totalCostUsd is nonnegative.
Cost status is known with required totalCostUsd string, or unknown with required
literal null. SQL CHECK enforces this pairing. Zero known cost is distinct from null.
Do not use Number/parseFloat/toFixed or numeric JSON outputs. No totals or arithmetic
are offered, so decimal parsing/canonicalization can remain small and pure.

asOf accepts Gregorian ISO YYYY-MM-DDTHH:mm:ss with optional1..3 fractional digits
and required Z or numeric +/-HH:mm offset. Years1970..9999; validate month/day/leap
year/time explicitly, seconds0..59, offsets up to14:00 (14 requires00 minutes).
Reject rollover dates, leap seconds, date-only, missing zones, excess fractions and
normalization outside the allowed UTC year range. Canonical output is UTC with three
fraction digits; database precision milliseconds. This instant marks coverage only,
not acquisition date, contribution or a claim of reconstructed prior history.

### Atomic requests and retained replacements

POST /accounting/accounts accepts requestId UUIDv4 and name; POST
/accounting/instruments accepts requestId,name,optional symbol. Unique(ownerId,
requestId) independently per resource enforces idempotency. Same canonical payload
returns original200; a new resource201; changed payload409. Resolve uniqueness races
transactionally without leaving failed transactions or duplicate objects.

POST /accounting/accounts/:id/openings accepts requestId UUIDv4, expectedRevision
JSON integer0..2147483646, asOf and1..100 distinct instrument positions. No ownerId
or mutable server fields. Lock the owner-scoped account row FOR UPDATE. Check its
existing request key BEFORE expectedRevision: same canonical payload returns the
original snapshot200 even after later revisions, without rewinding currentRevision;
changed payload409. Otherwise CAS mismatch409. Verify all instruments belong to
owner, insert entire next snapshot/positions, update currentRevision, commit201.
Failure on any row rolls back everything. Sort positions by instrument UUID when
canonicalizing request payload, so JSON row order is not economic identity.
Include expectedRevision in canonical payload. An idempotent replay never edits a
snapshot or changes its timestamps. Different request IDs sharing expectedRevision
have exactly one winner; initial expectedRevision0 starts revision1.

Replacement is the entire opening state, not an appended quantity or trade. Preserve
all preceding revisions and expose history. There are no operations depending on
openings in this slice; future operation support must define dependent correction
before enabling replacements that invalidate its derivations. Avoid speculative
operation tables or a fake dependency flag now.

### Bounded reads and useful UI

Owner-scoped GET /accounting/accounts and /accounting/instruments return items and
nextCursor, UUID ascending exclusive cursor, default limit50/max100, min1. Validate
UUIDv4 cursor and strict integer query syntax; cursor need not reveal another owner's
object. GET /accounting/accounts/:id returns current snapshot or null/revision0.
GET /accounting/accounts/:id/openings lists preserved revisions descending with
exclusive integer beforeRevision cursor, default10/max20; each snapshot at most100
positions. Return nextCursor or null. No unbounded nested history in account lists.
Unknown and foreign account/instrument references return generic404; validation400,
request/CAS conflicts409. Parameterize queries and assign owner only from session.

Protected Russian routes /manual-accounts and /manual-accounts/:id allow empty
account creation, explicit manual instrument reuse/creation and entire opening
replacement. String inputs retain every decimal digit; enter explicit UTC date/time
with a clear UTC label. Display known recorded total cost, known zero and unknown
separately, and warn that opening history before asOf is not reconstructed. Current
revision and paginated history explain corrections. Retain request UUID across a
retry of unchanged data; changed payload is a new explicit attempt, and409 triggers
reload/review rather than automatic overwrite. No price/provider calls, aggregation
with legacy wallets, profit/return widgets or fabricated fiat/chain identity.

### Independent delivery and evidence

Coordinator owns migration/entity contract and AppModule/App.tsx/Layout wiring;
backend worktree owns accounting logic/DTOs; frontend owns page/styles/API types;
independent QA owns behavioral RED, exact boundary and real PG/HTTPS acceptance.
Freeze interface/schema first; no concurrent migration/dependency edits. Existing
MFA/session/admission and owner Nginx preservation oracles remain unchanged.

## Risks / Trade-offs

- Manual identity cannot reconcile observed on-chain assets → explicitly separate
  views and defer address linkage/portfolio aggregation.
- Repeated snapshots retain bounded rows per request but growing history → bounded
  pagination now; do not delete provenance to impose an undocumented total cap.
- Known aggregate cost does not establish FIFO acquisition chronology → keep coverage
  and missing provenance visible; no performance calculation in this slice.
- Global DTO conversion and PostgreSQL rounding can hide input loss → raw-type
  validation plus pre-storage precision checks and actual large-value roundtrips.
- Idempotency races or stale UI can duplicate/overwrite positions → DB uniqueness,
  account row lock, replay-before-CAS and whole-snapshot transaction.

## Migration Plan

Only additive migration13 after the verified twelve-migration predecessor. New
tables initially empty; preserve every old row/schema and destructive legacy refusal.
Rehearse fresh/replay and populated12-to13 with actual CLI in isolated release images.
No production change is authorized. Runtime rollback may leave the additive tables
unused; downgrade must not drop saved manual history without a separate recovery plan.

## Open Questions

No product decision blocks this bounded proposal. CSV chronology, FIFO cost allocation,
chain/manual identity linkage and historical performance remain explicit later changes.
