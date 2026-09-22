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
using the established raw-type defense rather than IsString alone. Apply this to
all declared JSON string fields: name, symbol, asOf, requestId, instrumentId,
costStatus, quantity and known totalCostUsd. Arrays, objects (including toString
properties), numbers and booleans must return 400 without conversion or server errors.
Only unknown totalCostUsd permits its explicitly required null. Pure boundary tests
cover the full matrix; actual HTTP representatives verify the global pipe integration.

Four additive tables: manual_accounts, accounting_instruments,
account_opening_snapshots, account_opening_positions. Every object belongs to an
owner UUID referencing users.id, not the removable owner_auth binding. Removing
the singleton binding or recovering credentials must not delete or reassign history. Instrument UUID is immutable identity in namespace manual; name/symbol
are labels, never fiat, blockchain, contract or price-provider identity. Duplicate
names/symbols are allowed; explicit reuse selects the existing UUID. A symbol USD
is not automatically a fiat asset and USDC is never equivalent to USD cash.
Known cost is explicitly denominated in actual accounting USD independently of labels.

Accounts/instruments have immutable generated UUIDs, ownerId, requestId and canonical
creation payload, createdAt, name (trimmed nonempty 1..120 characters); instruments
optionally have trimmed nonempty symbol 1..32. Absent symbol canonicalizes to null;
explicit null is rejected. Reject control characters and preserve ordinary Unicode;
no case folding or Unicode normalization. There are no rename/delete endpoints here.
Accept UUIDv4 strings in either letter case, then normalize to lowercase hyphenated
form before payload comparison, key lookup, position sorting and duplicate checks.
Apply the same normalization to request IDs, path IDs, instrument IDs and UUID cursors.
A positions array containing lower/uppercase spellings of the same instrument is a
400 duplicate; equivalent UUID spellings on a valid idempotent retry return 200.

Accounts have currentRevision nullable in SQL (API 0 means no opening). Snapshot key
(ownerId,accountId,revision), revision positive bounded integer, includes requestId,
canonical payload, asOf and createdAt. Opening request uniqueness is
(ownerId, accountId, requestId); a key on another account is independent. Positions reference snapshot and instrument
through composite owner foreign keys; unique snapshot/instrument, quantity, costStatus
and totalCostUsd. Quantity, costStatus and every composite foreign-key identity
component are NOT NULL; only the initial account currentRevision and unknown cost
are nullable. Known cost requires a non-null value, explicitly closing SQL CHECK
UNKNOWN/null behavior. Add owner/id unique constraints where needed to support composite
references. Owner foreign keys target users.id. Account (ownerId,id,currentRevision) references its own snapshot; create
account with null pointer, insert snapshot and positions, then set pointer in the
same transaction. Snapshot/account foreign keys do not cascade-delete history.

### Exact values and chronology

