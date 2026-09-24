# FIFO original-interval refactor verification

Status: implemented and independently reviewed; scoped unit/source/actual PostgreSQL
and two unchanged HTTPS journeys pass. Final independent evidence audit passed; archived.

## Scope and inventory

Base58100f9,25 canonical specs and only preserved owner Nginx edit. Read current
AGENTS/brief/continuity/accounting stores and existing GHCR/Compose guarded CD.
Keep FIFO result DTOs, exactmoney, chronology/provenance, caps, migrations19, every
private API/UI and existing test. Simplify redundant disposed/allocated state into
an original-coordinate remaining interval. Remove only those redundant private
fields. No database/API/frontend/provider/dependency/pipeline/data/folder changes.
This prerequisite does not implement transfers or complete the remaining brief.

The architecture review rejected permanently frozen transfer cost snapshots and
sender-history/onward-transfer prohibitions. Dynamic connected-account replay is
still next. See design.md/CONTINUITY.md for follow-up decisions, not current promises.

## Characterization and independent review

`pnpm --dir backend test --runInBand --coverage=false fifo historical-accounting trade-input csv`
passed240tests/7suites in2.327s before product changes. Actual log
/private/tmp/capital-transfer-baseline.log. Pure refactor: no artificial RED.
No missing new helper/import failure is claimed as behavioral acceptance evidence.

Contract/root oraclesccb70b0; Sol independently confirmed partition7/11=>4,2,5,
subfragment[2,6)=>6 split3,1,2, suffix4/2/alreadydisposed1=>1,0,1 and bounds.
Root0cac33c strengthened unequal full-precision quantity/cost division. Fifteen
new focused helper tests supplement all existing unchanged characterization.

Luna isolated worktreecapital-tracker-fifo-intervals implementeda06a5b2, root
integrated84bf998. Only fifo.ts/fifo-lot-interval.ts product changes. Root and Sol
independently reviewed formulas, full/empty boundaries, class identity/re-export,
unchanged sorting/caps/public projections; no blocker. Temporary dependency symlink
removed and owned worktree clean; no unrelated directory removal.

## Source checks

Root final255tests/8suites passed2.081s including strengthened highprecision oracle.
Log /private/tmp/capital-fifo-interval-root-unit.log. Luna255tests/8suites also passed
before strengthening integration; actual tests/build/lint/biome logs same prefix.
Build/lint/scopedBiome exit0;77 existing backend warnings. TypeScript through backend
build. No frontend source changed, so no repeated frontendunit/build/lint or browser
TypeScript check; accepted frontend digest is reused and checked in HTTPS harness.

`pnpm audit:production` exit0, two existing moderate findings/nohighcritical; lock
unchanged, existing details in docs/dependency-security.md. Audit log sameprefix.
Initial strict OpenSpec run failed one normative statement because its first line
lacked SHALL/MUST. Rephrased without changing behavior in dda4d7e; subsequent strict
26items pass (25canonical+active), /private/tmp/capital-fifo-interval-specs-final.log.
Initial failed output remains /private/tmp/capital-fifo-interval-specs.log.

## Actual PostgreSQL

At84bf998, /private/tmp/capital-fifo-interval-db.cjs built backend then executed
unchanged usd-trades-db.cjs and carry-in-db.cjs against separate fresh guarded
synthetic PostgreSQL16.10 databases,19real migrations each. Exit0.
- Trade suite: exact origin/exclusions, mandatory250/100 and fee245/101 vectors,
 residual atom allocation/negative net/wide products, true version/lot identities,
 malformed/prefix rejection and replay/CAS, corrections acrossinstrumentqueues,
 finite/composite/RESTRICT/deferred SQL constraints, real two-process races,
 deferredCOMMIT rollback, real RR barrier,1000active and10000version histories.
- Carry-in suite: preview/raw/foreign boundaries, original allocation phase1/0/1,
 exact zero/exhaustion/replay, manual+CSV250/100, correction230, rollback to baseline,
 actual opening/account-lock races, deferredCOMMIT rollback, SQL constraints,
 separate-process RR/read-only snapshots,100carrylots plus1000trades/full paging.
- Every suite's saved prior financial/auth/migration rows remain exact under its
 fingerprint checks; no repository/database/authentication mocks.

Backend sha256:f1f480d4a1039aa89b909075d162273697253c755413c680d48bf01c47c09e3a.
Log /private/tmp/capital-fifo-interval-db.log; synthetic cleanup completed. Exact
same backend selected for the two unchanged browser cases.

## Selected scope and unrun checks

HTTPS selection: TRADE-003-A / TRADE-006-A Russian trade journey in usd-trades.spec.ts;
CARRY-004-A manual/CSV correction/rollback journey in carry-in-csv.spec.ts. No new E2E.
Full backend/full E2E, unrelated frontendunits/build, older upgrade matrix, hostedCI,
release/security/image scans, live provider calls and production are unrun. Existing
CI/discovery unchanged. No release-readiness or whole-brief-completion claim.

## Actual HTTPS and preservation

Atdda4d7e, /private/tmp/capital-fifo-interval-green.cjs reused the exact PG-tested
backend and the unchanged accepted frontend (no rebuild). Artifact/proxy/network
checks pass; fresh19migrations/synthetic owner, real login/MFA/HTTPS/backend/PG.
Only external providers stubbed. Existing test assertions were not modified.

`pnpm exec playwright test tests/e2e/usd-trades.spec.ts tests/e2e/carry-in-csv.spec.ts --grep 'TRADE-003-A / TRADE-006-A:|CARRY-004-A:' --workers=1`

Exit0:2/2 in35.5s, one worker/zero retries. CARRY-004-A passed14.5s; TRADE-003-A /
TRADE-006-A passed20.4s, including actual backend restarts and protected row/receipt
checks. No unexpected runtime failure or weakened assertion. Logs/artifacts:
/private/tmp/capital-fifo-interval-green.log and capital-fifo-interval-green-artifacts.
- Backend sha256:f1f480d4a1039aa89b909075d162273697253c755413c680d48bf01c47c09e3a
- Frontend sha256:4dd2bcef305e76c7a1f5e6506b9ee85d90b46ad77fecd6d4a811b8438586c19e

Synthetic harness cleanup completed. Owner Nginx mode0644/size1348/SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432 and lock SHA256
6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d unchanged.

Luna independently verified all claims against actual logs and tests: no blocker.
Live labeled synthetic container/network inventories are empty after cleanup.

OpenSpec1.2.0 `archive refactor-fifo-lot-intervals --yes` succeeded, adding three
canonical requirements. The5/6 warning concerned only the self-referential archive
task3.2; marked complete after success. Canonical Purpose filled. All25 prior specs
remain byte-identical to58100f9 and new requirements match the archived delta.
Post-archive strict26canonical specs passed; activechangesempty. Log
/private/tmp/capital-fifo-interval-archive-validation.log. All6tasks completed.
