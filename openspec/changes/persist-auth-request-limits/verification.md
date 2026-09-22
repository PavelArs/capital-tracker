# Verification: persist-auth-request-limits

Status: active, behavior RED captured before implementation. No persistent-limit
GREEN or production-readiness claim.

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

## Remaining verification

Source/PG/HTTP GREEN, populated11-to12 migration, all retained63 scenarios plus new
limits cases, independent implementation/security review, exact image identities,
final cleanup/preservation, documentation integration and archive remain outstanding.
The user requested parallel Git worktrees and simpler models for simple tasks;
documentation is isolated on refactor/auth-limits-docs with gpt-5.6-luna, while
security-critical implementation and independent QA retain stronger agents.