PostgreSQL numeric(78,30), at most 48 integer digits and 30 fractional digits. Require
plain decimal JSON strings: digits with optional decimal point followed by digits;
no signs, whitespace, exponent, commas, NaN/Infinity, raw numbers or coercible objects.
Count submitted fractional digits before canonicalization, so excess trailing zeros
also fail. Remove leading integer zeros and trailing fraction zeros for canonical API
strings; compare integer precision after removing leading zeros. Bound raw decimal
text to 256 characters. Quantity must be positive; known totalCostUsd is nonnegative.
Cost status is known with required totalCostUsd string, or unknown with required
literal null. SQL CHECK enforces this pairing and finite values: explicitly reject numeric NaN
and positive/negative Infinity, rather than relying on a quantity > 0 comparison
(PostgreSQL numeric NaN can satisfy that comparison). Quantity is finite and
positive; known cost is finite and nonnegative. Direct SQL rejection probes cover
NaN and both infinities for quantity and cost, alongside null/status mismatches. Zero known cost is distinct from null.
Do not use Number/parseFloat/toFixed or numeric JSON outputs. No totals or arithmetic
are offered, so decimal parsing/canonicalization can remain small and pure.
[PostgreSQL 16 numeric documentation](https://www.postgresql.org/docs/16/datatype-numeric.html#DATATYPE-NUMERIC-DECIMAL)
confirms declared scale rounds input before storage and numeric NaN sorts greater
than ordinary values. Therefore pre-storage scale validation and explicit finite
checks are both necessary. Infinity is already rejected by constrained numeric,
but direct probes must verify that protection alongside explicit NaN rejection.

asOf accepts Gregorian ISO YYYY-MM-DDTHH:mm:ss with optional 1..3 fractional digits
and required Z or numeric +/-HH:mm offset. Years 1970..9999; validate month/day/leap
year/time explicitly, seconds 0..59, offsets up to 14:00 (14 requires 00 minutes).
Reject rollover dates, leap seconds, date-only, missing zones, excess fractions and
normalization outside the allowed UTC year range. Canonical output is UTC with three
fraction digits; database precision milliseconds. This instant marks coverage only,
not acquisition date, contribution or a claim of reconstructed prior history.

### Atomic requests and retained replacements

POST /accounting/accounts accepts requestId UUIDv4 and name; POST
/accounting/instruments accepts requestId,name,optional symbol. Unique(ownerId,
requestId) independently per resource enforces idempotency. Same canonical payload
returns original 200; a new resource 201; changed payload 409. Resolve uniqueness races
transactionally without leaving failed transactions or duplicate objects.

POST /accounting/accounts/:id/openings accepts requestId UUIDv4, expectedRevision
raw JSON integer 0..2147483646 (reject strings, booleans, arrays and objects before
implicit conversion), asOf and 1..100 distinct instrument positions. No ownerId
or mutable server fields. Lock the owner-scoped account row FOR UPDATE. Check its
existing request key BEFORE expectedRevision: same canonical payload returns the
original snapshot 200 even after later revisions, without rewinding currentRevision;
changed payload 409. Otherwise CAS mismatch 409. Verify all instruments belong to
owner, insert entire next snapshot/positions, update currentRevision, commit 201.
Failure on any row rolls back everything. Sort positions by instrument UUID when
canonicalizing request payload, so JSON row order is not economic identity.
Include expectedRevision in canonical payload. An idempotent replay never edits a
snapshot or changes its timestamps. Different request IDs sharing expectedRevision
have exactly one winner; initial expectedRevision 0 starts revision 1.

Replacement is the entire opening state, not an appended quantity or trade. Preserve
all preceding revisions and expose history. There are no operations depending on
openings in this slice; future operation support must define dependent correction
before enabling replacements that invalidate its derivations. Avoid speculative
operation tables or a fake dependency flag now.

### Bounded reads and useful UI

Owner-scoped GET /accounting/accounts and /accounting/instruments return items and
nextCursor, UUID ascending exclusive cursor, default 50 / max 100, min 1. Validate
UUIDv4 cursor and strict integer query syntax; cursor need not reveal another owner's
object. GET /accounting/accounts/:id returns current snapshot or null/revision 0.
GET /accounting/accounts/:id/openings lists preserved revisions descending with
exclusive integer beforeRevision cursor, default 10 / max 20; each snapshot at most 100
positions. Return nextCursor or null. No unbounded nested history in account lists.
Unknown and foreign account/instrument references return generic 404; validation 400,
request/CAS conflicts 409. Parameterize queries and assign owner only from session.

Protected Russian routes /manual-accounts and /manual-accounts/:id allow empty
account creation, explicit manual instrument reuse/creation and entire opening
replacement. String inputs retain every decimal digit; enter explicit UTC date/time
with a clear UTC label. Display known recorded total cost, known zero and unknown
separately, and warn that opening history before asOf is not reconstructed. Current
revision and paginated history explain corrections. Retain request UUID across a
retry of unchanged data; changed payload is a new explicit attempt, and 409 triggers
reload/review rather than automatic overwrite. No price/provider calls, aggregation
with legacy wallets, profit/return widgets or fabricated fiat/chain identity.

### Response contract

Use explicit response projections, never serialize persistence payloads by default.
Instrument: {id, name, symbol: string|null, namespace: 'manual', createdAt}.
Account summary: {id, name, currentRevision: integer, createdAt}. Account detail:
{...summary, currentOpening: Opening|null}. Account creation/replay returns summary; replay preserves the original id, name and
createdAt but projects the live currentRevision without mutating its pointer. It does
not promise the original revision 0 after later openings exist.
instrument creation/replay returns Instrument. Opening creation/replay returns Opening
itself, including its original revision, with no claim that it is still current.
Opening: {accountId, revision, requestId, asOf, createdAt, positions: Position[]}.
Read-only Position: {instrumentId, instrumentName, instrumentSymbol: string|null,
quantity: string, costStatus: 'known'|'unknown',
totalCostUsd: string|null}. Positions are sorted by instrument UUID. Immutable instrument labels are projected through an owner-scoped join bounded to
100 positions, so current/history rows remain labeled even when their instruments
are beyond the first picker page. Request positions still accept only instrumentId,
quantity, costStatus and totalCostUsd; clients cannot assign projected labels. The UI
instrument picker explicitly paginates rather than fetching all owner instruments.
Account/instrument lists return {items, nextCursor: UUID|null}; history returns
{items: Opening[], nextCursor: integer|null}, to pass as beforeRevision next time.
All timestamps are canonical UTC strings; do not return ownerId, canonical request
payload or database internals. Existing safe error envelope handles 400/401/403/404/409.

The new pages own Russian validation, retry and conflict feedback instead of showing
raw English backend messages. Coordinator owns a narrow accounting-route delegation
in the existing API client's notification handling: suppress duplicate global toasts
for page-handled accounting errors while preserving existing 401 redirects and 403
CSRF invalidation/recovery semantics. Do not replace the transport or introduce a
new error framework; use status-based local text with field feedback where available.
Never render arbitrary server text as HTML or hide an unsuccessful save.

### Independent delivery and evidence

Coordinator owns migration/persistence contract and AppModule/App.tsx/Layout wiring;
backend worktree owns accounting logic/DTOs; frontend owns page/styles/API types;
independent QA owns behavioral RED, exact boundary and real PG/HTTPS acceptance.
Freeze interface/schema first; no concurrent migration/dependency edits. Existing
MFA/session/admission and owner Nginx preservation oracles remain unchanged.
Atomicity acceptance includes a disposable-DB deferred constraint trigger that fails
a real service commit after writes; snapshot, positions, pointer and request identity
must roll back, and an explicit retry after fixture removal must succeed. Precheck
validation failures alone do not prove transaction rollback. Direct SQL pairing
probes include known plus NULL and NULL costStatus. No production fault endpoint is added.
Reuse the existing GlobalExceptionFilter generic 500 and safe errorType logging for
unexpected storage/commit errors; runtime TypeORM query/error logging is already
suppressed. Assert safe response and absence of private position values in logs,
while preserving intentional 400/404/409. No storage-wrapper abstraction is needed.
Normal private-route authorization legitimately updates session lastSeenAt before
controller validation/accounting transactions. Rollback fingerprints therefore
require unchanged accounting, legacy financial and ownership/factor state, while
allowing that documented authorized session touch. Do not falsely claim a failed
accounting commit rolls back the preceding session transaction. Invalid CSRF/Origin
continues to fail authorization without touching sessions.

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

Only additive migration 13 after the verified twelve-migration predecessor. New
tables initially empty; preserve every old row/schema and destructive legacy refusal.
Rehearse fresh/replay and populated 12-to 13 with actual CLI in isolated release images.
No production change is authorized. Runtime rollback may leave the additive tables
unused; downgrade must not drop saved manual history without a separate recovery plan.

## Open Questions

No product decision blocks this bounded proposal. CSV chronology, FIFO cost allocation,
chain/manual identity linkage and historical performance remain explicit later changes.
