## ADDED Requirements

### Requirement: PRICE-1 Exact reviewed manual points
The system SHALL store reviewed dated USD unit-price strings for an owned manual
instrument UUID without floating-point conversion or symbol inference. Valid
finite nonnegative prices up to48 integer/30 fractional digits and UTC millisecond
timestamps1970..9999 SHALL normalize exactly. It SHALL label manual provenance,
retain immutable set/void versions and distinguish explicit zero from absent data.

#### Scenario: PRICE-EXACT Identity, time and precision
- **GIVEN** two instruments sharing a symbol, an empty price book and an exact price0.000000000000000000000000000001
- **WHEN** the owner saves that price at an offset-equivalent UTC instant for the first instrument and saves zero at a later instant
- **THEN** only that UUID has two exact dated points, source manual and USD/unit labels; the other instrument remains empty and no provider call occurs.

#### Scenario: PRICE-REPAIR Correct, void and restore
- **GIVEN** a point at2025-01-01 priced100
- **WHEN** reviewed commands correct it to110, void it, and restore it to120
- **THEN** effective reads show only the latest set or no point when voided; all four original receipts remain in history and zero is never used as deletion.

### Requirement: PRICE-2 Durable command safety
The system SHALL use per-instrument PostgreSQL serialization and optimistic revision
checks, preserve identical idempotent command receipts across later writes and
reject reused UUID with changed canonical payload. It SHALL cap each book at10000
versions without removing history; valid replay SHALL still work at that cap.

#### Scenario: PRICE-RACE Concurrent writes and replay
- **GIVEN** two real database connections submit distinct commands at the same current revision
- **WHEN** they contend for the owned instrument
- **THEN** exactly one commits201 and the other conflicts409; unchanged retry returns its original receipt200, while altered content conflicts and old rows remain unchanged.

#### Scenario: PRICE-BOUND Exhaustion and validation
- **GIVEN** malformed input, a stale revision, a missing point to void or a book at10000 versions
- **WHEN** a new command is submitted
- **THEN** invalid syntax is400, state/exhaustion is409, no row changes and an existing identical command remains replayable.

### Requirement: PRICE-3 Coherent private database reads
The system SHALL read effective points and immutable history only from PostgreSQL
in an owner-scoped RR READ ONLY snapshot. Effective paging SHALL occur after latest
version/void projection, sorted by timestamp descending; nonzero offsets SHALL
require a matching current revision. It SHALL preserve existing authentication,
MFA, CSRF, origin and no-store boundaries and return404 for unknown/foreign IDs.

#### Scenario: PRICE-PAGES Current projection and immutable history
- **GIVEN** a corrected point, a voided point and more than one effective page
- **WHEN** the owner reads pinned pages and per-point revision history
- **THEN** each effective point appears once, no void head appears, original versions remain paged in descending revision and concurrent edits invalidate old continuation with409.

#### Scenario: PRICE-SNAPSHOT Actual concurrent correction
- **GIVEN** an actual PostgreSQL read paused after establishing its snapshot
- **WHEN** another connection commits a correction
- **THEN** the paused read contains wholly the old revision/points and the next read contains wholly the new state, with no writes/provider calls from reads.

#### Scenario: PRICE-PRIVATE Denials and preservation
- **GIVEN** anonymous/pending-MFA clients, invalid CSRF/origin, foreign instrument or malformed query
- **WHEN** prices are read or changed
- **THEN** existing401/403,404 or400 denials apply with private no-store errors, and no existing accounting data or denied price row changes.

### Requirement: PRICE-4 Honest Russian editing and migration
The system SHALL provide a protected Russian price editor with full instrument
paging, exact values, explicit review, historical versions/void controls and
manual isolated-point limitations. It SHALL discard stale async results, require
refresh on revision conflict and retain unchanged ambiguous commands for safe
explicit retry. Migration SHALL add storage without rewriting prior data.

#### Scenario: PRICE-UI Real edit, history, void and reload
- **GIVEN** an owner logged in with actual password/MFA
- **WHEN** they save, correct, inspect history and void an instrument price then reload
- **THEN** the browser reflects persisted exact values/history and no active quote after void, with review reset on edits and no backend/authentication mocks.

#### Scenario: PRICE-RECOVERY Stale intent and uncertain delivery
- **GIVEN** an actual save response is lost after commit or a price read is delayed
- **WHEN** the owner explicitly retries the unchanged command or selects another instrument
- **THEN** retry returns the original receipt without duplication, and the delayed old result cannot populate the new selection; refresh failure cannot relabel a successful save as failed.

#### Scenario: PRICE-MIGRATION Populated upgrade
- **GIVEN** populated isolated migration17 data and recorded row fingerprints
- **WHEN** migration18 is applied and rerun
- **THEN** all previous rows are unchanged, the empty new schema enforces ownership/exactness constraints and destructive automatic downgrade is refused.
