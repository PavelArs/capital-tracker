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

Next bounded change: record-manual-opening-positions, independently reviewed artifacts
in ../capital-tracker-worktrees/manual-opening-spec through fd29f1d, to integrate next.
Manual accounts/instruments, numeric(78,30) exact strings, known/unknown aggregate USD
opening cost, explicit UTC coverage, immutable complete revisions, owner isolation,
idempotency and CAS. Four additive tables/migration13. No CSV/FIFO/prices/aggregation.
QA is writing genuine old-image real-auth RED in manual-opening-acceptance worktree;
no behavior implementation until it runs. Review vectors:
/private/tmp/capital-manual-openings-acceptance-review.md. Preserve raw types before
global DTO conversion, PostgreSQL finite/null checks, UUID lowercase identity,
replay-before-CAS, rollback at actual deferred commit. Allow legitimate session
lastSeenAt authorization touch outside accounting transactions.

Later required: CSV/trades/FIFO/fees, owned transfers and flows, performance/XIRR/TWR,
DB-first price/FX/history, six chain adapters/reconciliation, optional explicit free AI,
immutable image promotion/security/backup restore and final requirements audit;
only then old-repo consolidation/confirmed duplicate cleanup.

Existing auth worktree commits are integrated; retain until safe cleanup. Agents
 audit_security, gate_acceptance, provider_feasibility are reusable via followup_task.
 send_message does not wake idle agents. Simple docs agent previously completed;
 a later followup failed threadlimit. No approval rejection occurred.
