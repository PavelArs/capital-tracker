## 1. Specify and characterize

- [x] 1.1 Inspect migration command, schema chain, images, provider startup and UI; write ISO/MIG scenarios.
- [x] 1.2 Write startup/config and real migration acceptance tests; observe intended RED.
- [x] 1.3 Write real browser login/wallet characterization without backend/auth mocks.

## 2. Implement isolation and migrations

- [x] 2.1 Build reproducible production images from frozen workspace lock; exclude tests/fixtures and preserve owner Nginx.
- [x] 2.2 Disable implicit schema/startup migration actions and implement explicit required-config/advisory-lock/preflight migration CLI.
- [x] 2.3 Establish synthetic PostgreSQL/Redis/HTTPS/provider fixture stack and external seed; verify egress/ports.
- [x] 2.4 Run empty migration/replay and unsafe prior-schema refusal on real PostgreSQL.
- [x] 2.5 Run Chromium ISO-003/004/005 through actual release images; fix proven regressions via ATDD.

## 3. Review and release evidence

- [x] 3.1 Add reusable local and CI harness commands without deploying/publishing.
- [x] 3.2 Independently review artifacts, migration boundaries, oracles and security; resolve findings.
- [x] 3.3 Run relevant regression/spec/lint/build checks, record exact evidence and archive only after required gates pass.
