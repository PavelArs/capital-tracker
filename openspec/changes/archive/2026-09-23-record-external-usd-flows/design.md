## Context

Current account journals provide immutable USD trades and original carry-in lots.
They deliberately do not model investor cash movements or cash balances. Legacy
assets/metrics use floating-point income/value rows and cannot supply these flows.

## Goals / Non-Goals

**Goals:** Record explicit external USD flows across the owner's tracked portfolio
boundary, preserve corrections/receipts, and expose exact recorded period totals.

**Non-Goals:** Proposal exclusions apply. This ledger does not move money, establish
cash/asset holdings, classify blockchain observations, attest completeness, or compute
profit/returns. A withdrawal can exceed recorded contributions because opening wealth
is separate; no fabricated cash balance or overspending check is appropriate here.

## Decisions

### Classification and time

The only directions are contribution and withdrawal. A positive USD amount records
actual fiat crossing the tracked portfolio boundary; purchases/sales, internal own
account transfers, initial holdings, rewards, fees and in-kind movements are excluded.
Create/correct require literal assertExternal:true. No operation in an old account,
CSV, trade or opening automatically generates a flow. CoverageFrom is declared once;
rows before it are409. Coverage is owner-declared and unreconciled, not proof that all
external events are present. Empty covered periods return exact recorded zeros only.

Period reads use [from,to): from inclusive, to exclusive, normalized UTC, from<to and
from>=coverageFrom. This is a reporting interval, not yet a performance valuation
contract. OccurredAt equal to coverageFrom is allowed. Reuse parseAsOf (explicit
zone,1970..9999,millisecond maximum) and parseDecimal positive scale30/48integer
digits. Derive sums as BigInt atoms (up to82 digits), never JS floating-point.
Different legitimate equal-time/equal-amount events are distinct by request/flow UUID;
no economic-value deduplication or orderWithinTimestamp is necessary for addition.

### Protected wire contract

All routes use /accounting/portfolio and existing full-owner/MFA/CSRF/origin/no-store/
admission controls. No owner ID or mutable server field is accepted from the body.
Only the allowlisted objects/queries below are accepted; unknown/duplicate/array/raw
values are400, valid foreign/missing flow IDs404, coverage/revision/capacity/terminal
void conflicts409 with existing private messages. Accepted first writes201, exact
replays200. GETs are200. Method names below are service methods, not new frameworks.

- GET /cash-flow-journal -> {journal:null|{requestId,coverageFrom,createdAt,
  journalRevision,activeFlowCount,versionCount,limits:{activeFlows:1000,versions:10000}},
  basis:'owner-declared-usd-flows',completeness:'unreconciled'}.
- POST /cash-flow-journal initialize(owner,raw):
  {requestId,coverageFrom,assertReviewed:true}; immutable receipt
  {requestId,coverageFrom,createdAt}. Same accepted key/body replays despite later flows;
  another origin or changed accepted body conflicts. No reset/coverage rewrite.
- POST /cash-flows create(owner,raw):
  {requestId,expectedJournalRevision,direction,occurredAt,amountUsd,assertExternal:true}.
- POST /cash-flows/:flowId/corrections correct(owner,flowId,raw): same body as create.
- POST /cash-flows/:flowId/voids void(owner,flowId,raw):
  {requestId,expectedJournalRevision}.
- Mutation receipt: {journalRevision,flow:{flowId,version,journalRevision,requestId,
  kind:'create'|'correct'|'void',direction,occurredAt,amountUsd,createdAt}}.
- GET /cash-flows list(owner,rawQuery): required from/to; reuse bounded trade page
  query offset0..9999(default0),limit1..100(default50),journalRevision0..10000 required
  for nonzero offset. Response {from,to,coverageFrom,journalRevision,
  basis:'owner-declared-usd-flows',completeness:'unreconciled',
  summary:{contributionsUsd,withdrawalsUsd,netContributionsUsd,flowCount},items:Flow[],
  nextOffset:number|null}. Filter current nonvoid versions before sorting by
  occurredAt then canonical flowId; calculate complete totals before paging.
- GET /cash-flows/:flowId/versions versions(owner,flowId,rawQuery): existing history
  query beforeVersion1..10001 and limit1..20(default10), descending immutable versions;
  response {flowId,items:Flow[],nextBeforeVersion:number|null}.

Pure boundaries: parseFlowInitialization, parseFlowCreate, parseFlowVoid,
parseFlowPeriod; projectFlowPeriod(heads,from,to) -> {summary,items}. Production
PortfolioFlowService(DataSource) owns methods above. Canonical receipt payload is a
fixed explicit tuple containing kind,target when applicable,expected revision and
normalized economic fields/attestation; it excludes the request key and server fields.
Origin keys and flow command keys use separate endpoint namespaces. A flow command
key is unique across create/correct/void for that owner, with exact replay before
mutable revision, current head, bounds or period checks. Rejected keys reserve nothing.

### Storage and consistency

