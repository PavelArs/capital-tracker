## 1. Acceptance tests first

- [x] 1.1 Unit tests for the one-day lifetime, no idle timeout and cookie `maxAge` (`backend/src/auth/session.service.spec.ts`).
- [x] 1.2 Update browser and PostgreSQL acceptance (`sessions.spec.ts`, `sessions-db.cjs`, `mfa.spec.ts`) and the three journeys that expired a session through idle time.
- [x] 1.3 Record the expected failure (RED) in `verification.md`.

## 2. Implementation

- [x] 2.1 24-hour full-session lifetime, remove the idle check and idle pruning, align the cookie.
- [x] 2.2 Update `docs/owner-authentication.md` and `README.md`.

## 3. Verification

- [x] 3.1 Backend tests, lint, build and strict spec validation GREEN; record results.
- [ ] 3.2 Hosted CI green on the PR, and on main including browser acceptance after merge.
