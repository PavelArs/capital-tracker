# external-usd-flows Specification

## Purpose
Record explicitly reviewed external USD contributions and withdrawals separately
from asset operations, with exact period totals, immutable evidence, private
owner access and safe recovery of original commands.
## Requirements
### Requirement: FLOW-001 Explicit external USD declarations
The system SHALL require an initialized owner-scoped flow journal with an explicit
coverage boundary and literal review. Each contribution/withdrawal SHALL be a positive
exact USD amount, explicit execution time at or after coverage, and literal external
attestation. It SHALL distinguish owner-declared unreconciled cash flows from asset
balances, trades, internal transfers, opening holdings and investment profit. No old
operation or absence of records SHALL silently establish external-flow history.

#### Scenario: FLOW-001-A Recorded contributions are not investment profit
- **GIVEN** declared coverage2025-01-01T00:00:00Z and the real authenticated owner
- **WHEN** they record contribution1000 onJan2, withdrawal250 onJan3 and a distinct contribution0.000000000000000000000000000001 onJan4
- **THEN** the period[Jan1,Jan5) returns contributions1000.000000000000000000000000000001, withdrawals250, net750.000000000000000000000000000001 and count3
- **AND** the API/UI identify recorded external USD flows and unreconciled completeness, without returning portfolio value or investment-profit fields
- **AND** all account positions, opening/FIFO/CSV rows and old receipts remain unchanged; a covered trade does not add a cash flow

#### Scenario: FLOW-001-B Exact strict classification and declared coverage
- **WHEN** a caller submits unknown keys, raw numeric amounts, zero/negative/overflow amounts, non-USD/internal-transfer directions, invalid dates or missing external attestation
- **THEN** the route returns private400 and reserves no command key
- **WHEN** a valid flow precedes declared coverage or a period begins before coverage, or the journal is absent
- **THEN** it returns409 rather than inventing zero history
- **AND** an initialized covered period with no active records returns exact recorded zeros and an explicit unreconciled status

### Requirement: FLOW-002 Immutable atomic revisions and exact retry
The system SHALL append immutable flow versions and advance the locked owner journal
atomically. It SHALL support correction and terminal void, preserve original receipts,
and replay accepted canonical commands before mutable state/capacity checks. Distinct
legitimate equal-time/equal-value flows SHALL remain distinct. Rejected commands SHALL
reserve nothing. The design's exact owner-scoped key, bounds and wire contract apply.

#### Scenario: FLOW-002-A Correction, void and original receipt preservation
- **GIVEN** an accepted contribution1000 and withdrawal250 with distinct command keys
- **WHEN** the contribution is corrected to1200 and then the withdrawal is voided
- **THEN** the period net progresses750 ->950 ->1200 with current revisions explicit
- **AND** original create/correction/void receipts replay byte-for-byte, version history remains intact and the void cannot be corrected or restored
- **AND** a new key for a second legitimate identical contribution creates a separate flow, while the accepted original key never duplicates it

#### Scenario: FLOW-002-B Real concurrent writes and transaction failure
- **GIVEN** real independent PostgreSQL sessions competing for the same owner journal
- **WHEN** identical commands race, or different commands use the same expected revision
- **THEN** one version is accepted; the identical caller receives the same receipt, or the different stale caller receives409 with no reserved key
- **WHEN** an injected synthetic deferred COMMIT failure follows the version insert and journal advance
- **THEN** both writes roll back, a private failure reveals no details, and explicit original-command retry subsequently creates exactly one version
- **AND**1000 active flows and10000 versions are independently bounded, void frees only active capacity, and accepted replay works at either cap

### Requirement: FLOW-003 Exact coherent period and version reads
The system SHALL calculate all current nonvoid flows in UTC[from,to), with exact
scale30 integer arithmetic and complete totals before bounded pagination. Every
response SHALL use one caller-owned read-only REPEATABLE READ transaction. Positions
and investor cash flows SHALL remain separate. Continuations SHALL pin journal revision;
immutable version pages SHALL preserve old financial evidence.

