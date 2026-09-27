# Production dependency security record

## Manual MVP Router resolution — 2026-09-27

Exact `react-router-dom@7.18.4` and its pinned `react-router@7.18.4` resolve
both previously documented Router findings. The actual predecessor registry audit
still reported two moderate findings; the post-update `pnpm audit --prod --json`
exited **0**, with **0 info, low, moderate, high or critical findings** across
**332 production dependencies**. Required `pnpm audit:production` also exited
**0**, reporting no known vulnerabilities. No advisory suppression was added.

The [official upgrade guide](https://raw.githubusercontent.com/remix-run/react-router/react-router@7.18.4/docs/upgrading/v6.md)
and exact registry metadata require Node >=20 and React/React DOM >=18; the retained
Node 22 and React 18.3.1 meet those requirements. The exact
[7.18.4 release](https://github.com/remix-run/react-router/releases/tag/react-router@7.18.4)
exceeds the 7.18.0 fix floor of both historical findings and the 7.18.2 floor of
[GHSA-qwww-vcr4-c8h2](https://github.com/remix-run/react-router/security/advisories/GHSA-qwww-vcr4-c8h2).
The latter advisory is currently classified moderate upstream; the older review
below recorded it as high.

Frozen isolated installation, backend/frontend builds, all **121 frontend tests
in 22 files**, and **32 focused runtime/scheduler/display-FX provider tests in
3 suites** passed. Existing assets splat navigation uses absolute destinations;
the obsolete v6-only MemoryRouter future option was removed from the login test
without changing assertions. The existing Vite chunk-size warning remains.
**Real HTTPS navigation/login/MFA/logout and supported manual-provider independence
release acceptance now pass. Focused VCH responsive acceptance also passed 1/1 in
15.9s on FE image `FE28faa7ab8a7d695c1f4859d95669a340d7e7f2a6da8889f55d0471ddaa76f86`
with unchanged BE image
`BE049c5e91b667e737aeee06823d28931e290a29671e1693f84998228f528f4400`. Eighteen
previously passing browser journeys used FE `FEbd407fdd…`; do not combine these
split results into a 19/19 single-image claim. The application dependency graph
audit reported zero findings, but Trivy found inherited image findings (BE 5
critical/55 high; FE 2 critical/35 high). Runtime owns the minimal-base remediation
and final image scans. Current hosted CI and production security readiness remain
pending; the dependency audit does not establish those gates.

Audited lockfile SHA-256:
`7db95986acc2a8c4fbef9bf9be34c7296b51fe2aa821bcc215db5d8e36f289ba`.
Local evidence: `/private/tmp/capital-mvp-runtime-audit-before-live.json`,
`/private/tmp/capital-mvp-runtime-audit-after.json`,
`/private/tmp/capital-mvp-runtime-audit-gate.log`,
`/private/tmp/capital-mvp-router-metadata-live.json`,
`/private/tmp/capital-mvp-runtime-frozen.log`,
`/private/tmp/capital-mvp-runtime-build2.log`,
`/private/tmp/capital-mvp-router-build2.log`,
`/private/tmp/capital-mvp-router-unit.log`, and
`/private/tmp/capital-mvp-runtime-isolated-green.log`.
Initial sandbox DNS failures were not counted as passing registry verification;
the recorded passing audits used the live registry.

Historical scoped recheck,2026-09-26, independent review followup: required
`pnpm audit:production` exited0; two moderate Router findings remain, with no
high/critical findings. Evidence `/private/tmp/capital-reviews-production-audit.log`.
No dependency/lock changes; the existing findings and release deadline below remain.

Reviewed **2026-09-22** for `patch-production-dependency-advisories`.
Scope: pnpm production dependencies. Development tools, operating-system/image
packages, application exploitability and production deployment require separate
verification.

Rechecked on **2026-09-23** during `record-usd-fifo-trades`: frozen install and the
required high/critical audit both exited **0**. The full registry JSON report exited
**1** and still lists the two moderate Router advisories below, with **0 high,
0 critical, 2 moderate, 0 low** across **329** production dependencies. Current
lockfile SHA-256 is
`13e4fbf1d1effcf66367ef7829885eb53b339cb9f52ab43854ca2e4ba77c4e73`.
Local evidence: `/private/tmp/capital-usd-frozen-live.log`,
`/private/tmp/capital-usd-audit-live.log`, `/private/tmp/capital-usd-audit-current.json`.
Initial sandbox registry/cache failures were not counted as passing verification;
the successful runs used the actual registry and existing pnpm cache.

## Baseline and current verification status

The actual pre-change `pnpm audit --prod --json` registry response reported
**25 high, 0 critical, 38 moderate and 3 low** advisory records across 324
production dependencies. The command exited **1**. These counts describe advisory
records, not proven exploitable application flaws.

Post-resolution results on **2026-09-22**, with the report and lockfile checked:

- Frozen installation completed with exit **0**.
- Full `pnpm audit --prod --json`: **0 high, 0 critical, 2 moderate, 0 low**
  across **329** production dependencies; exit **1** because the two Router
  findings below remain. Local evidence: `/private/tmp/capital-dependency-audit-after.json`.
- Required `pnpm audit:production`: exit **0** at the high/critical threshold;
  its output still reports both moderate findings. Local evidence:
  `/private/tmp/capital-dependency-command-green.log`.
- Audited lockfile SHA-256:
  `788c2f1fa098842758ab89a004ec8c45ef36712584f0b39eb94d83a814a96b9e`.

`pnpm verify:baseline` passed: 424 backend tests in 18 suites, 81 frontend tests
in 10 files, both lint/build commands and strict OpenSpec validation. Existing
77 backend/29 frontend lint warnings remain. The first rebuilt-image run passed 54/55 browser cases; the retained BTC case
exposed an external-fixture incompatibility with Axios HTTPS CONNECT (501).
The fixture now terminates allowlisted TLS locally with normal certificate checks;
independent transport acceptance and the final full image run passed (exit 0).
All 55 HTTPS Chromium cases, real PostgreSQL migration/CLI/session/MFA checks,
artifact isolation, stack cleanup and Nginx preservation passed without retries.
See the [archived verification record](../openspec/changes/archive/2026-09-22-patch-production-dependency-advisories/verification.md)
for actual RED/GREEN evidence and image identities.
The passed severity threshold is not a zero-vulnerability audit or a production
security-readiness claim.

Use Node 22.21.1 and pnpm 10.33.0:

```sh
pnpm install --frozen-lockfile
pnpm audit:production
pnpm audit --prod --json
```

`audit:production` runs `pnpm audit --prod --audit-level high`; CI requires its
`dependency-audit` job. This threshold permits lower-severity findings, which must
remain visible and reviewed. Registry errors must fail the check. Do not suppress
advisories or treat an unavailable registry as a clean result.

## Selected compatible updates

| Package | Selected version | Relevant change |
| --- | --- | --- |
| Backend Nest common/core/platform-express; testing aligned | 11.1.18 | Common pins file-type 21.3.4; core/platform pin path-to-regexp 8.4.2. [Release](https://github.com/nestjs/nest/releases/tag/v11.1.18), [common metadata](https://registry.npmjs.org/@nestjs/common/11.1.18). |
| Nest config | 4.0.4 | Pins Lodash 4.18.1. Internal dotenv also moves to 17.4.1; verify configuration and CLI behavior. [Release](https://github.com/nestjs/config/releases/tag/4.0.4). |
| Nest Swagger | 11.2.7 | Fixes Lodash/path-to-regexp pins; YAML needs the override below. Existing decorators remain; there is no HTTP Swagger interface. [Metadata](https://registry.npmjs.org/@nestjs/swagger/11.2.7). |
| TypeORM | 0.3.31 | Fixes reported 0.3 advisories and raises UUID to `^11.1.1`. Write criteria become stricter; retain actual PostgreSQL migration, transaction and owner-scope tests. [Release](https://github.com/typeorm/typeorm/releases/tag/0.3.31). |
| Axios, backend and frontend | 1.18.0 | Meets all baseline Axios advisory floors. Recheck provider proxy behavior, cookies/CSRF, error handling and absence of automatic write retries. [Release](https://github.com/axios/axios/releases/tag/v1.18.0). |
| React Router DOM | 6.30.6 | Preserves major 6; pins react-router 6.30.6 and @remix-run/router 1.23.4. The full audit confirms the two moderate findings below. [Metadata](https://registry.npmjs.org/react-router-dom/6.30.6). |

React/React DOM remain 18.3.1; the Vite major remains 7. This change does not require
a React, Router, Nest or TypeORM major migration.

Two exact parent-scoped overrides are necessary because upstream pins older
children:

```json
{
  "@nestjs/platform-express@11.1.18>multer": "2.3.0",
  "@nestjs/swagger@11.2.7>js-yaml": "4.3.2"
}
```

Both preserve the child major. See the [Multer security release](https://github.com/expressjs/multer/releases/tag/v2.3.0),
[YAML release](https://github.com/nodeca/js-yaml/releases/tag/4.3.2) and
[pnpm override syntax](https://pnpm.io/10.x/settings#overrides). Remove each override
when an adopted parent naturally supplies a fixed version.

The checked production graph resolves form-data **4.0.6**, follow-redirects
**1.16.0**, UUID **11.1.1**, brace-expansion **2.1.7**, qs **6.16.0**, body-parser
**2.3.0** and path-to-regexp **8.4.2**, including Express's independent router
branch. Both Axios importers resolve **1.18.0**. The file-type/inflate update
removes the affected fflate production path.

Only the two overrides above were needed. Normal compatible resolution supplied
path-to-regexp; this targeted update refreshed retained transitive ranges:

```sh
pnpm update --recursive --prod --depth Infinity form-data brace-expansion qs body-parser
```

For future updates, inspect every production path rather than only the audit's
representative path. A parent update can retain an older nested resolution.
The selective resolution also refreshed shared development graph entries, including
Babel 7.29.7 and brace-expansion major 1/5 branches within their parent ranges;
this does not establish a clean development-dependency audit.

## Historical Router findings — resolved 2026-09-27

The findings below were open in the earlier Router 6 review and carried a
2026-10-06 deadline. The 2026-09-27 exact-version Router 7.18.4 migration and
full production registry audit above resolved both; the resulting audit reported
zero findings. This historical review remains for rationale and migration context,
not as a current release blocker. No advisory ignore entry was added.

- [GHSA-337j-9hxr-rhxg](https://github.com/remix-run/react-router/security/advisories/GHSA-337j-9hxr-rhxg),
  moderate: SSR error hydration. The maintainer excludes Declarative Mode. This
  frontend uses BrowserRouter and a client `createRoot` mount, so the reviewed
  application does not use the described SSR path; the package finding remains.
- [GHSA-wrjc-x8rr-h8h6](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6),
  moderate: unexpected external navigation from untrusted paths. The app uses
  Link/useNavigate; inspected destinations are fixed internal routes or fixed tab
  entries. No untrusted target was found in that bounded review. This does not
  justify suppressing the advisory or assuming future navigation is safe.

The migration selected 7.18.4 rather than the 7.18.0 fix floor because 7.18.0 has
the additional high
[GHSA-qwww-vcr4-c8h2](https://github.com/remix-run/react-router/security/advisories/GHSA-qwww-c8h2),
fixed in 7.18.2. The actual upgrade tested `assets/*`, tab navigation,
unknown-route redirects and login/MFA/logout. Keep re-auditing on future updates.

## CSV parser addition — 2026-09-23

The verified CSV slice adds exact backend `csv-parse@7.0.2`, with no transitive
runtime dependencies or new override. The maintained parser's actual UTF-8,
quoting, physical-line and size boundaries have independent tests; dependency
selection alone is not validation. See the [parser decision](../openspec/changes/archive/2026-09-23-import-usd-trades-csv/parser-decision.md).

The frozen install and `pnpm audit:production` completed successfully after this
addition: zero high/critical findings and the same two moderate Router findings
above. No advisory suppression or paid scanning service was added. Commands and
logs are recorded in the [CSV verification record](../openspec/changes/archive/2026-09-23-import-usd-trades-csv/verification.md); image/static/dynamic
scans and the Router follow-up remain separate release requirements.

## XIRR runtime dependency — 2026-09-23

`preview-conventional-xirr` declares backend `decimal.js@10.6.0` directly in
production dependencies. It previously existed only in the frontend development
graph through jsdom. No existing resolution or override changes: the lockfile
adds only the backend importer entry. Frozen installation and the required
`pnpm audit:production` both exited **0**. The actual full `pnpm audit --prod --json`
report exited **1**: **0 high, 0 critical, 2 moderate, 0 low** across **331**
production dependencies. The same two Router findings above remain unsuppressed.

Audited lockfile SHA-256:
`6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d`.
Local evidence: `/private/tmp/capital-xirr-frozen.log`,
`/private/tmp/capital-xirr-audit.log`, `/private/tmp/capital-xirr-audit-current.json`.
An initial offline dependency-add attempt failed because registry metadata was
not cached; the subsequent exact-version registry install succeeded. That failed
attempt is not counted as verification. Image scanning and production approval
remain separate release requirements.

## Asset swaps frontend checkpoint — 2026-09-24

`pnpm audit:production` exited0 with2moderate findings and no high/critical findings.
No dependency or lockfile edits were made. The previously documented lower-severity
findings remain visible and were not suppressed. Evidence:
`/private/tmp/capital-swaps-production-audit.log`; current lock SHA256
`6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d`.
This dependency gate is not full application/image security or release verification.

## Application shell checkpoint — 2026-09-26

No dependency or lock changes. `pnpm audit:production` initially failed on sandbox
DNS resolution (ENOTFOUND); the authorized network-enabled retry exited 0 with 2 moderate
findings and no high/critical findings. Existing findings above remain unsuppressed.
Logs `/private/tmp/capital-shell-production-audit.log` and `...-audit2.log`. Lock SHA256
remains `6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d`.
This is a dependency gate, not complete application/image security verification.

## Account directory checkpoint — 2026-09-26

`pnpm audit:production` exited0 with two moderate findings and no high/critical findings;
`/private/tmp/capital-directory-production-audit.log`. No dependencies or lock changed;
the previously documented findings remain unsuppressed. This is not complete release
or application/image security verification.

## Compact journal context checkpoint — 2026-09-26

No dependency or lock changes. `pnpm audit:production` exited0 with the same two
moderate findings and no high/critical findings; `/private/tmp/capital-context-production-audit.log`.
Findings remain unsuppressed. This scoped dependency gate is not release verification.
The subsequent trade-workbench gate also exited0 with the same two moderate findings
and unchanged lockfile: `/private/tmp/capital-workbench-audit.log`.
The acquisition-entry gate also exited0 with the same two moderate findings and
unchanged lockfile: `/private/tmp/capital-entry-audit.log`.
The CSV-workbench gate also exited0 with the same two moderate findings and unchanged
lockfile: `/private/tmp/capital-csv-workbench-audit.log`.

The transfer-workbench gate also exited0 with the same two moderate findings and
unchanged lockfile: `/private/tmp/capital-transfer-workbench-audit.log`.
The external-flow-workbench gate on2026-09-27 also exited0 with the same two moderate
findings and unchanged lockfile: `/private/tmp/capital-flow-workbench-audit.log`.
The period-review-workbench gate also exited0 with the same two moderate findings
and unchanged lockfile: `/private/tmp/capital-period-workbench-audit.log`.
The manual-price-workbench gate also exited0 with the same two moderate findings
and unchanged lockfile: `/private/tmp/capital-price-workbench-audit.log`.
The settings-workbench gate also exited0 with the same two moderate findings
and unchanged lockfile: `/private/tmp/capital-settings-workbench-audit.log`.
The acquisition-focus gate also exited0 with the same two moderate findings
and unchanged lockfile: `/private/tmp/capital-acquisition-focus-audit.log`.
The account-analytics gate also exited0 with the same two moderate findings
and unchanged lockfile: `/private/tmp/capital-analytics-workbench-audit.log`.
