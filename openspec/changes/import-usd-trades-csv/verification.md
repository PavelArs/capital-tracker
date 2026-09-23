# Verification: import-usd-trades-csv

Status: genuine predecessor-image CSV RED demonstrated; implementation now in progress.
Source, migration/PG and initial HTTPS checks passed. Expanded browser verification,
review fixes, the complete release gate and archive remain pending.

Predecessor record-usd-fifo-trades was actually archived in97a7a2d on2026-09-23 after
all101 real Chromium cases passed in21.7 minutes, one worker and zero retries, plus
actual migration/PostgreSQL/CLI/authentication/artifact/network prerequisites.
See its archived verification for source/audit results and retained earlier failures.
Exact predecessor images, required for initial CSV RED without a rebuild:
- backend sha256:17283e22fdc410782a31ebdd86e627e8c07cb576fd1f0b82ffb9bc87e39fc2c3
- frontend sha256:ebf4d8ce70cd660fc854459c6c84519fec7d54ab087a8019fc8f37f57a6234ad

Independent contexts reviewed the planned acceptance matrix, backend transaction
seam/security and parser/transport against actual installed sources and primary docs.
Coordinator resolved inspection-before-mapping, invalid-preview discriminants,
whole-candidate source ordering, conditional rollback reallocation, state-pinned
provenance and versioned replay-before-parse. No product/schema/dependency change
was made to demonstrate those design claims; runtime verification remains required.

| Scenarios | Planned executable evidence | Current result |
| --- | --- | --- |
| CSV-001-A / CSV-006-A | Maintained predecessor-image real MFA upload/UI RED, then full journey GREEN | Genuine RED recorded; both initial cases GREEN in current focused run, expanded journey pending |
| CSV-001-B / CSV-002 | Independent csv-input/csv-parser tests plus actual Nest/HTTPS transport and format cases | Independent122 input/parser tests and initial transport/wire HTTPS passed |
| CSV-001-C / CSV-003 / CSV-004 | Production CsvImportService with real PG exact vectors, races, caps, provenance, deferred COMMIT and retry | Real production-service PG nine families passed; HTTP supplements pending |
| CSV-005 | Real RR read barriers and state-pinned provenance; replica hash equality and stale preview denial | Real PG RR barriers and state-pinned provenance passed; replica HTTPS pending |
| CSV-006 / CSV-007 | Real Russian browser and private HTTPS/auth/CSRF/owner/log tests, actual transport faults | Focused seven-case HTTPS passed; three genuine UI regression failures recorded, fixes under verification |
| CSV-TRADE-001 | All retained manual/USD source/PG/HTTPS characterization plus atomic range assertions | Retained manual/USD PG and859 backend assertions pass; full HTTPS pending |
| CSV-MIG-001 | Release-image fresh15/replay and populated14-to15 plus all older upgrade/refusal cases | Actual fresh15/replay/populated8..14 upgrades and unsafe-history refusals passed |

## Initial genuine acceptance RED — 2026-09-23

At source d435a86, before any CSV behavior/schema/dependency changes, ran:
`PATH=/private/tmp/capital-task-bin:/Users/pavelars/.nvm/versions/node/v22.23.2/bin:$PATH caffeinate -is node /private/tmp/capital-csv-predecessor-red.cjs`.
The coordinator harness verified both exact predecessor image IDs above and reused
them without rebuilding. Log: `/private/tmp/capital-csv-predecessor-red.log`;
synthetic failure artifacts: `/private/tmp/capital-csv-red-artifacts`.
Actual result: exit1, two tests / two expected failures, one worker, zero retries.

- CSV-001-A: after actual CLI owner, password/MFA, initialized journal and private
  HTTPS setup, upload expected201 but received404 (csv-import-red.spec.ts:121).
- CSV-006-A: after actual password/MFA and account navigation, protected heading
  `Импорт CSV` was absent (csv-import-red.spec.ts:197).

Fresh14 migrations, real PostgreSQL, artifact/topology and authentication prerequisites
passed. Neither test depended on a future CSV table/module before its intended failure.
Finally assertions preserved prior business/admission rows and external-provider counts.
Owned cleanup ran; independent subsequent Docker reads found no acceptance Compose
containers/networks or client-source probes. Owner Nginx SHA256 remained
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432;
pre-implementation lock SHA256 remained
13e4fbf1d1effcf66367ef7829885eb53b339cb9f52ab43854ca2e4ba77c4e73.
Scoped TypeScript/Biome and discovery of both new tests passed before execution;
Playwright discovery now includes103 cases. No CSV GREEN claim yet.

Runtime note: external host update removed Node22.21.1 and switched global pnpm.
New local commands use compatible Node22.23.2 and a temporary wrapper invoking
cached pnpm10.33.0; repository and release-image pins remain unchanged. Use
PATH=/private/tmp/capital-task-bin:/Users/pavelars/.nvm/versions/node/v22.23.2/bin:$PATH.
No paid service, owner DB, production deploy, remote push or original-folder removal.

## Pure boundaries and dependency — 2026-09-23

