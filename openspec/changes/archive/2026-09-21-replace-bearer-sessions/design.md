## Context

Owner provisioning and revision-checked JWTs are verified. This slice replaces their
transport and public-route policy; it does not claim password-only login is sufficient
for public deployment. Existing health handlers are duplicated and reveal dependency
state. Existing fixtures use real login and must migrate to real browser cookies.

## Goals / Non-Goals

**Goals:** Revocable opaque sessions, no browser token storage, exact origin plus
synchronizer CSRF protection, expiry, rotation, default-deny and safe liveness.

**Non-Goals:** TOTP and recovery-code enrollment, distributed account/IP throttling,
recent-MFA controls, complete scans/ASVS and public rollout. They remain required.

## Decisions

- Add `auth_sessions`: tokenHash SHA-256 primary key, random 32-byte csrfToken,
  state anonymous/authenticated, nullable userId/credentialVersion, createdAt,
  lastSeenAt, expiresAt. Tokens are independent random 32-byte base64url values;
  only hashes enter PostgreSQL. No JWT, Authorization, URL or localStorage fallback.
  Node crypto supplies entropy/hash/constant-time comparison; no custom cryptography.
- Cookie `__Host-ct-session`: Secure, HttpOnly, SameSite=Strict, Path=/, no Domain;
  anonymous TTL five minutes, authenticated absolute twelve hours and idle thirty
  minutes. Expiry uses PostgreSQL time, never only cookie expiry. A successful request
  may touch lastSeenAt but never extend expiresAt. Reject duplicate/malformed cookies.
- `GET /auth/csrf` returns `{ csrfToken }`; it reuses a valid session without token
  rotation so multiple tabs work. Otherwise it creates a bounded anonymous session.
  Synchronizer CSRF tokens are stored in the session (not an auth credential alone)
  and remain only in browser memory. Expired sessions are pruned on creation; at most
  512 anonymous and ten authenticated sessions exist. Cap/creation runs under a
  transaction advisory lock; full anonymous capacity returns 429 without eviction of
  live sessions. Authenticated creation retires oldest owner sessions beyond ten.
- `POST /auth/login` requires a valid existing session, exact configured Origin and
  X-CSRF-Token before checking password. Login consumes the old session and issues a
  new cookie/CSRF token atomically, checking owner/revision again; concurrent attempts
  cannot upgrade the same session twice. Response is `{ user, csrfToken }`, no bearer.
  Failed passwords return generic 401, retain the anonymous session and grant no access.
- `POST /auth/logout` is private and CSRF-protected; delete the session then clear
  matching cookie attributes. CLI recovery removes that owner's sessions in the same
  transaction as password/revision rotation. Missing binding and revision mismatch
  deny access even if a session row remains. Already authorized in-flight operations
  can finish; revocation prevents later authorization and cannot be undone by touches.
- A global guard denies all matched routes unless explicitly Public: only GET health,
  GET auth/csrf and POST auth/login. Public metadata never exempts a write from CSRF.
  Private requests without authenticated cookies return 401; authenticated writes
  with invalid origin/CSRF return 403. Login without valid pre-session/CSRF is 403.
  Unmatched/removed routes retain 404. Public health returns only `{status:'ok'}`;
  `/health/details` uses existing checks but is private. Backend root becomes private.
- Require a configured exact HTTPS FRONTEND_URL origin; reject null/absent/multiple/
  mismatched origins on writes and mismatched supplied origins on CSRF retrieval.
  Never derive it from Host/forwarded headers. Align fixture origin127.0.0.1:8443.
  Keep Express trust proxy false. CORS permits only this origin and required headers.
- No-store on auth/private responses (including errors), redact Cookie/Set-Cookie/
  X-CSRF-Token in logs, and preserve secure cookie behavior across backend restarts.
  Frontend sends credentials, obtains CSRF before writes, updates it after login,
  calls actual logout and removes stale localStorage token without reading it for auth.
  Do not automatically retry failed mutations. HTTP-only local frontend login is no
  longer supported; use the existing verified HTTPS stack for auth acceptance.
- Read database time after acquiring a session row lock, because the lock can wait
  past expiry. Rotation locks the owner before pruning session rows, matching the
  recovery transaction order. Independent PostgreSQL tests exercise both races.
- Login DTO transformations inspect original input types even with global implicit
  conversion enabled. Malformed credentials return bounded 400 errors; password
  strings retain their original Unicode and whitespace.
- Request logging records method/path/address rather than query strings or arbitrary
  headers. Error paths omit queries, unknown-route messages are generic, raw error
  stacks/driver parameters are not logged. The development Swagger HTTP mount is
  removed because it bypassed Nest's global guard; API metadata remains in source.

Reference guidance checked2026-09-21: [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
[OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
[Nest global guards](https://docs.nestjs.com/security/authentication).

## Risks / Trade-offs

- Password-only still insufficient → production remains disabled; mandatory MFA next.
- Public anonymous records invite storage exhaustion → short TTL, bounded capacity,
  existing request rate limit and transactional cleanup; distributed throttling follows.
- Database outage denies auth → fail closed, no in-memory/bearer fallback.
- CSRF/session mutation changes test fingerprints → compare financial/owner rows;
  separately assert expected session state, never remove data-integrity assertions.
- Old client tokens stop working → clear local token and require fresh login, preserving
  all account/portfolio data. No backwards-compatible bearer path.

## Migration Plan

Add migration AddOwnerSessions1790000000000 without altering existing tables. Verify
fresh/replay, previous nine owner/portfolio snapshots and unsafe older refusals. Only
synthetic instances are upgraded. No automatic destructive downgrade; returning to
legacy auth is not a safe rollback. Final repository consolidation remains after the
full brief, preserving the original Git database and unique data/worktrees.
