## MODIFIED Requirements

### Requirement: ISO-003 Real HTTPS login and private access characterization
Acceptance tests SHALL exercise production-mode release images via an HTTPS proxy,
real authentication and PostgreSQL. Only external providers MAY be stubbed.

#### Scenario: ISO-003-A Anonymous private API denial
- **GIVEN** the synthetic migrated application and an unauthenticated client
- **WHEN** private profile and wallet endpoints are requested directly through HTTPS
- **THEN** they return 401 without portfolio data
- **AND** the login page is available

#### Scenario: ISO-003-B Browser login uses the real password
- **GIVEN** a synthetic owner explicitly provisioned and enrolled using the production owner and MFA CLIs
- **WHEN** the browser submits that owner's email/password and then a real unused TOTP or recovery code via the login form
- **THEN** the application authenticates only after the second factor and displays the private interface
