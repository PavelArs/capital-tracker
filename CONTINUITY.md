# Continuity Ledger

## Goal and constraints

Complete capital-tracker-openspec-prompt.md incrementally with OpenSpec and ATDD.
Full refactor is NOT complete. User authorized continued implementation and, only
after full verified replacement, consolidation into /Users/pavelars/Projects/capital-tracker-old
and removal of confirmed related duplicates. Preserve original histories, stashes,
configuration, data and unrelated apps; see docs/consolidation-plan.md. No push,
production deployment, owner database access or folder removal has occurred.

Working branch: refactor/brownfield-baseline. Root owns migrations, shared fixtures,
lockfiles and deployment. Use independent Git worktrees with bounded agent ownership;
simpler models for straightforward tasks, stronger models for security and review.
Keep code clean, compatible and simple. Give short periodic Russian progress updates.
Both future-work preferences were explicitly saved to memory notes on 2026-09-22.

Preserve the unstaged owner frontend/nginx.conf: SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432, mode0644.
No paid services, real data, destructive schema changes or production rollout.
Mock external providers only; backend, password/MFA, sessions and PostgreSQL are real.

## Runtime and workflow

Use PATH=/Users/pavelars/.nvm/versions/node/v22.21.1/bin:$PATH (default Node20 fails).
pnpm10.33.0, OpenSpec1.2.0, Playwright1.63.0, PostgreSQL16.10, Docker29.5.3,
Compose5.5.1. Docker/registry need reviewed escalation. Only synthetic fixed
capital-tracker-e2e project, tests/e2e/compose.yml; never production Compose.
Actual OpenSpec: status/instructions/validate --all --strict --no-interactive/archive --yes.
There is no core verify or validate --change command. After archive fill Purpose
and trim generated whitespace. Do not invent success or manufacture refactor RED.

## Done

Nine verified archived slices: brownfield baseline, isolated release acceptance,
CLI-only owner, opaque sessions, checkout preservation, mandatory second factor,
dependency remediation, trusted client attribution, persistent auth request limits.
Current contracts live in openspec/specs; audit/deployment/keep-simplify-remove and
provider inventories live in docs. Explicit migrations through12 preserve prior data
and refuse unsafe legacy history. Auth includes real Argon2id, encrypted TOTP, single-use
recovery, PostgreSQL sessions/CSRF and fresh-time bounded persistent admissions.

Latest archive: openspec/changes/archive/2026-09-22-persist-auth-request-limits.
Source baseline exit0:541 backend tests/20 suites,81 frontend/10 files, both lint/build,
9 strict spec items. Existing77/29 lint warnings and frontend bundle warning remain.
Frozen offline install and high-threshold audit exit0;2known moderate Router findings
remain visible with followup before production/by2026-10-06. No suppression.
Independent real PG admission fixture passed exact windows, two-process races,
capacity, held-lock expiry, query/deferred-commit failures,2s lock and5s pool bounds.
Full pnpm test:e2e exit0:74 Chromium cases,1worker,0retries,21.7m, plus all migration,
CLI/session/MFA/expiry/artifact/providerTLS and27invalidHTTPstartup prerequisites.
Populated11-to12 preserves all old rows/schema/sequence state. Prior actual replica
and restart RED expected429/actual401 is retained. All synthetic resources cleaned.

Evidence under /private/tmp: capital-ledger-baseline-first.log, capital-ledger-pg-first.log,
capital-ledger-image-first.log, capital-ledger-frozen.log, capital-ledger-audit.log,
capital-ledger-engineering-final.log. CI image timeout20→35min because measured browser
phase exceeded20; onlytimeout changed, independent review and183engineering tests pass.
Tested backend: sha256:dd0b55f720be27be0857d2929b6719c92c4779b8e7711e8ec08999b1835bd84d.
Frontend: sha256:0d12e654473f9b92b7a7caa6af7676fa69e8ead598ec40bad044c6a55581e87a.
Lock SHA256:13e4fbf1d1effcf66367ef7829885eb53b339cb9f52ab43854ca2e4ba77c4e73.
HostedCI, secondbrowser, image/SAST/DAST/ASVS and backup/recovery remain unexecuted.
No full production-readiness or availability guarantee is claimed.

## Now and next

Active record-manual-opening-positions implemented and independently reviewed, not archived.
Current integrated source base1258a50 plus dbe3311 provider-oracle correction.
Actual preceding-image RED153109e: real MFA API201expected/404actual and missing
Russian page, capital-manual-opening-behavior-red.log exit1. Four additive tables,
migration13, exact-string inputs, immutable account-locked opening revisions and
Russian UI are integrated. Focused real PG migration/race/rollback checks passed
(capital-manual-opening-pg-second.log); initial real MFA API passed1case14s.
Root strengthened100/101 distinct positions and256 raw characters;126 new boundary
checks pass. Full baseline capital-manual-baseline-first.log exit0:667 backend22suites,
81 frontend10files, both lint/build and10 strict OpenSpec items. Frozen install and
high-threshold audit exit0; two previously documented moderate findings remain.

First full image run capital-manual-image-first.log exited1:77/85 passed,8 failed,
1.5h. Cleanup verified: no synthetic Compose containers/networks remain; owner Nginx
hash/mode and lock unchanged. First artifacts copied to
/private/tmp/capital-manual-first-artifacts. Manual exact UI/DB/history assertions
passed but a whole-run provider count incorrectly included two retained startup
warmups. Corrected oracle now separately requires zero accounting calls and exactly
two known restart calls, with matching spec clarification and independent review.
One manual test failed before its body in real both-backend routing readiness;
synthetic Nginx shared upstream zone added, actual two-address oracle unchanged.
Candidate per-worker routing cause is not claimed proven without lost container log.
Five retained failures show618/899s trace gaps matching macOS sleep; recovery401
shows a899s server clock jump after login, expiring its real pending session.
Independent triage is finishing. Never relax authentication expiry assertions.
Full rerun will use macOS caffeinate -is for command lifetime. No GREEN/archive yet.

Parallel artifact-only worktree usd-trades-spec prepares record-usd-fifo-trades:
explicit declared-empty origin, bounded USD journal/corrections/void and exact FIFO.
No trade code or schema implemented. Research and independent acceptance notes are
/private/tmp/capital-usd-trades-next-review.md and capital-usd-trades-acceptance-notes.md.
Root owns migrations/shared fixtures/dependencies/deployment; agents own bounded
worktrees. Current manual must verify/archive before next implementation and RED.

Later required: CSV/carry-in/FIFO/fees, owned transfers/flows, performance/XIRR/TWR,
DB-first price/FX/history, six chain adapters/reconciliation, optional explicit free AI,
immutable image promotion/security/backup restore and final requirements audit;
only then old-repo consolidation and confirmed duplicate cleanup. Full goal open.
Worktrees retained; never stage node_modules symlinks. Reuse idle agents.
No approval rejection, production access/deployment, user data change or removal.
