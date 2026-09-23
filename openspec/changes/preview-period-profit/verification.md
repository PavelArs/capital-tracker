# Period profit verification

Status: implementation, independent review and required focused GREEN complete;
OpenSpec archive synchronization pending.

Genuine predecessor RED: `/private/tmp/capital-profit-predecessor-red.cjs`, exit1,
log `/private/tmp/capital-profit-predecessor-red.log`; both cases fail as expected:
authenticated preview200 vs actual404; new Russian heading absent. Existing origin
and flows were created successfully through real API after real password/MFA.
Pinned predecessor backend b8a8f25490603eeaaad904b2d762cd188045cd81c45b97c813d7c72c14066f28,
frontend d169e6d8d0ef9d96fba34dfa3dcaa4d9799832bc4991f75b53fee811124c571c.
Main test source aaf1a7d plus a return-type-only correction (unused marker property).
Containers/networks removed by finally. No product code existed before this RED.
New pure/PG cases were committed before implementation; missing modules were never
reported as behavioral RED. Root strengthened exact DOM assertions and added a real
response-delivery failure after a successful preview for later GREEN verification.

Acceptance review corrected examples before implementation: pure projection accepts
only the two flow legs, removing an inconsistent synthetic net field; UI loss example
is opening1200/closing2100/contribution1000 = -100. Auth ledger baseline follows the
real extra password step; that legitimate login is not incorrectly counted as a
calculation write. Strict E2E TS caught and removed a leftover marker return type.

Baseline: source d6305e1, only pre-existing owner frontend/nginx.conf edit. OpenSpec1.2.0, no active change before this slice. Existing deployment inspected via brownfield audit and unchanged Compose/GitHub workflow. No migration or dependencies planned.

`pnpm --dir backend test --runInBand portfolio-flow.spec portfolio-flow-input.spec` exited0: 57 tests / 2 suites. Coverage output from this scoped run is not whole-project coverage.

Independent contract review: historical_ui (Sol), no blocker; valuation boundary timing, exact response and consent reset incorporated. Reuse audit: carry_docs_review (Luna).

## Risk-based check manifest

| Scenario | Required check |
| --- | --- |
| PROFIT-CAPITAL / EXACT / INPUT | Pure exact arithmetic/input examples, including empty/zero, signed tiny loss, wide totals and strict invalid fields; critical real HTTPS capital example. |
| PROFIT-PERIOD / SNAPSHOT / COVERAGE | Real PostgreSQL current heads, >50 flows, corrections/voids, exclusive upper boundary, foreign ownership, deterministic two-connection snapshot barrier, accounting-row fingerprints unchanged; HTTP coverage refusal. |
| PROFIT-PRIVATE | Real HTTPS password/MFA/CSRF/origin/no-store plus foreign-row DB isolation; no backend/auth mocks. |
| PROFIT-UI / LATE | Real Russian UI calculation/review reset; delayed actual response after editing, failed request hides result. |
| Retained external flow behavior | Existing 57 pure cases, real PostgreSQL flow characterization, one retained critical HTTPS flow journey. |
| Integration | Changed E2E strict TS, backend/frontend build/lint, targeted frontend checks, strict OpenSpec, owner hash/lock/cleanup. |

No full E2E, provider implementation, dependency/security scan changes, schema upgrades or deployment in scope. Existing CI checks remain. Missing checks and failures must stay visible in final evidence.

## Implemented checks and independent review

- Backend source43681aa; exact helper and private period reuse. `pnpm --dir backend
  test --runInBand --coverage=false period-profit.spec portfolio-flow.spec
  portfolio-flow-input.spec` exit0: 111 tests / 3 suites (54 new, 57 retained), 1.823s.
  Backend build exit0; backend lint exit0 with77 pre-existing warnings.
