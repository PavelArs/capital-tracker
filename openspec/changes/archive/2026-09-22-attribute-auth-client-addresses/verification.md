# Verification: attribute-auth-client-addresses

Status: complete. Independent source and fixture reviews found no remaining blocker;
source checks and the full release-image run passed before archival.

## Scope and independent work

- `PROXY-001..004`: independent QA authored `client-source.spec.ts` and eight
  `auth-source.spec.ts` cases before production changes. Existing 55 cases retain
  their original financial/security assertions.
- The backend implementation agent was separately reviewed by the acceptance agent.
  The release-fixture reviewer inspected exact topology, mounted secrets, header
  sanitization, test oracles and helper cleanup. Root owns dependencies, deployment
  files and the actual Docker executions.
- Reviewer findings fixed: exact helper-container cleanup after Docker CLI timeout;
  actual socket assertions on normal/direct clients; complete network membership
  assertions; an actually forged `http` protocol value; effective Nginx forwarding
  directives; stale documentation claiming attribution was still future work.
- No schema change, production access/deployment, owner-data operation or folder
  consolidation. The owner `frontend/nginx.conf` remains excluded from this change.

## Acceptance first: observed failure

The preceding verified backend image was
`sha256:2ef0eddba3750e81f770aaf4b2f958d94eb4747a274590e378b47e92ea48c58f`.
Root launched its real PostgreSQL/migrations/owner/MFA fixtures and existing HTTPS
proxy with the two new client containers, without rebuilding application images.

`pnpm exec playwright test tests/e2e/auth-source.spec.ts --grep PROXY-001-A`
failed: A received five401 responses then429, and B's correct password received429
where the independent oracle required200. The failure occurred in `pending()` at
the password response assertion; no authenticated cookie was injected. Exit1 and
owned-project cleanup are recorded in `/private/tmp/capital-proxy-behavior-red.log`;
synthetic trace preserved as `/private/tmp/capital-proxy-behavior-red-trace.zip`.

An earlier fixture setup attempt failed because client containers inherited the
backend HTTP healthcheck. Their healthcheck is now explicitly disabled; client
profiles were removed so normal Compose cleanup includes them. This prerequisite
failure (`capital-proxy-setup-failure.log`) is not counted as behavior RED. Likewise
the initial missing-module unit compilation failure is not behavior RED.

## Source verification

All project checks use Node22.21.1 and pnpm10.33.0.

| Command | Actual result |
|---|---|
| `pnpm --filter capital-tracker-backend add ipaddr.js@1.9.1 --save-exact --offline` | Exit0 using the existing store; lock delta declares the already locked version directly |
| `pnpm install --frozen-lockfile --offline` | Exit0, `/private/tmp/capital-proxy-frozen.log` |
| `pnpm audit:production` | Exit0; 0high/critical, the two previously tracked moderate Router findings remain; `/private/tmp/capital-proxy-audit.log` |
| `pnpm verify:baseline` | Exit0: strict OpenSpec, both lint/build, 505backend tests/19suites, 81frontend tests/10files; `/private/tmp/capital-proxy-baseline.log` |

The existing 77backend/29frontend lint warnings and frontend bundle warning remain.
An agent initially used host-default Node20 and saw a scheduling-test process crash;
the supported Node22 focused run passed all96 cases. It is not recorded as a
supported-runtime failure or concealed as a successful check.

## Runtime verification

`pnpm test:e2e` built the changed images and exercised actual migrations, CLI/session/
MFA concurrency/expiry checks, 27 invalid HTTP startup configurations, the rendered
deployment template, retained55 cases and new8 cases. Exit0:
`/private/tmp/capital-proxy-image.log`; all63 Playwright cases passed in8.1minutes,
one Chromium worker, zero retries. All provider transport, migration, CLI, database
race/expiry, startup and artifact probes passed. All three synthetic networks and
their service containers were removed; checkout Nginx preservation passed afterward.

Tested backend image:
`sha256:29d707692957100490f846448225da86f9faf76e77a49e6911e42630dbc5aab0`.
Tested frontend image:
`sha256:0d12e654473f9b92b7a7caa6af7676fa69e8ead598ec40bad044c6a55581e87a`.
Lockfile SHA256:
`13e4fbf1d1effcf66367ef7829885eb53b339cb9f52ab43854ca2e4ba77c4e73`.
Owner Nginx remains regular0644 with SHA256
`115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`.
The isolated fixture's exact addresses are also checked from actual request sockets.
Standalone TypeScript checking of the new HTTP test and client helper passed.

The operator/migration/session/MFA fixture processes explicitly omit
`TRUSTED_PROXY_IPS` to prove this setting remains HTTP-only. The startup probe checks
safe errors, no listening socket and identical public-schema/row/sequence state.
Artifact checks compare the mounted deployment template, run `nginx -t`/`nginx -T`,
verify actual network identities and exclude credentials from protocol clients.

## Limits

Authentication request budgets still remain process-local. PostgreSQL shared
request/account limits are the next separate change. General API quotas, hosted CI,
second-browser execution, image scanning, SAST/DAST, full ASVS mapping and production
readiness are not claimed by this slice. No owner configuration or gateway address
has been inferred from the synthetic fixture.
