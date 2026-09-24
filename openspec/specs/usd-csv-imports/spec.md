# usd-csv-imports Specification

## Purpose
Retain private CSV originals and import explicitly mapped USD trades atomically,
with exact FIFO preview, immutable source provenance, safe replay and reviewed
whole-batch rollback.
## Requirements
### Requirement: CSV-001 Private bounded original identity
The system SHALL retain exact original UTF-8 bytes privately in PostgreSQL for an
owned, already initialized USD journal. Upload MUST NOT assert empty history or
convert opening balances. The routes and projections SHALL follow the [API and persistence contract](../../changes/archive/2026-09-23-import-usd-trades-csv/persistence.md).
One file SHALL contain 1..262144 bytes; original filename SHALL be bounded display
metadata only. Strict UTF-8, NUL and standalone CR validation SHALL precede retention.
An optional initial UTF-8 BOM SHALL be preserved in storage and stripped only for
parsing. Every upload SHALL retain existing full-session, Origin/CSRF and quota rules.
The whole multipart envelope SHALL be limited to 1048576 bytes at the trusted edge;
application file/field/part limits SHALL independently bound upload allocations.

Identity SHALL be owner/account/SHA256 with exact-byte comparison on a digest hit.
Identical-byte replay SHALL precede file capacity and return the original identity,
first filename and time, including after acceptance or rollback. Retention SHALL
allow at most 256 files and 64 MiB per account across all states; no silent deletion.
Changed bytes and overlapping exports MUST NOT be heuristically deduplicated.

#### Scenario: CSV-001-A Exact original and filename survive repetition
- **GIVEN** a real full-owner session and an explicitly initialized USD journal
- **WHEN** a UTF-8 BOM/CRLF file with a Cyrillic and emoji display name is uploaded, then uploaded again under a different name and after both backend restarts
- **THEN** one private byte-identical original and SHA256 remain, new upload returns201, repeats return200 with the same immutable identity, and first metadata remains unchanged
- **AND** reupload after confirmation or rollback never creates another batch or reactivates a terminal batch
- **AND** no journal entry, origin, opening, external observation or provider request is created by upload

#### Scenario: CSV-001-B Transport and encoding failures cannot retain a partial file
- **WHEN** empty or262145-byte files, invalid UTF-8/UTF-16/NUL/bareCR, invalid filename encoding, missing/extra/nested parts, non-multipart or truncated input reach the new route
- **THEN** safe400/413/415 failures as defined in persistence.md create no batch or accounting mutation and disclose no private file/name in errors or logs
- **AND** a valid262144-byte original and a120-codepoint UTF-8 display name remain admissible
- **AND** actual HTTPS requests with declared or chunked whole envelopes above1048576 bytes fail at the real proxy, including a small file with oversized multipart overhead
- **AND** pre-existing JSON routes and the owner Nginx file retain their behavior and bytes

#### Scenario: CSV-001-C Retained-file quota serializes and still permits replay
- **GIVEN** valid retained sources at the account limit or one available file slot
- **WHEN** exact-file retries and two distinct new uploads race through real service processes
- **THEN** accepted originals remain replayable at capacity and at most one last-slot upload commits, with no257th file, eviction or partial source
- **AND** drafts and rolled-back originals count; the64MiB bound is not misrepresented as independently reachable below256 maximum-size files

### Requirement: CSV-002 Explicit inspection and exact economic preview
The system SHALL inspect a stored source before requiring economic mapping, returning
all bounded headers/rows with ordinal and physical start line or one structural error
without a partial prefix. Inspection SHALL work in every batch state without writes.
The parser SHALL require one header plus1..100 records,1..32 equal-width columns and
at most4096 UTF-8 bytes per decoded cell, explicit comma/semicolon delimiter, strict
quotes and LF/CRLF endings. Headers SHALL reject trim-empty/exact duplicates; blank
all-empty records SHALL fail. No record skipping, truncation, coercion or repair.

Draft-only economic preview SHALL require explicit distinct column indexes, exact
source-key maps to owned instrument UUIDs and buy/sell, decimal separator, time mode,
same-instant order, actual gross/fee columns and literal USD attestation. Unknown cost,
fee, time, order or instrument identity MUST NOT be invented. Canonical exact amounts,
calendar/offset validation and buy-basis overflow SHALL retain the journal contract.
Optional currency cells SHALL contain literal USD. Settings SHALL reject unsupported
keys/types, duplicate maps, unused keys and undeclared numeric separators.

