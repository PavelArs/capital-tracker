# owner-second-factor Specification

## Purpose
Require protected CLI enrollment and a replay-safe second factor before owner access, with atomic recovery and bounded persistent attempts.
## Requirements
### Requirement: MFA-001 Protected CLI enrollment
Confirmed TOTP secrets SHALL be encrypted with a server-held key separate from the
database. Enrollment/replacement SHALL require the trusted CLI and explicit bound
owner ID, with secrets exported only to newly created private files.

#### Scenario: MFA-001-A Prepare and confirm without a public setup route
- **GIVEN** a provisioned owner and valid private key file
- **WHEN** the CLI prepares enrollment and confirms a valid candidate code
- **THEN** private0600 files contain the URI and subsequently ten recovery codes
- **AND** PostgreSQL contains encrypted secret/hash material, never those plaintext values
- **AND** no HTTP enrollment/setup endpoint is exposed

#### Scenario: MFA-001-B Failed or cancelled replacement preserves the active factor
- **GIVEN** an active enrollment
- **WHEN** replacement lacks its explicit flag, targets another user, expires after ten minutes, fails confirmation or cannot publish its output file
- **THEN** the active factor and financial rows remain unchanged
- **AND** existing output files/symlinks are not overwritten and five failed confirmations exhaust that candidate

#### Scenario: MFA-001-C Explicit replacement invalidates old authentication
- **WHEN** a replacement candidate is confirmed
- **THEN** the new confirmation counter is consumed and old factor, codes and pending/full sessions are unusable
- **AND** owner identity and all financial records remain unchanged

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

### Requirement: MFA-003 Authoritative replay-safe TOTP
TOTP SHALL use a maintained library, six ASCII digits, SHA1,30-second steps and a
one-step drift window. Accepted counters MUST increase atomically using PostgreSQL time.

#### Scenario: MFA-003-A Standards and malformed input
- **WHEN** known RFC-derived values, leading zeroes and invalid types/digits/windows are checked
- **THEN** valid string codes verify and malformed/out-of-window codes do not authenticate
- **AND** no code/secret is echoed in errors or logs

#### Scenario: MFA-003-B Reuse and concurrent verification
- **GIVEN** a code already used for confirmation/login, or two independent pending sessions submitting the same fresh code
- **WHEN** verification occurs, including after restart
- **THEN** a used counter cannot succeed and concurrent fresh use issues exactly one full session
- **AND** a lock wait crossing pending expiry cannot revive authentication

### Requirement: MFA-004 Single-use recovery codes and safe recovery
Ten random128-bit codes SHALL be exported once and stored only as domain-separated
hashes. Consumption and session issuance MUST share one transaction.

#### Scenario: MFA-004-A Real recovery login and atomic one-time use
- **GIVEN** password-derived pending sessions and a real CLI-issued recovery code
- **WHEN** the code is submitted concurrently or replayed after success
- **THEN** exactly one full session can be issued and the code is consumed once
- **AND** a rolled-back issuance consumes neither the code nor the pending challenge

#### Scenario: MFA-004-B Password recovery preserves the second factor
- **WHEN** the CLI recovers the bound owner's password
- **THEN** pending/full sessions and candidate enrollment are revoked but the confirmed factor and unused recovery codes remain
- **AND** new password alone still cannot obtain private access

### Requirement: MFA-005 Persistent bounded factor attempts
Five invalid attempts SHALL retire a pending challenge. Ten invalid owner-factor
attempts in ten minutes SHALL impose a ten-minute cooldown across challenges/restarts.
Existing IP request limits SHALL apply without trusting spoofed forwarding headers.

#### Scenario: MFA-005-A Challenge and account limits survive renewal
- **WHEN** wrong well-formed factors exhaust a challenge and then the owner window through another challenge
- **THEN** no session is issued, challenge renewal cannot reset owner failures, and blocked attempts return429
- **AND** restart/spoofed forwarding headers cannot bypass the persisted owner block

#### Scenario: MFA-005-B Finite cooldown and trusted recovery
- **WHEN** database time passes the cooldown, or trusted CLI recovery/confirmation completes
- **THEN** legitimate factor verification can proceed without a permanent lockout

### Requirement: MFA-006 Encryption integrity and upgrade safety
The application SHALL fail closed for missing/unsafe key configuration, incorrect
keys or tampered encrypted envelopes. Explicit upgrade SHALL revoke old transient sessions while
preserving owner/password and all financial data.

#### Scenario: MFA-006-A Key and envelope failures reveal no secrets
- **WHEN** the key is missing/wrong/unsafe or ciphertext/tag/owner context is modified
- **THEN** startup or factor verification refuses safely without plaintext disclosure or full access

#### Scenario: MFA-006-B Previous-schema data remains intact
- **GIVEN** a populated preceding-ten-migration schema with authenticated sessions
- **WHEN** the new migration and an idempotent replay complete
- **THEN** user/owner/financial fingerprints are unchanged and old sessions cannot authenticate
- **AND** fresh installation also succeeds with no implicit enrollment
