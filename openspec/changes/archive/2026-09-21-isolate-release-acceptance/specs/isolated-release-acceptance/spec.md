## ADDED Requirements

### Requirement: ISO-003 Real HTTPS login and private access characterization
Acceptance tests SHALL exercise production-mode release images via an HTTPS proxy,
real authentication and PostgreSQL. Only external providers MAY be stubbed.

#### Scenario: ISO-003-A Anonymous private API denial
- **GIVEN** the synthetic migrated application and an unauthenticated client
- **WHEN** private profile and wallet endpoints are requested directly through HTTPS
- **THEN** they return 401 without portfolio data
- **AND** the login page is available

#### Scenario: ISO-003-B Browser login uses the real password
- **GIVEN** an externally seeded synthetic verified owner with a real password hash
- **WHEN** the browser submits that owner's email and password via the login form
- **THEN** the application authenticates and displays the private interface

### Requirement: ISO-004 Wallet persistence and actual adapter characterization
Browser acceptance SHALL verify retained successful wallet operations against actual
repositories and outbound adapters, using deterministic synthetic provider data.

#### Scenario: ISO-004-A BTC wallet persists after reload and backend restart
- **GIVEN** a logged-in synthetic owner and fixture funded sum 150000000 and spent sum 25000000 satoshis
- **WHEN** the browser adds a BTC wallet
- **THEN** the wallet shows 1.25000000 BTC and has a corresponding PostgreSQL row
- **AND** browser reload and backend restart preserve the same row and balance

#### Scenario: ISO-004-B Refresh and deletion affect stored data
- **GIVEN** the stored synthetic BTC wallet
- **WHEN** the fixture changes and the owner refreshes then deletes the wallet
- **THEN** the real adapter refresh updates its stored balance and deletion removes the row
- **AND** reload does not resurrect the wallet

#### Scenario: ISO-004-C Another owner's wallet remains private
- **GIVEN** another synthetic owner's wallet
- **WHEN** an authenticated caller reads, deletes or refreshes that wallet by ID
- **THEN** the application returns 404, preserves the row and makes no wallet-provider request

### Requirement: ISO-005 Isolated reproducible artifacts
Release images SHALL install from the committed lockfile using pinned pnpm and
exclude tests, fixture scripts, synthetic credentials and test reset endpoints.
The harness SHALL expose only its loopback HTTPS proxy and deny live provider egress.

#### Scenario: ISO-005-A Artifact and network inspection
- **GIVEN** images built from the repository and the isolated test stack
- **WHEN** final files, published ports and provider traffic are inspected
- **THEN** production files contain no test fixture/credential code
- **AND** PostgreSQL/Redis/backend ports are unpublished and outbound provider traffic reaches fixtures only
- **AND** the owner's existing Nginx file remains unchanged

#### Scenario: ISO-005-B Periodic jobs can be disabled without bypassing adapters
- **GIVEN** BACKGROUND_JOBS_ENABLED=false during isolated acceptance or maintenance
- **WHEN** the application starts
- **THEN** periodic cron jobs are not registered, while startup and explicit refresh still use real adapters
- **AND** periodic jobs remain enabled when the setting is omitted
