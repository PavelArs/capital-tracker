# Verification: persist-auth-request-limits

Status: active. Behavior RED preceded implementation. Source and isolated
PostgreSQL service checks now pass; full HTTP/migration acceptance remains pending.
No production-readiness claim.

## Independent preparation

QA reviewed exact charging, read-only authorization and retained-test adaptations.
The design reviewer caught and corrected wording that would have forbidden existing
failed-factor counters/challenge retirement. Authorization alone becomes read-only;
later password/factor transactions retain their success and failure contracts.
QA also distinguished credential owner lookup from required session binding checks,
normal success charges from resets, and bounded pool acquisition from SQL timeouts.

The independent PostgreSQL fixture is tests/e2e/auth-limits-db.cjs. Its production
service/migration tests are written but unexecuted until implementation is available;
missing modules/tables are not behavior RED. Initial independent HTTP tests in
auth-limits.spec.ts do not read the future ledger. Discovery and TypeScript passed.

## Actual preceding-image RED

Root ran `/private/tmp/capital-ledger-red.cjs` using the verified backend image
`sha256:29d707692957100490f846448225da86f9faf76e77a49e6911e42630dbc5aab0`
twice concurrently against one actual synthetic PostgreSQL database and the actual
rendered Nginx template. No application rebuild or behavior change preceded RED.

Command within that fixture: `pnpm exec playwright test tests/e2e/auth-limits.spec.ts`.
Exit1, two expected behavior failures in `/private/tmp/capital-ledger-behavior-red.log`:

- LIMIT-001-A: five wrong passwords plus a blocked sixth on primary; actual upstream
  evidence then proves A reaches replica. It receives401 instead of429, while B's
  independent attempt remains401 and retained owner/MFA/financial state is unchanged.
- LIMIT-001-B: after exhaustion and independently verified restart/health of both
  actual processes, A again receives401 instead of429. The test proves the original
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

Root integrated the dedicated admission service/migration12 (2fe0036), reviewed
handler integration (739a649) and independent source boundaries (ec3f8af). The
integration and security reviewers found no remaining source blocker; these
reviews alone do not establish runtime behavior.

`pnpm verify:baseline` with Node22.21.1 exited0, recorded in
`/private/tmp/capital-ledger-baseline-first.log`: 541 backend tests/20 suites,
81 frontend tests/10 files, both lint/build and all9 strict OpenSpec items.
Existing77 backend/29 frontend lint warnings and frontend bundle-size warning
remain. Independent configuration RED was expected5000/actualundefined with
two prior tests passing, then GREEN in the real installed source boundary tests
(`/private/tmp/capital-admission-pool-config-red.log`).

`node /private/tmp/capital-ledger-pg.cjs auth-limits-db.cjs` built the actual
backend release image and exited0 against disposable PostgreSQL16.10. Evidence:
`/private/tmp/capital-ledger-pg-first.log`. The external fixture passed:

- Four policy limits, independently calculated digests, fixed deadlines, exact
  PostgreSQL expiry and committed pruning on expected denial.
- Distinct actual Node processes racing for one remaining hit and the last live
  capacity slot; every preceding live row preserved, existing allowance usable.
- Actual advisory, target-row and pruning waits crossing database deadlines.
- Real2s lock timeout, immediate query and deferred-commit trigger failures with
  nontransactional sequence proof of one attempt, safe503 and released runners.
- Actual runtime poolSize1 exhaustion with configured5000ms timeout; releasing
  the connection causes no late admission; a new explicit request succeeds.
- Actual schema scope/hash/hit/null/finite/exact-duration/key/index constraints.

All preceding nonledger rows remained identical in that fixture. The synthetic
stack was removed in finally and the owner Nginx preservation wrapper succeeded.
This run does not replace the populated11-to12 migration or real HTTP acceptance.

## Remaining verification

Populated11-to12 migration, all retained63 HTTP scenarios plus new limits cases,
independent fixture/oracle review, full image acceptance, final image identities,
cleanup/preservation, documentation integration and archive remain outstanding.
Independent implementation, acceptance and migration tasks run in separate Git
worktrees. Simple documentation refinements use gpt-5.6-luna; security-critical
implementation and independent QA retain stronger agents.
