## 1. Contract and acceptance

- [x] 1.1 Strict-validate the change and record the baseline of affected suites.
- [x] 1.2 Add backend unit acceptance (CSV input/parser for PCUR-RUB, PCUR-MIXED, PCUR-ERRORS, PCUR-COMPAT; conversion rounding) and frontend component acceptance for PCUR-UI mapping/preview/journal text; run them and record the expected failures.
- [x] 1.3 Add a real PostgreSQL probe for PCUR-MIGRATE, PCUR-RUB confirm/read-back and PCUR-SHAPE, and a critical HTTPS Playwright case PCUR-UI; record probe RED on the pre-change build.

## 2. Implementation

- [x] 2.1 Migration `AddTradePaymentRecords` (payment table keyed by and referencing the version, value CHECKs, refusing downgrade); trade store append/project `payment`; existing PostgreSQL probes learn the new table and migration count (PCUR-1).
- [x] 2.2 CSV settings `payment` and `columns.rate`, per-row currency/rate resolution and conversion, hash/payload compatibility, confirm stores payment, rollback void keeps it (PCUR-2).
- [x] 2.3 Russian mapping section, rate column, dynamic labels, payment text in preview, batch rows and journal (PCUR-3).

## 3. Review and verification

- [x] 3.1 Independently review the diff against the spec; resolve findings without weakening assertions.
- [x] 3.2 Run backend/frontend lint, build and unit tests, engineering gates, strict OpenSpec and the PostgreSQL probe locally; rely on hosted CI for the critical browser case; record what ran where in verification.md.
- [ ] 3.3 Archive with the installed CLI after hosted acceptance is green and confirm canonical spec sync.
