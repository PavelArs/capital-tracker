# Frozen command, projection and persistence contract

This is a design contract, not evidence of implementation. Route prefixes use the
existing `/accounting` API namespace. All routes require the current full owner
session; writes retain exact Origin/CSRF validation and existing throttling.

## Canonical inputs and commands

Reuse existing raw UUIDv4, amount and explicit-offset instant rules, including original
JSON type validation, unknown-field rejection and malicious object/array rejection.
UUIDs become lowercase hyphenated; amounts lose insignificant leading/trailing zeros;
times become UTC with three fractional digits. Scale is checked on raw input before
canonicalization, so excess trailing fractional zeros do not bypass the 30-place limit.
All string amounts have the existing 256-character raw limit. No Number conversion.
Raw integer fields reject booleans, strings, fractions and unsafe integer values.

| Command | Body | Receipt |
| --- | --- | --- |
| POST `/accounts/:accountId/trade-journal` | `{requestId,coverageFrom,assertEmpty:true}` | `JournalOrigin` |
| POST `/accounts/:accountId/trades` | `{requestId,expectedJournalRevision,...Execution}` | `TradeReceipt` |
| POST `/accounts/:accountId/trades/:tradeId/corrections` | `{requestId,expectedJournalRevision,...Execution}` | `TradeReceipt` |
| POST `/accounts/:accountId/trades/:tradeId/voids` | `{requestId,expectedJournalRevision}` | `TradeReceipt` |

`Execution = {instrumentId,side,occurredAt,orderWithinTimestamp,quantity,grossUsd,feeUsd}`.
Side is exactly `buy` or `sell`; quantity and gross are positive decimal strings,
fee is nonnegative. All three amount inputs are mandatory. Dates follow existing
Gregorian years 1970..9999 and offset/millisecond rules. Order is a raw integer
0..2147483647. Expected journal revision is a raw integer 0..10000. Every accepted
execution is at or after coverageFrom. Among effective active trades, normalized
(occurredAt,orderWithinTimestamp) is unique per account, even across instruments.
Distinct keys/order preserve duplicate-looking legitimate executions.

New initialization/version returns 201, equivalent replay 200. Initialization has
its own one-row owner/account request namespace: same key/canonical payload replays
its immutable origin, different payload or another initialization key returns 409.
The trade-command namespace is unique(ownerId,accountId,requestId) across all three
trade commands. Canonical JSON text excludes requestId, includes command kind,
normalized target trade ID for correction/void, expectedJournalRevision and every
execution field; field order is deterministic. Original expected revision is part
of request identity. Replay occurs before live CAS/cap checks and returns its original
receipt, never a current-state projection or pointer mutation. Another account has
an independent key namespace. Initialization and trade keys can have the same UUID.

Malformed input and buy gross-plus-fee overflow are 400, with no request-key reservation; absent/foreign account, instrument or target trade is generic
404 with no identity disclosure. A valid owned account without a journal, stale CAS,
pre-coverage execution, occupied effective chronology key, oversold historical prefix,
terminal-void target, capacity limit or ineligible origin is 409. A replay is looked
up by account/key before target-state checks. Changing kind or target under a used
key is 409. No DELETE, partial PATCH, restore or alternate fee currency is exposed.

## Projections and bounded reads

All projections omit owner IDs, canonicalPayload and private auth data. All instants
are canonical UTC strings; all quantities/money are canonical decimal strings,
including signed derived amounts. Instrument labels are immutable owner-scoped joins.

- `JournalOrigin = {accountId,requestId,originKind:'declared-empty',coverageFrom,createdAt}`.
  This receipt intentionally contains no live revision.
- `TradeVersion = {tradeId,version,journalRevision,requestId,kind,createdAt,...Execution,
  instrumentName,instrumentSymbol}`. Kind is `create`, `correct` or `void`; version
  starts at 1. A void retains the complete prior Execution and is terminal.
- `TradeReceipt = {accountId,journalRevision,trade:TradeVersion}` is immutable for the
  successful command and remains so after later corrections.
- `JournalState = {accountId,eligible,ineligibilityReason,journal}`. Before initialization
  journal is null; reason is null or `opening-history`. After initialization eligible
  is false, reason is `already-initialized`, and journal is
  `{...JournalOrigin,journalRevision,activeTradeCount,versionCount,limits,summary}`.
  Limits is `{activeTrades:1000,versions:10000}`. Summary is
  `{grossBuysUsd,buyFeesUsd,grossSalesUsd,sellFeesUsd,netSalesUsd,consumedCostUsd,
  realizedUsd,remainingCostUsd}`. Empty journal sums are string `0`. Never sum quantities
  of distinct instruments into a fictitious total quantity.
- `Lot = {buyTradeId,buyVersion,instrumentId,instrumentName,instrumentSymbol,
  occurredAt,orderWithinTimestamp,originalQuantity,originalCostUsd,
  remainingQuantity,remainingCostUsd}`. Current-lot list contains only nondepleted lots.
