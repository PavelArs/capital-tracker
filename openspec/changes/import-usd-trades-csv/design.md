## Context

The verified USD journal supports exact manual executions, immutable versions,
complete-history FIFO and coherent bounded reads. Its archive followed 101 passing
release acceptance cases. CSV support does not exist yet. The target brief requires
reviewed column mapping, retained private originals, row errors, provenance and safe
rollback without guessing acquisition history or suppressing legitimate equal trades.

This change adds that complete journey inside the accounting module. The normative
API/schema/canonicalization contract is [persistence.md](persistence.md); parser and
wire limits are [parser-decision.md](parser-decision.md). Existing owner MFA, CSRF,
request quotas, exact strings, account isolation and provider-free accounting remain.

## Goals / Non-Goals

**Goals:**

- Upload one bounded original, inspect all rows, explicitly map economic meaning,
  preview exact whole-history consequences, then accept one atomic batch.
- Preserve exact original bytes and immutable source-to-version links; exact file
  and accepted-command replay must not duplicate executions.
- Conditionally undo a complete untouched batch through appended void versions,
  recalculating the remaining history while retaining all evidence.
- Deliver a protected Russian UI with clear errors, reviewed conflicts, bounded
  history and safe explicit recovery after uncertain write responses.

**Non-Goals:**

XLS/XLSX, streaming large histories, new opening/carry-in conversion, implicit journal
initialization, semantic deduplication of overlapping exports, inferred instrument or
execution order, swaps/non-USD fees, external flows, valuations/investment returns,
blockchain reconciliation, provider calls, public original downloads, deletion,
production rollout or repository consolidation. The existing 1000 active trade and
10000 immutable version limits remain. This bounded importer explicitly satisfies
the predecessor's limits-before-CSV condition without claiming larger capacity.

## Decisions

### 1. Exact private input, then server inspection

Store bytea in PostgreSQL with the batch, not a second filesystem lifecycle. Exact
owner/account/SHA256 identity plus byte comparison returns the first metadata on
reupload, including renamed or rolled-back files. Count every state toward 256 files
and 64 MiB per account. Different bytes are a different draft, not semantic proof of
new trades. There is no automatic overlap matching.

Use the pinned maintained backend parser and route-local upload adapter in the parser
decision. Inspection takes only delimiter and returns all bounded literal source rows
or one structural error; every batch state is inspectable. This avoids a second browser
CSV parser and closes the otherwise circular upload-to-mapping workflow. It never
changes accepted settings. Economic preview is draft-only, with no saved mutable
preview or reserved request key. Raw source bytes never leak through generic metadata.

### 2. Explicit interpretation and one complete candidate

Every economic column is mandatory, including fee and explicit same-instant order.
Owned UUID mappings are explicit; names/symbols never establish identity. Decimal and
fixed-offset/explicit-offset time modes are selected, not inferred. Literal USD
attestation is required. Missing or unknown values are errors, never zero-cost lots.

Preview uses current full heads plus every normalized row, with existing pure BigInt
FIFO once. Invalid rows do not produce a valid-subset result. Structured bounded errors
leave candidate summary/hash null. Valid preview binds exact source, canonical mapping,
executions and journal revision through a versioned hash. It is not a human-consent
proof or cached permission. Confirmation reparses and recomputes under the account lock.

### 3. Small shared transaction seam

Extract only owned account/journal access, current heads/labels and prepared complete
version/head writes into a module-private helper taking the caller's EntityManager.
Existing TradeService and CsvImportService keep their own command validation, receipt
lookup and transaction wrappers. Reuse existing exact parsers, projections and FIFO.
No generic repository, event framework, nested transaction, source.manager escape or
public per-row create/void loop is needed. Retain existing characterization for this
pure extraction; new CSV behavior separately requires real predecessor RED.

Every writer locks the account first. After accepted receipt replay, a new import
validates the entire candidate and appends N complete versions, N heads and provenance,
one command receipt and one final revision advance in a single transaction. Source
ordinal determines consecutive version ordinals; execution chronology determines FIFO.
A sale-first source file may be valid when a later source row is an earlier buy.
Intermediate ordinals are not separately committed or queryable portfolio snapshots.

### 4. Immutable receipts and conditional rollback

Three tables suffice: batch/private original/settings, source-row links, immutable
command columns. Derive receipt JSON from columns; do not duplicate it or introduce
a cyclic batch-to-receipt FK. Composite RESTRICT references preserve ownership and
version provenance. Detailed cross-table cardinality/kind invariants belong to the
single transactional writer and independent PG evidence, not imaginary FK semantics.

Normalize a command syntactically, lock account, then compare the accepted key before
parser support, source parsing, journal/batch state, mapped references, CAS or caps.
A replay after later edits or rollback returns its original receipt. A changed command
under that key conflicts. Failed transactions reserve nothing, including at COMMIT.

