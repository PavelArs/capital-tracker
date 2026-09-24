# Reward verification record

Status: implementation in progress; pure checks and backend build pass. Runtime
GREEN is still pending. Full project goal remains incomplete. No owner database or provider was accessed.

## Baseline

Accepted predecessor9c0257b has schema20 and verified owned transfers. Live root status
before this change showed only preserved owner frontend/nginx.conf. Existing pipeline
remains inspected/contained, unchanged; no production authorization or paid services.

2026-09-24 host Node22.23.2, pnpm10.33.0:
`pnpm --dir backend test --runInBand --coverage=false fifo historical-accounting trade-input
csv owned-transfer-input historical-valuation manual-portfolio-valuation valuation-history`
passed368tests/13suites in2.703s, exit0. Log/private/tmp/capital-rewards-baseline.log.
No fabricated refactor RED; new reward behavior still needs intended acceptance failure.

Accepted predecessor release-candidate images for new real HTTPS RED:
BEsha256:01e43db63bc3faf2227f9b383c28da4650124361d38c65f68a451647151b30d3
FEsha256:184462cbef67047af371da2c8ede0577912823db35fdf047f5c35c3aed5c839a.
Verify live image IDs before running; do not rebuild product before recording RED.

## Scoped verification manifest

- Pure tests: exact known reward partial sales, null vs0, independent income/price,
  mixed-sale subtotal, transfer/fee/return intervals, restatement, chronology and bounds.
- Real PostgreSQL: fresh21/populated20 all-row preservation/no-op, SQL constraints,
  immutable lifecycle/request replay, two-process owner-lock/CAS race, deferred COMMIT
  failure with post-write witness, RR snapshot, saved CSV invalidation, all affected caps,
  batched history/valuation/series. Retain existing trade/carry/transfer oracles.
- Two new HTTPS cases: REWARD-API privacy/lifecycle/price-vs-basis and REWARD-UI review/
  unknown0/correction/void/actual lost-response recovery through real password/MFA/backend/PG.
  Keep arithmetic permutations at pure/PG levels. Selected unchanged transfer/trade/valuation
  critical journeys guard connected effects; no full E2E required for this slice.
- Both builds/lints, scoped frontend/backend unit checks, strict E2E types, strict OpenSpec,
  production dependency gate. Known lower-severity findings remain visible.
- Independent financial/security/UI review; archive only after required gates pass.
  Full E2E/older upgrade matrix/security scans/release/production are unrun unless recorded.

## Contract review and pure behavioral RED

Sol independently reviewed the financial/nullable cost/category/83digit/14200position
contract against the actual projection. Luna independently reviewed private wire/UI
acceptance and null-vs0/income/price separation. No contract blocker remained. The
unclassified subtype still requires explicit reward attestation; ambiguous external
receipts are not implicitly classified by this feature. Strict change validation passed.

Before product changes, `pnpm --dir backend test --runInBand --coverage=false
asset-reward-fifo` compiled and ran7new independent cases, all failed as expected
(exit1,1.669s). Predecessor ignores the new rewards input: historical positions were[]
instead of the two expected exact holdings; reward-funded sales/transfers threw invalid
history; reward summary and inclusive quantity were absent. This is behavioral RED,
not import/type/environment failure. Tests use existing exported pure entrypoints.
Log/private/tmp/capital-rewards-pure-red.log. The later HTTPS RED is recorded below.

Sol independently added4boundary cases before implementation (ea35533, integrated787c6ec).
Focused Jest failed4/4 on missing reward behavior, exit1; scoped Biome passed. Log
/private/tmp/capital-reward-boundaries-red.log. Root reviewed the11/7atom numerical oracle,
known/unknown same-instrument valuation, prefix chronology and1000/1001 boundary tests.
The83digit observation uses exact BigInt arithmetic and is not a full maximum-component
performance test. Root then narrowed helper category types to the explicit contract union;
no assertion changed.

ATDD execution split: pure-core implementation may proceed after the11actual pure RED
cases while the two HTTPS cases are prepared. API/UI/persistence implementation waits
for their corresponding genuine predecessor-image RED. This avoids an unnecessary
serial dependency without changing any oracle or claiming the later checks have passed.
The immutable accepted schema20 images remain pinned and are not rebuilt for RED.
Initial PG acceptance also now contains direct SQL constraints, deferred COMMIT witness
and real two-PID RR/read-only snapshot scenarios; these are written but not yet run.

Two HTTPS cases authored independently by Luna238fad6, integrated4cf8b12; scoped Biome
and diff checks passed. Agent standalone TypeScript attempt lacked Node type resolution
and was not a successful check. Root strict/noUnused TypeScript with backend Node type
roots passed. Root pre-execution review corrected three test-only issues: fingerprint
is captured after intentional foreign fixture seeding, unknownIncomeCount is0 for known
income40and0 despite one unclassified subtype (distinct counters in frozen contract), and
price assertions include the exact observed instant/revision rather than an accidental
partial nested equality. No product code or financial expectation was changed to pass.