- `Realization = {sellTradeId,sellVersion,instrumentId,instrumentName,instrumentSymbol,
  occurredAt,orderWithinTimestamp,quantity,grossUsd,feeUsd,netUsd,consumedCostUsd,
  realizedUsd}`.
- `Match = {sellTradeId,sellVersion,buyTradeId,buyVersion,quantity,costUsd}`.
  Match order is the consuming sale's FIFO lot order; no nested unbounded matches.

GET `/accounts/:accountId/trade-journal` returns JournalState, including pre-init
eligibility. Existing AccountSummary/Detail shape need not change; the UI loads this
state independently and guards opening actions while journal state is unresolved.

GET `/accounts/:accountId/trades`, `/trade-lots`, `/trade-realizations` return
`{journalRevision,items,nextOffset}`. GET `/accounts/:accountId/trades/:tradeId/matches`
uses the same envelope and returns the current active sale's matches (409 for an
owned current buy/void; absent/foreign 404). Every page accepts query
`{journalRevision?,offset?,limit?}`: canonical unsigned integer query strings only,
default offset 0, limit 50 / max 100; offset 0..9999, supplied revision 0..10000.
Any nonzero offset requires journalRevision. A supplied revision not equal to the
transaction's current revision is 409; no partial items returned. nextOffset is the
exclusive next zero-based index or null. Return empty for an offset beyond the end.
Trade-list items are TradeVersion projections of current heads. The list includes all current heads, including voids, ordered by their retained
execution time, order and final UUID tie-breaker for void-versus-active collisions;
this tie-breaker is ONLY display order, never execution order. Lots and sales order
by active execution chronology. No pagination truncates calculation inputs.

GET `/accounts/:accountId/trades/:tradeId/versions` returns
`{tradeId,items:TradeVersion[],nextBeforeVersion}` in descending version order,
exclusive beforeVersion, default 10 / max 20. Query bounds are canonical integer
beforeVersion 1..10001. Immutable pages can acquire newly added versions above their
cursor without changing previously returned versions; no current FIFO claim is made.
Other journal-dependent reads before initialization return 409.

Each current/derived page is calculated inside one read-only REPEATABLE READ snapshot,
including revision, heads, versions and labels. Separate pages carry the revision;
a concurrent correction cannot silently mix their results. Full historical derived
queries are not supported; retained immutable versions are individually inspectable.

## Tables and integrity

Migration `AddUsdTradeJournal1790040000000`, number 14, adds only these tables.
Names are snake_case tables / quoted camelCase columns, matching current conventions.
Timestamps are timestamptz(3); every createdAt has an explicit isfinite CHECK.
coverageFrom and occurredAt additionally have finite SQL bounds [1970-01-01T00:00:00Z,
10000-01-01T00:00:00Z), matching the preceding coverage contract. UUID IDs are generated
by the application. No DB extension,
provider call or background job is introduced. Owner FK always targets users.id,
not transient owner_auth. Existing account/instrument identity remains unchanged.

### account_trade_journals

Columns: `ownerId uuid`, `accountId uuid`, `requestId uuid`, `canonicalPayload text`,
`originKind text`, `coverageFrom timestamptz(3)`, `createdAt timestamptz(3)`,
`currentRevision integer` initially 0. All NOT NULL. PK(ownerId,accountId), composite FK(ownerId,accountId)→manual_accounts(ownerId,id)
with RESTRICT, owner FK users(id); CHECK originKind='declared-empty', currentRevision
0..10000. Attestation true is represented by this exclusive origin kind and canonical
initialization payload, never inferred during migration.

### account_trades

Columns: `id uuid`, `ownerId uuid`, `accountId uuid`, `currentVersion integer`,
`createdAt timestamptz(3)`, all NOT NULL. PK(id), unique(ownerId,accountId,id), composite
journal FK(ownerId,accountId), owner FK users(id), all RESTRICT. Current version is constrained to 1..10000.
Composite head FK(ownerId,accountId,id,currentVersion)→version(ownerId,accountId,tradeId,version)
is DEFERRABLE INITIALLY DEFERRED: create identity, append version, set head within one
transaction; no committed dangling head. No duplicated amount fields on the head.

### account_trade_versions

Columns: `ownerId uuid`, `accountId uuid`, `tradeId uuid`, `version integer`,
`journalRevision integer`, `requestId uuid`, `canonicalPayload text`, `kind text`,
`instrumentId uuid`, `side text`, `occurredAt timestamptz(3)`,
`orderWithinTimestamp integer`, `quantity numeric(78,30)`, `grossUsd numeric(78,30)`,
`feeUsd numeric(78,30)`, `createdAt timestamptz(3)`, all NOT NULL.
PK(ownerId,accountId,tradeId,version); unique(ownerId,accountId,requestId) and
(ownerId,accountId,journalRevision). Composite trade FK(ownerId,accountId,tradeId),
composite instrument FK(ownerId,instrumentId)→accounting_instruments(ownerId,id),
owner FK users(id), all RESTRICT. CHECK version/journalRevision 1..10000, kind in
create/correct/void, side buy/sell, order >= 0. Explicit finite checks exclude NaN and
both infinities on all three numeric columns; quantity/gross > 0, fee >= 0.
Application additionally rejects buy gross+fee overflow before storage. No costs,
profits or FIFO caches are persisted. Version rows are never updated/deleted by API.

