## ADDED Requirements

### Requirement: CVIS-001 Honest selected visibility lists
Authenticated Settings SHALL expose the existing database-backed currency preferences
as labeled native selected visible/hidden controls with related results and counts.
Initial failed or unfinished reads SHALL NOT claim an empty list or zero count.
Successful reads SHALL retain existing groups/catalogue status. List selection and
identity disclosure SHALL NOT fetch providers, reload data or change preferences.

#### Scenario: CVIS-001-A Recover an initial read failure
- **GIVEN** real password/MFA authentication and stored synthetic currencies
- **WHEN** one genuine list response is lost before reaching the browser
- **THEN** the screen reports an inline load error without a false empty list
- **WHEN** the owner explicitly reloads successfully
- **THEN** both saved lists and their exact counts become available, selection is announced and every financial/provider state is unchanged

### Requirement: CVIS-002 Explicit recoverable owner preference commands
Hide/show SHALL keep their existing authenticated owner-scoped API/storage semantics.
The UI SHALL prevent overlapping commands, preserve last-good lists during a request,
and move rows only from successful paired reads. Failures SHALL be visible and mark
last-good lists as potentially stale; another visibility command SHALL remain disabled
until an explicit successful reload resolves actual state. Obsolete completions SHALL
not replace current intent or steal focus after the owner has moved elsewhere.

#### Scenario: CVIS-002-A Resolve a committed command with a lost response
- **GIVEN** the owner starts hiding a stored system currency
- **WHEN** the real command commits but its genuine response is lost
- **THEN** the last-good row remains with an inline warning and disabled visibility actions, without an automatic command replay
- **WHEN** the owner explicitly reloads then shows the row again from the hidden list
- **THEN** actual PostgreSQL preference state and both displayed lists agree, only the owner's intended preference changes, and no accounting/provider state changes
- **AND** non-system rows cannot initiate unsupported hide commands and inactive catalogue status remains distinct from visibility

### Requirement: CVIS-003 Readable exact catalogue evidence
The view SHALL clearly scope preferences to the legacy catalogue, separately from
accounting instruments, exchange rates and network support. Stored identities and
contracts SHALL be fully accessible without truncation or HTML execution. At360,768
and1440pixels in both themes, actions SHALL be at least44px high, focus visible and
wide tables keyboard-scrollable within named regions without page overflow.

#### Scenario: CVIS-003-A Inspect responsive preferences and full identities
- **GIVEN** visible and hidden synthetic rows with a full contract and a literal hostile-looking name
- **WHEN** the owner switches lists, opens identity details and uses narrow-table keyboard scrolling across both themes and three widths
- **THEN** exact stored identity/contract, catalogue state and intended row action remain readable without script execution, extra requests, preference changes or page overflow
- **AND** returning through Settings preserves database preferences while the existing real FX journey retains its exact conversion and explicit-provider-collection behavior
