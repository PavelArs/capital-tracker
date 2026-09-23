# Historical account valuation verification

Status: implementation independently reviewed; selected verification GREEN.
Archived and canonical requirements synchronized; all7 tasks complete.

## Scope and reviewed check manifest

Root owns backend, shared runner and isolated Docker. Luna owns two HTTP/browser
acceptance cases in valuation-acceptance worktree; Sol independently reviews the
contract/tests and implements the isolated valuation-ui worktree after real RED.
Root independently reviews UI integration. Existing owner Nginx stays byte/mode
identical (SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432).
No schema/dependency/pipeline change; lock SHA256
6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d.

Keep/reuse: exact historical FIFO/carry-in, existing price table/index, UUID identity,
RR transactions, auth/MFA, Russian account detail, retained GHCR/Compose deployment.
Simplify: extract caller-owned historical load rather than invoking two independently
committed reads. Remove: nothing; no data, folder or legacy feature removal here.

| Risk/scenarios | Required verification |
|---|---|
| VAL-EXACT/PRECISION/GAPS/PRIVATE | New pure projectValuation and strict-query tests; retained historical/manual-price input tests |
| VAL-EXACT/GAPS/COVERAGE/PRECISION | Actual compiled services against fresh isolated database at migration18; saved points/corrections/voids, tiny60-place value,100carry-in+1000trades |
| VAL-SNAPSHOT/PRIVATE | Actual separate PostgreSQL connections, paused RR read across committed price+trade writes; all-row fingerprints |
| VAL-API/VAL-UI | Two real HTTPS Playwright cases via actual password/MFA, backend andPG; no own backend/auth mocks |
| Shared-loader refactor | Passing historical characterization plus unchanged historical-accounting-db.cjs and one retained HIST-004-A UI case |
| Integration | Backend/frontend scoped lint/build, existing frontend tests, E2E strictTS, production dependency gate, strict OpenSpec |

Full backend/E2E, unchanged migration-upgrade matrix, hostedCI, image/DAST/release
scans and production are not in this slice's selected run. All existing tests and
release gates are retained. Fresh migration18 is exercised by the actual PG
fixtures and HTTPS environment; no new schema needs an upgrade matrix.

## Actual baseline and review

At40b473b: `pnpm --dir backend test --runInBand --coverage=false
historical-accounting manual-price-input` exited0:92tests/3suites,1.762s. OpenSpec
activechanges empty; after proposal strict19items passed (18canonical+1change).
Host Node22.23.2 uses existing task wrapper, images remain pinned22.21.1; pnpm10.33.0,
OpenSpec1.2.0, PG16.10, Playwright1.63.0. No dependency installation/change.

Sol found no contract blocker; trade journal revision must invalidate UI, not
opening revision. Independent test review recomputed extreme products with Python
Decimal precision220; root repaired bulk synthetic canonicalPayload to match real
saved command shape. Neither expected financial result was changed.

`pnpm audit:production` exited0:2existingmoderate findings, no high/critical.
Raw log `/private/tmp/capital-valuation-audit.log`; existing findings documented in
`docs/dependency-security.md`. Docker image inspection initially required sandbox
escalation; authorized isolated read succeeded, no approval rejection.

## RED

Actual `/private/tmp/capital-valuation-red.cjs` exited1 against verified prior
accepted images, source16bb252 plus copied typed acceptance draft. Two expected
behavioral failures: anonymous valuation GET expected401 received404 (new route
absent); new heading missing after10s. Playwright1worker,0retries. Raw log
`/private/tmp/capital-valuation-red.log`; synthetic artifacts retained in
`/private/tmp/capital-valuation-red-artifacts`. Product files remained unchanged
until both failures were observed. Final test commitc208044 refines bookkeeping
and selectors, retaining both RED assertions. Previous accepted images:
BEsha256:16266828034a018b39ec611733c062415da7e5d2001ee19a054385c620fa3dfd
FEsha256:45a1f6056008cddc1162ebb52681475af63863922a673bcff947b79fac08c9db.
Missing TypeScript modules are not counted as behavioral RED.

## GREEN and final review

Initial new backend check: `pnpm --dir backend test --runInBand --coverage=false
historical-valuation historical-accounting manual-price-input` exited0,123tests/4
suites,1.944s (31new+92retained). Backend build and scoped Biome passed.
Backend lint exited0 with77 existing warnings. Main frontend build/scopedBiome
and lint exited0 with29 existing warnings and retained >500kB bundle warning.
Strict scoped E2E TypeScript (including noUnusedLocals/noUnusedParameters) passed.
Sol ran existing frontend Vitest in valuation-ui worktree:95 passed. No full
backend or browser suite was repeated.