Independent test commitded5d97 was reviewed and integrated126240d before pure source
implementation. Actual `pnpm --dir backend exec jest accounting/csv-input.spec.ts
accounting/csv-parser.spec.ts --runInBand --coverage=false` passed122 tests/2 suites,
exit0 in1.447s (`/private/tmp/capital-csv-boundary-tests.log`). Includes actual parser
exact262144bytes,100rows,32x4096decoded-byte record, malformed final records and
BOM/multibyte/quoted LF+CRLF physical starts. Scoped Biome passed. First implementation
check hit compile TS2550 for Object.hasOwn under the repository lib target (0 tests);
changed to compatible hasOwnProperty.call, preserving project configuration. This
compile failure is not behavioral RED. No assertions changed.

Actual pnpm10.33 added exact csv-parse7.0.2 with no transitive dependencies; manifest
and lock diff contain only that addition. Frozen install exit0
(`/private/tmp/capital-csv-frozen-install.log`), required live production audit exit0
(`/private/tmp/capital-csv-dependency-audit.log`): two existing moderate vulnerabilities,
zero high/critical. Existing ignored Nest build-script warning remains. Host runs
Node22.23.2; release-image Node22.21.1 verification remains pending.

## Integrated source and real PostgreSQL — 2026-09-23

Coordinator reviewed the backend agent's five-file diff (9fae5d3, integrated3c11a38).
The minimal EntityManager extraction preserves manual SQL/projections/canonical field
order, account-lock/CAS/replay and caller-owned transaction semantics. Independent
context reviewed root parser/input and schema/entities/proxy03ec6bc without blockers.
No claim that SQL jsonb-object checks validate the complete mapping or that foreign
keys alone enforce transactional row counts/state equivalence.

Actual integrated backend build and full lint exit0;77 retained warnings. Full backend
Jest exit0:859 tests/26 suites,9.932s (`/private/tmp/capital-csv-backend-integrated-tests.log`).
Exact release backend built with Node22.21.1 from5ea3354:
sha256:0c239e1e9b2994bd5468bc50ea9ededccf619b44022caf29e84999c18be99e46.
Build log `/private/tmp/capital-csv-backend-image-build.log`, exit0.

Actual targeted runner `node /private/tmp/capital-csv-pg-run.cjs migrations
manual-opening-db usd-trades-db` under the documented PATH/caffeinate, exit0; log
`/private/tmp/capital-csv-migration-regression-2.log`. Fresh15, identical replay, all
prior8..13 upgrades/refusals and new populated14-to15 passed. The14 fixture creates
real two-principal journal history using production manual commands against exactly
the first14 migrations: corrections, terminal voids, original accepted replay and
independent90/60 FIFO. Upgrade preserves every prior row/schema/index/constraint and
sequence definition, authentic factor envelopes, used/unused recovery, session classes
and live admissions. Only the migration sequence advances. Retained manual and USD
PG suites passed including exact extremes, real process races, RR barriers and COMMIT.
First attempt `/private/tmp/capital-csv-migration-regression.log` exited1 before
constructing the14 fixture because createPreviousSchema still allowed only8..13;
extended that explicit test allowlist to14. No product or expected outcome changed.

Independent PG fixture9e3f0d7 integrated755189a. Coordinator repaired one setup conflict
before execution: SQL ownership probes now create a separate foreign journal instead
of mutating the preexisting foreign journal that the unchanged preservation oracle
protects. Actual `node /private/tmp/capital-csv-pg-run.cjs csv-import-db` exit0, log
`/private/tmp/capital-csv-pg-first.log`: nine production-service PG families passed,
including whole-candidate sale-first250/100, immutable source/provenance, historical
unsupported-version receipt fixture, rollback200-to100, distinct-process observed
account-lock waits, real deferred COMMIT complete-write witnesses and exact retry,
RR/read-only concurrent-writer barriers, SQL constraints and valid row/history/file
caps. Historical receipt construction is explicitly isolated fixture setup, not
current writer acceptance of an unsupported parser. All prior captured rows remain.
Both targeted runners cleaned their owned containers/networks; independent final
cleanup reads will be repeated after the currently active HTTPS run.

Frontend69b98a3 integrated83398d0: build/lint81 retained tests passed in its worktree;
no runtime success inferred from those checks. Independent review found stale parent
revision on CSV refresh, retained old workflow after new file selection, and collapsed
source-key whitespace. Root also identified global401 full-navigation recovery loss.
Maintained real regressions are being authored before repairs; these remain open.
No full slice GREEN or archive until those and all required gates pass.

## Focused HTTPS and review regression RED — 2026-09-23

