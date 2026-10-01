# csv-workbench Specification

## Purpose
Guide CSV preparation and exact evidence review through accessible, responsive stages
while preserving explicit confirmation, original-command recovery and complete rollback.
## Requirements
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

### Requirement: CSV-PAGE-001 Authoritative instrument discovery
CSV mapping SHALL use the account page's owner-scoped instrument choices and authoritative server pagination state. Its first load-more action SHALL request the existing next cursor and add the next available choices without repeating an already displayed first page to initialize a private cursor. Equal names/symbols SHALL remain distinct UUID options. The action SHALL be hidden when the catalog is known to be exhausted and SHALL NOT change financial data, authentication or provider requests.

#### Scenario: CSV-PAGE-001-A Discover an exact instrument beyond the first page
- **GIVEN** an authenticated owner mapping an inspected CSV with 50 displayed instruments, a server next cursor and a target UUID on the next page
- **WHEN** the owner activates CSV load-more once
- **THEN** the account catalog loader requests that cursor and the exact target UUID becomes selectable with visible option progress
- **AND** existing choices and explicit column/source mappings remain unchanged

#### Scenario: CSV-PAGE-001-B Hide an exhausted catalog action
- **GIVEN** the account catalog has loaded its final page with no next cursor and no loading error
- **WHEN** the owner views CSV instrument mapping
- **THEN** no load-more action is offered and the loaded exact UUID choices remain selectable

### Requirement: CSV-PAGE-002 Catalog loading and retry preserve CSV intent
Catalog loading SHALL disable repeated catalog requests and show Russian loading feedback. A catalog failure SHALL retain existing choices and the authoritative cursor, expose Russian error feedback and permit explicit retry of the failed page. Loading, failure and retry SHALL preserve the selected File, column/source mappings, reviewed preview, saved receipts and original-command recovery; no CSV write or implicit command retry SHALL result from catalog discovery.

#### Scenario: CSV-PAGE-002-A Retry a failed next page without losing intent
- **GIVEN** an inspected CSV with an original selected File, explicit mapping and any retained receipt/recovery state, plus a catalog next cursor
- **WHEN** loading the next page fails and the owner explicitly retries
- **THEN** the same cursor is requested, existing choices and CSV intent remain intact, and only successful catalog completion adds choices
- **AND** no CSV command is sent and a second catalog action is unavailable while its request is pending

#### Scenario: CSV-PAGE-002-B Retry an initial catalog failure
- **GIVEN** the initial account instrument catalog request failed before a next cursor was known
- **WHEN** the owner retries catalog loading from CSV mapping
- **THEN** the account loader retries the first page, preserves the mapping and shows the resulting authoritative catalog state
