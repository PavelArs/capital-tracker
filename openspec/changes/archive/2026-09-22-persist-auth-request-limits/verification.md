# Verification: persist-auth-request-limits

Status: verified on 2026-09-22. Behavior RED preceded implementation; required
source, PostgreSQL and full HTTPS checks pass. No production-readiness claim.

## Independent preparation

QA reviewed exact charging, read-only authorization and retained-test adaptations.
The design reviewer caught and corrected wording that would have forbidden existing
failed-factor counters/challenge retirement. Authorization alone becomes read-only;
later password/factor transactions retain their success and failure contracts.
QA also distinguished credential owner lookup from required session binding checks,
normal success charges from resets, and bounded pool acquisition from SQL timeouts.

The independent PostgreSQL fixture is tests/e2e/auth-limits-db.cjs. Its production
service/migration tests were authored before implementation; missing modules/tables
were never counted as behavior RED. The initial HTTP tests at commit 10fee53 did
not read the future ledger. Current GREEN tests add independent ledger assertions.
Discovery and strict TypeScript checks passed.

## Actual preceding-image RED

Root ran `/private/tmp/capital-ledger-red.cjs` using the verified backend image
`sha256:29d707692957100490f846448225da86f9faf76e77a49e6911e42630dbc5aab0`
twice concurrently against one actual synthetic PostgreSQL database and the actual
rendered Nginx template. No application rebuild or behavior change preceded RED.

Command within that fixture: `pnpm exec playwright test tests/e2e/auth-limits.spec.ts`.
Exit 1, two expected behavior failures in `/private/tmp/capital-ledger-behavior-red.log`:

- LIMIT-001-A: five wrong passwords plus a blocked sixth on primary; actual upstream
  evidence then proves A reaches replica. It receives 401 instead of 429, while B's
  independent attempt remains 401 and retained owner/MFA/financial state is unchanged.
- LIMIT-001-B: after exhaustion and independently verified restart/health of both
  actual processes, A again receives 401 instead of 429. The test proves the original
  sixty-second window has not elapsed.

Real jars and CSRF came from actual application responses. Nginx selection is
fixture-controlled, never selected by a client header. Actual source/upstream socket
evidence is checked before each behavioral assertion. Both images/configs/mounts
match; no own backend or authentication response is mocked. Owned synthetic cleanup
removed both replicas, clients, data services and all three networks; the preservation
wrapper reported no owner-file change.

Two prior setup failures were repaired without changing the behavior assertions:
artifact comparison incorrectly treated environment-array order as semantic, then
socket metadata was sampled after graceful Nginx closure. Environment/mount sets
now compare complete sorted entries; source evidence is captured at connection.
Those prerequisite logs are capital-ledger-artifact-setup-failure.log and
capital-ledger-socket-setup-failure.log under /private/tmp, not counted as RED.

## Implemented source and PostgreSQL service checks

Root integrated the dedicated admission service/migration 12 (2fe0036), reviewed
handler integration (739a649) and independent source boundaries (ec3f8af). The
integration and security reviewers found no remaining source blocker; these
reviews alone do not establish runtime behavior.

`pnpm verify:baseline` with Node 22.21.1 exited 0, recorded in
`/private/tmp/capital-ledger-baseline-first.log`: 541 backend tests/20 suites,
81 frontend tests/10 files, both lint/build and all 9 strict OpenSpec items.
Existing 77 backend/29 frontend lint warnings and frontend bundle-size warning
remain. Independent configuration RED was expected 5000 / actual undefined with
two prior tests passing, then GREEN in the real installed source boundary tests
(`/private/tmp/capital-admission-pool-config-red.log`).

`node /private/tmp/capital-ledger-pg.cjs auth-limits-db.cjs` built the actual
backend release image and exited 0 against disposable PostgreSQL 16.10. Evidence:
`/private/tmp/capital-ledger-pg-first.log`. The external fixture passed:

- Four policy limits, independently calculated digests, fixed deadlines, exact
  PostgreSQL expiry and committed pruning on expected denial.
- Distinct actual Node processes racing for one remaining hit and the last live
  capacity slot; every preceding live row preserved, existing allowance usable.
