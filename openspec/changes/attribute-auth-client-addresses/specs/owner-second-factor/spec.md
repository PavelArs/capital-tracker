## MODIFIED Requirements

### Requirement: MFA-002 No private access before second factor
Password verification SHALL grant only a five-minute pending session after confirmed
enrollment exists. Only successful TOTP/recovery verification SHALL issue full access.

The authentication scenarios below assume valid source metadata and available
request quota. Malformed forwarding metadata from an explicitly trusted proxy MUST
return 400 before factor/session operations, without granting or consuming access.

#### Scenario: MFA-002-A Password alone remains outside private APIs
- **WHEN** a real browser submits correct owner credentials
- **THEN** it sees the Russian second-factor form and receives only a pending cookie
- **AND** private profile/wallet/report/settings requests return401 with no provider calls or full session row

#### Scenario: MFA-002-B Second factor rotates into full authentication
- **GIVEN** a valid pending cookie, exact Origin and bound CSRF
- **WHEN** a valid unused factor is submitted
- **THEN** the pending cookie is consumed and a new full cookie/user/CSRF is issued
- **AND** real wallet operations and restart persistence still pass

#### Scenario: MFA-002-C Unenrolled, expired or mismatched pending state fails closed
- **WHEN** enrollment is missing, the pending five-minute deadline has passed, owner/revision differs, or a factor is submitted without a password-derived pending cookie
- **THEN** no private access or authenticated session is issued
- **AND** invalid CSRF/Origin remains403 without authentication-state mutation
