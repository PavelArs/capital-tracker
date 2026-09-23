# Verification: record-manual-opening-positions

Status: required local verification passed and actual OpenSpec archive completed on
2026-09-23. Canonical manual-opening-positions and explicit-migrations specs are synced.
Earlier failures and interim notes below are retained as chronological evidence.

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

## Independent source review

A separate reviewer inspected the raw input/global-pipe boundary, owner-scoped SQL,
uniqueness/replay/CAS and awaited transaction, explicit response projections and
root DDL; no backend/security blocker found. The reviewer identified a test oracle
weakness:101 identical positions proved duplicate rejection instead of the size cap.
Root strengthened it with100 valid distinct UUIDs and101 distinct rejection, plus a
positive256-character leading-zero amount. Both accounting suites now pass126tests
(capital-manual-boundary-reviewed.log). No product assertion was weakened.

Frontend review is still active. Initial findings cover replay/current-state mismatch,
stale asynchronous navigation, edits during pending saves, duplicate picker entries
and conflict reload recovery. They must be resolved before final acceptance/archive.

## Integrated source and frontend review

Root integrated frontend dee2a7a, independent-review fixes fe8962b and final bounded
history refresh f0a90f2. Independent review found no remaining blocker after repairs:
POST receipts no longer replace the actual current snapshot; fresh GET supplies it.
Generation guards reject stale account-route responses; pending forms lock inputs;
conflicts preserve drafts and require explicit reload/review; picker entries merge
by UUID, creation exposes a direct account link, and history requests use version
checks and refresh after save. No own-backend/authentication mock was added.
Expanded independent HTTPS tests integrated2d59dbb, strictTSC/discovery passed85total.
They include actual blocked writes proving disabled inputs, deterministic overlapping
requests through both real upstreams, safe commit500 and retained private boundaries.

pnpm verify:baseline exited0 in capital-manual-baseline-first.log after integration.
Frozen offline install and required high-threshold audit both exited0 in
capital-manual-frozen.log and capital-manual-audit.log. Two known moderate Router
findings remain visible and unsuppressed; lockfile is unchanged. Full release-image
verification still remains; no archive or full product completion is claimed.

## First full image run: failed, retained evidence

`pnpm test:e2e` exited1 in capital-manual-image-first.log:77 passed,8 failed,1.5h.
All real PostgreSQL/migration/CLI/artifact prerequisites ran before browser checks.
First traces/report are retained under /private/tmp/capital-manual-first-artifacts.
This run is not full acceptance and the change stays active.

One new case reached its final provider assertion after all exact UI/PG/history
checks passed: two existing constructor CoinGecko BTC/ETH warmups were wrongly
included in the expected zero accounting delta. Independent code/trace review
confirmed CryptoPricesService startup behavior predates this change. Commit dbe3311
now requires the complete provider log unchanged before restart, exactly two known
warmup records at restart, and the complete new log unchanged afterward. It does
not filter requests or weaken amount, history or accounting-provider assertions.
OPEN-001-A now states this distinction explicitly.

Another new case failed before its body in selectBackend('both'). The synthetic
upstream lacked shared worker state; a64KiB zone is added while preserving the real
two-address routing oracle, identity rules, retry-off and production template.
[Nginx zone documentation](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#zone)
confirms the supported shared-state behavior. Per-worker distribution is a plausible
historical cause, not proven after container cleanup; real rerun is required.

Five retained failures contain618/899-second trace gaps coinciding with local system
sleep; another recovery400/401 mismatch shows the backend Date jumping899 seconds
after issuing a five-minute pending cookie. No authentication assertion is changed.
System evidence is /private/tmp/capital-manual-sleep-evidence.log; independent triage
and complete awake rerun are required. macOS caffeinate -is will keep the next command
awake without changing application clocks, timeouts or system sleep settings.

After failure, Docker read checks found zero owned Compose containers/networks.
Owner Nginx retained its original SHA256/mode0644/1348bytes; lockfile hash unchanged.

## Final verified release-image result — 2026-09-23

`PATH=/Users/pavelars/.nvm/versions/node/v22.21.1/bin:$PATH caffeinate -is pnpm test:e2e`
exited 0 in `/private/tmp/capital-manual-image-second.log`. All 85 Chromium cases
passed, one worker, zero retries, 17.6 minutes of browser execution: all 74 retained
cases and 11 new manual-opening cases. Every prior failed case passed with retained
security/amount assertions. This was a fresh synthetic database and a full image run,
not a selected retry. The two legacy startup requests are asserted exactly and the
accounting intervals still require zero external-provider requests.

All preceding real PostgreSQL/migration/CLI/session/MFA/expiry/provider-TLS and
27 invalid-HTTP-startup checks passed. Fresh thirteen migrations, populated12-to13,
replay and all retained unsafe-history refusals passed. The independent manual DB
fixture covered exact values, direct constraints, two-process serialization and
post-write deferred-COMMIT rollback. Browser acceptance independently covered that
rollback through authenticated HTTPS, safe errors/logs, real UI conflicts, disabled
in-flight inputs, bounded discovery/history and exact persistence through restart.

| Contract | Executed evidence |
| --- | --- |
| OPEN-001/002 | manual-opening-red.spec.ts and manual-opening.spec.ts: actual forms/API/PG exact strings, zero versus unknown, raw types, UUID identity, labels and pagination |
| OPEN-003 | manual-opening-db.cjs and browser cases: two real process/upstream races, replay/CAS, immutable history, deferred commit failure and explicit retry |
| OPEN-004 | migrations.cjs populated predecessor preservation plus real private/CSRF/Origin/foreign-ID and safe-log HTTP cases |
| Retained behavior | All prior 74 HTTPS cases and all previous migration/authentication/CLI/provider/artifact prerequisites |

Exact tested images, independently inspected after cleanup:
- backend `sha256:9efd443953ddd723844aca23da46a9de6b016ffbc16b443ed65a933b3f35ce47`
- frontend `sha256:cca53f6ade800efbb256f5164f37ebf4b4085190bde35253b44fe394ee0bf084`

Source baseline remains exit0:667 backend tests/22 suites,81 frontend tests/10 files,
both lint/build, frozen install and required high-threshold production audit. After
the fixture correction, `pnpm test:engineering` passed183 tests/2 suites in
capital-manual-fixture-engineering.log; strict OpenSpec and diff checks passed.
No production dependency changed. Existing77/29 lint warnings, bundle warning and
two documented moderate dependency findings remain visible; no advisory suppression.

The harness completed its file-preservation finally check. Independent Docker reads
found no owned Compose containers/networks or direct source-probe containers.
Owner frontend/nginx.conf remains SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432,
mode0644,1348bytes, unstaged. Lock SHA256 remains
13e4fbf1d1effcf66367ef7829885eb53b339cb9f52ab43854ca2e4ba77c4e73.
Only synthetic tmpfs PostgreSQL data was created/removed. Existing owner data,
original project folders, Git history, configuration and unrelated work are preserved.

Hosted CI, second-browser execution, full image/SAST/DAST/ASVS scans, backup/restore
and production rollout remain unexecuted. CSV/FIFO/prices/returns and the remaining
full brief are not completed by this opening-only slice. No production-readiness claim.
