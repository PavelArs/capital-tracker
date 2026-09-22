## Why

Bearer tokens in browser storage cannot provide the required cookie/session boundary,
idle expiration or server logout. Cookie authentication must introduce CSRF protection
and default-deny routing together so the transport change does not expose mutations.

## What Changes

- **BREAKING** Replace JWT/Passport and localStorage authentication with opaque
  PostgreSQL sessions and Secure/HttpOnly/SameSite=Strict host cookies.
- Rotate anonymous sessions at login; enforce idle/absolute expiry, logout and CLI
  recovery revocation while retaining owner/revision checks.
- Add session-bound synchronizer CSRF tokens, exact HTTPS Origin validation for all
  writes including login/logout, restrictive CORS and credential-log redaction.
- Protect routes globally except explicit login/CSRF/minimal liveness; make detailed
  health private and remove the duplicate health handler.
- Preserve accounting/user rows through one additive migration and real image tests.

## Capabilities

### New Capabilities
- `owner-sessions`: opaque cookie lifecycle, bounded anonymous sessions, CSRF and
  backend default-deny behavior.

### Modified Capabilities
- `owner-provisioning`: retained owner/revision checks and recovery now revoke cookie
  sessions; all legacy bearer authentication is removed.
- `explicit-migrations`: tenth additive migration with previous-version preservation.
- `engineering-gates`: retained authentication characterization now tests the session
  guard instead of the removed Passport JWT guard.

## Impact

Depends on restrict-owner-provisioning. Changes backend/frontend auth, controller
guards, health/configuration, CLI recovery, one additive session table, dependencies,
fixtures and docs. Existing users, owner binding and portfolios remain unchanged.
Only disposable authentication sessions may be expired/pruned/revoked.

Non-goals: TOTP/enrollment/recovery codes, distributed account/IP throttling, full ASVS
mapping/scans and production rollout. Password-only login remains transitional until
the mandatory MFA slice; production remains disabled. Repository consolidation is
authorized for the end of the full refactor, not this authentication slice.
