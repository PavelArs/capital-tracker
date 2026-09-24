## ADDED Requirements

### Requirement: Legacy liability bookmarks explain retirement
The application SHALL replace the legacy liability editor with a Russian retirement
notice under the existing authenticated layout, covering `/liabilities` and nested
paths. It SHALL state that saved records were not deleted and link to manual accounts.

#### Scenario: LIR-UI owner follows a retired bookmark
- **GIVEN** the owner completed real password and MFA authentication
- **WHEN** the owner opens `/liabilities` or a nested legacy bookmark
- **THEN** the page shows `Раздел обязательств закрыт` and `Сохранённые записи не удалены.`
- **AND** `Перейти к ручным счетам` opens the working manual-accounts page
- **AND** no liability navigation entry, editor, list or chart is rendered

### Requirement: Retirement does not fetch or mutate financial data
The notice SHALL perform no business API request or provider request. Navigation
through it SHALL preserve all persisted business rows, including legacy liabilities.

#### Scenario: LIR-UI persisted owner and foreign records survive retirement
- **GIVEN** representative owner and foreign liabilities exist in real synthetic PostgreSQL
- **WHEN** the authenticated owner visits both retired bookmarks and follows the accounts link
- **THEN** full business-table fingerprints are unchanged, excluding only auth sessions and request limits
- **AND** the notice initiates no business API request and the journey adds no provider request

### Requirement: Preserved liability API remains private and owner-scoped
The frontend retirement SHALL NOT remove or alter liability backend routes, guards,
storage, or shared dashboard metrics and category labels.

#### Scenario: LIR-UI existing read and privacy characterization stays passing
- **GIVEN** an owner liability and a foreign liability exist
- **WHEN** the fully authenticated owner requests the liability list and own record
- **THEN** responses are 200 with no-store, the own record is intact, and the list excludes the foreign record
- **AND** requesting the foreign record yields 404 with no-store
- **AND** anonymous and password-only sessions receive 401 with no-store from the liability API
- **AND** anonymous and password-only browser visits to retired bookmarks redirect to login

### Requirement: Manual portfolio valuation remains available after retirement
Removing liability frontend code SHALL preserve the existing selected manual-account
valuation journey and its exact financial, coverage and stale-response behavior.

#### Scenario: MPV-UI retained portfolio characterization passes
- **GIVEN** the existing real manual-portfolio browser fixture
- **WHEN** the selected MPV-UI acceptance scenario runs through HTTPS and PostgreSQL
- **THEN** all its existing exact-value, incomplete-coverage and stale-response assertions pass unchanged
