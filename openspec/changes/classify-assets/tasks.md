## 1. Contract and acceptance

- [ ] 1.1 Strict-validate the change and record the baseline of the affected suites.
- [ ] 1.2 Add backend unit acceptance for AST-NEW, AST-RULES and AST-LEGACY (input parsing and service-shaped create/list results) and frontend component acceptance for AST-UI; run them and record the expected failing assertions before implementation.
- [ ] 1.3 Add the real PostgreSQL probe `asset-classification-db.cjs` (AST-TYPES upgrade from migration 23 with an opening, trades and prices; AST-NEW, AST-RULES, AST-LEGACY through the compiled service; direct-SQL checks) and wire it into acceptance; record its RED on the pre-change build.

## 2. Implementation

- [ ] 2.1 Add migration `ClassifyAssets1790700000000` and the entity fields; bump the migration-count probes and the migration acceptance to 24 with the reviewed column/constraint exception (AST-2).
- [ ] 2.2 Add classification parsing and derivation; return the fields from create and list; keep the legacy replay payload (AST-1, AST-2).
- [ ] 2.3 Add the Portfolio asset list, filters and the "Add asset" dialog in the new shell, replacing the Portfolio placeholder; update SHELL-005 and the shell E2E (AST-3).

## 3. Review and verification

- [ ] 3.1 Independently review the diff against the spec; resolve findings without weakening assertions.
- [ ] 3.2 Run backend/frontend lint, build and unit tests, engineering gates, strict OpenSpec and the new probe locally; rely on hosted CI for critical browser acceptance and the full probe set; record what ran where in verification.md.
- [ ] 3.3 Archive with the installed CLI only after hosted acceptance is green, and confirm canonical spec sync.
