# CSV import persistence and API contract

Normative companion to design.md and the usd-csv-imports specifications. This is
the implementation contract; runtime acceptance remains to be demonstrated.

## 1. Shared types and input conventions

Reuse existing `Execution` and `FifoSummary` verbatim from accounting/fifo.ts.
Execution has instrumentId, side, occurredAt, orderWithinTimestamp, quantity,
grossUsd, feeUsd; monetary/quantity strings and UTC millisecond timestamps retain
existing canonical grammar, bounds and FIFO semantics. UUIDs normalize lowercase;
request IDs are UUIDv4. Raw objects must be plain JSON objects with exactly the
allowlisted own fields. Never use implicit conversion, trim source keys, or accept
numbers for declared strings. Raw JSON integer fields must be finite safe integers.
Unknown keys, arrays, null, coercion objects and malformed Unicode are rejected.

`BatchState = 'draft' | 'committed' | 'rolled-back'`.
`ParserVersion = 'usd-csv-v1'` for newly evaluated commands.
A bounded syntactic version identifier can be compared on replay even if its parser
is no longer supported: ASCII `[a-z0-9-]{1,32}`; support is a later new-command check.
`Kind = 'confirm' | 'rollback'`.

Request `Format`:
- delimiter: ',' | ';'; decimalSeparator: '.' | ',';
- timestampMode: 'offset' | 'fixed-offset';
- fixedOffset: required only for fixed-offset, forbidden for offset.
  Grammar signed HH:mm, absolute maximum 14:00, minutes 00..59; 14 requires 00.
  Both signed zeros normalize to +00:00. No machine timezone or DST inference.

Request `Mapping`:
- columns: {instrument,side,occurredAt,order,quantity,grossUsd,feeUsd,currency?};
  each is a raw integer 0..31; all supplied indexes are distinct and must exist.
- instruments: 1..100 entries {source:string,instrumentId:UUID};
- sides: 1..2 entries {source:string,side:'buy'|'sell'}.
Each source is nonempty, at most 120 Unicode code points, without Unicode Cc control
characters, and retained exactly, including spaces/case. Reject duplicate sources.
Require exactly the observed instrument/side source-key sets: no missing OR unused
entries. Multiple distinct sources may explicitly target the same owned instrument.
Sort maps by ECMAScript UTF-16 code-unit lexicographic comparison (`<`/`>`), never
localeCompare. Resolve every syntactically valid mapped instrument through owner
scope before reporting economic row errors; inaccessible identity is generic 404.

`Settings = {format,mapping,assertUsd:true}`; literal true mandatory. Optional currency
column must contain exact 'USD' on every row; missing column never removes assertion.
Normalized stored settings preserve the same optional-property shape as input:
offset mode omits fixedOffset; an unmapped currency column omits currency. Explicit
null is rejected. AcceptedSettings is parserVersion plus normalized Settings. Only
the canonical F/M tuples below encode absent properties as null; no second stored
settings grammar or conversion is needed.

## 2. Private source and parser boundary

One exact source of 1..262144 bytes, UTF-8 with optional single initial BOM. Retain
and hash ALL original bytes, including BOM and line endings; strip BOM only for
parsing. Reject invalid UTF-8, NUL and every bare CR (including inside quotes) before
retention. CR must be followed by LF. Mixed LF/CRLF record endings and quoted LF or
CRLF cells are accepted. No independent browser parser.

At inspection/economic parse: header plus 1..100 data records, at most 32 columns,
at most 4096 UTF-8 bytes per decoded cell; equal column counts. Standard delimiter,
quoted delimiter/newline and doubled quote syntax; no lenient malformed-quote mode.
Reject trim-empty headers; detect duplicates by exact decoded text, without trimming
otherwise. A data record is blank iff all decoded cells are exactly empty; whitespace
is not silently removed. A final record terminator does not create an empty record.
Return source ordinal 1..100 and physical starting line (one-based; CRLF counts once).
Header text/cells remain literal, including formula-looking or markup text.

Original display filename: nonempty, at most 120 Unicode code points, valid Unicode,
no Cc control characters, '/' or '\\'; no normalization, path use, MIME trust or logs.
Byte-level rejection creates no batch; delimiter-dependent parse errors retain the
already accepted private draft. Economic date parsing accepts 1..3 fractional digits,
strict calendars and normalized UTC years 1970..9999. Fixed mode accepts local ISO
only then applies the explicit offset; offset mode requires its own offset. Decimal
input must use only the selected separator and existing exact decimal bounds; no
sign/grouping/exponent/whitespace, no missing-to-zero. Order is canonical integer
cell text 0..2147483647. Buy gross+fee overflow is invalid row data, not rounded.

