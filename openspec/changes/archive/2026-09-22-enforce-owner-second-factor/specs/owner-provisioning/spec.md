## MODIFIED Requirements

### Requirement: OWN-003 Owner-only transitional authentication and recovery
Password login, mandatory second-factor completion and every cookie-session-authenticated request SHALL verify the current singleton
owner and credential revision. Missing binding, legacy session cookies or stale sessions and non-owner
credentials MUST fail generically. CLI recovery MUST target the established owner,
replace its password and rotate the revision and delete owner sessions atomically, preserving confirmed MFA, unused recovery codes and financial history; any candidate enrollment is cancelled.

#### Scenario: OWN-003-A No implicit owner or legacy bearer access
- **GIVEN** no owner binding, or a retained non-owner account
- **WHEN** its valid password or previously valid session cookie is used
- **THEN** private access returns 401 without private data

#### Scenario: OWN-003-B Real login and recovery revocation
- **GIVEN** the explicitly provisioned owner has logged in through real HTTPS
- **WHEN** the CLI recovers that owner's password
- **THEN** the previous password and session cookie both fail with 401
- **AND** the new password plus the retained second factor logs in through the browser and financial rows are unchanged

#### Scenario: OWN-003-C Recovery cannot transfer ownership
- **WHEN** recovery supplies a missing or different user ID
- **THEN** it fails without changing the owner, credentials or any portfolio data
