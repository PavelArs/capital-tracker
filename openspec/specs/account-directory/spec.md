# account-directory Specification

## Purpose
Present saved manual accounts first with explicit creation and valuation controls that preserve drafts and request identity.
## Requirements
### Requirement: DIRECTORY-001 Saved accounts lead the working entry
The private manual-account page SHALL lead with saved accounts, an honest loaded
count, existing account destinations and exclusive-cursor continuation. Creation and
valuation inputs SHALL be hidden initially behind clear actions. Loading, failure,
retry and empty states SHALL remain distinguishable; empty accounts SHALL NOT imply
known portfolio value. No account, legacy record or API SHALL be removed.

#### Scenario: DIRECTORY-001-A Browse a paged directory
- **GIVEN** real password/MFA authentication and more accounts than one API page
- **WHEN** the owner opens manual accounts
- **THEN** the directory appears before supplementary forms with the loaded count
- **WHEN** the owner loads the next page
- **THEN** every returned account appears once with its original link/name/revision
- **AND** names render as text and the count does not claim an unloaded total

### Requirement: DIRECTORY-002 Explicit creation with retained draft and retry
A “Новый счет” button SHALL expose an inline form and focus its name field. Closing
or Escape SHALL hide the form and return focus to the trigger without discarding its
name, error or retained request identity. Reopening/resizing SHALL NOT submit anything.
Success SHALL close the form and expose the created-account link even when catalog
paging does not currently contain that account. Existing private create semantics,
trimmed labels and explicit idempotent retry SHALL remain intact.

#### Scenario: DIRECTORY-002-A Draft and ambiguous committed response
- **GIVEN** an entered account name and a real committed create response lost in transit
- **WHEN** the owner closes/reopens the form and changes viewport width
- **THEN** the same entered name and mounted editor remain, with no implicit POST
- **WHEN** the owner explicitly submits the unchanged name again
- **THEN** the actual backend replays the same request ID with200 and no second account
- **AND** the success link remains usable after the form closes and reload preserves the account

### Requirement: DIRECTORY-003 Responsive bounded presentation
The account directory and supplementary actions SHALL be usable at360/768/1440px
without page-level horizontal overflow. Long names SHALL wrap without hiding their
identity. Keyboard focus and disclosure state SHALL be visible; existing real auth,
exact financial evidence and explicit operation recovery SHALL remain unchanged.

#### Scenario: DIRECTORY-003-A Compact directory and keyboard creation
- **WHEN** the authenticated owner opens/closes creation by keyboard at360/768/1440px
- **THEN** the action accurately reports its expanded state, hidden controls cannot
  receive focus, and the entered name survives
- **AND** navigation to an existing account remains usable without a provider request
