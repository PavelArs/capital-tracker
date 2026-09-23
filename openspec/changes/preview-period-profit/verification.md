# Period profit verification

Status: specified; implementation and GREEN pending. No success claimed for unrun checks.

Baseline: source d6305e1, only pre-existing owner frontend/nginx.conf edit. OpenSpec1.2.0, no active change before this slice. Existing deployment inspected via brownfield audit and unchanged Compose/GitHub workflow. No migration or dependencies planned.

`pnpm --dir backend test --runInBand portfolio-flow.spec portfolio-flow-input.spec` exited0: 57 tests / 2 suites. Coverage output from this scoped run is not whole-project coverage.

Independent contract review: historical_ui (Sol), no blocker; valuation boundary timing, exact response and consent reset incorporated. Reuse audit: carry_docs_review (Luna).

## Risk-based check manifest

| Scenario | Required check |
| --- | --- |
| PROFIT-CAPITAL / EXACT / INPUT | Pure exact arithmetic/input examples, including empty/zero, signed tiny loss, wide totals and strict invalid fields; critical real HTTPS capital example. |
| PROFIT-PERIOD / SNAPSHOT / COVERAGE | Real PostgreSQL current heads, >50 flows, corrections/voids, exclusive upper boundary, foreign ownership, deterministic two-connection snapshot barrier, accounting-row fingerprints unchanged; HTTP coverage refusal. |
| PROFIT-PRIVATE | Real HTTPS password/MFA/CSRF/origin/no-store plus foreign-row DB isolation; no backend/auth mocks. |
| PROFIT-UI / LATE | Real Russian UI calculation/review reset; delayed actual response after editing, failed request hides result. |
| Retained external flow behavior | Existing 57 pure cases, real PostgreSQL flow characterization, one retained critical HTTPS flow journey. |
| Integration | Changed E2E strict TS, backend/frontend build/lint, targeted frontend checks, strict OpenSpec, owner hash/lock/cleanup. |

No full E2E, provider implementation, dependency/security scan changes, schema upgrades or deployment in scope. Existing CI checks remain. Missing checks and failures must stay visible in final evidence.