Invalid draft previews SHALL return200 canConfirm:false, bounded row/batch errors and
null candidateSummary/previewHash, never a profitability result for a valid subset.
Raw envelopes SHALL fail400, inaccessible mapped identities generic404 and non-draft
economic preview409. Valid previews SHALL report every normalized row, ignored column,
exact current/candidate summary, coherent journal revision and versioned preview hash.
For a reviewed carry-in origin, both summaries and validation SHALL use its immutable
original-lot baseline under CARRY-002/004 without adding baseline buys or fees.

Preview SHALL rebuild the complete candidate connected component using the stored transfer
history and its current pinned journal revision, without mutating any participant. Transfer
commands are not CSV-importable under this requirement. The preview identity SHALL become stale
when any upstream connected revision changes; no partial or truncated recipient history may be
shown. Candidate connected prefix/capacity failures SHALL retain the invalid-preview
envelope with `connected-history`/`connected-capacity` batch errors respectively;
invalid saved history SHALL return409 rather than a fabricated current summary.

Candidate FIFO SHALL include rewards and propagate nullable sale/remaining costs and explicit known subtotals. Unknown basis alone SHALL NOT reject a quantity-valid candidate or become zero.

#### Scenario: CSV-002-A Inspection supports deliberate mapping without guessing
- **WHEN** the owner inspects comma or semicolon data containing doubled quotes, quoted delimiter/newlines, optional BOM and mixed LF/CRLF endings
- **THEN** every source ordinal/start line and literal cell is correct before mappings exist, including ignored formula-looking text
- **AND** explicit decimal comma plus a fixed offset normalizes exact strings and UTC instants independently of browser/server timezone
- **AND** equally named instruments remain distinct UUID choices; ignored columns and actual total-USD/fee interpretation are shown before confirmation

#### Scenario: CSV-002-B A bad final row never creates a partial preview or import
- **WHEN** the final record has malformed quotes/width, a101st row,33rd column,4097-byte cell, empty/duplicate header or blank record
- **THEN** inspection returns a bounded structural error without a successful prefix and economic preview has no candidate/hash
- **WHEN** a mapped row has missing fee, mixed/grouped/exponent decimal, excess precision, zero gross/quantity, impossible calendar date, missing/extra offset, unsupported currency or buy-basis overflow
- **THEN** every source row remains represented, that execution is null with stable errors, no subset FIFO is presented and no accounting row/key is written
- **AND** exact100-row/32-column/4096-byte boundaries, leap days, offset date crossings and supported30-place amounts are exercised with independent expectations

#### Scenario: CSV-002-C Mapping is raw, explicit and owner scoped
- **WHEN** mapping contains coerced indexes, unknown server fields, duplicate source keys/indexes, missing/unused observed keys, wrong assertion or a foreign instrument
- **THEN** the documented400, structured nonconfirmable preview or generic404 occurs without guessing, dropping rows or disclosing foreign identity
- **AND** source keys remain exact case/Unicode strings, including safe prototype-like names, and map-array reordering/UUID case normalize equivalently

#### Scenario: TRANSFER-CSV-PREVIEW Candidate trades use connected transferred basis
- **GIVEN** an initialized source and recipient connected by an effective transfer of an original FIFO lot
- **WHEN** the owner previews a CSV sale of the received lot
- **THEN** the candidate summary and FIFO matches use the original lot interval and provenance, while every
  connected account row, transfer version and revision remains unchanged

#### Scenario: REWARD-CSV-PREVIEW
- **WHEN** a mapped sale consumes an unknown-cost reward
- **THEN** preview shows valid quantity history but null affected cost/profit with exact completeness

### Requirement: CSV-003 Whole-batch atomic confirmation and replay
Confirmation SHALL reparse immutable source/settings on the server and bind the exact
parser version, source, account/batch, normalized rows and locked journal revision to
the preview hash. The hash MUST NOT be treated as authentication or proof of a human
review. No client-normalized rows, random future IDs or mutable labels SHALL define it.
All import/manual/opening writers SHALL use the same owned-account lock. Confirm and
rollback SHALL share a dedicated owner/account/request key namespace; accepted replay
SHALL precede reparse, parser support, batch state, mapped identity, CAS and caps.

