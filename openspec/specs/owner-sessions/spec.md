# owner-sessions Specification

## Purpose
Protect owner access with revocable opaque cookies, database expiry, exact-origin CSRF and default-deny routes.
## Requirements
### Requirement: SES-001 Opaque protected session lifecycle
Authentication SHALL use independent cryptographically random 256-bit tokens stored
only as SHA-256 hashes, in Secure/HttpOnly/SameSite=Strict/Path=/ host-only
`__Host-ct-session` cookies. JWT/header/URL/localStorage credentials MUST NOT authenticate.

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
metadata MUST NOT exempt mutations. Failed writes MUST NOT mutate application data.

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

### Requirement: SES-003 Bounded anonymous sessions and atomic rotation
Anonymous sessions SHALL expire after five minutes and confer no owner privileges.
Creation SHALL prune expired records, cap combined anonymous/pending records at512 and authenticated
records at10, and serialize capacity/rotation decisions in PostgreSQL.

#### Scenario: SES-003-A Anonymous capacity is bounded
- **GIVEN** 512 unexpired anonymous sessions
- **WHEN** another new CSRF session is requested
- **THEN** it returns 429 without adding a record or evicting an active record
- **AND** expired records are pruned before a later new session is accepted

#### Scenario: SES-003-B A pre-session cannot be upgraded twice
- **GIVEN** concurrent valid login attempts using the same anonymous session
- **WHEN** they attempt rotation
- **THEN** exactly one pending session is issued, only successful MFA can issue full authentication, and the anonymous token cannot authenticate

#### Scenario: SES-003-C Authenticated capacity retires oldest sessions
- **GIVEN** ten valid authenticated owner sessions
- **WHEN** two further real password and second-factor verifications issue sessions
- **THEN** only the ten newest remain and the two retired credentials return 401

### Requirement: SES-004 Private routes and safe public liveness
Backend routes SHALL be private by default. Only explicit login, CSRF retrieval and
minimal liveness SHALL be public. MFA completion and logout MAY accept an explicit
pending state but MUST NOT grant private data before verification. Authentication/private responses SHALL use no-store,
credentials SHALL be redacted, and forwarded headers SHALL NOT be implicitly trusted.

#### Scenario: SES-004-A Anonymous route matrix and liveness
- **WHEN** anonymous clients request the root or private profile/assets/wallets/currencies/reports/metrics/detailed-health routes
- **THEN** matched private routes return 401
- **AND** GET health returns exactly {"status":"ok"}, while removed/unmatched routes remain 404

#### Scenario: SES-004-B Privacy headers and credential redaction
- **WHEN** authentication and private requests succeed or fail
- **THEN** responses contain Cache-Control no-store and logs contain no cookie, Set-Cookie or CSRF secret values
- **AND** a rejected credential in URL query parameters is absent from error responses and request/error logs
