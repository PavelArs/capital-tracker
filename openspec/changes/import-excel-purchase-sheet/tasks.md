## 1. Contract and acceptance

- [ ] 1.1 Strict-validate the change; record the baseline of the affected suites and the existing CSV PostgreSQL probe.
- [ ] 1.2 Add backend unit acceptance for SHEET-SAMPLE, SHEET-SAME-DAY (order assignment), SHEET-INVALID, SHEET-EXPLICIT and the reconciliation arithmetic (SHEET-RECON-SAMPLE/MISMATCH); add frontend component acceptance for the settings builder and preset (SHEET-4); run them and record the expected failing assertions.
- [ ] 1.3 Add the real-PostgreSQL probe `tests/e2e/excel-purchase-import-db.cjs` (SHEET-SAMPLE, SHEET-SAME-DAY, SHEET-DUPLICATE, SHEET-RECON-*, existing-settings hash stability) and run it against the pre-change build to record RED.
- [ ] 1.4 Add the Playwright journey SHEET-UI and select it in the critical manifest.

## 2. Implementation

- [ ] 2.1 Settings: tab delimiter, date mode, optional side/fee/order with companions; stable canonical tuples (SHEET-1, CSV-002).
- [ ] 2.2 Normalization: date parsing, fee 0, all-buy, order assignment and duplicate guard in preview/confirm (SHEET-1/2).
- [ ] 2.3 Reconciliation module and read-only route (SHEET-3).
- [ ] 2.4 Russian UI: delimiter, date mode, optional columns, preset, reconciliation table; docs/csv-imports.md (SHEET-4).

## 3. Review and verification

- [ ] 3.1 Independently review the diff against the spec; resolve findings without weakening assertions.
- [ ] 3.2 Run lint, build and unit tests for both packages, engineering gates, strict OpenSpec and the PostgreSQL probes locally; rely on hosted CI for the browser path; record what ran where in verification.md.
- [ ] 3.3 Archive with the installed CLI only after hosted acceptance is green, and confirm canonical spec sync.
