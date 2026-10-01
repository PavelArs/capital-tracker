## ADDED Requirements

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
