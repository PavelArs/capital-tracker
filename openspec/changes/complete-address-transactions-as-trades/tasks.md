## 1. Contract and acceptance

- [x] 1.1 Write proposal, design and ADDRT-1..3 scenarios; strictly validate.
- [x] 1.2 Write acceptance tests before behavior: the real PostgreSQL probe `tests/e2e/wallet-address-trades-db.cjs` (ADDRT-COMPLETE, REPLAY, INVALID, ATOMIC, STATE, PRIVATE, MIGRATION), Jest input tests, page tests and the Playwright journey ADDRT-UI.
- [x] 1.3 Run them against a stub (route and migration present, behavior empty) and record the expected assertion failures.

## 2. Implementation

- [x] 2.1 Additive migration 24 with the link table (ADDRT-MIGRATION).
- [x] 2.2 Transaction hook in `TradeService.create` and the completion service and endpoint (ADDRT-COMPLETE, REPLAY, INVALID, ATOMIC, PRIVATE).
- [x] 2.3 Completion state in transaction reads (ADDRT-STATE).
- [x] 2.4 Page: «Дополнить» with account selector and the reused `TradeForm` (ADDRT-UI).

## 3. Review and verification

- [x] 3.1 Independent review; fix findings without weakening assertions.
- [x] 3.2 Run scoped checks locally and record results in `verification.md`.
- [ ] 3.3 Hosted CI: critical acceptance including ADDRT-UI green on the PR head; record run id.

## 4. Archive

- [ ] 4.1 After 3.3 passes, strictly validate and archive with the OpenSpec CLI.
