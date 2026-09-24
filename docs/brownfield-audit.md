# Brownfield audit — 2026-09-21

## Repository selection and preservation

Base: `/Users/pavelars/Projects/capital-tracker-old`, commit
`9c78d80036d6314e8902dc54adb0e26d30d156a2`. Isolated clone in
`/Users/pavelars/Projects/temp/capital-tracker`, branch `refactor/brownfield-baseline`.
This retains the existing Git history, code and package manager. Source has one
uncommitted edit, `frontend/nginx.conf`; copied unchanged, not overwritten.
No remote push, project removal or real database access occurred.

| Existing project | Evidence | Decision |
|---|---|---|
| capital-tracker-old | Git, NestJS/TypeORM/PostgreSQL migrations, React/Vite, pinned pnpm, Jest/Vitest, GHCR workflows | Refactoring base |
| capital-tracker | No Git directory, Bun-based smaller MVP, SQL init, no CI/tests discovered | Preserve as reference; no deletion before final verified replacement/data inventory |
| project | Package identifies ai-web-scraper monorepo | Unrelated; preserve |
| project2 | Hono/thirdweb x402 project | Unrelated; preserve |
| Other Projects folders | 3dp-manager, ai-web-scraper, website | Unrelated; preserve |

OpenSpec: supplied temp/openspec only had default config, empty specs/changes.
Global CLI 1.2.0, `spec-driven` schema, core profile with propose/explore/apply/archive.
`validate --all --strict --no-interactive` verified supported. No verify integration;
use documented equivalent independent review plus actual command execution.

## Baseline

| Command/check | Observed result |
|---|---|
| pnpm install --frozen-lockfile | Pass, pnpm 10.33.0; network escalation required after sandbox DNS failure |
| pnpm --dir backend test --runInBand | 6 suites / 108 tests pass before new characterization |
| pnpm --dir backend build | Pass |
| pnpm --dir frontend build | Pass; bundle-size warning |
| Backend/frontend lint | Pass with 99 / 38 warnings; no auto-fix |
| pnpm --dir frontend test, default runtime | Cannot start 7 workers: ERR_REQUIRE_ESM; shell later confirmed Node 20.10.0 |
| Same frontend test using installed Node 22.21.1 in PATH | Exit 0; 7 files / 59 tests pass. Reported statement coverage 35.41%, branches 18.75%; purported nested global 90% threshold is not effective |
| Docker | Initially daemon absent; app started, daemon 29.5.3 responding; no running containers observed |
| PostgreSQL/migrations/images/browser baseline | Not yet run; unit mocks are not evidence for these |

Initial raw logs: `/tmp/capital-backend-baseline.log`,
`/tmp/capital-frontend-baseline.log`, `/tmp/capital-frontend-node22.log`,
`/tmp/capital-*-build.log`, `/tmp/capital-*-lint.log`.
Dependency/environment failures do not establish ATDD RED.

## Keep / simplify / remove

| Area | Decision | Data consequences and prerequisite |
|---|---|---|
| NestJS modular monolith, TypeORM, PostgreSQL | Keep; explicit migrations | Preserve existing rows and provenance |
| pnpm 10.33.0 lockfile, Node 22, Jest/Vitest | Keep; pin tooling/runtime and enforce reproducibility | None |
| React/Vite, Russian translations, Chart.js | Keep working components; new UI may use Mantine/ECharts where needed | UI removals do not authorize data deletion |
| Wallet CRUD and owner scoping | Keep characterization; separate network/token/account model incrementally | Migrate existing wallets without silently changing identity |
| Auth | Replace public registration/email reset/stateless JWT with CLI owner, Argon2id, mandatory TOTP and revocable opaque sessions | Preserve owner identity; carefully planned credential/session migration |
| Redis currency cache | Simplify to PostgreSQL persistence/coordination after equivalent behavior is proven | Preserve historical values; remove dependency only after callers migrate |
| Income/liabilities/runway/FL-ratio legacy UI | Remove in explicitly scoped changes as portfolio screens replace it | Retain/export rows; no silent destructive schema changes |
| Current market/provider adapters | Refactor boundaries; preserve last-known values, quotas, freshness | Do not mistake current balances for cost basis/history |
| Metrics history | Replace reconstruction from current rows with ledger/observations | Existing output is not reliable investment history; do not freeze as requirement |
| Compose, Nginx, separate images, GHCR, /opt/capital-tracker | Keep useful topology; repair release gates, immutable artifacts and backup/recovery | Preserve volumes and previous releases |
| Obsolete docs/routes/tests/dependencies | Remove only with corresponding scoped feature removal | Inventory data first |

## Scoped legacy UI retirement (2026-09-24)

`retire-liabilities-editor` removes only the dedicated frontend liability editor,
list, chart, navigation, unused adapter/types/labels and its six obsolete wrapper
tests. Old authenticated bookmarks show a notice linking to manual accounts.
The backend CRUD, guards, tables and rows remain; Dashboard aggregate metrics and
its category labels remain. This does not retire the Dashboard or historical
account-valuation chart and does not authorize data/folder deletion.
The change's verification record contains the actual scoped acceptance evidence.

