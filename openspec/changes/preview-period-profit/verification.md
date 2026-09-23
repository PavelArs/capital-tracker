# Period profit verification

Status: specified; implementation and GREEN pending. No success claimed for unrun checks.

Genuine predecessor RED: `/private/tmp/capital-profit-predecessor-red.cjs`, exit1,
log `/private/tmp/capital-profit-predecessor-red.log`; both cases fail as expected:
authenticated preview200 vs actual404; new Russian heading absent. Existing origin
and flows were created successfully through real API after real password/MFA.
Pinned predecessor backend b8a8f25490603eeaaad904b2d762cd188045cd81c45b97c813d7c72c14066f28,
frontend d169e6d8d0ef9d96fba34dfa3dcaa4d9799832bc4991f75b53fee811124c571c.
Main test source aaf1a7d plus a return-type-only correction (unused marker property).
Containers/networks removed by finally. No product code existed before this RED.
New pure/PG cases were committed before implementation; missing modules were never
reported as behavioral RED. Root strengthened exact DOM assertions and added a real
response-delivery failure after a successful preview for later GREEN verification.

Acceptance review corrected examples before implementation: pure projection accepts
only the two flow legs, removing an inconsistent synthetic net field; UI loss example
is opening1200/closing2100/contribution1000 = -100. Auth ledger baseline follows the
real extra password step; that legitimate login is not incorrectly counted as a
calculation write. Strict E2E TS caught and removed a leftover marker return type.

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
