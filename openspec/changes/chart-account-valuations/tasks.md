## 1. Contract and acceptance

- [ ] 1.1 Review scenarios independently, record baseline/inventory and strict-validate the contract.
- [ ] 1.2 Add backend range/projection tests, real PostgreSQL series/snapshot/maxima fixture and two focused HTTPS API/UI cases (VCH-TIMELINE/RANGE/PRIVATE/UI); demonstrate missing-route/UI behavioral RED before implementation. Test chart precision/gaps below E2E (VCH-CHART).

## 2. Implementation

- [ ] 2.1 Implement single-transaction series using shared bounded loads and exact existing arithmetic; retain point/historical API characterization (VCH-TIMELINE/RANGE/SNAPSHOT).
- [ ] 2.2 Implement Russian form/table/scatter and stale-intent handling with installed Chart.js; preserve draft and exact strings (VCH-UI/CHART).

## 3. Review and verification

- [ ] 3.1 Independently review backend and UI; resolve findings without weakening assertions.
- [ ] 3.2 Run relevant unit/display-boundary tests, new PG fixture plus retained valuation PG fixture, two new HTTPS cases plus retained VAL-UI, builds/lints, dependency gate and strict specs. Record real commands/results/images, failed attempts and unrun checks; keep full CI suite intact.
- [ ] 3.3 Update guide/verification/continuity, check preservation and isolated cleanup, archive with installed CLI and verify canonical sync.
