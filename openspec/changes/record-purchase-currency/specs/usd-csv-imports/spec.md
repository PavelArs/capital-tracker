## MODIFIED Requirements

### Requirement: CSV-002 Explicit inspection and exact economic preview
CSV inspection and preview SHALL calculate candidate rows against the complete current connected history, including effective swaps, without treating a swap as a synthetic USD trade or changing its consideration. A candidate which conflicts with or makes a later swap prefix invalid SHALL be rejected as a whole.

The system SHALL inspect a stored source before requiring economic mapping, returning
all bounded headers/rows with ordinal and physical start line or one structural error
without a partial prefix. Inspection SHALL work in every batch state without writes.
The parser SHALL require one header plus1..100 records,1..32 equal-width columns and
at most4096 UTF-8 bytes per decoded cell, explicit comma/semicolon delimiter, strict
quotes and LF/CRLF endings. Headers SHALL reject trim-empty/exact duplicates; blank
all-empty records SHALL fail. No record skipping, truncation, coercion or repair.

Draft-only economic preview SHALL require explicit distinct column indexes, exact
source-key maps to owned instrument UUIDs and buy/sell, decimal separator, time mode,
same-instant order, actual gross/fee columns and literal amount attestation
(`assertUsd`: amounts are in each row's paid currency, USD unless declared under PCUR-2). Unknown cost,
fee, time, order or instrument identity MUST NOT be invented. Canonical exact amounts,
calendar/offset validation and buy-basis overflow SHALL retain the journal contract.
Optional currency cells SHALL contain USD or a currency accepted by PCUR-2 with its rate. Settings SHALL reject unsupported
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
- **WHEN** a mapped row has missing fee, mixed/grouped/exponent decimal, excess precision, zero gross/quantity, impossible calendar date, missing/extra offset, invalid currency code, missing or invalid rate or buy-basis overflow
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

#### Scenario: SWAP-CSV-PREVIEW
- **GIVEN** an effective swap depends on inventory later changed by a candidate CSV sale
- **WHEN** the candidate preview makes the swap chronology invalid
- **THEN** preview identifies the invalid candidate and creates no accepted trade, swap version, or partial import
