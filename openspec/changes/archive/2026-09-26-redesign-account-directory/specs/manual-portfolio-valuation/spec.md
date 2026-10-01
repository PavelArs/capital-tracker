## MODIFIED Requirements

### Requirement: MPV-3 Russian selection and trustworthy asynchronous results
The manual-accounts page SHALL offer explicit account selection and UTC preview,
exact per-account/aggregate values, coverage explanations and manual-subset caveats.
Editing selection/time or leaving the view SHALL invalidate older pending results
without disturbing account creation or catalog paging. The supplementary panel SHALL
start collapsed and offer a clear valuation action. Collapsing the panel SHALL only
hide it, preserving selection, time and current results without changing the intent
or issuing another request; page navigation SHALL still invalidate older responses.

#### Scenario: MPV-UI Exact display and stale intent
- **GIVEN** real login with MFA, multiple manual accounts and stored exact prices
- **WHEN** the owner selects accounts and explicitly requests a preview
- **THEN** the Russian summary/table show the exact sum and any missing-data reasons
- **WHEN** a real response is delayed and the owner changes selection or time
- **THEN** the old result stays cleared and cannot overwrite the new intent; only an explicit fresh preview supplies a result.

#### Scenario: MPV-UI-DISCLOSURE Preserve a deliberate valuation
- **GIVEN** a real exact selected-account preview
- **WHEN** the owner collapses and reopens the valuation panel
- **THEN** selected accounts, UTC time, exact result and missing-data explanations remain
- **AND** no extra preview or business mutation is issued
