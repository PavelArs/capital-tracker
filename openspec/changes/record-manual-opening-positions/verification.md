# Verification: record-manual-opening-positions

Status: implementation in progress; no GREEN or completion claim.

## Independent preceding-image RED

Independent QA authored two maintained cases at d7e0022 (integrated153109e), with
real password/MFA, HTTPS, PostgreSQL and no future table/helper prerequisite. Root
ran node /private/tmp/capital-manual-opening-red.cjs, invoking pnpm exec playwright
 test tests/e2e/manual-opening-red.spec.ts, with Node22.21.1 against existing images:
backend sha256:dd0b55f720be27be0857d2929b6719c92c4779b8e7711e8ec08999b1835bd84d;
frontend sha256:0d12e654473f9b92b7a7caa6af7676fa69e8ead598ec40bad044c6a55581e87a.
No product implementation/schema change or rebuild preceded this run.

Exit1 in /private/tmp/capital-manual-opening-behavior-red.log, two expected failures:
- OPEN-001-B/003-A authenticated creation expected201, actual404, after auth/me200.
- OPEN-001-A protected /manual-accounts has no Ручные счета heading.

Actual migrations12/seed/replicas/renderedNginx/artifact isolation and real MFA
prerequisites succeeded. API finally checks preserved preexisting business/factor/
admission rows and provider requests. Authorized session activity is excluded.
Only external providers are stubbed. Owned synthetic stack was removed in finally;
owner Nginx SHA256 remains115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432.

Backend boundary tests were authored before implementation at191bb2a; a missing
input module was not executed or claimed as behavioral RED. PG/migration and
expanded HTTP acceptance are authored in independent worktrees. Required source,
PG/image verification, review and archive remain pending.

## Initial fixture setup correction

The first focused PG command (capital-manual-opening-pg-first.log) exited1 before
running a migration: Compose requires explicit start_period with start_interval.
The synthetic override now repeats the existing image start_period30s; artifact
comparison still allows only the two cadence differences. No accounting assertion
ran or was relaxed. This setup error is not additional behavioral RED.

## Focused PostgreSQL and API GREEN

After the Compose correction, node /private/tmp/capital-manual-opening-pg.cjs
migrations.cjs manual-opening-db.cjs exited0 (capital-manual-opening-pg-second.log).
The actual image built from the integrated service/migration passed fresh13/replay,
unsafe legacy refusals and populated8/9/10/11/12 upgrades. Every predecessor12 row,
schema and sequence definition is preserved including all four live admission scopes.
New tables start empty. Service probes passed exactstrings/calendar boundaries,
finite/null/compositeowner constraints, actual cross-process request/CAS lock races,
old replay without pointer rewind, and deferred COMMIT failure with exact-one-attempt
sequence evidence, complete rollback and explicit retry. These are real service/PG
checks; its separate error-filter probe does not claim an authenticated HTTP failure.

The initial authenticated API acceptance now passes through real browser/MFA/HTTPS:
node /private/tmp/capital-manual-opening-api.cjs exited0,1case14.0s in
capital-manual-opening-api-first.log. Exact tested backend image:
sha256:9efd443953ddd723844aca23da46a9de6b016ffbc16b443ed65a933b3f35ce47.
Frontend remained the preceding image for this API-only run. Artifact probes verified
the actual image health command/failure policy unchanged, with only the faster
synthetic cadence, and both identical replicas. Owned cleanup and file-preservation
wrapper completed. This does not replace new-page or full retained acceptance.

Backend implementer reports build and125newsource tests passed; root integrated
source build also exits0. Existing frontend client characterization12tests pass
(capital-manual-client-regression.log). Full baseline/expandedHTTPS/review remain pending.
