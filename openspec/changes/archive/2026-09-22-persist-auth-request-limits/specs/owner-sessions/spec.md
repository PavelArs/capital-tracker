## MODIFIED Requirements

### Requirement: SES-001 Opaque protected session lifecycle
Authentication SHALL use independent cryptographically random 256-bit tokens stored
only as SHA-256 hashes, in Secure/HttpOnly/SameSite=Strict/Path=/ host-only
`__Host-ct-session` cookies. JWT/header/URL/localStorage credentials MUST NOT authenticate.
Login/MFA admission authorization SHALL preserve all existing checks while remaining
read-only. Subsequent password/factor transactions SHALL retain their existing
success and failure mutation contracts, including failed-factor counters and
challenge retirement. Normal private activity and logout retain their existing behavior.

#### Scenario: SES-001-A Real login rotates the cookie without browser token storage
- **GIVEN** a real browser with an anonymous CSRF session
- **WHEN** valid owner credentials, CSRF and a subsequent unused second factor are submitted through HTTPS
- **THEN** password success consumes the old session into a pending cookie and factor success consumes it into a full protected cookie
- **AND** no bearer appears in response or local/sessionStorage and no raw cookie token is stored in PostgreSQL

#### Scenario: SES-001-B Logout and recovery revoke copied cookies
- **GIVEN** a real logged-in owner with a copied full or pending cookie
- **WHEN** server logout or CLI recovery completes
- **THEN** subsequent requests with that cookie return 401
- **AND** financial data remains unchanged and the cleared logout cookie uses matching attributes
- **AND** a password verification completed before recovery cannot issue a new session after recovery, including concurrent rotation

#### Scenario: SES-001-C Idle and absolute expiration are authoritative
- **GIVEN** stored sessions at the thirty-minute idle or twelve-hour absolute boundary
- **WHEN** access is attempted
- **THEN** expired sessions return 401 and are not revived by access
- **AND** valid activity renews idle time without extending absolute expiry, including across backend restart
- **AND** a session that expires while authorization waits for its PostgreSQL row lock is rejected using database time after acquiring that lock

#### Scenario: SES-001-D Invalid credential transports cannot authenticate
- **WHEN** a request sends a malformed/duplicate/anonymous cookie or a legacy bearer/header/URL token
- **THEN** private access returns 401 without attaching an owner identity

### Requirement: SES-002 Session-bound CSRF and exact origin
Every state-changing matched route, including login/MFA/logout, SHALL require a valid
session-bound synchronizer token and the exact configured HTTPS Origin. Public
metadata MUST NOT exempt mutations. Failed authorization SHALL preserve session,
owner, factor and financial rows; expected committed request admissions MAY change
only their independent ledger according to auth-request-limits.

For CSRF retrieval, login and MFA, the scenarios below assume valid source metadata and available
request quota. Malformed forwarding metadata from an explicitly trusted proxy MUST
return 400 before any session operation; it MUST NOT permit invalid Origin or CSRF.

#### Scenario: SES-002-A Invalid CSRF or Origin denies mutation
- **GIVEN** an authenticated owner session
- **WHEN** a write omits CSRF or sends wrong/cross-session CSRF or absent/null/foreign Origin
- **THEN** it returns 403 and financial/owner/session state remains unchanged
- **AND** forged Host/X-Forwarded headers cannot make the request valid

#### Scenario: SES-002-B Login and logout have CSRF protection
- **WHEN** correct password login lacks a valid anonymous CSRF session, or logout lacks the bound token/origin
- **THEN** it returns 403 and grants or revokes no authentication

#### Scenario: SES-002-C Multi-tab retrieval preserves a valid session
- **GIVEN** two tabs sharing a valid cookie
- **WHEN** both retrieve CSRF state
- **THEN** the cookie and CSRF value remain consistent and both can use the session
- **AND** a supplied foreign Origin cannot read/create CSRF state

#### Scenario: SES-002-D Malformed credentials remain client errors
- **GIVEN** a valid anonymous session, CSRF token and exact Origin
- **WHEN** login submits an email array/object or a non-string password
- **THEN** validation returns 400 without type coercion, authentication, server errors or application-data changes
- **AND** valid string passwords retain every character and email normalization remains unchanged