### Actual PostgreSQL

`/private/tmp/capital-valuation-db.cjs` exited0 at
4edac35659c718e01f3ee25511e57c70cf5549e4. It builds the backend, starts only the
isolated Compose services, and runs:

```
node /tests/historical-valuation-db.cjs
node /tests/historical-accounting-db.cjs
```

Each runs as a separate process in the migrate container against a newly created,
guarded synthetic database with the actual18 migrations. Four new families passed:
VAL-EXACT/GAPS/PRIVATE, VAL-COVERAGE, VAL-SNAPSHOT and VAL-PRECISION. They assert full
DTO/UUID identity, exact-time/void behavior, immutable original receipt, empty and
zero-cost carry-in boundaries, no-journal/precoverage denials, all-row preservation,
actual separate-connection RR across committed price and trade corrections, tiny
scale60 product and100 baseline lots plus1000 active maximum-precision trades.
The retained historical fixture passed without assertion changes: inclusive
carry-in, pages/revision conflicts, concurrent RR, supported maxima, malformed
saved-history refusal and fingerprints. Log `/private/tmp/capital-valuation-db.log`.

Tested backend image:
`sha256:6585ed74167fb470aa4c5575e934759daf14f60adb2502b1ed0a84f3409b8fd4`.

### Actual HTTPS Playwright

`/private/tmp/capital-valuation-green.cjs` exited0 at
b90e65e139997c79cfed2f71446caab8c1afd330. It builds both release-style images,
initializes synthetic PostgreSQL through real migration/seed commands, starts
HTTPS and actual backends, verifies artifact/network isolation, then runs:

```
pnpm exec playwright test tests/e2e/historical-valuation.spec.ts tests/e2e/historical-accounting.spec.ts --grep 'VAL-|HIST-004-A: UI snapshot' --workers=1
```

3/3 passed in37.8s, one worker, zero retries: retained HIST-004-A11.9s,
VAL-API13.6s, VAL-UI11.6s. Password/MFA, authorization, backend and PostgreSQL are
real. Only external providers are stubbed. The delayed response follows actual
route.fetch(), not a fabricated backend body. Assertions include exact UI rows,
missing-to-zero transition, unsaved correction preservation and stale-intent
rejection; API cases cover exact allowlisted DTO, no-store admission/foreign/input
denials, correction/void and row/provider/admission preservation.

Backend image is identical to the preceding PG verification. Frontend image:
`sha256:f034307171dc39856cd16fe5bfe5ca177998584419324b90c9375de6279db4ea`.
Log `/private/tmp/capital-valuation-green.log`; synthetic artifact directory
`/private/tmp/capital-valuation-green-artifacts`. There were no unexpected failed
GREEN runs; the earlier two failures are the intended predecessor RED.

### Independent review and preservation

Sol reviewed backend/SQL/arithmetic and shared-loader refactor: no product blocker.
Root reviewed all four UI files and added wrap handling for wide summary amounts
and a price span, then strengthened row assertions in the same existing UI case.
Luna checked contract/docs and existing selectors. No financial/security assertion
was weakened; no tests or data were removed. Changes: contract660c6ce,
acceptancebaf0304/e57d5fb/c208044, backend4edac35, UI9bc3209, reviewed finalb90e65e.
Both temporary agent dependency symlinks were removed; worktrees preserved.

Owner Nginx remains mode0644,size1348 with the original hash, and lock hash is
unchanged. Both isolated harnesses ran cleanup successfully. Final labeled Docker
inventory and strict canonical archive synchronization are recorded below after
execution. No original repository move, folder deletion, remote push or production
access/deployment occurred.

Final labeled Docker container/network inventories returned empty after successful
cleanup. Nginx/lock hashes and Nginx0644/1348 were rechecked unchanged.

## Actual archive

OpenSpec1.2.0 `OPENSPEC_TELEMETRY=0 openspec archive value-historical-account --yes`
exited0, adding4 requirements to the new canonical historical-account-valuation
spec and moving this change to2026-09-23-value-historical-account. The CLI reported
6/7 tasks because the last task itself includes archive/sync; that checkbox was
completed only after actual synchronization. No implementation/check was skipped.
The generated purpose placeholder was filled without changing requirements.

Final strict validation passed19/19 canonical specs, active changes are empty.
All18 prior canonical specs are byte-for-byte unchanged; new requirements match
the archived delta exactly. All guide archive links resolve. Final diff check
passes, isolated containers/networks are absent, owner Nginx remains the only
unrelated unstaged modification. No production action was taken.