## Migration and security blockers at the audited base

Independent reviewer inspected source; these are code findings, not a scan or production test:

- `backend/src/config/typeorm.config.ts` enables startup migrations. Legacy migrations
  `1764100000000` and `1764200000000` drop tables; `1764300000000` deletes all non-BTC/ETH
  wallets. Downgrades cannot restore rows. Existing migration state is unknown.
- `1764000000000` silently maps unknown currency codes to USD, then drops originals;
  its downgrade loses decimal precision. Require isolated legacy fixtures, export,
  explicit preflight and backup/restore strategy before existing-data upgrade.
- Public registration, password-only full JWT, localStorage tokens, seven-day default
  lifetime and no server revocation violate the target. Browser logout/password reset
  cannot revoke already issued tokens. No mandatory second factor/session CSRF boundary.
- Crypto update errors can replace ETH/token balances with zero and a fresh timestamp;
  raw quantities become JS numbers; zero token decimals incorrectly become 18.
- Wallet address/balance logs disclose financial data. Source review is not proof of
  complete redaction, route protection, proxy handling, SSRF or XSS safety.
- Current history uses current asset/liability rows and current conversion logic,
  omitting crypto. Its existing mocked tests do not prove historical accounting.

Do not start legacy application against owner data. Full ASVS Level 2 mapping,
authenticated/anonymous DAST, static/dependency/image/secret scans and negative
API/browser tests remain required. No security certification or release readiness claimed.

## Existing pipeline inspected

Actual workflow uses GHCR, not the stale CLAUDE.md Yandex description. CI originally
ran only PRs, with floating actions and a six-job aggregate omitting Docker.
CD originally ran independently on pushes; used mutable tags, rebuilds, unauthenticated
ssh-keyscan, optional unencrypted backups, success when DB is missing, down/up downtime,
image pruning and backend-only rollback. No tested image promotion, migration job,
server-side lock, restore evidence or logical security gates exist.
Dockerfiles install pnpm@latest and resolve fresh dependencies without the workspace
lockfile. The owner's modified frontend/nginx.conf is host-level TLS proxy configuration
copied into an image without certificates; preserve it, later introduce a distinct
container static-server config. No image has yet been tested.

First change provides CI aggregation/containment only. Do not enable
PRODUCTION_ROLLOUT_ENABLED until release hardening has replaced unsafe steps and the
owner explicitly authorizes rollout. No current workflow is claimed release-ready.

## Provider uncertainty and full remaining sequence

See provider-feasibility.md for dated official-source research (separate from source
adapter coverage). No paid fallback, credentials or live wallets used in this audit.
Unknown archival permissions, free historical depth, indexed Ethereum transactions,
Zcash source feasibility and AI data retention must be settled before promising coverage.

1. Complete baseline gate slice; preserve honest limits.
2. Explicit migration execution/preflight and isolated release-image HTTPS/PostgreSQL
   Playwright harness. Reproducible images, real authentication, controlled outbound
   provider fixtures, empty and representative prior-schema migration fixtures.
3. Secure single owner authentication and negative acceptance; threat model/ASVS mapping.
4. Exact accounting, CSV import/reconciliation, FIFO, profit, XIRR/TWR and manual accounts.
5. Persisted prices, historical FX/coverage, Russian history/performance UI.
6. BTC, Ethereum, TRON, Solana, Stellar, transparent Zcash adapters and honest manual
   shielded holdings, pagination/finality/reorg/fees/coverage/reconciliation.
7. Optional click-triggered AI with approved minimal data and free-tier safeguards.
8. Full release gates, scans, tested images, encrypted backup/restore, safe rollback,
   operational docs and final requirement-by-requirement completion audit.

No narrower slice substitutes for the full target. Consolidation/deletion is deferred
until updated code is verified and original data/config/backups are inventoried.

## Progress after the baseline audit

`establish-brownfield-baseline` is archived with engineering-gates specs. The next
`isolate-release-acceptance` slice disables startup migration/extension actions,
implements explicit preflight/advisory-lock migration execution, fixes lockfile-based
image builds and excludes fixtures. Local real PostgreSQL and four HTTPS Chromium
journeys passed; see its verification.md for image IDs and scope. Source-level
regression passes 264 backend tests and 59 frontend tests. Unsafe prior schemas
are refused, not silently migrated; secure owner auth and the full target remain open.

The subsequent `restrict-owner-provisioning` slice removes public signup/email recovery,
adds a CLI-selected owner and Argon2id, and checks the owner/credential revision for
every transitional JWT request. Recovery invalidates earlier tokens; retained user and
wallet rows survive. TOTP, cookie sessions, CSRF and the full security baseline remain
required before public access. See its verification evidence and owner-authentication.md.