Actual `node /private/tmp/capital-csv-http-run.cjs` with the documented PATH and
caffeinate completed exit0: 7/7 Chromium cases, 1.5 minutes, one worker, zero retries.
Log: `/private/tmp/capital-csv-http-focused-first.log`. Includes the original two
missing-feature cases now GREEN, four private multipart/security cases and actual
Nginx exact-1-MiB/one-over probes using both Content-Length and chunked transmission.
Backend image is the 0c239e1e image above; frontend image:
`sha256:58fe842863dc1095e70c3b776c97d86711e8dce4a305434aa72ea651fcef1866`.
All calls use real release applications, session/MFA, TLS proxy and PostgreSQL.
Only external providers are stubbed. Fresh15, artifact/topology and owned cleanup
completed. Later auth-negative test strengthening sends a valid multipart body
rather than JSON at the upload route; that strengthening still needs execution.

Independent maintained UI regressions then demonstrated three real defects against
that unchanged frontend, before the respective fixes:

- `csv-import-journey.spec.ts` actual accepted201 confirmation was observed in
  PostgreSQL, delivery aborted, original retry received an actual401 after isolated
  session expiry, and real password plus issued recovery MFA succeeded. The original
  retry button was then missing because document navigation discarded the command.
  `/private/tmp/capital-csv-401-red.log`, exit1, one intended failure;
  artifacts `/private/tmp/capital-csv-401-red-artifacts`.
- Explicit CSV refresh after an external journal revision advance left the rollback
  review checkbox disabled: child detail refreshed but the parent journal did not.
- Choosing a new unuploaded file left the old batch mapping/preview actionable under
  the new filename. The required cleared/disabled workflow oracle failed.
  Both were run with `node /private/tmp/capital-csv-http-run.cjs
  tests/e2e/csv-import-journey.spec.ts --grep 'explicit CSV refresh|new unuploaded'`:
  `/private/tmp/capital-csv-draft-review-red.log`, exit1, two intended failures;
  artifacts `/private/tmp/capital-csv-draft-review-red-artifacts`.

These are behavioral failures after successful real setup, not missing imports,
compilation failures or mocked application responses. Each isolated run completed
owned cleanup. Fixes preserve the original commands and assertions: SPA unauthorized
navigation with stale-session response guards; explicit parent refresh with revision
checks on late previews and commands; clearing old source/mapping/detail on file
selection. Literal source-key whitespace remains a separate pending regression.
The auth worktree source checks passed 95 tests/10 files, build and lint with retained
warnings. Actual integrated expanded HTTPS verification is running; no GREEN claim
is inferred from its source tests.

## Integrated review fixes and additional evidence — 2026-09-23

At42ac520, `node /private/tmp/capital-csv-http-run.cjs
 tests/e2e/csv-import-journey.spec.ts tests/e2e/csv-import-commands.spec.ts` exited1:
7 UI cases passed and 2 command cases failed, 2.1 minutes, one worker, zero retries.
Log `/private/tmp/capital-csv-journey-first.log`; artifacts
`/private/tmp/capital-csv-journey-first-artifacts`. The three previously demonstrated
UI defects are GREEN. Complete sale-first250/100/0.5 import/provenance/restart/rollback,
lost-confirm and lost-rollback actual403/original200 recovery, and late unchanged
requests after draft edits all passed. Tested frontend:
`sha256:beb9db4ca91dc02fa92521463015b546b0af5a2b1ea7044770c8604363dfd358`.

Both command failures were the same test-oracle ordering bug: sorted actual keys
were compared with an unsorted expected five-key list. Root and independent reviewer
confirmed the exact allowlist; d2b82b3 only reordered expected keys. No financial,
privacy or provenance assertion was removed. This failure is not product RED.

The next actual filtered run, `/private/tmp/capital-csv-literal-and-commands.log`,
exited1: both command cases passed, and the new literal-source regression failed
at its intended visible-whitespace oracle (41.2 seconds for all three cases).
This proves actual two-replica canonical hash equality/replay and both real deferred
COMMIT failure paths: complete-write sequence witnesses, private generic500,
unchanged transactional fingerprints and successful original-key201 then200 retry.
The whitespace case reached valid uploaded/inspected/mapped source keys TOKEN and
leading-space TOKEN, but the latter collapsed visually. Artifacts are preserved
at `/private/tmp/capital-csv-literal-red-artifacts`. Only after that genuine RED,
root added pre-wrap spans to source mapping labels and accepted settings.

A separate selected-manual-target case passed (one case,14.0 seconds) in
`/private/tmp/capital-csv-literal-red.log`: correction and void preserve draft/target,
show every field of its changed current version and require explicit review before
one CAS write. The original grep matched that case only; despite the historical log
filename, it did not execute the whitespace case or establish its RED.

Independent read-only review approved auth lifecycle/generation changes, explicit
CSV refresh, stale economic revision guards and clearing a newly selected file's old
workflow. It also checked docs against input/parser/persistence and confirmed that
document-lifetime recovery is an explicit client boundary, not server-replay weakening.
Actual root frontend95 tests/10 files, lint (29 retained warnings), and build exit0;
logs `/private/tmp/capital-csv-root-frontend-tests.log`,
`/private/tmp/capital-csv-root-frontend-lint.log`,
`/private/tmp/capital-csv-review-fixes-build.log`. Strict OpenSpec12 passed.
These checks precede the small literal rendering repair and remaining read-failure
regressions. Full release verification remains pending.
