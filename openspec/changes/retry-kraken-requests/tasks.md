## 1. Acceptance tests first

- [x] 1.1 Client tests against the local HTTP server: a pair failing once is repeated and delivered (hourly and daily); a pair failing twice is reported after exactly two requests; an invalid answer is not repeated (`price-providers.spec.ts`).
- [x] 1.2 Record the expected failure (RED) in `verification.md`.

## 2. Implementation

- [x] 2.1 `KrakenClient`: 2 second spacing, one retry after 5 seconds for `rate_limited` and `unavailable`; probe and tests set both pauses to 0.

## 3. Verification

- [x] 3.1 Backend tests, lint, build, the real PostgreSQL probe `prices-db.cjs` and strict spec validation GREEN; record results.
- [ ] 3.2 Hosted CI green on the PR.
