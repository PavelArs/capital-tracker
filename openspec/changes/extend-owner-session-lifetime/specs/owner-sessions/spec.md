## MODIFIED Requirements

### Requirement: SES-001 Opaque protected session lifecycle
A full owner session SHALL last one day (24 hours) from factor completion with no
idle timeout; logout, recovery, revocation and the session cap may end it earlier.
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

#### Scenario: SES-001-C One-day absolute expiration is authoritative
- **GIVEN** a full session issued by factor completion
- **WHEN** access is attempted before its deadline one day after sign-in, including after many hours without activity or a backend restart
- **THEN** it remains valid without re-login, and activity never extends that deadline
- **AND** at or after the deadline it returns 401 and is not revived by access
- **AND** a session that expires while authorization waits for its PostgreSQL row lock is rejected using database time after acquiring that lock

#### Scenario: SES-001-D Invalid credential transports cannot authenticate
- **WHEN** a request sends a malformed/duplicate/anonymous cookie or a legacy bearer/header/URL token
- **THEN** private access returns 401 without attaching an owner identity