One accepted confirmation SHALL validate the complete candidate history, including
any reviewed immutable carry-in baseline, once and
atomically append N create versions/heads, N source links, one immutable receipt,
accepted settings and final journal revision+N. Source order SHALL assign consecutive
version ordinals; economic time/order SHALL determine FIFO. No provisional prefix or
per-row transaction SHALL reject or expose an otherwise valid complete batch.
Caps SHALL remain1000 active trades/10000 versions. Any failure SHALL reserve no key
and commit no partial trade, link, receipt, batch transition or pointer.

Confirmation SHALL validate the accepted complete candidate history for every account affected
by its trades through the connected transfer ledger before commit. The source account journal
revision advances by the existing N contiguous trade range; each other affected participant
receives one passive invalidation tick in the same transaction. The 10,000 journal-revision
budget is separate from local trade versionCount and is checked for all participants before
writes. Every affected account row SHALL be locked in sorted UUID order after the owner-scoped
advisory lock, shared with trade, carry-in and transfer writers.

Confirm SHALL revalidate connected reward history under the common owner-first locks. Upstream reward changes invalidate saved candidate pins/hash rather than silently accepting a different result.

#### Scenario: CSV-003-A Out-of-source-order history commits exact mandatory FIFO
- **GIVEN** a file physically lists sale1.5/gross450 at t3, then buy1/gross100 at t1 and buy1/gross200 at t2, all fees0
- **WHEN** a valid preview is explicitly confirmed
- **THEN** all three trades commit together, realized result is250, remaining quantity/cost0.5/100, and source links identify the exact created versions
- **AND** journal revision advances by3 with no separately visible intermediate accepted state
- **AND** equal-looking legitimate rows with distinct explicit chronology remain separate rather than being skipped as duplicates

#### Scenario: CSV-003-B Concurrent commands and old receipts cannot duplicate acceptance
- **WHEN** actual processes race identical confirmation or distinct import/manual sales at the same revision with distinct chronology
- **THEN** identical commands commit once and replay200, distinct commands have one winner and one409, and no historical overspend or losing-key reservation occurs
- **AND** accepted exact confirmation replays its original receipt before later corrections, rollback, parser-support checks or exhausted caps, without rewinding heads/state
- **AND** a changed accepted key's mapping, kind, target, revision or hash conflicts, while another key cannot accept an already committed/rolled-back file

#### Scenario: CSV-003-C A whole batch must fit and commit completely
- **WHEN** N rows would exceed active/version caps, have duplicate normalized chronology, predate coverage or create a negative historical prefix
- **THEN** the new confirmation returns409 with every accounting/batch row unchanged, including when final inventory would be nonnegative
- **AND** exact caps succeed; accepted replay still works at capacity and no smaller subset is imported
- **WHEN** a real deferred COMMIT failure occurs after every version/head/link/receipt/state write
- **THEN** an independent stage witness proves that path, HTTP returns private generic500, every transactional write rolls back and explicit original-key retry succeeds once after the fixture is removed

#### Scenario: TRANSFER-CSV-COMMIT Accepted batch restates recipient atomically
- **GIVEN** a batch changes a source lot already transferred and sold by a connected recipient
- **WHEN** the whole candidate component is valid and within each affected journal revision budget
- **THEN** the batch trade range and every passive recipient revision commit atomically, and the recipient
  result reflects the recomputed original-coordinate basis
- **WHEN** any connected prefix is negative or a participant reaches its revision ceiling
- **THEN** no source or recipient row, receipt, batch state, head or revision changes

#### Scenario: REWARD-CSV-CONFIRM
- **WHEN** a reward correction commits after a saved sale candidate
- **THEN** confirmation returns409 until explicit review; original CSV bytes and receipts remain unchanged

### Requirement: CSV-004 Conditional complete rollback preserves history
Rollback SHALL append N terminal void versions only when every imported trade still
has its exact initial create head, N version slots remain and the complete remaining
history is valid. It SHALL remove the whole batch from candidate calculation at once. A reviewed
carry-in baseline SHALL remain in that calculation and its original lots SHALL not
be voided or replaced by batch rollback.
Prior FIFO matches to imported lots MUST NOT independently block valid reallocation.
Any modified imported head, negative remaining prefix or capacity refusal SHALL reject
the entire operation. Originals, accepted settings, create versions and receipts SHALL
remain private and immutable; there SHALL be no delete, restore or reimport generation.

