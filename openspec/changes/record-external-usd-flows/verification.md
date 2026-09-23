# Verification: external USD flows

Status: design/acceptance preparation only. No new product implementation or behavioral
RED/GREEN has occurred. Checkboxes reflect audit/artifact review, not execution.

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
