## 1. Specify and characterize

- [x] 1.1 Confirm baseline118 tests; independently extend existing SWAP-UI/REWARD-UI with descriptions and responsive evidence, demonstrating actual missing-description RED before implementation.

## 2. Implement in isolated worktrees

- [x] 2.1 Group swap form and associated hints while preserving every handler/guard.
- [x] 2.2 Group reward form and independent evidence hints with original handlers/guards.
- [x] 2.3 Extract scoped shared operation-form CSS from trade presentation; integrate both forms and retain trade markup/controller behavior.

## 3. Review and verify

- [x] 3.1 Independently review financial UI semantics, source preservation and responsive screenshots; resolve findings.
- [x] 3.2 Run scoped verification, document actual evidence/limits and preserve owner files/data/preview; clean only task symlinks and synthetic runtime.
- [ ] 3.3 Archive with actual OpenSpec CLI, compare added/untouched specs and strictly validate; mark only after this procedure.

## Verification manifest

Extend existing SWAP-UI/REWARD-UI only: accessible guidance RED, filled conditional
fields, both themes360/768/1440 and action/control bounds; preserve all null/zero,
fee-source, stale-review, exact committed-response loss/replay/SQL/account-isolation
oracles. Run those plus retained WORKFLOW-UI for the shared trade CSS extraction:
three real HTTPS/password/MFA/backend/PostgreSQL journeys,1worker0retries; external
providers only stubbed. No new E2E suite or financial assertion weakening.

Retain118 frontend characterization; build/lint, scoped Biome, strict E2E types,
required production audit and OpenSpec. Pure CSS/refactor keeps passing tests; no
new tests that mirror markup. No repeated full E2E/backend/SQL/security matrix because
controllers/backend/schema are untouched. Independent source/screenshot review is a
required gate; complete-redesign, preview and release claims remain out of scope.