Rollback SHALL rebuild and validate the complete connected component after removing the batch
effects. It SHALL refuse atomically if any dependent recipient history would become negative. On
a successful rollback the importing account advances according to the existing trade rollback
revision semantics, and each other affected participant advances once; the journal-revision
budget remains distinct from saved trade versionCount.

#### Scenario: CSV-004-A Reviewed reallocation is safe when remaining lots cover sales
- **GIVEN** imported A buys1 for100, later manual B buys1 for200, and a later manual sale1/gross300 realizes200 using A
- **WHEN** the untouched import is rolled back at its reviewed current revision
- **THEN** the sale reallocates to B, current realized becomes100 and remaining quantity/cost become0, while A's original evidence and one terminal void remain
- **AND** detail shows coherent exact before/after results and the UI explains that remaining FIFO matches are recomputed
- **AND** rolling back the mandatory three-row batch removes it atomically rather than rejecting its intermediate source prefix

#### Scenario: CSV-004-B Unsafe or failed rollback changes nothing
- **WHEN** an imported row was corrected/manually voided, remaining chronological inventory would be negative, version capacity is insufficient or the reviewed revision is stale
- **THEN**409 preserves all source, trade, link, command and batch state without partial undo
- **AND** a real deferred COMMIT failure after all void/link/state writes also rolls everything back; original-key retry commits once after removing the isolated fixture
- **AND** accepted rollback replay returns its original receipt before later journal changes without appending duplicate voids; same-file upload stays terminal

#### Scenario: TRANSFER-CSV-ROLLBACK Cannot strand dependent recipient history
- **GIVEN** an accepted batch supplies basis later transferred to a recipient sale
- **WHEN** rollback removes that basis and the recipient would have a negative historical prefix
- **THEN** rollback is refused with all connected accounts, transfer state, original CSV bytes, receipts
  and revisions unchanged
- **WHEN** the complete connected component remains valid
- **THEN** rollback commits atomically and invalidates each affected account pin once

### Requirement: CSV-005 Coherent bounded preview and provenance
Preview and live rollbackReview SHALL read journal revision, complete history, batch
and owned labels in one read-only REPEATABLE READ snapshot. Carry-in baseline records
SHALL be loaded through that same snapshot manager and applied consistently to all
current/candidate/rollback summaries. Accepted historical receipt replay SHALL remain
independent of recalculation or current baseline read success. Preview hash SHALL use
the fixed canonical tuples/version in persistence.md. New confirmation SHALL require
the same revision and recomputed hash. Immutable command receipts MUST NOT be shown
as current FIFO. Batch lists SHALL use bounded exclusive UUID cursors; provenance
pages SHALL use bounded ordinal cursors pinned to batchState across rollback.
Raw bytes and canonical request payloads SHALL NOT leak through metadata projections.

CSV preview, confirmation review, rollback review and provenance reads that depend on transfers
SHALL use one coherent connected-history snapshot. A trade, transfer or CSV correction affecting
any participant SHALL invalidate its pinned results, and no nested page may calculate from a
truncated connected ledger.

Reward history SHALL be read in the same candidate/history snapshot and without per-row or per-point reloads. All current and candidate nullable totals SHALL use the same explicit cost-evidence contract as direct journal results.

#### Scenario: CSV-005-A Real concurrent reads never mix journal versions
- **WHEN** a real correction overlaps preview or rollback detail through a controlled database read barrier
- **THEN** each complete response equals one old or new coherent revision, including labels and both summaries, never a mixed result
- **AND** repeated equivalent previews on two replicas at one revision have identical hashes independent of random IDs or clock
- **AND** stale/tampered hashes or a hash paired with a newer expected revision cannot confirm; explicit re-preview is required

#### Scenario: CSV-005-B Provenance pages cannot silently cross rollback
- **WHEN** a committed source-row page is followed by rollback before its continuation
- **THEN** the old supplied batchState returns409 without mixed rows; explicit restarted pagination shows all immutable create and rollback versions
- **AND** unrelated manual journal edits do not invalidate immutable source provenance, while they invalidate stale live rollback review
- **AND** nonzero ordinal cursors require state, malformed bounds fail400 and no list/detail response serializes original bytes

#### Scenario: TRANSFER-CSV-SNAPSHOT Pinned recipient preview cannot mix revisions
- **GIVEN** a connected CSV preview is read while a real source correction commits after its database
  snapshot begins
