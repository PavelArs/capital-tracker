## MODIFIED Requirements

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
