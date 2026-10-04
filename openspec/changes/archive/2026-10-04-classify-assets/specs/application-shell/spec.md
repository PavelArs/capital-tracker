## MODIFIED Requirements

### Requirement: SHELL-005 New sections with honest placeholders
The shell SHALL route Dashboard to `/dashboard`, Portfolio to `/portfolio`,
Transactions to `/transactions`, Wallets to `/wallets` and Settings to `/preferences`.
Each new section SHALL show its English title as the page heading. Portfolio SHALL
show the asset list defined by `asset-classification` (AST-3). Until the change that
builds it ships, Dashboard, Transactions and Wallets SHALL state that the section is
not built yet and link to the legacy screen that holds the same data (manual
accounts for Dashboard and Transactions; wallet addresses for Wallets). A
placeholder SHALL NOT claim the portfolio is empty, show invented numbers, issue API
requests or change data.

#### Scenario: SHELL-005-A Open each new section
- **GIVEN** a full owner session with existing accounts
- **WHEN** the owner opens Dashboard, Transactions and Wallets from the sidebar
- **THEN** each URL matches its section, the section is marked current and its heading is shown
- **AND** each page says it is not built yet and links to its legacy screen, which opens when followed
- **AND** no placeholder says "Your portfolio is empty" and opening placeholders issues no API request
- **WHEN** the owner opens Portfolio
- **THEN** it shows the Portfolio heading and the asset list, not a placeholder
