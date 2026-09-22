# Dependency remediation verification

Date: 2026-09-22. Node 22.21.1, pnpm 10.33.0, OpenSpec 1.2.0.
Preceding verified checkpoint: `93f7f94`. This is a production dependency refactor;
passing application characterization was retained without artificial application
failures. The new mandatory CI gate received independent failing acceptance first.

## Scenario and command evidence

| Scenarios | Actual command/oracle | Observed result |
| --- | --- | --- |
| DEP-001-A | Original `pnpm audit --prod --json`; new `pnpm audit:production` before dependency updates | Both exit 1: 25 high, 38 moderate, 3 low, 0 critical; 324 production dependencies. Compact dated registry evidence: audit-before.json. |
| DEP-001-A/B, ENG-001-B/D RED | Independent QA executes the actual old workflow aggregate shell command with dependency-audit missing/failure/cancelled/skipped/unknown/empty/null | All seven incorrectly exit 0; the expectation runner exits 1. Success control exits 0. This proves the old aggregate bypass, independently of missing job configuration. |
| DEP-001, ENG-001 GREEN | `pnpm --dir backend exec jest engineering/gates --runInBand` | Exit 0; 183 tests across the aggregate and preservation suites. Required ninth job is in both needs and the actual shell argument list; no suppression/conditional bypass. |
| DEP-001-C, DEP-002-A | `pnpm install --frozen-lockfile` | Exit 0 after selected compatible parent updates and targeted transitive refresh. |
| DEP-001-C, DEP-003-A | Final `pnpm audit --prod --json` | Exit 1: exactly 2 moderate React Router records, 0 high/critical/low, 329 production dependencies. audit-after.json preserves dated findings and lock checksum. |
| DEP-001-C | Final `pnpm audit:production` | Exit 0 at the declared high/critical threshold; both moderate findings remain visible. This is not a zero-vulnerability claim. |
| DEP-002-A | `pnpm verify:baseline` | Exit 0: strict specs, both lint/build checks, 424 backend tests/18 suites and 81 frontend tests/10 files. Existing 77 backend/29 frontend lint warnings and frontend chunk-size warning remain. |
| DEP-002-A initial run | `pnpm test:e2e` on rebuilt release images | Exit 1: all migration/CLI/session/MFA checks passed; 54/55 browser cases passed. BTC creation showed zero instead of 1.25 because the old external fixture rejected actual Axios CONNECT with 501. |
| DEP-002-B transport RED | Independent `provider-proxy.cjs` through the harness and unchanged external fixture | Exit 1 with actual Axios HTTPS CONNECT receiving 501. This is an observed transport behavior failure. |
| DEP-002-A/B final run | `pnpm test:e2e` with locally terminated fixture TLS | Exit 0: independent real Axios TLS/authority/control probes, all PostgreSQL migration/CLI/session/MFA/expiry checks, all 55 HTTPS Chromium cases in 7.1 minutes with one worker and zero retries, stack cleanup and Nginx preservation. |

Gate RED log `/private/tmp/capital-dependency-aggregate-red.log` records the seven
actual command bypasses. Initial Jest RED `/private/tmp/capital-dependency-gate-red.log`
has 10 failures/155 passes: seven behavior failures, one missing needs entry and two
missing configuration failures. The latter three are not additional behavior proof.
The isolated gates.spec.ts GREEN was 165/165; independent full engineering selection
was 183/183 (includes 18 preservation tests), recorded in
`/private/tmp/capital-dependency-gate-green.log`.

Other local logs: `capital-dependency-command-red.log`, `capital-dependency-install.log`,
`capital-dependency-transitive-update.log`, `capital-dependency-frozen.log`,
`capital-dependency-command-green.log`, `capital-dependency-baseline.log` and
`capital-dependency-image.log`, all under `/private/tmp`. Raw audit reports are
`capital-dependency-audit.json` and `capital-dependency-audit-after.json` there.
The first post-parent-update audit still had 4 high/5 moderate/1 low findings:
normal parent resolution retained form-data, brace-expansion, qs and body-parser.
The supported targeted command
`pnpm update --recursive --prod --depth Infinity form-data brace-expansion qs body-parser`
refreshed those compatible ranges before final frozen installation and audit.

The first image failure is preserved in `capital-dependency-image.log`; its synthetic
trace is `/private/tmp/capital-dependency-wallet-failure-trace.zip`. Installed Axios
http.js explains that HTTPS proxy requests now use CONNECT to retain end-to-end TLS.
The fixture's former CONNECT handler explicitly returned 501. Independent transport
RED is in `capital-dependency-transport-red.log`. Only the external fixture/harness
was adapted, with separate synthetic provider TLS, normal certificate verification,
exact authority binding and no upstream network operation. The 1.25/2 BTC assertions,
database persistence checks and all 55 application browser cases remain unchanged.
Final results are collected in `capital-dependency-image-final.log`.

## Dependency and independent review

[The security record](../../../../docs/dependency-security.md) documents selected
versions, two parent-scoped overrides, primary sources, actual transitive versions
and the two open Router records. Maintainer follow-up is before any production
release and by 2026-10-06. No advisory was ignored. Only Nest testing was aligned
among direct development dependencies; the resolver also refreshed some shared
Babel/brace-expansion development entries within existing ranges.

Separate provider-feasibility, acceptance and security agents reviewed package
constraints, current navigation applicability, test oracles and the final diff.
No implementation blocker remained. TypeORM's select:false retention change does
not apply to the current password column; AuthService explicitly projects safe
response fields. Existing owner writes use loaded entities or parameterized SQL,
not the changed empty-criteria repository operations.

Independent synthetic config probe exit 0 verified @nestjs/config 4.0.4:
a fresh child given only a synthetic process environment and temporary file
observed process-over-file precedence, file fallback, custom validation and no
synthetic file marker in stdout/stderr. No owner environment file was read.
Captured command/oracles: `/private/tmp/capital-dependency-config-review.md`.
This focused check does not replace runtime initialization in image acceptance.

## Artifact identity and limits

Audited lock SHA-256:
`788c2f1fa098842758ab89a004ec8c45ef36712584f0b39eb94d83a814a96b9e`.
Final tested image IDs (local only, never published):

- Backend: `sha256:2ef0eddba3750e81f770aaf4b2f958d94eb4747a274590e378b47e92ea48c58f`.
- Frontend: `sha256:0d12e654473f9b92b7a7caa6af7676fa69e8ead598ec40bad044c6a55581e87a`.

Final source verification was repeated after the fixture changes:
`/private/tmp/capital-dependency-baseline-final.log`, exit 0, unchanged 424/81 counts.
The security reviewer also reviewed the TLS fixture and independent oracles; no
blocker remained. The provider gets no MFA key and the long-running backend gets
only its public fixture certificate. Trusted short-lived test tools retain existing
whole-directory mounts and can read synthetic TLS files. No TLS verification bypass.
Early-disconnect probes do not claim every possible TCP reset/fault permutation.

Only the fixed disposable `capital-tracker-e2e` project is used; PostgreSQL data is
synthetic tmpfs. External providers alone are stubbed. Existing migrations,
application/authentication source and 55 browser assertions are unchanged by this
slice. Owner frontend/nginx.conf remains SHA-256
`115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`.
No production deployment, original repository move, data mutation or folder removal.
No hosted GitHub run, second browser, full development dependency audit, image/OS
scanner, SAST/DAST, complete ASVS audit or recovery exercise is claimed here.

OpenSpec archive completed with exit 0: three dependency-security requirements added
and ENG-001 synchronized to nine required jobs. No tasks remained incomplete.
