## 1. Specify and characterize

- [x] 1.1 Record actual hosted audit RED, all severities, official Axios/npm metadata and exact fix floor (AXS-001-A).
- [x] 1.2 Preserve passing pre-upgrade provider/frontend characterization; record real local backend HTTP adapter checks separately with durable fixture `tests/transport/axios-http-characterization.cjs` (AXS-001-B).

## 2. Remediate and verify source

- [x] 2.1 Pin backend/frontend Axios 1.20.0, target lock resolution and update the image probe assertion without broad refresh (AXS-001-A).
- [x] 2.2 Pass frozen install, scoped characterization, backend/frontend lint, strict types and builds; record logs/hash (AXS-001-B).
- [x] 2.3 Run full real production registry audit and required high/critical gate, preserving all lower-severity findings (AXS-001-A/C).

## 3. Independent release verification

- [ ] 3.1 Resolve independent review findings on the frozen source and dependency graph.
- [ ] 3.2 Root verifies rebuilt release-image provider TLS/transport and selected real HTTPS/MFA/CSRF/browser/PostgreSQL acceptance; record separate evidence (AXS-001-B).
- [ ] 3.3 Integrate final evidence, validate strict OpenSpec, and archive only after all required gates pass.