- Actual advisory, target-row and pruning waits crossing database deadlines.
- Real 2s lock timeout, immediate query and deferred-commit trigger failures with
  nontransactional sequence proof of one attempt, safe 503 and released runners.
- Actual runtime poolSize 1 exhaustion with configured 5000ms timeout; releasing
  the connection causes no late admission; a new explicit request succeeds.
- Actual schema scope/hash/hit/null/finite/exact-duration/key/index constraints.

All preceding nonledger rows remained identical in that fixture. The synthetic
stack was removed in finally and the owner Nginx preservation wrapper succeeded.
This run does not replace the populated 11-to-12 migration or real HTTP acceptance.

## Full release-image GREEN

`pnpm test:e2e` exited **0**. Evidence is
`/private/tmp/capital-ledger-image-first.log`: **74 passed (21.7m)**, one Chromium
worker, zero retries. All 63 retained scenarios and 11 new LIMIT scenarios passed.
No assertion was weakened to mask an incorrect result; meaningful source/account
stage differences have explicit oracles. The full command also passed:

- External-provider TLS boundary probes and all prior migration/CLI/session/MFA,
  concurrency, expiry-after-lock, key/error and rollback checks.
- Populated 11-to-12 upgrade with authentic encrypted active/candidate factors,
  used/unused recovery, anonymous/pending/full/expired sessions and two principals'
  financial rows. Every old row and schema/index/constraint/sequence definition
  remains identical; only migration history advances. Replay is exact.
- Every independent ledger PostgreSQL probe listed above, fresh twelve-migration
  installation, prior 8/9/10 preservation and unsafe legacy refusals.
- All 27 invalid HTTP proxy startup cases, actual rendered deployment Nginx,
  identical image/environment/mounts for both replicas and isolated topology.
- HTTPS storage-lock 503/no-store with exact state preservation and explicit retry;
  actual overlapping requests across both upstreams; fixed-window restart survival;
  owner and unknown-account limits; full-session denial without activity updates;
  malformed JSON/source accounting and genuine A/B/third-source owner cooldown.

Independent source/fixture review found no remaining blocker. Integration includes
c42d1ea (migration fixture), 50f3d53 (retained plus new HTTP cases), c8e9727 (malformed
JSON) and the asynchronous source client in 18065a6. Strict E2E TypeScript passed.

Frozen offline install and required high-threshold production audit both exited 0:
`/private/tmp/capital-ledger-frozen.log`, `/private/tmp/capital-ledger-audit.log`.
The two known moderate Router findings remain visible; no advisory is suppressed.
The existing image CI job timeout changes from 20 to 35 minutes because the actual
browser phase alone exceeded 20. Independent review confirms this is its only CI
change; all nine required gates, permissions, commands, pins and retries remain.
`pnpm test:engineering` exited 0 after it: 183 tests in 2 suites, recorded in
`/private/tmp/capital-ledger-engineering-final.log`.

## Exact artifacts and preservation

- Backend, both replicas: `sha256:dd0b55f720be27be0857d2929b6719c92c4779b8e7711e8ec08999b1835bd84d`.
- Frontend: `sha256:0d12e654473f9b92b7a7caa6af7676fa69e8ead598ec40bad044c6a55581e87a`.
- Lockfile SHA-256: `13e4fbf1d1effcf66367ef7829885eb53b339cb9f52ab43854ca2e4ba77c4e73`.
- Owner Nginx SHA-256: `115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`, mode 0644; preserved and unstaged.

The final command reported checkout preservation after cleanup. Subsequent actual
Docker queries found no containers/networks for the owned acceptance project and
no client-source probe containers. No owner database/folder, production system or
unrelated work was changed. All old migrations remain unchanged; only migration 12
is added in this slice. No push or deployment occurred.

Independent implementation, acceptance and migration tasks used separate Git
worktrees. Straightforward documentation used gpt-5.6-luna; architecture/security
and independent QA retained stronger agents. Hosted CI, a second browser engine,
image scanning, SAST/DAST, full ASVS and production backup/recovery remain unexecuted.
The finite ledger/pool and remaining process-local general-route quotas provide no
owner-availability or complete DoS guarantee. Full product refactor remains open.
