# Endpoint TWR verification

Status: implemented, independently reviewed, actual PostgreSQL and selected HTTPS GREEN; archived.

Base1aa3369: 23 canonical specs, no active changes and only owner Nginx edit.
Installed OpenSpec1.2.0 spec-driven workflow, Node22.23.2 host/pinned22.21.1 images,
pnpm10.33.0, Playwright1.63.0 and PostgreSQL16.10. No tool/dependency replacement.

Keep: existing manual valuation/profit/XIRR inputs, private owner flow snapshot,
React period form, guards, schema19, GHCR/Compose and guarded manual CD. Simplify:
reuse validation and snapshot rather than fetch/paginate flows in the browser.
Remove: nothing. No backend/API retirement, data write, chart, migration, dependency,
provider, production or original-folder change. User chart max-period review deferred.

Contract3aaaf37 independently reviewed by Sol: lower-bound net adjustment, strictly
interior nonzero-net counts, exact percent from rounded rate and rounding-only bound
confirmed. Root pure and actualPG acceptance6b000c3 independently reviewed by Sol;
no blocking oracle/fixture issue. No product implementation precedes genuine RED.
Missing imports/prerequisite errors are not counted as behavioral RED.

Baseline `pnpm --dir backend test --runInBand --coverage=false period-profit xirr`
passed82 tests/2suites in2.934s. `/private/tmp/capital-twr-baseline.log`.
Strict24items (23canonical+active) passed. The previous accepted frontend baseline
is98tests/12files at1aa3369; this slice will run the changed frontend checks again.

Risk-based manifest: pure endpoint/tie/high-precision/gap/1000-head oracles; real PG
coverage/complete effective heads/ownership/all-row/provider preservation and actual
two-pool snapshot across committed correction; TWR-API and TWR-UI plus unchanged
XIRR-UI over actual HTTPS/password/MFA/backend/PostgreSQL. Relevant unit/lint/build/
TypeScript, required production advisory gate and strict OpenSpec. No full backend,
full E2E, older upgrade matrix, hosted CI, release scan/live provider/production run
selected. Existing test discovery and CI gates remain intact.

Implementation, actual RED/GREEN, review, image IDs and cleanup will be recorded
after execution. No inferred success is claimed here.

## Genuine RED and implementation

Luna two-case HTTPS acceptancef449f70 integratedf1938f2; root reviewed and added
explicit omitted-CSRF case7f686d6. At7f686d6, before any product edit,
`/private/tmp/capital-twr-red.cjs` ran against accepted predecessor images:
- BEsha256:4b6bfc44032298aa1f4c8c342ad5ff9ac16c235d9bbf6c665fb58e227ae61c77
- FEsha256:fd9572099767a0e2a0ef0983408adcc9eb831bec44d3cb69b11ee7816b8baed8

Two expected failures: valid authenticated API expected200 got404, and absent
`Рассчитать TWR` button after10-second expectation. Actual password/MFA/backend/PG;
no fixture/import failure counted as RED. Cases12.3s/21.0s, one worker, zero retries,
exit1. `/private/tmp/capital-twr-red.log` and red-artifacts. Cleanup completed.

Root backend7e39b45 followed genuine RED: pure exact BigInt projector, small private
route/service method sharing existing snapshot, full acceptance runner discovers
new PG fixture. No existing accounting math/validation/snapshot replaced. Sol's
independent backend review found no blocker in arithmetic, boundaries, owner
snapshot or private route wiring. No financial/security assertion relaxed.

Sol UI d228647 in isolated twr-ui worktree integrated4f2305c. Root reviewed API/form/
generation guards; e512cf5 clarified rounding in terms of displayed percentage
(up to10 fractional places), including tiny returns that round to0. Backend rate
still rounds to12 places with the declared bound; no money rounds or test change.
Only two frontend files changed; no abstraction/dependency or CSS churn introduced.

## Source checks and actual PostgreSQL

- Backend `test --runInBand --coverage=false twr period-profit xirr`:109tests/3suites
  passed in2.92s (27new+82retained). `/private/tmp/capital-twr-backend-unit.log`.
- Backend build/lint exit0;77existing warnings. Corresponding backend-build/lint logs.
- Sol frontend98tests/12files, build/lint/scopedBiome exit0;27existing warnings and
  retained Vite>500kB advisory. `/private/tmp/capital-twr-frontend-{test,build,lint,biome}.log`.
