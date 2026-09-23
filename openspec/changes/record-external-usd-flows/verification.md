# Verification: external USD flows

Status: required targeted verification and independent review complete; ready for supported OpenSpec archival. Whole project/release remains incomplete.

## Baseline and scope

Main f69c059 has only the preserved owner frontend/nginx.conf edit. The verified
historical-accounting source images are backend
sha256:1f6ce77cba5ad9444ccb8d3a6ba769fc722560bf9145401651f418054a33388f and frontend
sha256:acf24293ebd64f3cbc9425c7e86504402c55109a849a9ac0f46630e7b1d2cc95.
Its archived actual checks are the predecessor evidence:939backend/95frontend unit,
build/lint, five PG families and9selected HTTPS cases; no full140-browser success.
They have not been repeated merely to restate an unchanged baseline. Live image IDs
must be checked before new RED execution. Owner Nginx hash
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432 and lock hash
aa2588325aacdc54e8437d3500c7d2df580cc20cd061d1e3727f30f0dcc1e4f8 remain expected.

Independent simpler-model audit confirmed legacy AssetType.FLOW/income and MetricsService
are floating-point household/value models, not an investor flow ledger. Reuse existing
authentication and exact accounting primitives; leave those old rows/routes unchanged.
Independent gpt-6-sol architecture review found no blocking classification, interval,
locking, replay/RR/privacy or recovery ambiguity. Include identical/different origin
races, saved-key versus foreign-target precedence, and actual SPA401/MFA recovery.
No arithmetic or acceptance runtime result is claimed by either read-only review.

## Targeted acceptance manifest

| Requirement | Planned evidence |
| --- | --- |
| FLOW-001/003 | Pure parsers/projection: positive scale30 bounds, exact atom sums, [from,to), correction time/void, UUID identity, totals before pages,1000 maxima; no provider or profit/holdings field |
| FLOW-001-A/002-A/004-A | Two initial real HTTPS cases: API exact1000+atom/250 journal/history/replay and Russian creation/correction/period review with old accounting fingerprints |
| FLOW-002-B/003-B | Real PG processes: origin/command races, owner journal lock/CAS, rejected-key retry, active/version limits, deferred post-write rollback witness and caller-owned RR read barrier |
| FLOW-004-B | One bounded privacy route-family case and one critical lost-delivery/real401/MFA/SPA recovery journey; no fake backend body/authentication |
| FLOW-005/FLOW-MIG-001 | Fresh17/replay, populated16 carry/trade/CSV/auth state preservation, SQL owner/history/finite constraints and retained destructive legacy refusals |
| Retained | Selected historical-account snapshot and carry/manual-CSV critical cases through actual images; relevant existing pure/PostgreSQL characterization |

Do not expand every arithmetic/raw-validation permutation into a browser case. Full
browser regression, other engines, hosted CI, scanners/release recovery and production
are not required for this bounded change unless a concrete risk justifies them; report
unrun checks explicitly. No test deletion or weakening is part of this slice. Update
only latest-schema fixture counts; retain pinned predecessor assertions unchanged.

Record exact commands/results/images and expected RED failures as they occur. A missing
module/compile/fixture error is not the intended feature RED. All tests/implementation
and the complete canonical migration delta must agree before supported archival.

## Genuine predecessor RED

At49d6d99, `caffeinate -is node /private/tmp/capital-flow-predecessor-red.cjs`
ran exactly `pnpm exec playwright test tests/e2e/external-usd-flows.spec.ts --workers=1`
against the exact predecessor image IDs above (checked live before startup), actual
HTTPS/password/MFA/backend and fresh synthetic PostgreSQL16 schema. Both cases failed
for the intended feature absence: FLOW-001-A initialization expected201/received404;
FLOW-004-A Russian heading missing. No compile/fixture failure was counted as RED.
Terminal exit1; log /private/tmp/capital-flow-predecessor-red.log, synthetic failure
artifacts /private/tmp/capital-flow-predecessor-red-artifacts. Isolated containers and
networks independently confirmed empty after finally cleanup; both owner hashes match.
Luna independently authored initial browser acceptance70209bf (integratedd901dbf);
root reviewed financial oracles and wrote exact pure boundaries49d6d99. Pure tests
were authored before production modules; missing-module failure is not behavior RED.

