## ADDED Requirements

### Requirement: DFX-1 Exact daily indicative conversion from stored data
The system SHALL persist attributed daily USD/EUR/RUB observations and convert the
owner's entered USD amount exactly using the latest saved batch. It SHALL preserve
publication/fetch times, distinguish unavailable/stale data from zero, and SHALL
NOT use current FX as historical accounting data or mutate USD calculations.

#### Scenario: DFX-EXACT Stored conversion and replay
- **GIVEN** a valid daily batch with EUR0.9 and RUB90.12 perUSD1
- **WHEN** the owner converts USD123.45 from PostgreSQL
- **THEN** the exact results are EUR111.105 and RUB11125.314, with source/timestamps
- **AND** repeat collection of the identical publication creates no duplicate or rewrite; zero USD converts to known zero and a missing observation never does.

#### Scenario: DFX-PRECISION Unsupported or incomplete observations
- **WHEN** upstream returns missing RUB, a nonpositive/rounded-unrepresentable rate, malformed JSON, wrong base, invalid publication/next/EOL time or a changed existing publication
- **THEN** the entire new batch is rejected, original data remains and the read reports stale/unavailable with a generic collection failure.

### Requirement: DFX-2 Opt-in bounded collection across replicas
Collection SHALL default off, use one fixed HTTPS endpoint with no key/paid path,
bounded timeout/body and no redirects. Persistent PostgreSQL leases and attempt
budgets SHALL coordinate replicas/restarts: successful collection at most daily,
at most3 attempts per rolling24h window, >=20min failure cooldown and respect for
Retry-After. Expired workers SHALL NOT publish data or overwrite current health.

#### Scenario: DFX-COLLECT Race, outage and restart
- **GIVEN** enabled replicas competing to collect one due publication
- **WHEN** both collect concurrently and requests are replayed after restart
- **THEN** one outbound call obtains the lease and duplicate/early calls are suppressed
- **WHEN** upstream fails or returns429
- **THEN** last-good observations survive and persisted cooldown/budget prevents a retry burst, including after process restart.

#### Scenario: DFX-FENCE Lease expiry and atomic failure
- **GIVEN** an expired worker, a new lease holder or a failing database commit
- **WHEN** the old or unsuccessful worker tries to publish
- **THEN** no partial/replaced observation is visible and no newer collection result is overwritten; the previously reserved attempt is not refunded.

### Requirement: DFX-3 Private database-only owner display
The system SHALL provide a Russian private Settings converter with attribution,
exact values and explicit freshness/errors. Viewing, converting, changing amount
and refreshing the saved result SHALL make zero provider calls and no business-data
writes. Only an explicit protected refresh or enabled scheduled collection may call
the provider. No general/public rate feed or export SHALL be introduced.

#### Scenario: DFX-PRIVATE Authentication and provider boundary
- **WHEN** anonymous/MFA-pending clients read or refresh, or a signed-in client omits CSRF or sends a URL/unknown field
- **THEN** actual backend401/403/400 denies the request with private no-store responses and no provider/business-data effects
- **WHEN** the admitted owner reopens the converter or changes the USD amount
- **THEN** exact database results return with unchanged provider counters and stored financial data.

#### Scenario: DFX-UI Real collection, failure and stale intent
- **GIVEN** actual password/MFA login, PostgreSQL and a controlled external provider
- **WHEN** the owner explicitly collects then converts USD123.45 in Settings
- **THEN** the exact table, daily publication/fetch times, attribution and freshness are shown
- **WHEN** a subsequent allowed collection fails
- **THEN** the last good conversion remains visible with a stale indication
- **WHEN** a real read response is delayed and the amount changes
- **THEN** the old result cannot overwrite the new intent.

### Requirement: DFX-4 Additive migration and bounded verification
The schema change SHALL preserve prior user/financial/authentication rows and
require explicit migration execution. No destructive downgrade or production
deployment is authorized. Existing accounting/chart checks SHALL stay passing.

#### Scenario: DFX-MIGRATE Fresh and populated predecessor
- **WHEN** the actual CLI migrates an empty database or a populated schema18 fixture to19 and reruns
- **THEN** the new tables are available, prior data/schema/session state is unchanged, rerun is a no-op and downgrade refuses destruction.