Transport is specified by the separate provider decision summarized in §10; parser
limits do not imply wire-body limits. Original bytea must never appear in generic
list/detail ORM serialization.

## 3. Routes and exact response projections

Base `/accounting/accounts/:accountId/csv-imports`. All routes require full owner MFA;
POST additionally requires existing Origin/CSRF rules. No public bypass or new quota.
All application responses are private/no-store. Edge-generated 413 may retain its
existing generic response/cache headers; it contains no private input. Do not change
location add_header inheritance or unrelated security headers for this.
Authentication may legitimately touch its own
session/admission rows; that is outside the accounting transaction.

`UploadIdentity = {batchId,sha256,byteLength,createdAt}` (no mutable state).
POST base: one upload, new 201 / identical-byte replay 200, same UploadIdentity.
Identity is owner/account/exact bytes, independent of filename. First filename/time
remain unchanged. A digest hit MUST compare actual bytes before returning identity.
Same file after acceptance/rollback still returns its original upload identity.

`BatchMetadata = UploadIdentity & {accountId,filename,state}`.
GET base query {cursor?,limit?}: UUID ascending id, exclusive cursor, default 20 / max
50. Return `{items:BatchMetadata[],nextCursor:UUID|null}`. UUID order is not a claim
of chronological creation order. Validate raw query strings once; reject unknown keys.
Cursor need not be an existing batch; it is an exclusive owner-scoped ordering bound.

POST /:batchId/inspect body exactly {delimiter} returns 200:
- `{batchId,valid:true,headers:string[],rows:{ordinal,startLine,cells:string[]}[],error:null}`;
- `{batchId,valid:false,headers:[],rows:[],error:{code,line,column}}`.
Location is a positive integer or null, never raw exception text. No partial prefix.
All batch states are inspectable; inspection never changes accepted settings/state.

POST /:batchId/preview body exactly Settings, draft only, 200:
`{batchId,parserVersion,journalRevision,canConfirm,rows,ignoredColumns,rowErrors,
batchErrors,summaryBefore,candidateSummary,previewHash}`.
- rows: source-order `{ordinal,startLine,execution:Execution|null}[]`; every structurally
  valid source row appears, with null for an invalid execution (no partial execution).
- ignoredColumns: ascending `{index,header}[]` for every unmapped column.
- rowErrors: `{ordinal,field,code}[]`, at most one error per logical field per row,
  sorted ordinal then field order instrument,side,occurredAt,order,quantity,grossUsd,
  feeUsd,currency. `field` is exactly one of those eight names.
- batchErrors: `{code,line:number|null,column:number|null}[]`, unique codes in the
  fixed order in §4. Non-structural errors have null location.
- summaryBefore: current FifoSummary in the same snapshot, always present.
- canConfirm true iff no errors, every execution valid and entire candidate valid;
  then candidateSummary:FifoSummary and previewHash:lowercase 64-hex.
- otherwise candidateSummary:null, previewHash:null, canConfirm:false. Structural
  failure returns rows:[], ignoredColumns:[], one structural batch error; no prefix.
  With row errors, do not calculate a subset candidate or add derivative history errors.

POST /:batchId/confirm body exactly
`{requestId,expectedJournalRevision,parserVersion,format,mapping,assertUsd:true,previewHash}`.
POST /:batchId/rollback body exactly `{requestId,expectedJournalRevision}`.
expectedJournalRevision is raw integer 0..10000, hash lowercase 64-hex only.
Each returns new 201 / accepted replay 200 with the immutable ImportReceipt:
`{accountId,batchId,requestId,kind,rowCount,firstJournalRevision,lastJournalRevision,createdAt}`.
No live summary/state/revision or receipt JSON blob; project immutable command columns.
Receipt range records one atomic command, NOT separately visible intermediate states.

