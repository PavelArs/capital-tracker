# journal-context Specification

## Purpose
Keep journal context compact and keyboard accessible while preserving exact accounting
explanations, initialization guidance, mounted drafts and explicit recovery.

## Requirements
### Requirement: CONTEXT-001 Compact initialized journal with exact details
An initialized account's operations SHALL initially show the short notice «Учёт операций в USD. Без рыночной оценки.» and a closed native disclosure «Параметры и правила учёта». The existing initialization explanation, exact journal revision/UTC coverage, active-trade/version counts and limits,30-decimal allocation explanation and full accounting-scope caveat SHALL remain available inside it without truncation. Opening or closing it SHALL be keyboard operable, retain focus on its summary and fit360/768/1440px without page-level horizontal overflow.

#### Scenario: CONTEXT-001-A Read details on demand
- **GIVEN** real password/MFA authentication and an initialized journal with a persisted trade
- **WHEN** the owner opens operations
- **THEN** the short notice and workflow/editor are visible, and detailed revision/capacity prose is hidden
- **WHEN** the owner activates the disclosure using the keyboard
- **THEN** exact revision1, coverage2025-01-01T00:00:00.000Z, trade1/1000, version1/10000 and the original allocation/scope explanations are visible
- **WHEN** the owner closes it
- **THEN** the details become hidden, focus remains on the summary and the workflow/editor stays available

### Requirement: CONTEXT-002 Preserve intent while reading context
Disclosure toggles, section/workflow switches and resize SHALL preserve editor nodes, independent exact drafts, the selected CSV File and financial guards without implicit accounting requests or provider calls. Ordinary re-renders SHALL preserve the disclosure's open state and show current journal values; actual account remount SHALL start closed. Existing auth and account isolation SHALL remain in force.

#### Scenario: CONTEXT-002-A Read context without changing operations
- **GIVEN** independent trade/swap/reward drafts and an unuploaded CSV File
- **WHEN** the owner opens/closes context and switches sections/workflows at the supported widths
- **THEN** all exact drafts and the same File/editor nodes remain, without automatic accounting reads/writes or provider changes
- **AND** returning to operations retains the disclosure state chosen for that mounted journal

### Requirement: CONTEXT-003 Preserve initialization and actionable recovery
The initialization explanation SHALL remain visible before the uninitialized journal's explicit actions. Errors, journal conflicts, receipts and original-request retry SHALL remain outside the collapsed disclosure and account sections. Hiding context SHALL NOT hide or bypass any existing initialization, stale-review or unresolved-command guard.

#### Scenario: CONTEXT-003-A Initialize and recover explicitly
- **GIVEN** an uninitialized account
- **WHEN** the owner opens operations
- **THEN** the original initialization warning and permitted explicit initialization action remain visible, without an initialized-context disclosure
- **GIVEN** a submitted trade committed by the actual backend with its response lost
- **WHEN** the owner closes context or changes account sections
- **THEN** the draft stays frozen and original-request retry remains visible and explicit
- **WHEN** the owner retries
- **THEN** the original receipt is replayed without a duplicate financial effect