- **WHEN** the remaining source, transfer and recipient data are loaded
- **THEN** the preview is wholly the old candidate revision, and the next request detects the new connected
  revision instead of reusing that preview

#### Scenario: REWARD-CSV-SNAPSHOT
- **WHEN** a concurrent reward correction overlaps preview reads
- **THEN** one complete old or new candidate is returned; no mixed cost completeness is shown

### Requirement: CSV-006 Protected Russian import journey preserves intent
The account journal SHALL provide Russian upload/inspect/map/preview/confirm and
batch/provenance/rollback views. It SHALL disclose supported formats/caps, exact-file
deduplication limits, declared history, conditional rollback and recorded-cost results,
without cash/market/return/tax claims. Confirmation SHALL require a current valid
preview and explicit action; there SHALL be no automatic mutation retry.
Late responses SHALL NOT overwrite another draft/account or enable obsolete preview.
An unresolved command SHALL keep its complete original key/settings/target/revision
across in-app data refresh, SPA navigation, stale reads and denied retries, with edits locked and exact explicit
replay available. Only an accepted receipt or proved post-replay conflict SHALL resolve it.
Recovery is ephemeral to the loaded browser document. The UI SHALL explain that a
full document reload or tab closure discards that local command and SHALL NOT imply
that saved batch discovery reconstructs an unknown request key.

#### Scenario: CSV-006-A Real UI imports, restarts and inspects retained evidence
- **GIVEN** actual password/MFA login through release HTTPS
- **WHEN** the owner uploads, inspects, explicitly maps and confirms the mandatory file through Russian forms
- **THEN** preview writes no trades, exact250/100/0.5 results and source/version provenance survive real backend restarts, and literals cannot execute script
- **AND** unchanged reupload exposes the same batch rather than offering another acceptance; supported-limit and overlapping-export warnings are visible before confirmation

#### Scenario: CSV-006-B Ambiguous confirm and rollback preserve original commands
- **WHEN** an actual committed confirm or rollback response is lost, a real retry is refused403, and the owner refreshes or encounters stale reads
- **THEN** mapping/file/target remain protected, later explicit retry sends the original complete command and receives its original200 receipt without another version range
- **AND** an actual401 retry followed by real password/MFA login and SPA return retains that same original command without automatic submission
- **AND** current results come from fresh reads rather than the old receipt, and new work requires successful current-state review
- **AND** stale preview responses after edits/account navigation cannot enable confirmation or replace the active account state

### Requirement: CSV-007 Private import boundaries preserve unrelated data
Every new route, including inspection and nested provenance, SHALL require the actual
full owner session; writes SHALL retain Origin/CSRF, source attribution and existing
request limits. Ownership predicates/composite RESTRICT references SHALL preserve
account/batch/instrument/version identity. Imported text SHALL render literally and
never become a formula, HTML, path, shell argument, SQL identifier or provider URL.
No source/filename/amount/parser exception SHALL enter public failures or logs.

#### Scenario: CSV-007-A Real denied access never discloses or mutates imports
- **WHEN** anonymous/pending clients, invalid Origin/CSRF, foreign accounts/batches/instruments or mass assignment exercise all new private route families
- **THEN**401/403/generic404/400 boundaries preserve sources and accounting rows and disclose no private metadata or original
- **AND** invalid Origin/CSRF does not touch sessions; valid authorization may change only documented session/admission bookkeeping before a controller refusal
- **AND** SQL cross-owner/account/version references fail constraints and private canaries remain absent from backend/proxy logs and failure bodies
- **AND** all previous financial/authentication assertions remain and accounting flows make zero provider requests, with retained startup warmups measured separately

#### Scenario: CSV-007-B Trusted-edge multipart boundary preserves private state
- **GIVEN** a real full-owner session, initialized journal and valid small UTF-8 source inside a multipart body with bounded fields and additional MIME overhead
- **WHEN** the exact1048576-byte multipart body is uploaded with Content-Length, then replayed byte-identically using chunked transfer
- **THEN** the first response is201 and the replay200 with the same immutable source identity and no-store, with one draft source and an unchanged journal
- **WHEN** a1048577-byte multipart body is submitted using either transfer form
- **THEN** the real proxy returns413, every persisted application/authentication row remains unchanged, and neither private source text nor filename is echoed
- **AND** auth-admission state and provider requests remain unchanged
