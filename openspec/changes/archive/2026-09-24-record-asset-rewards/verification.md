# Reward verification record

Status: completed and archived2026-09-24 after required scoped source, PostgreSQL and
HTTPS gates and independent review. All9tasks and canonical comparisons are complete. Full project goal remains incomplete. No owner database or provider was accessed.

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

## Final UI review and real HTTPS verification

New editor74665d1 integrated5aa4b43, reviewed correction1fcc917 integratedfdfa263, root
parent integration and submit guard0d834bc. Root/Sol review found and resolved stale
review restoration after refresh/cancel, missing parent-pin invalidation, incomplete
frozen-command identity, inaccurate correction copy, and invalid-date normalization.
The editor retains the original command/body/pins and display evidence across SPA
remount; review includes instrument UUID as well as name. Form/receipt/review rendering
are separated. A proposed new component test that mocked internal APIs/auth was removed;
its critical interaction assertions live in the real HTTPS case. No new backend or
authentication mocks remain. Sol reviewed final child/parent guard and test-only fixes.

Root integrated frontend checks:103tests/15files pass, lint passes with27existing warnings,
scoped Biome passes. The final actual frontend Docker build includes TypeScript/Vite and
passes with the existing >500kB chunk warning. Strict/noUnused E2E TypeScript passes.
Logs/private/tmp/capital-rewards-frontend-{tests,lint,image-final}.log and
/private/tmp/capital-rewards-e2e-ts-final.log. Backend build/unit/lint evidence above
remains applicable: no later backend product changes.

Exact images in both real HTTPS attempts:
BEsha256:176f668b0c6a77e78961600a3b989446f2bd479a8bcbd9a933142b8e5684d25f
FEsha256:fe42b103d5daf60de1ad13c2415defbbf0f948e5398ef37e627763e489a7069e.
Actual release artifact checks ran before Playwright. Real password/MFA, two backend
replicas and PostgreSQL were used; only external providers are stubbed. Transport tests
forward real requests with route.fetch and then abort/delay delivery of actual responses.

Attempt1 selected two new reward cases, owned-transfers.spec.ts:281, usd-trades.spec.ts:130
and historical-valuation.spec.ts:266, one Chromium worker/zero retries. Four passed, one
failed, exit1(1.1m). Reward API's test expected the proxy-facing/api prefix in the private
error path; GlobalExceptionFilter uses request.url after Nginx removes/api. Root corrected
only the exact two expected paths to/accounting. Status/message/error, canonical ISO
timestamps, stable foreign/missing envelope equality, financial and private-label assertions
remain unchanged. Sol independently confirmed the correction is not a weakened oracle.
The reward UI and all3retained UI cases passed, including trade backend restarts.

Attempt2 reran only the2new cases on identical images:2/2pass27.7s, exit0,1worker0retries.
The same UI case now additionally follows actual SPA links away/back while the create
response is unknown, verifies restored fields/no automatic secondPOST, then exact original
body/key/pins and unchanged receipt200after committed201. It also delays a real version1
history response while a concurrent actual correction commits and list refresh showsv2:
late delivery cannot restore review, the unsaved reward draft remains, and explicit new
review is needed. The separate trade draft17/777/3 survives reward correction/void.
Logs/private/tmp/capital-rewards-https-attempt{1,2}.log; traces/artifacts
/private/tmp/capital-rewards-green-artifacts and/private/tmp/capital-rewards-green2-artifacts.

Required scoped gates are therefore satisfied. Full backend/E2E suites, older8–17upgrade
matrix, hostedCI,
reward-specific expired/revoked-session permutations, full security scans and backup/restore
release gates were not rerun. Session guards are unchanged and independently inspected;
this slice does not claim full route/security/release coverage. Existing tests/CI retained.
The proxy still emits its existing http2 deprecation warning; no deployment file changed.

Final live labeled Docker container/network inventories are empty. Owner nginx mode0644/
size1348/SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432 and
lock SHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d remain
unchanged. No owner database, production deployment, paid provider, push, project removal
or final repository consolidation occurred.

## Archive and final consistency

Installed OpenSpec1.2.0 `archive record-asset-rewards --yes` synced6added and17modified
requirements in8capabilities and archived2026-09-24. The CLI's nonblocking >10deltas
suggestion was acknowledged: nullable reward basis necessarily updates its connected
trade/transfer/history/valuation/CSV consumers within this one acquisition feature.
It saw8/9tasks because task4.2 itself includes archive and post-archive comparison; all
functional/source/runtime checks had passed, and only this procedural closure remained.
The final checkbox was updated after archive, owner guide, continuity and comparison.

Snapshot-based comparison passed23delta blocks (blank-line normalization only),16retained
requirement blocks and20unrelated capability files byte-for-byte. New canonical Purpose
was filled with the actual capability and linked frozen wire contract, without altering
requirements. Final strict canonical validation and active-change inventory are recorded
in/private/tmp/capital-rewards-post-archive.log. Goal remains substantially incomplete;
this archive does not complete the target brief or authorize production/consolidation.
