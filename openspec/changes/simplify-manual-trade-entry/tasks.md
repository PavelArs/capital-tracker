## 1. Contract and acceptance

- [ ] 1.1 Strict-validate the change.
- [ ] 1.2 Add acceptance for TRADE-002-C (input parsing and automatic order resolution, backend) and WORKBENCH-001-B (plain form, frontend); run them and record the expected failures before implementation.

## 2. Implementation

- [ ] 2.1 Backend: optional order in `parseTradeCreate`, automatic resolution in `TradeService.mutate`, canonical payload `null`.
- [ ] 2.2 Frontend: plain `TradeForm` (wording, optional fee, order disclosure, `lockedFields`), command without order when empty, plain receipt.
- [ ] 2.3 Update unit tests and Playwright cases for the renamed label and the order disclosure without weakening asserted results; add a browser case for two date-only purchases on one day.

## 3. Review and verification

- [ ] 3.1 Independently review the diff against the spec; resolve findings.
- [ ] 3.2 Run backend and frontend lint, build and unit tests, strict OpenSpec, Playwright listing and E2E typecheck; exercise the form against the local HTTPS/PostgreSQL stack; record results in verification.md.
- [ ] 3.3 Archive after hosted acceptance is green.
