# Verification record — enforce-owner-second-factor

Status: complete and independently reviewed on2026-09-22. Required local verification passed; no production rollout.

## Contract and implementation

| Scenarios | Implementation | Executable checks |
|---|---|---|
| MFA-001 enrollment, replacement, output and failure preservation | `mfa-cli.ts`, `auth/mfa-input.ts`, `auth/mfa.service.ts` | CLI/input Jest tests; `tests/e2e/mfa-db.cjs`; `mfa-expiry.cjs`; replacement browser case |
| MFA-002 pending/full boundary and rotations | session service, global guard, auth controller, frontend auth context/login | `mfa.spec.ts`, retained session/owner/portfolio cases; frontend context/API/login tests |
| MFA-003 standards, strict input and replay | OTPAuth9.5.2, PostgreSQL clock/counter, raw DTO preservation | RFC-derived crypto tests, actual ValidationPipe tests, PostgreSQL races/held-lock tests and HTTPS replay/type cases |
| MFA-004 one-time recovery and trusted password recovery | domain-separated hashes, atomic issuance, owner CLI | actual concurrent recovery, PostgreSQL issuance-failure rollback, CLI preservation and browser recovery |
| MFA-005 finite persistent attempts | pending attempt count and owner ten-minute window/cooldown | database reconstruction/restart and HTTPS renewal/restart/expiry cases |
| MFA-006 keys, envelopes and upgrade | bounded private-key reader, AES-GCM, eleventh migration | key/crypto Jest tests; actual CLI/key/envelope and populated preceding-ten upgrade checks; runtime mount/image inspection |

## Observed failures before corrections

- `/tmp/capital-mfa-behavior-red.log`: two real HTTPS/PostgreSQL failures on the
  preceding verified password-only images. Correct password issued full sessions
  and private200; unenrolled password login also succeeded. These are behavioral
  failures, not missing-endpoint404 or compilation errors.
- `/tmp/capital-mfa-frontend-red.log`: premature full-user/navigation and pending
  CSRF handling failed. The missing-method prerequisite is not counted as behavior RED.
- `/tmp/capital-mfa-image-first.log`: real migration/CLI/session/MFA checks passed;
  Chromium finished52 passed,2 failed,zero retries. Numeric TOTP returned401
  instead of malformed400 due to implicit DTO conversion. The other failure was
  a test oracle incorrectly counting unrelated anonymous sessions after owner
  replacement. It now counts the specified owner's sessions; explicit old full/
  pending cookie and old factor/code rejection assertions remain unchanged.
  Playwright had loaded the old assertion before the source correction; its later
  source excerpt reflects the edited file, not the already loaded test expression.
- `/tmp/capital-mfa-dto-review-red.log`: independent real ValidationPipe test had
  five failures/13 passes: scalar/object coercion and object `toString` server errors.
  Raw `@Type(() => Object)` plus transforms corrected the boundary; all18 pass in
  `/tmp/capital-mfa-dto-review-green.log`.
- `/tmp/capital-mfa-login-dto-behavior-red.log`: two malicious-object password/email
  cases returned TypeError rather than BadRequestException; fixed at the same raw
  input boundary. `/tmp/capital-mfa-dtos-green.log` has26 passing DTO cases.
  The earlier `/tmp/capital-mfa-login-dto-review-red.log` was a test typing error
  and is explicitly not acceptance evidence.
- `/tmp/capital-mfa-expiry-review-red.log`: the independently written PostgreSQL
  test observed a full-session row lock spanning candidate expiry in backend image
  `sha256:d317f752e3ec3694832df8fa291c352872fbed8dede42ca3c256427b99559f3a`.
  Confirmation incorrectly succeeded. The source now checks final database time
  and code counter after all writes, before publishing. Failure rolls back factor,
  revision, recovery codes and session deletion. The same run passed the recovery-row
  delayed pending-expiry test, whose fix was already in that image.

## Source verification and independent review

`pnpm verify:baseline` exited0 in `/tmp/capital-mfa-baseline-final.log`:
strict OpenSpec validation, both lint/builds,401 backend tests/18 suites and81
frontend tests/10 files. Existing77 backend/29 frontend warnings and the frontend
chunk-size warning remain. These source checks are not database/browser evidence.

Separate agents authored the frontend/CLI and independent browser/PostgreSQL tests.
Read-only review covered root's service/crypto/session/guard/migration and key
mounts; another context reviewed CLI output/rollback handling and frontend state.
Concrete findings corrected: final checks after row waits; raw credential types;
provider stub mount narrowed to its script so it cannot read the synthetic MFA key;
database enrollment retries restricted to unsuccessful CLI confirmations across an
observed clock boundary. A successful confirmation's assertions are never retried.

Compose configuration parsed successfully with synthetic key-path settings using
`docker compose --env-file env.production.example -f docker-compose.yml config --quiet`.
This did not start services or operate production. The owner Nginx remains SHA256
`115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`.

## Final release-image run

`pnpm test:e2e` exited0 in `/tmp/capital-mfa-image-final.log`. All eleven-migration,
preceding8/9/10 preservation, CLI, session, MFA/key/envelope, publication/issuance
rollback, replay/race, persistent limits and observed lock-wait expiry checks passed.
All55 HTTPS Chromium cases passed with one worker and zero retries. The synthetic
Compose stack was removed and the checkout Nginx preservation guard passed.

Exact tested local images (not published):

- Backend: `sha256:1b1e9b84221a07b6ae8558e26798eb098330716b1c19c9e284e0792cc57fcf9d`
- Frontend: `sha256:af6154b7241d4360acd891436e402a354f92b1305491bd245d0963916baaa744`

The independent late candidate-expiry RED now passes on this backend image, with
no publication and the complete pre-call authentication fingerprint preserved.

## Limits

No production database, live wallet, deployment, folder consolidation or hosted CI
was operated. Only external providers are stubbed in real acceptance; own backend,
CLI, password/factor verification, sessions, HTTPS and PostgreSQL run normally.
The filesystem and PostgreSQL cannot commit atomically: published private output is
retained on ambiguous commit failure and can be orphaned after a crash; operator
reconciliation is documented. No general key re-encryption command is claimed.

Process-local IP limits still reset on restart and do not yet attribute clients
through the trusted proxy. Shared password/IP budgets, recent MFA for future sensitive
settings, ASVS mapping/scanners, another browser engine, exact accounting/history,
six-network coverage, optional free AI, tested release/backups and final consolidation
remain required by the full brief. This change is not a production-readiness claim.
