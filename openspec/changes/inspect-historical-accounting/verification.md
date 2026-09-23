# Verification: historical accounting snapshot

Status: carry-in prerequisite archived at1667502 after full133/133 GREEN. Prepared
specifications and acceptance tests integrated at11b18f1; genuine missing-route/UI
RED observed below. Backend implementation is in progress; focused unit checks and
build passed. No historical PostgreSQL/browser GREEN or full release is claimed.

## Artifact review — 2026-09-23

An independent explicitly selected gpt-6-luna context read the proposal/design/spec
against the actual FIFO, store and page-parser contracts. No arithmetic or preserved-
contract blocker was found. Root resolved its three concrete ambiguities: the exact
pre-Jan3 millisecond, the corrected120 precondition for void restoration, and explicit
terminal/empty-page nextOffset rules. This is a read-only artifact review, not runtime
verification. Installed OpenSpec1.2.0 strict validation passed14 items (exit0), including
the still-active carry-in prerequisite; all four new artifacts are apply-ready.

## Acceptance preparation — not executed

Root prepared `historical-accounting.spec.ts` and
`historical-accounting-input.spec.ts` under backend/src/accounting, against proposed
`projectHistoricalAccounting(heads, baseline, at)` and `parseHistoricalQuery(raw)`
interfaces. They cover complete prefixes, effective-time correction, terminal void,
fee atoms, original partial-lot coordinates, known zero, UUID aggregation,100+1000
maximum-precision inventory and strict query normalization. Scoped Biome passed;
an independent Python Decimal calculation confirmed the1100-lot maximum literal.
Production modules do not exist yet: no Jest success or module-error RED is claimed.
Actual missing-feature RED must come from the HTTPS/browser tests on verified images.

An independent gpt-6-luna author prepared two actual API/UI cases in
`tests/e2e/historical-accounting.spec.ts` (0a6efa2). Root review strengthened retained
rows to include all trade tables and replaced the UI's incorrect unchanged-CSRF
assumption with the exact existing navigation-admission delta. The author applied
both; corrected120/320/230 and carry-in250/100 expectations remain unchanged.
Root also prepared `historical-accounting-security.spec.ts` for actual anonymous/
pending denial, foreign ownership, strict raw query errors, unavailable coverage and
exact empty-journal shape, with no business/provider changes. All E2E TypeScript
passed strict checking, exit0 (`/private/tmp/capital-historical-draft-tsc.log`), using
symlinks to existing main-checkout dependencies; no install or product change.
Scoped Biome passed. None of these browser cases has run yet: carry-in archival is
delayed by its independently reproduced unknown-cost alert regression and full rerun.

The independent author also prepared `historical-accounting-db.cjs` (82a8baa): actual
production service + fresh synthetic PostgreSQL, guarded absent fixture database,
full-row fingerprints across reads/refusals, UUID pages/stale revision and separate
reader/writer processes with a real query barrier. Root review corrected the second
instrument's independent expected quantity2 (original draft incorrectly said1),
narrowed claimed coverage to HIST-002/003 and removed unused boilerplate. Syntax/diff
checks passed; no PostgreSQL runtime result is claimed. The probe expects
`HistoricalAccountingService(source).getSnapshot(ownerId, accountId, rawQuery)`.
Missing future service is a prerequisite error before creating its fixture database.
Real100+1000 bounds and expanded late-response UI checks still need implementation.

Independent `historical-accounting-journey.spec.ts` preparation153d979 adds one actual
delayed-response scenario with a preserved unsaved correction. Root verified existing
form selectors and strengthened its no-write oracle to forbid every accounting POST,
not just a POST to the new read route. It delays actual `route.fetch()` output without
inventing backend data. Scoped Biome and strict E2E TypeScript passed, exit0
(`/private/tmp/capital-historical-journey-tsc.log`); temporary dependency links removed.
The case has not run. Account-switch and real pinned-pagination409 browser coverage,
plus real PostgreSQL100+1000 bounds, remain outstanding before final verification.

| Scenarios | Planned executable evidence |
| --- | --- |
| HIST-001-A, HIST-002-A | `tests/e2e/historical-accounting.spec.ts`: actual owner/password/MFA, HTTPS API/UI, PostgreSQL; exact chronological100/300/100 costs and250/230 realized, inclusive baseline boundary |
| HIST-001-B, HIST-002, HIST-003 | `backend/src/accounting/historical-accounting*.spec.ts`: independent pure/input vectors for corrected execution times, voids, fees, atoms, zero cost, shared-FIFO original coordinates and page bounds |
| HIST-003, HIST-004-B | `tests/e2e/historical-accounting-db.cjs`: production service through real PostgreSQL, RR process barrier, revision conflict, complete accounting fingerprints and supported maxima |
| HIST-004 | `tests/e2e/historical-accounting.spec.ts`: late actual response delivery, changed account/instant, real409, unchanged parent correction, literal labels, private admission/error behavior and zero provider requests |

Record actual predecessor source/images and intended missing-route/UI RED before
product changes. Unit/service doubles cannot substitute for database/browser checks.
Retain original receipts/import bytes and documented authentication/admission deltas.
The final release gate must run the complete existing suite, not only new scenarios.
Hosted CI, other browser engines, backup/restore and production remain unrun unless
separately evidenced. There are no new migration or provider checks in this slice.

## Exact predecessor behavior RED — 2026-09-23

At11b18f1 (only new specification/acceptance code), command
`caffeinate -is node /private/tmp/capital-historical-predecessor-red.cjs` checked the
exact verified backend36856553e640b6906894d3e70dc8122548b31e7b84a699777344699e008da315
and frontendf81445af15fe1c9f48c39ee13118bbdd0e00c8060d91676a72fcbed8f1868c0a
image IDs, used --no-build, actual migrations/seed, PostgreSQL and HTTPS password/MFA.
Terminal exit1: two intended failures. HIST-001-A API expected200 received404 at
historical-accounting.spec.ts:118; HIST-004-A expected the Russian history heading
visible at:243, but it did not exist. Fixture, actual authentication, retained-row,
admission/provider assertions completed; finally cleaned up the synthetic project.
Log `/private/tmp/capital-historical-predecessor-red.log`; synthetic failure artifacts
`/private/tmp/capital-historical-red-artifacts`. This is feature RED, not an import or
compile failure. Product implementation started only after the terminal result.

Initial backend projection/input implementation passed37/37 tests in2suites,2.667s,
exit0 (`pnpm --dir backend test --runInBand historical-accounting`); backend build
exit0 (`/private/tmp/capital-historical-backend-build.log`). Scoped Biome passed.
A real PostgreSQL maximum fixture now covers100 original lots plus1000 current buys
at maximum input precision; expected values independently checked with Python Decimal
precision100. It is wired into the existing full acceptance runner and has not run yet.
