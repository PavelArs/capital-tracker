# Historical account valuation verification

Status: active; no GREEN/archive claim until the required checks below execute.

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
| VAL-EXACT/GAPS/COVERAGE/PRECISION | Actual compiled services against fresh isolated PG18; saved points/corrections/voids, tiny60-place value,100carry-in+1000trades |
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
Real PG/HTTPS, UI integration, final independent review and archive remain pending.
