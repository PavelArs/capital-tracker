## 1. Independent contract and actual acceptance RED

- [x] 1.1 Confirm persist-auth-request-limits is verified and archived before implementation; independently review OPEN-001..004 schema/API/decimal/time/retry contracts and assign non-overlapping worktrees.
- [x] 1.2 Write actual owner/MFA HTTPS manual-account creation/read acceptance and record failing preceding-image behavior before implementing new routes; missing future helper imports are not behavioral RED.
- [x] 1.3 Add independent exact-string/time boundary tests and PostgreSQL race/rollback/preservation scenarios for OPEN-002/003/004 without changing retained security or financial assertions.

## 2. Small exact manual-account implementation

- [x] 2.1 Add only migration 13 and four tables and their typed persistence mappings with exact numeric/check/composite-owner/idempotency/current-snapshot constraints; rehearse populated 12 upgrade/fresh/replay and retain legacy refusal tests (OPEN-004-B).
- [x] 2.2 Implement pure decimal and strict offset-time validation/canonicalization with raw-type defenses, no floating-point amounts or added arithmetic dependency (OPEN-002).
- [x] 2.3 Implement private account/instrument creation and bounded owner-scoped discovery, database-enforced retry identity and consistent 400/404/409 semantics (OPEN-001/004-A).
- [x] 2.4 Implement account-locked replay-before-CAS whole-opening replacement, atomic pointer update and bounded immutable history (OPEN-003).
- [x] 2.5 Add protected Russian list/detail pages, string inputs, manual instrument reuse, explicit UTC coverage, known/unknown cost and safe retry/conflict/history flows using existing layout/forms (OPEN-001/002/003).
- [x] 2.6 Document API precision/time/identity/history limits and no legacy aggregation, valuation or acquisition-history claim; keep providers, authentication and owner configuration unchanged.

## 3. Independent review and verification

- [x] 3.1 Independently review schema, backend/frontend integration and test oracles; resolve demonstrated defects with regressions, including raw-number coercion and concurrent request replay.
- [x] 3.2 Pass supported-runtime frozen install, production audit, lint/build/unit and strict OpenSpec validation; preserve all prior tests.
- [x] 3.3 Pass real PostgreSQL race/atomicity/upgrade checks and full release-image HTTPS Playwright including actual large-string roundtrip/restart and private owner boundaries, with no provider calls from new flows.
- [x] 3.4 Record actual RED/GREEN, exact images, unchanged owner configuration/data and synthetic cleanup; sync/archive/checkpoint only after required terminal verification.
