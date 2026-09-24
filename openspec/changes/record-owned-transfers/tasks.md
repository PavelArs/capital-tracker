## 1. Specify and establish acceptance

- [x] 1.1 Freeze reviewed proposal/design/persistence/deltas and validate using installed OpenSpec1.2.0; retain independent numerical oracles (TRANSFER-001..006).
- [x] 1.2 Write independent pure/real PostgreSQL/two HTTPS acceptance tests; root-review scenarios and demonstrate intended behavioral RED against the accepted predecessor images before changing product behavior. Record actual failures and baseline evidence in verification.md.

## 2. Implement connected accounting

- [x] 2.1 Share exact per-account FIFO book and bounded connected replay, original-coordinate provenance, fee-once and inclusive historical prefixes; preserve unchanged single-account characterizations (TRANSFER-001/004).
- [x] 2.2 Add migration20, strict transfer input/store/service/private routes, immutable complete versions/receipts, dual pins and terminal void; preserve existing rows (TRANSFER-002/006).
- [x] 2.3 Integrate owner-before-account locking and graph replay/invalidation into trade, origin/opening and CSV writers; expose actual local version count and revision budget; reject connected deficits atomically (TRANSFER-003).
- [x] 2.4 Integrate connected current/historical/valuation/series projections and bounded provenance pages inside the same snapshot, retaining untouched DTOs and chart limits (TRANSFER-004 and seven modified capabilities).

## 3. Integrate owner workflow

- [x] 3.1 Implement protected Russian transfer review/create/correct/void/allocation and explicit identical retry after ambiguous delivery; extend existing TradeResults/API unions with explicit transfer provenance and unique fragment keys; preserve unrelated trade drafts (TRANSFER-005).
- [x] 3.2 Independently review security, financial conservation, contract/test consistency, bounds, concurrency and UI; resolve findings without weakened oracles. Refactor only after passing targeted checks.

## 4. Verify and archive

- [x] 4.1 Run reviewed targeted manifest: affected unit/type/lint/build checks, real PostgreSQL constraints/migration/preservation/replay/races/snapshots, two new HTTPS cases plus selected retained critical journeys, strict OpenSpec and production audit; record actual outputs/images, warnings and unrun checks.
- [ ] 4.2 Update owner guide/continuity and verify preserved Nginx/lock/data; archive with installed CLI only after all required checks pass, verify canonical spec deltas and cleanup isolated test resources.