GET /:batchId returns
`{batch:BatchMetadata,acceptedSettings:AcceptedSettings|null,
confirmReceipt:ImportReceipt|null,rollbackReceipt:ImportReceipt|null,rollbackReview}`.
`AcceptedSettings = {parserVersion,format,mapping,assertUsd:true}` with normalized
input-compatible shapes defined above; draft null, both accepted states retained unchanged.
`rollbackReview = {journalRevision,eligible,reason,removedTradeCount,
additionalVersionCount,summaryBefore,summaryAfter}`.
reason is null when eligible; otherwise first applicable in this order:
'not-committed', 'modified-trade', 'version-cap', 'insufficient-holdings'.
For draft/rolled-back: both counts 0. For committed: both counts equal accepted row
count even if another reason makes rollback ineligible (proposed complete removal,
not a claim of performed writes). summaryAfter is null when ineligible.
Batch, receipts, heads, revision, labels and summaries come from one RR READ ONLY TX.

GET /:batchId/rows query {afterOrdinal?,limit?,batchState?} returns
`{batchId,batchState,items,nextAfterOrdinal}`.
items: `{ordinal,startLine,tradeId,createVersion:TradeVersion,rollbackVersion:TradeVersion|null}`.
TradeVersion is the existing full immutable-version projection (including owned joined
instrument labels); createVersion.kind='create'/version=1; rollbackVersion.kind='void'/
version=2 when present. These are historical versions, never current head projections.
Default afterOrdinal 0, max 100; default limit 20 / max 100, canonical raw integer text.
Nonzero cursor requires batchState; every supplied state must match snapshot or 409.
nextAfterOrdinal is last returned ordinal when more remain, otherwise null. Draft is
empty. Rollback between pages invalidates continuation; unrelated edits do not.

Protected account detail exposes heading `Импорт CSV`, file input label `Файл CSV`,
button `Загрузить CSV`, combobox `Разделитель` with options `Запятая (,)` and
`Точка с запятой (;)`, button `Просмотреть исходные строки`, and source table caption
`Исходные строки`. These accessible labels anchor the maintained initial journey.
Successful upload shows the retained filename; inspection shows all literal rows
and their physical start lines. Full mapping/preview/rollback follows the same
protected view and the specified explicit-review/unknown-outcome rules.

## 4. Bounded error vocabulary and HTTP boundaries

Inspection structural codes (also preview structural batch codes), fixed precedence:
'csv-syntax', 'header-required', 'column-limit', 'cell-limit', 'empty-header',
'duplicate-header', 'row-width', 'blank-row', 'row-limit', 'no-data'.
Only one structural error is required: first encountered by deterministic full parser
traversal; header validation precedes row validation, checks within each record follow
the order above. Locations identify available source positions, never cell contents.
Byte-level invalid encoding/NUL/bare CR was already refused on upload with safe 400.

Row codes: 'instrument-key-unmapped', 'side-key-unmapped', 'invalid-time',
'invalid-order', 'invalid-quantity', 'invalid-gross', 'invalid-fee',
'buy-cost-overflow', 'currency-not-usd'. Buy overflow attaches to grossUsd only after
both gross/fee are individually valid. A mapped but foreign UUID is HTTP 404 instead.
Out-of-range columns leave every structurally parsed row represented with execution:null.
Mapping-set/column problems use batch codes 'column-out-of-range',
'unused-instrument-key', 'unused-side-key' (before history codes), not silent pruning.
Missing observed keys are row errors as above. Duplicate map keys/indexes are envelope400.

After all rows/settings are valid, history batch codes in fixed order:
'before-coverage', 'duplicate-chronology', 'active-trade-cap', 'version-cap',
'insufficient-holdings'. Detect duplicate chronology across candidate plus retained
heads; test insufficient holdings only with unique chronology and within active cap.
Cap/chronology failures in preview remain 200 canConfirm:false.

HTTP failures keep the EXISTING global error envelope
{statusCode,message,error,timestamp,path}; do not add a shared error framework.
Use static safe CSV messages, no input strings, parser exceptions or SQL details.
400 invalid envelope/upload encoding/file metadata/new-confirm row or structural data;
404 inaccessible account/batch/instrument (generic Not Found);
409 absent journal, non-draft preview, changed accepted key, new unsupported parser
version, source hash collision, quota, state, stale revision/hash, coverage/chronology/
FIFO/cap conflicts; 413 transport/file size limits; 500 existing generic storage failure.
Structured codes above are ONLY inspection/preview JSON; UI need not decode English
HTTP messages. Preserve existing 401/403/429 and real Retry-After/no-store behavior.
All confirm/rollback 409 paths MUST follow owned account locking and accepted receipt
lookup, including absent-journal, unsupported-version and batch-state checks. Thus
a 409 from the exact original POST is authoritative, matching the existing USD rule.
Prior ambiguity survives every other error (including 400/401/403/404/429), and a read
409 never resolves it. First-attempt known 4xx is a refusal; 2xx receipt resolves the
command. No ambiguous command is replaced because a read says already committed.
Trace this ordering in the implementation review; a future pre-replay 409 path must
change the classifier rather than silently invalidate this guarantee.

