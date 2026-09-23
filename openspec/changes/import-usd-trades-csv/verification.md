# Verification: import-usd-trades-csv

Status: genuine predecessor-image CSV RED demonstrated; implementation now in progress.
GREEN, expanded migration/PG/browser verification and archive remain pending.

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
| CSV-001-A / CSV-006-A | Maintained predecessor-image real MFA upload/UI RED, then full journey GREEN | Genuine expected RED: two failures; GREEN pending |
| CSV-001-B / CSV-002 | Independent csv-input/csv-parser tests plus actual Nest/HTTPS transport and format cases | Independent122 input/parser tests passed; HTTPS transport pending |
| CSV-001-C / CSV-003 / CSV-004 | Production CsvImportService with real PG exact vectors, races, caps, provenance, deferred COMMIT and retry | Not written/run |
| CSV-005 | Real RR read barriers and state-pinned provenance; replica hash equality and stale preview denial | Not written/run |
| CSV-006 / CSV-007 | Real Russian browser and private HTTPS/auth/CSRF/owner/log tests, actual transport faults | Not written/run |
| CSV-TRADE-001 | All retained manual/USD source/PG/HTTPS characterization plus atomic range assertions | CSV not run; predecessor passed |
| CSV-MIG-001 | Release-image fresh15/replay and populated14-to15 plus all older upgrade/refusal cases | Not written/run |

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