#### Scenario: FLOW-003-A Boundaries, restated times and consistent pages
- **GIVEN** contributions10 exactly atfrom,20 strictly inside,30 exactly atto and a withdrawal5 inside, with limit1
- **WHEN** all pinned pages and an out-of-range page are read
- **THEN** every page reports contributions30, withdrawals5, net25 and count3; only the first three in-range effective records appear once, ordered by UTC time then UUID
- **WHEN** a correction moves the20 contribution toexactlyto, or an included flow is voided
- **THEN** the next read restates totals and an old pinned continuation returns409
- **AND** equal-time distinct IDs, one-atom values and1000 maximum-precision amounts remain exact without floating-point conversion

#### Scenario: FLOW-003-B Snapshot and no-mutation evidence
- **GIVEN** a real reader paused after its snapshot is established and a competing correction commits
- **WHEN** the reader continues loading versions and computes totals
- **THEN** it returns the complete old revision/state and a new read returns the complete new revision/state
- **AND** all reads preserve accounting/original receipts/import bytes, create no provider requests, and only documented authenticated session/admission bookkeeping changes

### Requirement: FLOW-004 Protected Russian intent and recovery
The system SHALL expose the Russian form and explicit review in the design through
real owner/password/MFA admission. It SHALL reject anonymous/pending sessions, invalid
Origin/CSRF and foreign flow references without disclosure. It SHALL invalidate late
period responses and stale pages while preserving unsaved command intent. Ambiguous
writes SHALL retain the full original command through SPA/auth recovery, allow only
explicit same-command retry and block new writes; known acceptance SHALL never become
an ambiguous command solely because a current read failed.

#### Scenario: FLOW-004-A Actual entry, correction and review
- **GIVEN** the owner signs in with actual password and MFA
- **WHEN** they initialize coverage, explicitly attest and save a contribution, inspect a period, correct the amount and inspect versions
- **THEN** the Russian UI shows exact recorded amounts/revisions and original history, sends no automatic business write and makes no provider request
- **AND** editing the period or receiving a real stale continuation cannot restore mixed or late data or reset an unsaved correction

#### Scenario: FLOW-004-B Lost delivery and private admission
- **GIVEN** a server-accepted flow whose actual response delivery is lost
- **WHEN** the owner navigates away/back or encounters real401 followed by MFA and explicitly retries
- **THEN** the complete original key/target/payload is retained, exactly one flow exists and no automatic POST occurs
- **AND** an accepted receipt remains visible through failed current reads and new writes remain blocked until explicit successful refresh
- **WHEN** anonymous/pending clients, invalid Origin/CSRF, malformed bodies/queries or foreign identities exercise the new route families
- **THEN** their private401/403/400/404 refusals preserve accounting data and documented authentication boundaries

### Requirement: FLOW-005 Additive storage and bounded verification
Migration17 SHALL add only the two reviewed exact flow tables and constraints. It
SHALL preserve prior financial/authentication rows, original imports/receipts,
immutable lots and schema objects; no backfill, destructive down or owner-data reset
is permitted. The scoped verification manifest SHALL exercise real HTTPS/PostgreSQL,
retain relevant passing characterizations and distinguish unrun full-suite checks.

#### Scenario: FLOW-MIG-001 Populated sixteen-migration predecessor survives
- **GIVEN** a populated sixteen-migration synthetic database with carry-in lots, corrected/void trades, CSV originals and owner/MFA/session/admission state
- **WHEN** actual migration17 and replay run from the release image
- **THEN** old rows/schema/provenance remain byte-for-byte equivalent apart from the new migration ledger entry, both new tables start empty and replay changes nothing
- **AND** finite/positive numeric and time constraints, composite owner/history keys and RESTRICT relations reject invalid writes
- **AND** fresh17 and retained destructive-history preflight refusals pass without accessing the owner's database or deploying production