- Root browser strict/noUnused TypeScript and scoped frontend/backend Biome passed.
- Production dependency high/critical gate exit0;2existing moderate advisories,
  lock unchanged. `/private/tmp/capital-twr-audit.log`; details remain visible in
  docs/dependency-security.md. No zero-vulnerability claim.

At7e39b45, `/private/tmp/capital-twr-db.cjs` built the backend, ran actual fresh
schema19 migrations, then `twr-preview-db.cjs` and retained `period-profit-db.cjs`.
Exit0, four new and four retained scenario families passed:
- TWR-COVERAGE/PRIVATE: missing/before coverage409, strict number400, complete DB unchanged.
- TWR-ENDPOINT/EXACT:61effective heads exceed50-row page, exact cancellation,
  corrected/voided heads, upper-bound exclusion, owner isolation and unchanged profit.
- TWR-SNAPSHOT: two real max1 pools/distinct PostgreSQL PIDs, reader paused after
  its first actual journal SELECT; committed correction moves initial flow inside.
  First result retains original revision65/rate0.1/profit100, next revision66 has
  missing-boundary state; later void revision67 restores supported manual start.
  Actual COMMIT witness and all-row/provider preservation asserted.
- TWR-BOUND: all1000 heads, exact1000 adjusted starting capital and10percent return.
- Retained PROFIT-COVERAGE, PROFIT-PERIOD, PROFIT-SNAPSHOT, PROFIT-EXACT passed unchanged.

BEsha256:a1975ae4405b23b463845dab0fb46171524b0f9129b8b104d14ae251e7623277.
`/private/tmp/capital-twr-db.log`. No repository/backend/authentication mock.
Only external providers controlled; no provider request added. Harness cleanup
completed. The exact same backend image is selected for the HTTPS run.

## Actual HTTPS GREEN and cleanup

At e512cf5, `/private/tmp/capital-twr-green.cjs` rebuilt the integrated frontend and
asserted the backend digest matched the actualPG run. Fresh schema19/synthetic owner
via production CLI; actual HTTPS/password/MFA/session/backend/PostgreSQL. Only external
providers stubbed, delayed UI delivery uses real `route.fetch()` without fake bodies.

`pnpm exec playwright test tests/e2e/twr-preview.spec.ts tests/e2e/xirr-preview.spec.ts
--grep 'TWR-|XIRR-UI' --workers=1`

Exit0: **3/3 in36.7s**, one worker, zero retries. TWR-API, TWR-UI and unchanged
XIRR-UI/LATE. Exact initial contribution1000-to1100 rate0.1/percent10/profit100,
upper-bound exclusion, interior-flow unavailable/null, strict400/coverage409,
anonymous/pending401, absent/invalidCSRF and hostileOrigin403, no-store, all-financial-
row/provider preservation, input review reset and late actual response after newer
profit all passed. Retained annual XIRR and its unavailable/stale checks passed.
No unexpected GREEN failure or weakened assertion.

- Backend sha256:a1975ae4405b23b463845dab0fb46171524b0f9129b8b104d14ae251e7623277
- Frontend sha256:3a3a6c834db933168a0af0aa06b8a5df01e499a3c68cfef2ca1832f19e0aa919

Artifact/proxy/network containment passed. `/private/tmp/capital-twr-green.log` and
`/private/tmp/capital-twr-green-artifacts`. Harness cleanup completed; subsequent
live labeled container/network lists empty. Owner Nginx mode0644/size1348/SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432 and lock SHA256
6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d unchanged.
No full-suite, release, live-provider or production claim; listed unrun checks
remain unrun. General linked TWR remains future work, not silently approximated.

## Archive

Luna independently audited the final root evidence against logs/assertions; no
inaccuracy or blocker. Installed OpenSpec1.2.0 `archive preview-endpoint-twr --yes`
succeeded with four canonical requirements synchronized, archive2026-09-24-preview-
endpoint-twr. Expected6/7 warning was the self-referential archive task3.2, marked7/7
only after success. Canonical Purpose filled without changing requirements.
Post-archive strict24 canonical specs passed; previous23 specs byte-identical,
new canonical requirements match the archived delta and active changes empty.
