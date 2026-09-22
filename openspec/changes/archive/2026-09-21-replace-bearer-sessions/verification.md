# Verification: replace-bearer-sessions

Date: 2026-09-21. This slice replaces the verified transitional bearer transport;
it does not complete the full brief or authorize public deployment. Final source and release-image checks passed; results below describe this slice only.

## Acceptance and implementation mapping

| Contract | Executable evidence | Implementation |
|---|---|---|
| SES-001-A/B/D, OWN-003 | sessions.spec.ts, owner-auth.spec.ts, retained portfolio.spec.ts | SessionService, global SessionGuard, AuthController, owner CLI; cookie-aware frontend |
| SES-001-C | sessions-db.cjs expiry/touch/held-lock assertions; sessions.spec.ts expiry/restart cases | Fresh PostgreSQL time after row lock, fixed absolute expiry and bounded idle renewal |
| SES-002-A/B/C/D | sessions.spec.ts real mutation/login/logout/multi-tab/type cases; login.dto.spec.ts | Exact HTTPS Origin, synchronizer CSRF, raw credential type validation |
| SES-003-A/B/C | sessions-db.cjs capacity/rotation/recovery races; concurrent HTTPS login | PostgreSQL advisory capacity lock and owner-before-session lock order |
| SES-004-A/B | sessions.spec.ts route/no-store/captured-secret assertions; typeorm.config.spec.ts | Default-deny, minimal health, safe HTTP/SQL logging, no development Swagger mount |
| SES-MIG-001, retained MIG/ISO/OWN | migrations.cjs and owner-cli.cjs | Additive tenth migration; previous eight/nine-schema and financial-row preservation |
| Browser integration | client.test.ts, AuthContext.test.tsx, auth.api.test.ts and real HTTPS suite | In-memory CSRF, cookie credentials, actual server logout, no automatic mutation replay |

All browser successful authentication uses real passwords and browser cookie jars.
Copied/fabricated credentials appear only in negative denial tests. Dedicated
PostgreSQL lifecycle tests call the production services with real password-verified
owners; they supplement browser tests rather than replacing them. Only outbound
external providers are fixtures. There are no backend/authentication response mocks
in acceptance; frontend adapter unit tests are explicitly a different level.

## Observed RED

- `/tmp/capital-sessions-behavior-red.log`: the unchanged preceding image accepted
  a copied credential after browser logout, exposed bearer/browser-storage auth,
  served the backend root anonymously and exposed detailed public health.
- `/tmp/capital-sessions-csrf-red.log`: corrected valid currency-preference payloads
  returned 200 and inserted rows for missing CSRF and foreign Origin, where 403 and
  unchanged PostgreSQL rows were required. An earlier DTO400 was an invalid test
  payload and is explicitly not the behavioral RED evidence.
- Frontend Axios contract tests initially showed five expected failures before
  cookie/CSRF implementation; existing compatible behavior stayed passing.
- Independent review added `/tmp/capital-sessions-review-red.log`: an actual
  PostgreSQL row-lock wait crossed expiry, but authorization succeeded. The fixed
  code reads the clock after acquiring the lock.
- `/tmp/capital-sessions-review-http-red.log`: a real copied cookie submitted in a
  URL could not authenticate, but appeared in the 401 error response. Query data is
  now excluded from request/error paths and logs. This focused run selected the
  privacy case only; a renamed malformed-input test was not selected by its grep.
- `/tmp/capital-sessions-dto-red.log`: three of six actual ValidationPipe cases
  failed: an email array threw TypeError; numeric/object passwords were implicitly
  converted to strings. Original types now reach validation, preserving valid
  password characters. The final HTTPS suite also exercises these inputs.

Initial TypeScript test-fixture/configuration errors were fixed separately and are
not claimed as behavioral failures. Existing wallet/database characterization was
retained. Deferred CSRF-response and delayed403/new-login tests were added against
already-correct behavior and passed directly; no artificial failure was introduced.

## Independent review

- `audit_security` authored PostgreSQL capacity/concurrency/expiry tests and reviewed
  service/guard/CLI/schema integration. Found owner/session lock inversion, stale
  clock under lock contention, query credential leakage and unsafe DTO coercion.
  Reviewed the corrections and reported no remaining source blockers.
- `gate_acceptance` authored/adapted the real HTTP/browser cases, reviewed frontend
  cookie/CSRF/logout integration independently, and added passing race
  characterization. No blocking frontend finding remains.
- `provider_feasibility` reviewed configuration and documentation boundaries,
  confirmed the DTO issue, checked SQL logger privacy, identified the development
  Swagger guard bypass and confirmed its removal. Updated operator documentation.

## Executed checks

- `pnpm verify:baseline`: exit0 in `/tmp/capital-sessions-final-baseline.log`;
  strict OpenSpec five items, 296 backend tests/13 suites, 69 frontend tests/9 files,
  both builds and lint passed. Existing 77 backend/29 frontend lint warnings remain.
- First complete corrected image run: exit0 in
  `/tmp/capital-sessions-image-green.log`; all 34 Chromium cases and PostgreSQL
  checks passed. This preceded removal of the development Swagger mount, so it is
  not the final artifact evidence.
- Final `pnpm test:e2e`: exit0 in `/tmp/capital-sessions-final-image.log`. All
  migration/CLI/lifecycle checks and all 34 HTTPS Chromium cases passed (3.3 minutes
  for Playwright), zero retries. The synthetic stack and networks were removed.
- `git diff --check`: passed. Original owner Nginx bytes are preserved; the image
  uses separate deploy/container-nginx.conf.

Final candidate image IDs observed by the harness:

- Backend: `sha256:182da8ffadafdba439fec2ac68c81e02babe15601d49cae69bbbe59249ec39fa`
- Frontend: `sha256:b2a85d0990ccb1b4cc4de689b6de3a327a8987fe801188231b6f4bcd07bb9cc1`

## Remaining scope and limits

Password-only full sessions remain transitional until mandatory TOTP, encrypted
enrollment and single-use recovery codes are implemented. Shared per-account/IP
throttling, recent MFA, complete ASVS5 mapping, scanners/second browser, immutable
promotion, least-privilege runtime DB and backup/restore/rollback remain required.
No hosted CI, production deployment or real owner database access occurred.

The local artifact gate still hardcodes the preserved owner's Nginx checksum;
fresh-checkout portability is a separately identified engineering correction, not
a reason to alter the owner file. Final consolidation/deletion is authorized only
after the full refactor and preservation checks in docs/consolidation-plan.md.