Rollback requires every imported head to remain the exact create version. Remove all
batch executions together and validate remaining history once, then append N terminal
voids and links atomically. Previous FIFO consumption alone does not forbid rollback:
imported buy 1/$100, later manual buy 1/$200, then sale 1/$300 changes realized result
from $200 to $100 when the imported buy is removed; the manual buy still covers sale.
Without the replacement inventory it fails. Version exhaustion also refuses rollback;
this is conditional undo, not reserved future capacity or deletion.

### 5. Coherent reads and explicit client state

Preview, batch detail and provenance pages use REPEATABLE READ READ ONLY as specified.
Detail separates immutable receipts from live rollbackReview, with complete before/after
summary and fixed reason precedence. Provenance pages pin batchState so a rollback
between pages cannot mix missing/present rollback links. Unrelated trade edits do not
invalidate immutable provenance. Existing journal result pages retain revision pins.

Integrate a bounded import view in the existing protected manual-account flow, using
current components/client and Russian local feedback. Select a file, inspect, choose
columns/owned instrument UUIDs and explicit formats/USD, then show all normalized rows,
ignored columns, errors and before/after recorded-cost results. Render source text
literally. Show that changed/overlapping exports are not deduplicated. Accepted detail
shows saved interpretation, receipt range and original/rollback versions; it does not
pretend they are current heads or investment returns.

Changes to mapping/file/account invalidate pending preview immediately. Generation
checks prevent late inspection/preview/detail/page responses from restoring obsolete
state. Disable mutable inputs during writes. A new conflict preserves the draft but
requires refreshed preview/review and explicit consent before a fresh command.

Retain an uncertain write's entire operation/key/revision/settings/hash/target. Explicit
retry sends the same command even if current detail is terminal or ineligible; do not
automatically retry mutations. Prior uncertainty survives all failures except success
or authoritative 409 from the exact POST after accepted receipt lookup. Read 409 never
resolves it. All confirm/rollback 409 paths obey that ordering, including absent journal.
A known receipt followed by failed current GET remains visible and blocks resubmission
until a fresh read. Upload uncertainty retains exact bytes/account for reupload, not a
new selected file. Route changes isolate state and prevent stale async updates.

### 6. Existing security boundaries, bounded transport

Keep full-session guards, Origin/CSRF, no-store application responses, safe generic
storage errors and private logs. Validate raw nested JSON before coercion; foreign
references return generic 404. The route upload sanitizer must not echo Multer fields,
filename or parser messages. Source/map strings never become SQL identifiers, paths,
HTML, formulas, URLs or log values. No changes to existing auth or quota contracts.

The existing trusted private-backend topology provides the explicit 1 MiB edge body
cap; route-local file/field limits bound application buffers separately. Proxy buffering
may touch private disk. Generic edge 413 need not gain new headers or disturb inherited
security headers. Preserve the owner's unrelated frontend/nginx.conf.

## Risks / Trade-offs

- Parser edge cases → exact real-library UTF-8/quotes/newlines/limit/location vectors,
  then Nest/proxy/browser probes; a dependency choice is not compatibility evidence.
- Source-order revisions mistaken for portfolio snapshots → receipts identify one
  atomic range; no new historical-FIFO-at-every-ordinal API is offered.
- 1000/10000 or file caps refuse useful work → show explicit capacity/error and never
  partially import; accepted replay still precedes caps. No unconditional undo promise.
- Account serialization and complete FIFO recomputation cost → bounded 100-row inputs
  and existing history limits; avoid new caching/invalidation or lock hierarchies.
- Retained originals grow per account → count all states; no public download/delete.
  The 64 MiB bound is redundant at the present file/count maxima, not an independent
  quota fixture below the count limit or a global owner/storage bound.
- Ambiguous network outcomes → exact immutable command replay and explicit retry;
  actual commit-then-abort/denied-retry tests, not fabricated backend responses.

## Migration Plan

After genuine upload/API and missing-UI RED on the verified predecessor images,
implement `AddUsdCsvImports1790050000000` as migration 15 adding only the three empty
tables and RESTRICT constraints. No data conversion, extension change or automatic
startup migration. Preserve every previous row/schema/sequence and legacy refusals.
Root owns DDL/entities, dependency/lock, deployed proxy template and shared harness;
separate reviewed worktrees own backend, frontend and independent tests.

Rehearse fresh install/replay and populated 14-to-15 upgrade in allowlisted isolated
release databases. Exercise actual commit-stage rollback witnesses, concurrent writers,
source quotas, read barriers and conditional batch rollback; retain all 101 predecessor
acceptance oracles. Run source/build/lint, frozen install/audit, exact-image artifacts
and expanded HTTPS/browser checks before archive. Pending tests are not green evidence.

Application rollback may remove the new UI/routes while retaining tables/originals;
never drop accepted provenance or run a destructive down migration as recovery.
Production rollout remains outside this slice.

## Open Questions

No architectural or authorization decision remains open. Parser/interceptor/edge
characterization, migration preservation, arithmetic/concurrency and UI behavior are
required verification work. A failed oracle must be fixed or the contract explicitly
reviewed; it is not permission to weaken assertions or silently change semantics.