Account serialization enforces active chronology uniqueness, active/version caps,
coverage, sequential revisions, immutable origin/versions and candidate prefix validity.
Composite SQL FKs/NOT NULL/finite checks defend stored identity/value integrity.
Do not claim a DB unique index over effective joined version chronology exists;
verify concurrent application writers use the shared account lock instead.
Indexes supporting composite PK/unique/FKs and account journal lookup are sufficient;
avoid speculative redundant indexes. Preserve all predecessor constraints/rows.

## Narrow service seam and ownership

`TradeService(DataSource)` offers initialize(ownerId,accountId,rawInput),
create(ownerId,accountId,rawInput), correct(ownerId,accountId,tradeId,rawInput),
void(ownerId,accountId,tradeId,rawInput) → `{created:boolean,value:receipt}` and typed
getJournal/listTrades/listLots/listRealizations/listMatches/listVersions reads.
Raw bodies are parsed once in service, preserving Object metatype handling; path/query
parsing retains current strict boundaries. Pure atom/FIFO helpers accept normalized
execution records and return projections independent of DB/framework. Do not use
repository mocks as PG evidence or import production helpers for expected test math.

Coordinator owns entities/DDL/AppModule/shared harness. Backend owns narrow new trade
files and the existing opening write guard; frontend owns journal API/components;
independent QA owns arithmetic/PG/HTTPS tests in separate worktrees. Preserve existing
opening, security, migrations and provider-count oracles. Source checks and artifact
validation are distinct from actual future RED/GREEN and production readiness.

### Pure calculation and input test seam

`backend/src/accounting/fifo.ts` exports `FifoTrade`, consisting of the normalized
`Execution` fields plus `tradeId`, `version`, `instrumentName` and `instrumentSymbol`,
and `calculateFifo(trades: readonly FifoTrade[])`. Its result is
`{summary, lots, realizations, matches}` using exactly the Summary fields in
JournalState and the Lot, Realization and Match projections defined above. These
arrays contain the complete bounded calculation, before API pagination. Matches are
ordered by sale chronology and then each sale's FIFO buy chronology; lots and
realizations follow the chronology already specified above.

Inputs are normalized active canonical executions for one account, at most 1,000
trades. The helper does not mutate the supplied array or records and sorts by explicit
execution chronology. It exports `FifoHistoryError` for a negative historical prefix
or duplicate effective chronology. The helper enforces the 1,000-effective-trade
bound. It uses pure BigInt arithmetic without database or Nest dependencies; it does
not coerce or validate raw HTTP input types. Coverage, ownership, request identity,
CAS and transaction handling remain service responsibilities.

`backend/src/accounting/trade-input.ts` exports `parseJournalInitialization(raw)`,
`parseTradeCreate(raw)`, `parseTradeCorrection(raw)`, `parseTradeVoid(raw)`,
`parseTradePageQuery(raw)` and `parseTradeHistoryQuery(raw)`. Each accepts unknown raw
input and returns a strongly typed normalized value according to the command/query
shapes and defaults above. Correction uses the same body shape as create; its target
trade ID comes from the path. The create/correction parsers reject buy gross-plus-fee
overflow with 400 before database access or request reservation. Existing raw type,
unknown-field, decimal, UUID, instant and integer rules remain unchanged.

These function names are a bounded implementation seam for independent tests, not a
new framework. Author expected values independently before helpers; an unavailable
module/import is a prerequisite failure, never claimed behavioral RED.

### Read-service query seam

`TradeService` takes `DataSource` in its constructor and exposes these read methods:

- `getJournal(ownerId, accountId)`.
- `listTrades(ownerId, accountId, rawQuery: unknown = {})`.
- `listLots(ownerId, accountId, rawQuery: unknown = {})`.
- `listRealizations(ownerId, accountId, rawQuery: unknown = {})`.
- `listMatches(ownerId, accountId, tradeId, rawQuery: unknown = {})`.
- `listVersions(ownerId, accountId, tradeId, rawQuery: unknown = {})`.

The service validates each raw query exactly once with the frozen page/history parser.
Controllers pass the unknown query object and owner/path IDs without implicit query
conversion. Direct PostgreSQL fixtures pass the same canonical raw string query values
as HTTP requests; numeric internal-call exceptions are not supported. Omitted queries
use the documented defaults. This seam does not change the existing AccountingService
read methods or their typed numeric query contract.