## Implementation, database and source checks

Root backend37980b5 implements strict canonical input, exact BigInt period totals,
owner journal locking, immutable versions/replay and RR readonly reads; migration17
adds only portfolio_flow_journals/portfolio_flow_versions. Sol's independent PG
acceptance68cb060/beb74cb was integrated07b402d/72cfc5e. Root reviewed it and added
SQL constraint/down probes plus complete populated16 and predecessor preservation
inbb5f941. `capital-flow-db-focused.cjs` built backend and passed seven actual PG
families, exit0; log /private/tmp/capital-flow-db-focused.log.

`caffeinate -is node /private/tmp/capital-flow-migrations-focused.cjs` reused that
backend and ran migrations.cjs, external-usd-flows-db.cjs and
historical-accounting-db.cjs in a fresh synthetic stack: exit0. Log
/private/tmp/capital-flow-migrations-focused.log. Fresh17/replay, advisory lock,
populated/empty unsafe-legacy refusal, upgrades8..16, authentic factors/sessions/
admissions and old financial rows/schema all passed. The populated16 fixture
includes original partial carry-in allocation, sales, corrections/voids, CSV bytes
and original receipts; unlike pre16 there is NO carry-in schema-change exception.
Eight flow PG families pass including separate-process origin/CAS races, actual
FOR UPDATE wait, deferred COMMIT failure after both SQL writes, rollback+retry,
RR read barrier,1000active/10000versions and exact51-digit totals, positive/finite
storage, composite owner/history uniqueness, RESTRICT and refused destructive down.
Retained historical PG characterization passed. No owner DB is involved.

Pure57/2 passed before first build. Later complete backend Jest996/32 passed11.1s,
exit0; backend build and lint pass (77existingwarnings); frontend lint passes
(29existingwarnings). Sol frontend70f6e84 integrated71ab642; its existing95/10
Vitest, TS and Vite build passed; root independently reviewed source and applied
actual frontend Biome configuration (formatting only). Initial agent formatter
used defaults, so its scoped format result was not the repository-format gate.
Root strict E2E TypeScript passes. Frozen install and production high/critical
audit exit0; audit retains2existingmoderate findings in docs/dependency-security.md.
Logs /private/tmp/capital-flow-{backend-unit,backend-lint,frontend-lint,frozen-install,audit}.log.
Independent Sol review of root backend/migration/tests atbb5f941 found no blocker
in classification/locking/replay/RR/SQL/privacy or preserved predecessor16 schema.
This does not substitute for the remaining actual UI scenarios.

## Intermediate HTTPS results and fixture corrections

Initial focused3-case run exit1, log /private/tmp/capital-flow-focused.log:
Luna's privacy oracle incorrectly treated the caller's own UUID echoed in the
existing error path as private disclosure; it also compared dynamic timestamp/
request paths. Corrected oracle compares every remaining error field and asserts
exact caller paths, valid time, no foreign owner/private marker/financial fields.
Global error responses were not changed to satisfy that fixture. The owner-wide
journal persisted between independent cases, causing later valid409 and missing
initialization form. A guarded flow-only fixture now isolates the two new tables
between cases (never within a journey), retaining all old financial/auth rows.
It verifies exact synthetic database/user identity before TRUNCATE, without CASCADE.
The fixture tolerates absent tables only for the archived predecessor RED.

Rerun unchanged images log /private/tmp/capital-flow-focused-rerun.log: API and
privacy passed; UI timed out on an overly literal implicit-label locator for the
select, despite the accessibility snapshot showing combobox 'Направление'.
The locator now uses that actual role/name; no business assertion changed. The
finally admission oracle also failed after that120s timeout; it was retained,
not relaxed. This run is not a complete focused pass. Root then added a real
delayed-history assertion for a source-review risk: choosing another flow must
not display previous flow versions under its ID. UI/recovery execution is ongoing.