## Genuine predecessor HTTPS RED and integrated unit checks

Actual pinned schema20 images above ran both new Playwright cases through real HTTPS,
password/MFA, application backend and PostgreSQL, one worker and zero retries. Both
failed behaviorally as intended: valid create expected201 received404 (line63), and the
reward region was absent (line338,10s). Exit1; log/private/tmp/capital-rewards-red.log,
artifacts/private/tmp/capital-rewards-red-artifacts. Harness finally removed the synthetic
containers and networks. API/UI/persistence implementation began only after this RED.
Root's pre-execution review also compared foreign404's exact stable envelope separately
from its legitimate path/timestamp, retaining canonical timestamp and expected path checks.

Pure core83a48f5 integratedae9a677, parsera4d59fa integrated153682c. Root corrected an
unused parser import and guarded the legacy known-cost projection against reward identities.
After connecting reward storage/replay/current/history/CSV/series/module, backend build
passed and focused Jest passed385tests/16suites in3.037s, exit0. Selection adds asset-reward
to the baseline expression above. Logs/private/tmp/capital-rewards-backend-build.log and
/private/tmp/capital-rewards-unit-green.log. Scoped Biome on12changed backend files passed.
These are source/pure checks, not yet PostgreSQL or HTTPS GREEN evidence.

Sol's independent existing-consumer UI commit ee02b2e integrated4c92516; agent reported
103tests/15files, build and lint passed (27existing warnings; Vite chunk warning), scoped
Biome11files passed. Root inspected DTOs/nullable display/provenance before integration.
New reward editor and root integration checks remain pending.

## PostgreSQL integration and independent review

Backend implementation1148f1b was independently reviewed by Sol for financial semantics,
owner scoping, replay-before-CAS/caps, owner-before-sorted-row locking, connected validation,
nullable propagation and SQL constraints. No blocker found. Root reviewed pure original
interval arithmetic, null propagation and categorized income independently of its author.

Actual new backend image sha256:176f668b0c6a77e78961600a3b989446f2bd479a8bcbd9a933142b8e5684d25f
ran the real production compiled services on PostgreSQL16.10 with synchronize/migrationsRun
false and the guarded migration CLI. Main PG attempt1 passed the original5families. Root
then added populated auth/admission/CSV-byte preservation, connected CSV and once-only
read-model scenarios. Attempt2 passed6families then failed at setup: additional price
instants incorrectly supplied expectedRevision0 despite the instrument-wide price pin.
The fixture now explicitly appends at1and2; no product or financial assertion changed.
Attempt3 passed all7families, exit0; log/private/tmp/capital-rewards-pg-attempt3.log.
It covers fresh21/populated20/no-op, old receipt/row preservation, independent quantity/
nullable basis/income/price, connected restatement/terminal lifecycle, actual SQL and
deferred COMMIT rollback witness, two-PID RR/read-only snapshot, CSV stale-preview/refusal/
rollback/receipt/bytes, and once-only reward count/materialization in series and selected
valuation. The schema-valid auth preservation rows in the new20fixture are synthetic;
actual encrypted factors and session preservation are additionally checked below.

Independent boundary fixtureb71336f integrated773fd75. Root strengthened setup BEFORE
execution to seed999then accept the1000th reward through the actual service (owner/local),
rather than merely constructing1000after an earlier service write. Actual4families passed:
two forked OS processes observed waiting on the owner's real advisory lock, identical
replay/conflicting CAS, owner/local active1000, owner versions10000 with spare local ticks,
and local/passive journal revision10000. Every refusal preserves full table fingerprints;
old exact replay still succeeds at limits. Same image then passed retained transfer PG
economics/lifecycle/RR/CSV/deferred constraints/real races/owner limits and populated19
upgrade, and fresh21 plus populated18 upgrade with authentic encrypted MFA factors, used/
unused recovery, all session classes, prior economic rows and schema-object comparison.
Log/private/tmp/capital-rewards-bounds-attempt1.log; harness uses synthetic tmpfs PG and
finally removes the stack. This is scoped verification, not the full older upgrade matrix.

Sol independently reviewed the root's newPG oracles and schema21 fixture maintenance,
including price-pin correction and actual1000th-write strengthening; no blocker found.
Existing fresh-count assertions now require21, explicit17/19predecessors require4/2new
migrations, and schema comparisons allow only the two new empty reward tables in addition
to their earlier additive sets. Syntax check passed19affected acceptance files.

Backend lint passed77existing warnings. Production dependency gate passed exit0 with
2existing moderate advisories and nohigh/critical; log/private/tmp/capital-rewards-audit.log.
No dependency or deployment changes. New UI is still under review; no reward HTTPS GREEN
or completed-change claim yet.