## 5. Canonical byte strings and hashes

Normalize syntactically before accepted replay, but never parse source or resolve
live instruments during replay comparison. Preserve a stable normalizer for this
command version independently of current CSV parser support. requestId is the lookup
key, excluded from canonicalPayload. Owner identity is the storage namespace.

Canonical normalized format tuple F:
`[delimiter,decimalSeparator,timestampMode,fixedOffsetOrNull]`.
Canonical normalized mapping tuple M:
`[[instrument,side,occurredAt,order,quantity,grossUsd,feeUsd,currencyOrNull],
[[source,instrumentId],...sorted],[[source,side],...sorted]]`.
Canonical execution tuple E:
`[instrumentId,side,occurredAt,orderWithinTimestamp,quantity,grossUsd,feeUsd]`.
Arrays remove JSON object-order ambiguity; JSON.stringify without whitespace, UTF-8
bytes, no Unicode NFC/casefold, no undefined or undefined-to-null accidental coercion.

Preview hash = lowercase SHA256 hex of UTF-8 JSON.stringify:
`['usd-csv-preview-v1',parserVersion,accountId,batchId,sourceSha256,F,M,true,
[[ordinal,startLine,E],...sourceOrder],journalRevision]`.
No random generated IDs, label text, wall clock, derived matches or summaries in hash.
Internal FIFO placeholders may be `csv:${batchId}:${ordinal}`; never expose/hash them
as actual trade IDs. Two replicas same canonical data/revision must produce same hash.

Confirm canonicalPayload text = JSON.stringify:
`['usd-csv-command-v1','confirm',batchId,expectedJournalRevision,parserVersion,F,M,true,previewHash]`.
Rollback canonicalPayload text = JSON.stringify:
`['usd-csv-command-v1','rollback',batchId,expectedJournalRevision]`.
Lookup is owner/account/requestId across both kinds. Equal text returns original
receipt before parser support, parse, mapped identity, batch state, CAS or capacity.
Different text is 409. New confirm checks expected revision then recomputes hash at
that same locked revision; unsupported version/stale hash requires explicit re-preview.
No server cache or client-provided normalized rows can authorize acceptance.

## 6. Three tables and relational constraints

Migration: `AddUsdCsvImports1790050000000` (fifteenth).

All UUID identity components NOT NULL. All times timestamptz(3), finite createdAt;
all integers NOT NULL except explicitly nullable below. FKs ON DELETE RESTRICT, no cascades.
Composite identity targets follow existing owner/account keys and users.id, never
transient owner_auth. New tables do not update preceding schema/data.

### account_csv_imports

- id uuid PK (server random UUIDv4), ownerId uuid, accountId uuid;
- sha256 text lowercase64hex; originalBytes bytea NOT NULL;
- byteLength integer CHECK 1..262144 AND octet_length(originalBytes)=byteLength;
- filename text NOT NULL with nonempty / 120-codepoint / no-control/slash bounds;
- state text NOT NULL CHECK in draft/committed/rolled-back;
- acceptedSettings jsonb NULL (versioned object described in §3);
- createdAt timestamptz(3) NOT NULL DEFAULT clock_timestamp(), CHECK isfinite.
UNIQUE(ownerId,accountId,id); UNIQUE(ownerId,accountId,sha256).
FK(ownerId,accountId) -> account_trade_journals(ownerId,accountId).
CHECK explicit disjunction `(state='draft' AND acceptedSettings IS NULL) OR
(state IN ('committed','rolled-back') AND acceptedSettings IS NOT NULL AND
jsonb_typeof(acceptedSettings)='object')`. Do not rely on SQL UNKNOWN to reject nulls.
Detailed canonical settings validation is the bounded application writer; do not
pretend a jsonb-object CHECK validates its whole schema. Digest matches actual bytes
by server calculation/duplicate comparison; length CHECK alone does not prove SHA.
No command pointer or cyclic FK. Lookup commands by the unique batch/kind index.
Original/settings/filename/time become immutable once written; state is monotonic.

