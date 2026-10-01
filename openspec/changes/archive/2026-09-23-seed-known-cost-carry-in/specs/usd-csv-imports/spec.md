## MODIFIED Requirements

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
