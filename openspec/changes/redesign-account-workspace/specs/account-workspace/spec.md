## ADDED Requirements

### Requirement: WORKSPACE-001 Focused account sections
An authenticated manual account SHALL provide Операции, Аналитика and Начальные данные sections with operations selected initially. Controls SHALL expose selection and their controlled section, be keyboard operable and remain usable at360/768/1440px without page-level horizontal overflow. Hidden controls SHALL leave the focus order. Actual auth, eligibility checks, exact values and private account boundaries SHALL remain unchanged.

#### Scenario: WORKSPACE-001-A Select an account task
- **GIVEN** actual password/MFA authentication and a persisted manual account
- **WHEN** the owner opens the account
- **THEN** operations are visible and historical-analysis/setup inputs are hidden
- **WHEN** the owner activates another section with the keyboard
- **THEN** only that section is visible, selection is exposed and focus stays on its button
- **AND** opening a different account cannot expose the previous account's drafts or results

### Requirement: WORKSPACE-002 Retain state and explicit recovery
Section selection and resize SHALL preserve mounted drafts, analytical inputs/results and mutation request identity without submitting a command, rerunning analysis or bypassing eligibility/conflict locks. Journal errors and original-request recovery SHALL remain reachable when a different section is selected. Page departure and actual journal revision changes SHALL retain their established result-invalidation rules.

#### Scenario: WORKSPACE-002-A Draft, analysis and committed response loss
- **GIVEN** an entered trade draft and an explicitly calculated historical result
- **WHEN** the owner switches among all sections and resizes
- **THEN** the same editor nodes, exact draft and calculated result remain without extra commands or analysis
- **WHEN** an explicitly submitted real trade commits but its response is lost
- **THEN** the draft is frozen and the original request remains recoverable after switching
- **WHEN** the owner explicitly retries
- **THEN** the backend replays the same identity and PostgreSQL contains one trade/version

### Requirement: WORKSPACE-003 Honest initial-data scope
Setup SHALL identify the saved opening snapshot as Сохраненные начальные позиции, show its revision and coverage boundary and explain that it is not current journal holdings. Known decimal values and unknown cost SHALL remain exact; setup access SHALL NOT permit opening replacement after journal initialization.

#### Scenario: WORKSPACE-003-A Inspect saved initial data
- **GIVEN** saved opening positions and a subsequently initialized journal
- **WHEN** the owner selects Начальные данные
- **THEN** the opening snapshot retains its original quantity/cost/revision/time with the explicit initial-data label
- **AND** current journal lots remain separate and opening replacement stays unavailable