### account_csv_import_commands

- ownerId uuid, accountId uuid, requestId uuid; composite PK on these three;
- batchId uuid; kind text CHECK confirm/rollback;
- canonicalPayload text NOT NULL;
- rowCount integer CHECK 1..100;
- firstJournalRevision integer CHECK 1..10000;
- lastJournalRevision integer CHECK 1..10000;
- createdAt timestamptz(3) NOT NULL DEFAULT clock_timestamp(), CHECK isfinite.
CHECK lastJournalRevision=firstJournalRevision+rowCount-1.
UNIQUE(ownerId,accountId,batchId,kind).
FK(ownerId,accountId,batchId) -> account_csv_imports(ownerId,accountId,id).
CanonicalPayload application bound comes from the strict bounded input grammar;
no duplicate receipt JSON, no extra command ID, no duplicated expected revision column
(firstJournalRevision-1 already identifies it). All rows immutable; no failed keys.

### account_csv_import_rows

- ownerId uuid, accountId uuid, batchId uuid;
- ordinal integer CHECK 1..100; startLine integer CHECK 2..262145;
- tradeId uuid; createVersion integer NOT NULL CHECK =1;
- rollbackVersion integer NULL CHECK IS NULL OR =2.
PK(ownerId,accountId,batchId,ordinal).
UNIQUE(ownerId,accountId,tradeId) prevents attributing a trade to multiple batches.
FK(ownerId,accountId,batchId) -> account_csv_imports(ownerId,accountId,id).
FK(ownerId,accountId,tradeId,createVersion) -> account_trade_versions PK.
Nullable FK(ownerId,accountId,tradeId,rollbackVersion) -> same PK, MATCH SIMPLE.
All nonnullable identity components remain NOT NULL when optional link is absent.
Rollback may append the link once; create provenance is never rewritten.

These ordinary FKs prove referenced identity/existence, NOT referenced version.kind,
number of rows equals receipt.rowCount, contiguous version ranges, or cross-table
state equivalence. The single transactional writer enforces those invariants and
real PG tests check them. Do not claim extra triggers are present. The only new rows
are these three tables; no separate source filesystem/observation/reconciliation table.

## 7. Mutation seam and transaction ordering

Minimal module-specific extraction accepts the CALLER's EntityManager. Reuse owned
account row lock, head loading, owned labels, complete version insert/head update and
final journal pointer helpers. No generic repository, nested transaction, public
per-row create/void loop, or source.manager escape from the active transaction.

Upload: authenticate/strict transport+metadata/bytes -> owned account FOR UPDATE ->
existing journal -> exact digest+byte replay -> count/sum source quota -> insert draft.
All states count toward 256 files / 64 MiB per account; byte cap currently follows
mathematically from file/count limits, not independently reachable below count cap.
Concurrent final-slot uploads serialize on the shared account row. Never global quota.

Confirm/rollback: normalize raw command -> TX -> owned account FOR UPDATE -> accepted
command lookup/compare -> journal existence -> owned batch -> remaining mutable checks. Batch locks, if
used, come AFTER account, never before. Same account lock as manual commands/openings.

New confirm: draft/support/CAS -> complete parse+map+owned identities -> combine all N
candidate executions with current active heads -> validate coverage/chronology/caps/
FIFO ONCE -> verify preview hash -> create N new trade UUIDs and N server request UUIDs
-> N immutable complete create versions, N heads, N provenance rows, one command,
acceptedSettings/state, final journal revision r+N -> COMMIT. No prefix publication.
Version journal ordinals r+1..r+N follow SOURCE ordinal, not economic chronology.
Per-row manual canonical create payload uses its predecessor ordinal as expected
revision and existing exact field order; these are provenance inside one atomic batch,
not claims that intermediate prefixes were valid standalone journal snapshots.

New rollback: committed/CAS -> every imported current head still exact create v1 ->
N version slots available -> remove ALL batch trades from full candidate -> FIFO once
-> N complete terminal void v2 versions, N head advances, N rollback links, one command,
rolled-back state, final revision r+N -> COMMIT. Same source ordinal order. Any failure,
including deferred COMMIT failure, rolls back EVERY write/key; existing source persists.
A sale previously matched to imported inventory does not prohibit rollback if other
remaining chronological lots cover it. Receipt replay ignores subsequent head changes.

