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
