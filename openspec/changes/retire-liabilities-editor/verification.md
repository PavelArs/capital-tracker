# Legacy liabilities retirement verification

Status: genuine predecessor RED observed; frontend implementation in progress.

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
