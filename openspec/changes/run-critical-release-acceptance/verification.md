# Verification — source profile, not hosted acceptance

The selected manifest has 20 exact file/title entries: the original 19 plus `CSV-006-B regression` for a committed confirm, lost response, actual session expiry, real 401, MFA and exact replay. Independent source inspection found no selected synthetic own-backend/auth `route.fulfill`: selected response handlers forward actual `route.fetch()` results or abort/delay their delivery after a real request. This review does not claim browser execution.

Actual expected RED before implementing the helper: `node --test scripts/critical-release-profile.test.cjs` exited 1 (`Cannot find module './critical-release-profile.cjs'`; 0 pass, 1 fail). The initial helper then passed 3/3 local contract tests. A further actual Playwright `--list` dry-run exposed a real routing defect: `tests/e2e/...` file arguments and `^title$` grep yielded `No tests found` (exit 1), because file filters use the test directory and grep includes the project/file prefix. The implementation now uses test-directory-relative file filters and a prefixed-title expression; a second Playwright CLI `--list` invocation validates the exact 20 routed cases before Docker starts. These are source/discovery checks, not runtime acceptance.

Actual scoped GREEN on this branch, Node 22.23.2 / pnpm 10.33.0 / `CI=true` / OpenSpec telemetry off:

- `pnpm test:engineering`: engineering Jest 196/196 and profile Node tests 3/3; log `/private/tmp/capital-critical-engineering-green.log`.
- `pnpm --dir backend exec jest engineering/manual-mvp-validator --runInBand`: 27/27; log `/private/tmp/capital-critical-validator-green.log`. The image manifest remains schema v3.
- `pnpm specs:validate`: 47/47 strict items, including both pre-existing active changes and this one; log `/private/tmp/capital-critical-openspec-green.log`.
- `pnpm --dir backend exec biome check src/engineering/gates.spec.ts`: passed after formatting the changed policy test. Whole-backend lint was attempted first and failed on that formatting error; a later scoped Biome check passed. No unrelated lint warnings were changed.
- `node --check scripts/acceptance.mjs` and `git diff --check`: passed.

The release runner's Docker/PostgreSQL/provider HTTPS/browser execution, all 20 runtime case results, hosted image/security/audit aggregate, candidate export, backup/restore, server promotion and deployment are **UNRUN**. Local Docker is unavailable and was not invoked. The full browser suite remains available through `pnpm test:e2e` and is **UNRUN** for this change. Tasks 2.3 and 3.1–3.2 remain open pending independent review and actual hosted/operator evidence. No archive is authorized yet.