- Real PostgreSQL: `/private/tmp/capital-profit-db-focused.cjs` exit0, log
  `/private/tmp/capital-profit-db-focused.log`. Four profit families pass: coverage
  refusal/empty period; complete61 in-period heads across >50-page boundary,
  correction/void/time/foreign isolation and read-only fingerprints; two actual
  pools with a barrier after completed first SELECT then committed correction;
  all1000 maximum-precision current heads yielding full51-digit signed profit.
  Fresh explicit17 migrations are prerequisites. No upgrade migration is added.
- All eight retained flow PostgreSQL families also pass in that run: timeline and
  replay/ownership, pages/revisions, independent-process origin races, lock/CAS,
  deferred-COMMIT rollback, RR snapshot, active/version caps, SQL constraints and
  refused down. No fake failure for the shared private period extraction.
- UI authored in isolated profit-ui worktree by Sol, commit2aeab27, integrated
  db21664 (message normalized to Conventional Commit). Agent ran frontend TS,
  build, scoped Biome and95 existing Vitest tests/10 files successfully. Root
  independently reviewed lifecycle, exact strings, owner key and transport; added
  valuation-help accessibility references/examples and correction-restatement copy.
- Independent Sol review of root backend at2123e28 (same backend as43681aa): no
  blocker; checked exact signed arithmetic, strict input, owner identity, one RR
  READ ONLY snapshot, no write/provider path and retained list semantics.
- Root final integration c4ae371: frontend lint exit0 (29 existing warnings),
  frontend TS/Vite build exit0 (existing >500kB bundle warning remains). Strict
  changed E2E TypeScript and diff check exit0. Root added actual HTTP400 assertions
  and a failed delivery after a real successful calculation; no fabricated response.
- Luna reviewed draft guide; timestamp bounds/precision and unpaginated preview
  clarified. Root reviewed Luna acceptance tests; arithmetic/type/locator corrections
  above preserve financial assertions. No product fix was needed to satisfy a bad
  expected arithmetic value.

## Final HTTPS GREEN

`PATH=/private/tmp/capital-task-bin:/Users/pavelars/.nvm/versions/node/v22.23.2/bin:$PATH
caffeinate -is node /private/tmp/capital-profit-focused.cjs` exited0 at product
source c4ae371. Log `/private/tmp/capital-profit-focused.log`; exact current images:

- backend `sha256:24a9827a93bae8615bc84feb90f6351f3730e6d4ed77319f459e07b524cdacfb`
- frontend `sha256:1a5a83094e97866982fb28e84038286c5b74264565a1eca745759e6e61e2c6be`

The harness builds current release images, verifies isolated networks, preserves
owner Nginx via `withPreservedFile`, starts fresh tmpfs PostgreSQL/Redis/external
provider fixture, runs actual migrations/seed, starts both real backend replicas,
frontend/proxy/client topology and release-artifact checks, then invokes:

```sh
pnpm exec playwright test tests/e2e/period-profit.spec.ts tests/e2e/external-usd-flows.spec.ts:293 --workers=1
```

3/3 Chromium tests passed in36.8s, zero retries: retained FLOW-004-A12.9s;
PROFIT API/privacy/coverage11.7s; PROFIT UI/lateness/delivery-failure11.5s. All
backend/authentication/DB responses are real; route.fetch only delays or aborts
delivery after the actual server calculation. No financial assertions were relaxed.
Provider-call counts and accounting-row fingerprints stay unchanged for previews.
Previously passed PG families were not rerun unnecessarily in this browser harness.

Finally removed all synthetic containers/networks. Owner Nginx SHA256 remains
`115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`;
lock SHA256 `aa2588325aacdc54e8437d3500c7d2df580cc20cd061d1e3727f30f0dcc1e4f8`.

Unrun: full146-case E2E suite, full backend unit suite, repeated dependency audits/
hosted CI/security scans, complete upgrade matrix, production rollout and
backup/restore/release hardening. Those are not implied by focused success; no
dependency/schema change requires them for this slice. All existing CI gates and
cases remain. XIRR/TWR/providers/prices and whole-brief consolidation remain future.
