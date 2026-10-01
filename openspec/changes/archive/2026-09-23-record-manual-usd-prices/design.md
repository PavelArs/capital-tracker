## Context

Baseline92a3039:17 canonical specs, no active changes, only preserved owner Nginx
edit. Scoped `input.spec accounting.service.spec` selected433 passing cases/9
suites (2.745s). Legacy crypto prices are memory-only and FX is Redis-only;
CoinGecko archival permission remains unresolved in docs/provider-feasibility.md.
No provider is enabled here. Existing gated GHCR/Compose pipeline is retained.

## Goals / Non-Goals

**Goals:** Durable reviewed manual USD/unit price points tied to a particular
owner instrument UUID, immutable corrections/voids, coherent database-only reads.

**Non-Goals:** External prices/FX, network mapping by symbol, automated valuation,
continuous coverage, interpolation/carry-forward, trade costs, stored profit or
XIRR, new dependency, existing cache removal or production deployment.

## Decisions

### Storage and commands

Add `manual_usd_price_versions` with composite primary key(ownerId,instrumentId,
revision), unique(ownerId,instrumentId,requestId), composite foreign key to
accounting_instruments(ownerId,id), and `(ownerId,instrumentId,observedAt,revision
DESC)` index. Fields: UUID owner/instrument/request; revision1..10000; immutable
canonicalPayload; kind `set` or `void`; observedAt UTC timestamptz(3) years1970..9999;
priceUsd numeric(78,30), finite nonnegative for set, NULL for void; finite createdAt.
Source `manual` and quote currency `USD` are fixed response metadata, never supplied
by the caller. The instrument namespace is manual; no ticker/chain association.

POST `/accounting/instruments/:id/usd-prices` exact body:
`{requestId,expectedRevision,observedAt,priceUsd,assertReviewed:true}`.
POST `/accounting/instruments/:id/usd-prices/void` exact body:
`{requestId,expectedRevision,observedAt,assertReviewed:true}`.
Use existing UUIDv4/date/decimal normalization. Price must be a decimal STRING,
48 integer/30 fractional digits; zero is meaningful, never missing. expectedRevision
is a JSON integer0..10000. Reject unknown fields/types400. Same canonical instant
(including equivalent offsets) identifies one logical point; a new set replaces
that point only in the effective view. Void requires a currently effective set;
missing/already voided point409. To move a mistaken timestamp, explicitly void it
then save a new point; do not substitute zero. A set can restore a voided point.

Mutation transaction READ COMMITTED locks the owned instrument row FIRST with
SELECT FOR UPDATE. Foreign/missing instrument404. Then find same requestId; exact
canonical operation including kind/expectedRevision/time/amount returns ORIGINAL
receipt200 even after later writes or at cap; changed payload409. Next compute
MAX(revision) or0, compare expectedRevision, enforce at most10000 total versions
per instrument including voids; stale/exhausted409. Insert revision+1, no UPDATE
or DELETE. New commands201. Instrument/account/trade/old receipt rows unchanged.
Database uniqueness and lock serialize actual concurrent writers across replicas.

Receipt DTO (set/void discriminated by kind):
`{instrumentId,revision,requestId,kind,observedAt,priceUsd:string|null,createdAt,
source:'manual',quoteCurrency:'USD'}`. No internal payload/ownerId in responses.

### Reads

GET same base path allows only `{limit?,offset?,revision?}` query strings.
Default limit50, range1..100; offset0..10000, revision0..10000; canonical integer
strings only, no repeated/array/unknown fields. Nonzero offset requires revision.
In one RR READ ONLY transaction: owner instrument lookup, MAX revision, optional
revision equality (409 on mismatch), latest row per exact observedAt, filter
void heads, order observedAt DESC, paginate AFTER effective projection.
Return `{instrument:{id,name,symbol,namespace:'manual'},currentRevision,
source:'manual',quoteCurrency:'USD',items:Receipt[],nextOffset:number|null}`.
Empty instruments have revision0/items[]; empty pages never fabricate zero quotes.
Any new write invalidates pinned continuation, including an excluded old-date edit.