## 8. Read consistency and independent seams

Inspect reads immutable original bytes; preview/detail/rows use explicit REPEATABLE
READ READ ONLY transactions for coherent batch/journal/head/label/provenance state.
Preview is read-only: no mapping cache, reserved key, draft-settings write or dummy ID
persistence. Detail returns live review separately from receipts. List exposes only
bounded metadata, never original bytes. Row paging is pinned by batchState, not journal
revision; immutable per-trade versions are joined with the same owner/account identity.

Public CsvImportService seam (constructor DataSource), raw input parsed once:
upload(ownerId,accountId,{filename,bytes:Buffer}) -> {created,value:UploadIdentity};
inspect(ownerId,accountId,batchId,raw), preview(...,raw), confirm(...,raw), rollback(...,raw);
confirm/rollback -> {created,value:ImportReceipt};
list(ownerId,accountId,rawQuery:unknown={}), detail(ownerId,accountId,batchId),
rows(ownerId,accountId,batchId,rawQuery:unknown={}). Queries retain raw HTTP strings;
PG fixtures use that same seam. No controller trusts client owner IDs/normalized rows.
Use accounting/csv-import.service.ts, csv-input.ts and csv-parser.ts, with a private
shared trade-journal persistence helper as needed. No framework or test-only endpoint.

### Pure boundary seams for independent characterization

`csv-input.ts` exports `decodeDisplayName(raw:unknown):string` and
`validateCsvSource(raw:unknown):Buffer` (returns the original validated Buffer, no
mutation/BOM stripping), plus `parseCsvInspect`, `parseCsvPreview`, `parseCsvConfirm`,
`parseCsvRollback`, `parseCsvListQuery` and `parseCsvRowsQuery`. Each parse function
takes unknown once and returns its normalized strict input type from this contract.
Query parsers take raw string properties, not fixture-only number exceptions.
Confirm parsing accepts bounded version syntax; support checking occurs after replay.

`csv-parser.ts` exports `parseCsvSource(bytes:Buffer, delimiter:','|';')` returning
exactly the inspection discriminated union without batchId. It independently validates
source bytes before parsing, using the shared validator; invalid bytes throw safe 400,
whereas structural errors use the documented valid:false union. It also exports
`normalizeCsvRows(document, settings)` for a valid parsed document and normalized
Settings, returning `{rows,rowErrors,batchErrors,ignoredColumns}` as defined above.
This pure helper performs no SQL or ownership lookup, mutates neither input and adds
no journal/FIFO/history errors. Service resolves all mapped UUID ownership and combines
normalization with coverage/chronology/capacity/FIFO checks in its transaction.

No exported hash helper is needed. Deterministic hashing and command replay are tested
through real service/replica results. These names support independent test authorship;
a missing module/import before implementation is a prerequisite, never behavior RED.

## 9. Required independent evidence

Preserve predecessor assertions. Genuine upload/UI RED uses old verified images with
real MFA, no future tables/imports in prerequisite. Pure parser boundary vectors;
real PG source SHA/bytes, FK negative probes, exact replay after correction/rollback,
whole-batch sale-first-source-order success, distinct-chronology import/manual CAS,
RR barriers, complete deferred-COMMIT rollback including failed key, cap races,
rollback reallocation and refusal, populated14-to15 preservation. Real HTTPS denied
writes and own-backend accepted-response loss must prove ambiguity handling. No mocked
auth, fabricated acceptance, modified oracle, or ignored CSV tables in fingerprints.

## 10. Transport and verification boundary

[parser-decision.md](parser-decision.md) fixes csv-parse 7.0.2, route-local memory
upload, canonical displayNameBase64url metadata and the distinct application/edge
limits. It is the authoritative transport/options reference; no second set of limits
is inferred from this schema. Worst-case ordinary browser UTF-8 JSON mapping fits
100 KiB; heavily escaped alternate representations may receive ordinary JSON 413.
Include maximum browser-serialized mapping in characterization, without truncation
or increasing global JSON limits. Parser location fields may be null when unavailable;
never guess positions or disclose underlying exceptions. Actual parser, Nest, edge,
PostgreSQL and browser checks are required evidence, not unresolved authorization.
