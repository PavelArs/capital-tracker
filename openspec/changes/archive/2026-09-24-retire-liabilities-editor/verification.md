# Legacy liabilities retirement verification

Status: implemented, independently reviewed, selected real HTTPS GREEN and archived.

## Scope and keep/simplify/remove inventory

Base ada4797: 22 canonical specs, no active change, only owner Nginx modification.
Target and brownfield inventory call for scoped legacy household UI removal.
GHCR/Compose deployment inspected: keep existing CI and manual guarded CD;
no replacement, deployment, schema or dependency change is necessary here.

| Action | Scope |
| --- | --- |
| Keep | Backend liabilities endpoints/guards/entities/schema/rows; Dashboard aggregate metrics and category translations in both locales; accounting charts; shared dependencies/styles; pipeline and owner Nginx |
| Simplify | Protected old exact/nested bookmarks become static Russian notice with manual-accounts link |
| Remove | Legacy Liabilities page/CSS, 16 dedicated feature files, client CRUD wrapper/export, unused liability types/UI labels and 6 obsolete wrapper-only tests |

Broader dashboard/assets/crypto/API cleanup, automatic prices, chart maximum period,
original-repository consolidation and folder cleanup remain outside this slice.
No business data is deleted. Tests for retained accounting/security behavior stay.

## Contract, baseline and genuine RED

Contract and acceptance committed 1587ac6 before any product edit. Sol independently
reviewed scope and LIR-UI; no blocker. Fingerprints are explicitly captured after
real MFA, preserving MFA rows as well as business rows throughout the notice journey.
Luna independently checked shared consumers, then owns frontend-only implementation
in the isolated capital-tracker-lir-ui worktree. Root owns all runtime verification.

- `pnpm --dir frontend test`: 104 tests / 13 files passed in 2.90s, exit 0.
  `/private/tmp/capital-liabilities-baseline.log`.
- `pnpm --dir backend test --runInBand --coverage=false liabilities manual-portfolio-valuation`:
  44 tests / 2 suites passed in 2.061s, exit 0. Retained characterization;
  `/private/tmp/capital-liabilities-backend-baseline.log`.
- OpenSpec strict: 23 items passed (22 canonical + active change).
- LIR-UI strict/noUnused TypeScript and scoped frontend Biome passed.
- `pnpm audit:production`: exit 0; 2 existing moderate findings, no high/critical.
  `/private/tmp/capital-lir-audit.log`; lower-severity detail remains visible in
  docs/dependency-security.md. No lockfile change or zero-vulnerability claim.

`/private/tmp/capital-lir-red.cjs` used the accepted predecessor images without any
product rebuild. LIR-UI reached successful anonymous/password-only characterization,
real owner MFA, and synthetic PostgreSQL setup, then failed exactly on absent heading
`Раздел обязательств закрыт` (10-second expect timeout). One failed case in 22.8s,
one worker, zero retries; exit 1 expected. This is a behavioral RED, not an import,
fixture or environment failure. No tests were relaxed after this result.

- Backend sha256:4b6bfc44032298aa1f4c8c342ad5ff9ac16c235d9bbf6c665fb58e227ae61c77
- Frontend sha256:92528857004478837265653aa1651f31b73783fa9c5bbbefdb1a45d4efb222b7

`/private/tmp/capital-lir-red.log`, `/private/tmp/capital-lir-red-artifacts`.
Artifact/network checks passed and synthetic containers/networks were removed.
Owner Nginx hash and lock hash remain unchanged after RED.

## Selected GREEN criteria

Build the changed frontend, reuse byte-identical accepted backend. Run exactly new
LIR-UI and unchanged MPV-UI over actual HTTPS/password/MFA/backend/PostgreSQL.
LIR-UI must show both notices without business API/provider requests, preserve the
full database fingerprint except auth_sessions/auth_request_limits, retain exact
own/foreign liability fields and private no-store API behavior, and reach accounts.
MPV-UI must preserve its existing exact aggregate, coverage and stale-response oracles.
Run frontend unit/lint/build, independent review, strict OpenSpec, and diff checks.