Root owns migration17 AddExternalUsdFlows1790070000000 and two ORM mappings:
portfolio_flow_journals (ownerId PK/FK users RESTRICT, requestId, canonicalPayload,
coverageFrom,createdAt,currentRevision0..10000), portfolio_flow_versions
(ownerId,flowId,version PK; journalRevision unique per owner; requestId unique per
owner; canonicalPayload,kind,direction,occurredAt,amountUsd,createdAt,previousVersion).
Composite owner FK to journal; self FK(ownerId,flowId,previousVersion) RESTRICT ensures
previous version belongs to the same operation/owner. Check version1=create and
previousVersion NULL; later versions=correct/void with previousVersion=version-1.
Version/revision1..10000, finite bounded timestamptz, positive finite numeric(78,30),
finite createdAt, and literal direction/kind checks. All IDs are UUID. No UPDATE or
DELETE of versions in application code. The highest version is the effective head;
DISTINCT ON(flowId) ordered by flowId/version DESC uses the bounded PK, avoiding a
separate mutable head table/insert cycle. No speculative generic journal framework.

Initialization INSERT ON CONFLICT(ownerId) DO NOTHING then reads/locks that journal
inside the same transaction; concurrent identical origins replay, different origins
conflict. Every mutation SELECTs the owned journal FOR UPDATE before checking saved
command receipts. Lock serializes CAS/caps. Read at most10000 immutable versions;
currentRevision advances exactly once with accepted version in the same transaction.
Terminal void cannot be corrected/restored. Creating at1000active or any new version
at10000versions is409; void can free an active slot, never version capacity. Original
receipts remain obtainable by resending exact accepted commands even at these caps.

Each GET uses one read-only REPEATABLE READ transaction for origin, heads/versions and
all derived values. Supplied revision mismatch is409, including empty/out-of-range
pages. Reads never alter accounting, invoke providers or create sessions; documented
existing last-seen/admission bookkeeping remains. No financial data in error/log text.

### Russian page and original-command recovery

Add /capital-flows and navigation 'Вводы и выводы'. Heading 'Внешние денежные потоки'.
Initialize with label 'Граница учёта потоков (ISO)' and unchecked confirmation
'Я проверил границу учёта', button 'Начать учёт потоков'. Form labels 'Направление'
(options 'Ввод','Вывод'), 'Момент операции (ISO)', 'Сумма, USD', unchecked
'Это внешний ввод или вывод USD'; submit 'Сохранить поток'. List rows expose UUID,
version, UTC date, direction, exact amount; buttons 'Исправить','Аннулировать',
'Версии'. Period labels 'Начало периода (ISO, включительно)' and
'Конец периода (ISO, не включительно)', action 'Показать потоки', continuation
'Следующая страница'. Show recorded totals, coverage/revision and unreconciled status;
explain exclusions and absence of cash/holdings/performance calculation visibly.

Keep form state separate from period/history reads. Invalidate pages on period,
observed journal revision and account/owner change; ignore late responses; pin
continuations. Stale409 requires explicit refresh/review and never auto-resubmits.
Loading/read errors must not look like empty/zero data. Every original mutation
command is retained before sending, including key,target,expected revision and exact
payload. Ambiguous transport/5xx delivery blocks new writes and permits only explicit
same-command retry; retain through SPA navigation and actual401/MFA recovery, without
local/sessionStorage. A known accepted receipt stays visible if current read fails,
blocks writes until explicit successful refresh, and is never reclassified as unknown.
Recovery is keyed by authenticated owner, no automatic POST. Full-document reload
ends in-memory recovery; show that limitation and enable server journal discovery.
Ordinary definitive400/403/404/409 first-send failures are editable with explicit
review; ambiguous retries preserve the original command even after a later denial.

## Risks / Trade-offs

- Confusing recorded flows with asset transactions/value -> separate ledger and explicit
  labels; unchanged old rows/projections/receipts, no automatic backfill.
- Duplicate delivery/concurrent writes -> owner-journal lock, saved canonical receipts,
  exact replay before CAS/caps; real PG races/rollback and browser delivery loss.
- Incomplete/misclassified records -> explicit external attestation, unreconciled status,
  original correction history; no investment-profit claim in this slice.
- Larger browser suite -> keep arithmetic and raw-shape permutations in pure/PG tests;
  use a small critical HTTPS set, plus selected retained historical/carry characterization.

## Migration Plan

Additive schema only; no prior migration or owner row rewrite, destructive down refuses.
Verify fresh17/replay, representative fully populated16 upgrade and retained unsafe
legacy refusals in synthetic PostgreSQL; preserve previous rows/schema/receipts. Update
only true latest-schema fixture counts, preserving deliberately pinned predecessor
fixtures. Existing inspected Docker/Compose/Nginx/GHCR pipeline stays intact; no new
service/provider/dependency and no production deployment. Run independent review and
risk-based manifest before supported OpenSpec archival. Preserve owner Nginx/lockfile.

## Open Questions

None required for this USD-only declaration slice. Non-USD/in-kind classification,
fees, flow reconciliation and valuation-boundary semantics need distinct later changes.
