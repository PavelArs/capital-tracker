## ADDED Requirements

### Requirement: CSVUX-001 Observable import stages and field guidance
The CSV workbench SHALL expose an ordered file, mapping and review guide with its
current step derived from existing state. A valid inspection SHALL select mapping;
a preview or accepted batch SHALL select review; otherwise file SHALL be current.
The guide SHALL NOT perform actions or imply automatic confirmation. Mapping SHALL
group columns, exact source values and numeric/time interpretation, with associated
Russian descriptions for total amounts, explicit fee zero, optional USD currency,
decimal/time offset and same-time order. Existing labels/options/validation SHALL remain.

#### Scenario: CSVUX-001-A Follow an explicitly reviewed import
- **GIVEN** a real owner with an initialized account
- **WHEN** the owner selects/uploads, inspects/maps and previews the sale-first file
- **THEN** the guide changes from file to mapping to review and the field descriptions explain exact interpretation
- **AND** preview creates no trades and explicit confirmation retains exact250/100/0.5 results

### Requirement: CSVUX-002 Secondary identity and visible operational evidence
Selected-batch IDs/hash SHALL be available in a native keyboard disclosure closed by
default. Status, historical receipts, errors, unresolved-request guidance, original
retry and complete rollback consequences SHALL remain visible outside that disclosure.
Presentation interactions SHALL preserve original File, mapping, reviewed state and
financial rows with no requests/writes caused by opening details or changing viewport.

#### Scenario: CSVUX-002-A Inspect identity without changing intent
- **GIVEN** a selected batch with populated mapping and a valid preview
- **WHEN** the owner opens/closes the identity disclosure using the keyboard
- **THEN** exact saved batch ID/hash are readable and the same mapping/preview remains usable
- **AND** financial rows and provider-call counts stay unchanged

#### Scenario: CSVUX-002-B Retain original recovery and conditional rollback
- **WHEN** a real committed confirm or rollback response is lost and the owner returns through the SPA
- **THEN** original-command retry remains available with unchanged payload and no duplicate versions
- **AND** explicit current eligible rollback review still requires its checkbox and preserves original source/history

### Requirement: CSVUX-003 Responsive exact CSV evidence
File, mapping, preview and batch/provenance views SHALL fit360/768/1440px in both themes
without page-level horizontal overflow. Wide tables SHALL use contained scrolling;
literal whitespace, exact strings, unknown values and completeness SHALL remain intact.
Text/select/action/disclosure targets SHALL be at least44px high; native assertion
checkboxes SHALL retain compact shape and full associated labels.

#### Scenario: CSVUX-003-A Review populated fields and evidence at each width
- **WHEN** the owner changes theme/viewport with an inspected mapping and then a reviewed candidate
- **THEN** groups, hints, warnings, actions and exact evidence remain readable and drafts remain unchanged
- **AND** full import/restart/provenance/rollback and original-command recovery characterization remains passing
