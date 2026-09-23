## MODIFIED Requirements

### Requirement: OPEN-003 Atomic idempotent opening revisions
Creation requests SHALL require UUIDv4 requestId with owner-scoped resource uniqueness.
Same canonical payload SHALL return original 200, new creation 201, conflicting payload 409.
Opening request keys SHALL be unique per owner/account/requestId. Owner foreign keys
SHALL reference users rather than the removable singleton binding. Opening requests
SHALL contain a raw JSON integer expectedRevision and 1..100 distinct owned instruments.
The system SHALL serialize on the account, replay an existing request before CAS,
atomically append the complete next snapshot and update current pointer, preserving
all old revisions. Replay MUST NOT rewind the pointer. No DELETE SHALL be exposed. New opening writes SHALL refuse 409 after an explicit
trade journal exists, under the same owned account lock used by journal initialization.
Existing request replay SHALL retain its original semantics. Declared-empty journal eligibility SHALL
require absence of ALL opening history, not merely a NULL current pointer. Separately,
explicit known-cost carry-in SHALL pin the current immutable opening revision and
reconcile owner-supplied original lots under CARRY-001..006; no automatic conversion
SHALL occur. The same journal dependency SHALL block later new opening snapshots
while retaining all old opening receipts and historical rows.

#### Scenario: OPEN-003-A Retries and competing replacements preserve provenance
- **WHEN** identical requests race, changed payload reuses a key, or different keys race on one expectedRevision
- **THEN** identical retries create one snapshot, changed payload 409, and competing replacements have exactly one 201 and one 409
- **AND** replaying an old request after a newer revision returns its original snapshot 200 without changing the current pointer
- **AND** decimal-zero normalization, equivalent UTC offsets and reordered positions replay the same canonical request, while rejected batches consume no request key
- **AND** uppercase UUID spellings replay equivalently, but mixed-case duplicate instrument IDs in one positions array return 400
- **AND** string/boolean/object expectedRevision values return 400 before coercion
- **AND** account-creation replay retains its original id/name/createdAt while reporting the live currentRevision without moving its pointer
- **AND** old rows remain identical and a failed position leaves no partial snapshot or pointer update
- **AND** an actual deferred commit failure returns safe generic 500 with accounting rows and request identity rolled back, without private values in logs
- **AND** rollback assertions permit only the preceding valid private-session lastSeenAt touch outside the accounting transaction

#### Scenario: OPEN-003-B History and empty initialization are bounded
- **WHEN** an empty account receives expectedRevision 0 or saved history is requested
- **THEN** initialization creates revision 1 and replacements contain the entire position set rather than adding quantities
- **AND** descending history uses exclusive revision cursor default 10 / max 20, at most 100 positions per snapshot

#### Scenario: OPEN-003-C Journal dependency protects the opening baseline
- **WHEN** a journal has been explicitly initialized, even if all its trades are void
- **THEN** a new opening write returns 409 without creating a snapshot or moving the pointer
- **AND** the account UI explains journal dependency instead of offering a misleading empty-opening editor
- **AND** a first-opening-versus-declared-empty-initialization race commits exactly one model under the common account lock
- **AND** an opening-replacement-versus-carry-in-initialization race at one expected opening revision commits exactly one new command, preserving the earlier opening in either outcome
