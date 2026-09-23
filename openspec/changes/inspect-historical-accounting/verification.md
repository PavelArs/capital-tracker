# Verification: historical accounting snapshot

Status: proposal preparation only in an isolated worktree while the prerequisite
carry-in release gate runs. No historical-accounting product change or acceptance
execution has occurred. None of the planned checks below is a successful result.

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