Only external providers are controlled. No full backend/full E2E, separate schema
upgrade matrix, live-provider, hosted CI, release scan or production run is selected
for this frontend-only change. Existing CI/full acceptance discovery remains intact.
Record actual GREEN results, image IDs and cleanup below after execution.

## Implementation and source checks

Luna implementation 122e0c0, integrated as 63562b9 after real RED. 27 frontend files:
20 added lines / 1,853 removed lines. The static notice explicitly imports existing
manual-page styles. Sol independently reviewed the final implementation in its
worktree: no blocking regression, dangling imports, shared label loss or auth/data
scope change. Root also reviewed integration and confirmed backend, lock, Dashboard,
GitHub pipeline and retained MPV-UI source byte-identical to ada4797.

Luna's source checks at 122e0c0 with prescribed Node22 PATH (output in agent tool
transcript, no separate saved log): frontend Vitest 98 tests / 12 files passed in
3.59s; Biome lint exit0 with 27 existing warnings (two fewer after retired code);
TypeScript and production Vite build exit0 (existing >500kB chunk advisory).
Scoped Biome and diff whitespace checks passed. The six removed tests covered only
the deleted thin CRUD wrapper; no retained financial/security oracle was removed.
An initial Node20 ESM test-loader mismatch and pnpm metadata attempt failed before
these successful checks; neither was counted as a product failure or a passing run.
No dependency install/change was used to mask the runtime mismatch.

## Actual HTTPS GREEN

At 63562b9, `/private/tmp/capital-lir-green.cjs` built only the frontend and reused
the pinned accepted backend. Fresh isolated tmpfs PostgreSQL schema19/seed, existing
real auth/session/MFA, actual HTTPS app, and controlled external providers only.

`pnpm exec playwright test tests/e2e/legacy-liabilities-retirement.spec.ts
tests/e2e/manual-portfolio-valuation.spec.ts --grep 'LIR-UI:|MPV-UI:' --workers=1`

Exit0: **2/2 passed in25.7s**, one worker, zero retries. LIR-UI13.4s, retained
MPV-UI11.7s. Full business-table fingerprints (including both seeded liabilities)
remain equal, excluding only legitimate auth session/request-limit writes; the
notice makes zero business API requests and the journey adds zero provider calls.
Exact saved decimal/fields, owner-only list/read, foreign404, anonymous/pending401,
no-store and both protected bookmarks are asserted. MPV-UI passes unchanged with
exact308.64, explicit gaps and stale-response rejection against the real backend.
No unexpected GREEN failure or relaxed assertion. This E2E run itself exercises
real PostgreSQL; no separate DB-algorithm/migration matrix is claimed for this UI change.

- Backend sha256:4b6bfc44032298aa1f4c8c342ad5ff9ac16c235d9bbf6c665fb58e227ae61c77
  (byte-identical to the predecessor and previous actual PostgreSQL acceptance).
- Frontend sha256:fd9572099767a0e2a0ef0983408adcc9eb831bec44d3cb69b11ee7816b8baed8

Artifact containment/proxy/network checks passed. Raw evidence:
`/private/tmp/capital-lir-green.log` and `/private/tmp/capital-lir-green-artifacts`.
Harness cleanup completed; subsequent live labeled container/network lists empty.
Owner Nginx mode0644/size1348/SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432 and lock SHA256
6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d unchanged.
Strict OpenSpec23items (22canonical+active) PASS; diff whitespace PASS.
No owner database, original folders, remote push, paid service or production action.
The previously listed unrun checks remain unrun. Whole refactor remains incomplete;
this is a single legacy UI retirement, with chart max-period review still deferred.

## Archive

Luna independently audited root's final acceptance evidence and found no discrepancy.
Installed OpenSpec1.2.0 `archive retire-liabilities-editor --yes` succeeded with
canonical synchronization to `legacy-liabilities-retirement` (four requirements),
archive `2026-09-24-retire-liabilities-editor`. The expected6/7 warning referred only
to task3.3, which includes archive itself; marked7/7 after actual success. Generated
Purpose filled without changing requirements. Post-archive strict23canonical specs
passed; 22 prior canonical specs byte-identical and active changes empty.