## Independent UI finding and correction

Root review identified mixed version history when selecting another flow while
its real response is delayed. Acceptance265c457 (same existing UI case, no new
case) held an actual route.fetch response: the new flow heading still showed the
previous flow's1000 USD cell (expected0cells, received1). This is genuine product
RED against frontend sha256:f50dc3f3d12875f07dfc89b61c99b7df593731983cf790bca9bbd8bb7d1107ff
and backend sha256:b8a8f25490603eeaaad904b2d762cd188045cd81c45b97c813d7c72c14066f28.
Log /private/tmp/capital-flow-ui-review.log, terminalexit1. In the same run the
critical original-command recovery case passed through actual POST201 delivery
loss, SPA, expired-session401, password/recovery-factor MFA, identical POST200
receipt, failed real journal-read delivery and explicit successful refresh.

Fixea7cceb clears history on a fresh selection, retaining matching immutable
continuations and generation guards. Sol independently reviewed the exact root
fix and assertion and found no blocker. The failed test's cleanup also raced
unroute against route.fulfill; it now waits for handler completion. This secondary
fixture cleanup error did not cause or explain the observed stale1000 cell.
Final UI/recovery plus two retained critical HTTPS cases passed on the rebuilt
frontend and unchanged cached backend; exact terminal evidence follows.

## Final targeted result — 2026-09-23

At productfixea7cceb, `caffeinate -is node /private/tmp/capital-flow-final-focused.cjs`
built the actual release-candidate images and ran this concrete Playwright selection:

```sh
pnpm exec playwright test tests/e2e/external-usd-flows.spec.ts:293 \
  tests/e2e/external-usd-flows-recovery.spec.ts \
  tests/e2e/historical-accounting.spec.ts:220 \
  tests/e2e/carry-in-csv.spec.ts --workers=1
```

All4 passed in53.4s, Chromium,1worker,0retries, terminalexit0. Log
/private/tmp/capital-flow-final-focused.log; synthetic artifacts
/private/tmp/capital-flow-final-focused-artifacts. This establishes the genuine
mixed-history failure is fixed, all delayed/pinned409/current-page/unsaved-draft
assertions pass, recovery preserves exactly one original operation, and retained
account-history/carry-manual-CSV correction/rollback/receipt paths remain passing.
Release artifact/isolation checks and actual migration/seed/bootstrap/authentication
ran before the browser cases. Real authentication/backend/DB were never mocked;
network-loss tests fetch the actual response and interrupt only delivery.

Final backend sha256:b8a8f25490603eeaaad904b2d762cd188045cd81c45b97c813d7c72c14066f28
Final frontend sha256:d169e6d8d0ef9d96fba34dfa3dcaa4d9799832bc4991f75b53fee811124c571c
The two API/privacy cases passed in the earlier partial run against the identical
backend; the later product change affects only frontend history selection. They
were not redundantly rerun. The selected manifest therefore covers6distinct HTTPS
cases:4new and2retained. Earlier failed whole runs remain explicitly failed above.
No complete144-case suite result is claimed. Other engines, hostedCI, image/ZAP/
secret scans and production/recovery release exercises were not run for this slice.

Strict E2E TypeScript and final frontend lint exit0; final Docker build includes
TypeScript/Vite, and backend remains the version with996passing unit tests and all
PG results above. OpenSpec strict all15 passed before archive. Independent final
container/network listing is empty; owner Nginx mode0644,size1348 and hash unchanged,
lock hash unchanged. No dependencies, provider services, owner data, production
configuration or existing project folders were changed. Shared CI runner retains
all prior gates and now includes the new PG probe. Original-folder consolidation
is still deferred until the whole target brief is verified.

Final simpler-model read-only audit found no spec/acceptance/migration-count
mismatch. The two document findings were an inventory separator (corrected)
and the active evidence link (retargeted during archival). Archive remains the
last task; it will be checked only after the supported command succeeds.
