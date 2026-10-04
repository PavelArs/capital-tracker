## 1. Contract and acceptance

- [x] 1.1 Write proposal, design and PV-1..5 scenarios with the modified AST-3; strictly validate.
- [x] 1.2 Write acceptance before behavior: Jest projection tests (PV-MARKET, PV-STALE, PV-NONE, PV-FIXED, PV-BR11, PV-REALIZED, PV-UNKNOWN-COST, PV-ALLOC), frontend component tests (PV-UI, AST-UI), the real PostgreSQL probe `tests/e2e/portfolio-valuation-db.cjs` (PV-TOTAL, PV-PRIVATE, PV-MARKET, PV-STALE, PV-MANUAL, PV-FIXED, PV-REALIZED, PV-ALLOC) and the critical browser case `PORTFOLIO-UI`.
- [x] 1.3 Run them against stubs and record the expected failures.

## 2. Implementation

- [x] 2.1 Shared latest-market-price read; manual latest-price read (PV-2).
- [x] 2.2 Whole-portfolio projection: holdings, prices, cost, average, P&L, allocation (PV-2..4).
- [x] 2.3 Service and `GET /accounting/portfolio` in one read-only snapshot (PV-1).
- [x] 2.4 Portfolio page and Asset details page (PV-5, AST-3); SHELL-UI updated.

## 3. Review and verification

- [x] 3.1 Independent review of the diff against the spec; fix findings without weakening assertions.
- [x] 3.2 Run scoped checks locally (lint, build, unit tests, real PostgreSQL probe) and record them in `verification.md` with screenshots.
- [ ] 3.3 PR checks green; after merge, main CI with the probe and `PORTFOLIO-UI` green.

## 4. Archive

- [ ] 4.1 After 3.3, strictly validate and archive with the OpenSpec CLI.
