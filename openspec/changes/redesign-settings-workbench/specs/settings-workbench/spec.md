## ADDED Requirements

### Requirement: SETTINGS-UX-001 Accessible focused section navigation
Settings SHALL expose its three existing destinations in a named native-button group with explicit selected state, a related content region and visible keyboard focus. General language/theme controls SHALL have associated visible labels and retain existing selection/persistence behavior. Inactive currency and FX panels SHALL remain unmounted; merely opening general settings or adjusting preferences SHALL NOT read or collect FX. Legacy currency visibility SHALL remain available with an honest scope notice.

#### Scenario: SETTINGS-UX-001-A Navigate and adjust preferences
- **GIVEN** a real HTTPS/password/MFA session with PostgreSQL
- **WHEN** the owner opens Settings and uses the labeled language/theme controls and keyboard section buttons
- **THEN** the correct section is announced as selected, preferences update, and all three destinations remain reachable
- **AND** before FX activation there is no FX read/collect request or provider call and existing financial data is unchanged

### Requirement: SETTINGS-UX-002 Separate saved conversion from external collection
The converter SHALL associate exact nonnegative USD amount guidance, including zero, with its input and distinguish database-only calculation/refresh from explicit external collection. Freshness, failures, missing data, original attribution and UTC evidence SHALL remain visible. The exact result table SHALL precede observation timestamps while retaining semantic rows, caption and a named keyboard-focusable contained scroll area. Original guards, raw values, stale-intent invalidation and financial/provider boundaries SHALL remain unchanged.

#### Scenario: SETTINGS-UX-002-A Calculate from stored data and collect explicitly
- **WHEN** the owner activates FX, explicitly collects the first daily observation and converts USD123.45
- **THEN** initial activation reads stored data only and reports unavailable; collection alone makes the provider call
- **AND** the result shows exact EUR111.105 and RUB11125.314 before publication/fetch evidence with attribution and unchanged financial rows

#### Scenario: SETTINGS-UX-002-B Preserve stale intent and last-good conversion
- **WHEN** a genuine backend read for123.45 is delayed and the owner changes the amount to200
- **THEN** the old result cannot replace the new intent and the explicit new read returns EUR180/RUB18024 without provider calls
- **WHEN** a later explicit due collection fails
- **THEN** the last-good exact conversion remains with visible stale/failure context and original request limits

### Requirement: SETTINGS-UX-003 Responsive preferences and exact FX evidence
At360,768and1440pixels in light/dark themes, general settings and the FX converter SHALL avoid page-level horizontal overflow and keep primary buttons/inputs/selects at least44px high. The section selector SHALL remain fully available without horizontal navigation scrolling. Wide exact tables SHALL scroll within their named keyboard-focusable region. Theme, layout and presentation actions SHALL NOT mutate financial data or trigger provider requests.

#### Scenario: SETTINGS-UX-003-A Inspect general settings and converted values
- **GIVEN** the normal general controls and a saved exact FX conversion
- **WHEN** both themes and all three viewport widths are inspected and the narrow table is scrolled with the keyboard
- **THEN** selected state, field guidance, primary actions, exact results and timestamp/source evidence remain readable and reachable
- **AND** financial fingerprints, provider counts and current conversion intent are preserved
