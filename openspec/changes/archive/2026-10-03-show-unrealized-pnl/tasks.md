## 1. Contract and acceptance

- [x] 1.1 Strict-validate the change and record the baseline of affected suites.
- [x] 1.2 Add backend unit acceptance for UPNL-EXCEL, UPNL-GAPS and UPNL-PORTFOLIO (pure projection plus service-shaped results) and frontend component acceptance for UPNL-UI; run them and record the expected failing assertions before implementation.
- [x] 1.3 Extend real HTTPS/PostgreSQL Playwright cases (VAL-API, MPV-API, REWARD-API exact values; VAL-UI and MPV-UI rendered summary and rows on the existing critical cases without renaming them) and the valuation PostgreSQL probes; record probe RED on the pre-change build.

## 2. Implementation

- [x] 2.1 Add signed scale-60 formatting and `projectUnrealized`; wire it into account valuation and selected-accounts projection; keep valuation history unchanged (UPNL-1/2).
- [x] 2.2 Add API types and Russian display in the account valuation form and selected-accounts panel; update the method note (UPNL-3).

## 3. Review and verification

- [x] 3.1 Independently review the diff against the spec; resolve findings without weakening assertions.
- [x] 3.2 Run backend/frontend lint, build and unit tests, engineering gates and strict OpenSpec locally; rely on hosted CI critical acceptance for the VAL-UI/MPV-UI browser path; record what ran where in verification.md.
- [x] 3.3 Archive with the installed CLI only after hosted acceptance is green, and confirm canonical spec sync.
