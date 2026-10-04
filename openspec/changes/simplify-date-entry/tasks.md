## 1. Contract and acceptance

- [x] 1.1 Strict-validate the change and record the frontend baseline.
- [x] 1.2 Add component acceptance for DATE-1-A..D and DATE-2-A/B (`DateEntry.test.tsx`); run it and record the expected failing assertions before implementation.

## 2. Implementation

- [x] 2.1 Add `DateTimeField` and pure date/time conversion (`components/common/DateTimeField`).
- [x] 2.2 Replace every owner-facing ISO text input (trade, swap, reward, transfer, carry-in, opening, journal start, three account analytics tools, selected-accounts valuation, manual prices, period profit/XIRR/TWR, external flows) and rewrite their guidance; apply DATE-2 defaults.
- [x] 2.3 Update existing unit tests and every Playwright case that fills or inspects those controls, without weakening the asserted financial results or request bodies.

## 3. Review and verification

- [x] 3.1 Independently review the diff against the spec; resolve findings without weakening assertions.
- [ ] 3.2 Run frontend lint, build and unit tests, strict OpenSpec, Playwright test listing and an E2E typecheck locally; exercise the changed forms in real Chromium; rely on hosted CI critical acceptance for the HTTPS/PostgreSQL browser path; record what ran where in verification.md.
- [ ] 3.3 Archive with the installed CLI only after hosted acceptance is green, and confirm canonical spec sync.