GET `/accounting/instruments/:id/usd-prices/history` allows only
`{observedAt,beforeRevision?,limit?}`. Exact normalized timestamp required;
beforeRevision1..10001 optional, limit1..20 default10. Owner-scoped RR READ ONLY
returns all immutable versions for that point in revision DESC, strictly below
beforeRevision, with `{instrumentId,observedAt,source,quoteCurrency,items,
nextBeforeRevision:number|null}`. Unknown point is empty, not invented coverage.
No overall coverage/current-price/staleness claim; these are independent declared
points only. Database reads never call providers or change accounting data.

### Russian UI

Protected `/manual-prices`, nav `Ручные цены`, heading `Ручные цены инструментов`.
Paginated existing instrument picker (labels include name/symbol/UUID), explicit
`Загрузить цены`, current revision, exact point table with `Цена за единицу, USD`
and UTC time. Empty state `Сохранённых цен нет.` Never infer asset identity from
symbol. Clearly label manual, unverified, isolated points/no continuous coverage,
USD per unit; not portfolio valuation/cost basis. No automatic provider query.

Form labels `Дата цены (UTC)`, `Цена за единицу, USD`, checkbox
`Я проверил инструмент, дату и цену`, button `Сохранить цену`. Same-time set is
explicitly explained as a correction retaining old versions. Point actions
`История` show immutable versions (void label `Исключена`); `Исключить цену` stages
a void of that exact point, then explicit reviewed `Подтвердить исключение`.
No physical deletion. Editing/form/mode/instrument/revision changes reset review.

Bind current/continuation/history/save responses to selected instrument and request
generation; ignore late replies after editing/navigation/auth loss. Use real
currentRevision for CAS and exact same revision for continuation. Missing/failed
initial load disables mutation. 409 clears stale review/data and requires explicit
refresh. Keep full original request including UUID/CAS across unchanged ambiguous
network/5xx retries and refresh failures; no automatic resubmit. Disable both form
actions/fields while saving to prevent duplicate intent. Separate successful commit
from failed follow-up refresh: report saved receipt, disable further writes until
explicit refresh, never call the save failed. No browser persistence of portfolio
prices. Existing auth/MFA/CSRF/origin/no-store applies to every endpoint.

## Keep / Simplify / Remove Inventory

| Decision | Scope |
| --- | --- |
| Keep | Instrument UUID identity, exact parsing, immutable command pattern, auth, existing provider/legacy UI, deployment. |
| Simplify | One small price store with instrument row serialization; no new journal pointer or duplicate asset catalog. |
| Remove | No feature/row/cache/folder deletion in this slice. |
| Defer | Automated free provider selection/storage permissions, derived valuation and removal of legacy caches. |

## Risks / Trade-offs

- Wrong manual values → explicit review, exact UUID/time, versioned corrections and voids.
- Unknown asset mapping/retention → manual only; no copied provider prices or permissions claims.
- Stale/concurrent changes → per-instrument lock, CAS and pinned read revision, actual PG tests.
- Misleading history → isolated point labels; no continuous coverage/as-of fallback.
- Unbounded book growth → explicit10000-version cap and20/100-page bounds; no truncation of logical heads.
- Rollback → additive migration; revert application safely but retain recorded data.

## Migration Plan

Migration1790080000000 creates one empty table/index, changes no existing data.
Verify fresh18 and upgrade populated17 preserving every pre-existing row, idempotent
rerun, exact money/FK/check constraints, no provider call and original command
receipts. Down refuses automatic destructive rollback. Root owns shared migration
manifests/count assertions and full runner; adjust only actual current-version
expectations, preserve historical17 pre-upgrade assertions. Production not run.
