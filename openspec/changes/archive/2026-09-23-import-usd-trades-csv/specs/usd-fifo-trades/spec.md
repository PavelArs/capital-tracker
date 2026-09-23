## MODIFIED Requirements

### Requirement: TRADE-004 Atomic immutable corrections, voids and receipts
The system SHALL serialize all journal writes on the owned account row, check request
replay before CAS, and atomically append a complete version, change its head and advance
the journal revision after validating the entire candidate effective history. Correction
SHALL allow all execution fields to change. Void SHALL preserve a complete terminal
version; no restore/delete SHALL exist. Any negative historical prefix SHALL reject
the entire command even if final inventory is positive. Trade command identity SHALL
be unique owner/account/requestId across create/correct/void; canonical payload includes
kind, target, expected revision and execution. Receipts SHALL be immutable, never rewind
heads, and never claim to be current state. Limits SHALL be 1,000 active trades and
10,000 versions including voids; rejected commands consume no key or capacity.
Single-trade commands SHALL retain their existing behavior. An explicitly accepted
CSV command MAY append N consecutive version ordinals in one atomic transaction,
advancing the current journal revision by N only at commit. Its complete candidate
history SHALL be validated as a whole; source-row order MUST NOT become economic
chronology or imply separately committed intermediate FIFO snapshots. Batch command
identity SHALL remain separate from server-generated individual version keys.
The same active/version bounds SHALL apply without truncation or partial acceptance.

#### Scenario: TRADE-004-A Historical changes rebuild or roll back fully
- **GIVEN** the mandatory three-trade history
- **WHEN** the first buy gross changes from 100 to 120
- **THEN** realized becomes 230 and remaining cost stays 100; restoring gross 100 restores 250/100 while old versions remain readable
- **AND** valid changes of instrument, side, quantity, time and order rebuild all affected queues
- **WHEN** a consumed purchase is voided/reduced/moved after its sale, or an earlier sale exceeds holdings by one atom despite a later buy
- **THEN** 409 preserves the whole previous history and results
- **AND** voiding an unconstrained sale restores lots while preserving origin; correction/second void of a terminal void returns 409 except exact request replay

#### Scenario: TRADE-004-B Cross-process races and old replay
- **WHEN** two real processes race identical commands or different commands against one expected revision
- **THEN** identical commands commit one version and replay 200, while distinct commands have one 201 and one 409 with no overspend
- **AND** changed payload/kind/target under a used key returns 409
- **AND** old create/correct/void replay returns its original receipt before stale CAS without rewinding current state
- **AND** canonical decimal/UUID/time variants replay equivalently, while distinct accounts retain independent keys

#### Scenario: TRADE-004-C Commit failure and exact capacity
- **WHEN** a real deferred constraint fails after version/head/journal writes
- **THEN** commit returns safe generic 500, every accounting write/key rolls back, and private input/SQL does not appear in logs
- **AND** an independent nontransactional fixture probe proves the post-write path occurred; removal of the fixture allows explicit same-key retry once
- **WHEN** a command would create active trade 1001 or immutable version 10001
- **THEN** it returns 409 without partial mutation; exact boundaries 1000 and 10000 work, void history still counts and prior replay still works

#### Scenario: CSV-TRADE-001 Atomic version ranges preserve single-command semantics
- **WHEN** a source-ordered batch lists a sale before its chronologically earlier purchases
- **THEN** the complete valid candidate commits all N versions together and current reads see the final revision rather than an invalid provisional source prefix
- **AND** source links and the immutable batch receipt identify the complete accepted revision range
- **AND** every existing manual command, exact allocation, replay-before-CAS, cap, correction/void and coherent-read assertion remains passing across the internal persistence extraction
