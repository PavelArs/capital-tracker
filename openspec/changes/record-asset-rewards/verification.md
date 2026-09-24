# Reward verification record

Status: specification/acceptance preparation; no product reward implementation or GREEN
claim. Full project goal remains incomplete. No owner database or provider was accessed.

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
Log/private/tmp/capital-rewards-pure-red.log. HTTPS RED is still pending.

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
