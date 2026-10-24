# Capital Tracker

Personal, single-owner capital tracker (public repository): NestJS, TypeORM, PostgreSQL and Redis in `backend/`; React and Vite in `frontend/`; real HTTPS and PostgreSQL acceptance in `tests/e2e/`. Production is live: a green CI run on `main` deploys after the owner approves it in GitHub (`docs/manual-mvp-release.md`).

## Commands

Use Node 26.12.1 (`.nvmrc`) and pnpm 12.9.1 (`packageManager`). Node 26 ships without corepack, so README's `corepack enable` fails; if pnpm is missing, install it with `npm install -g pnpm@12.9.1`. Check `node --version` and `pnpm --version` first: pnpm doesn't enforce `engines`, and on Node 22 backend Jest fails with "Must use import to load ES Module".

```sh
pnpm install --frozen-lockfile                # needs network
pnpm --dir backend lint                       # Biome on src/; fix: pnpm --dir backend check
pnpm --dir frontend lint                      # fix: pnpm --dir frontend check
pnpm --dir backend build
pnpm --dir frontend build                     # tsc && vite build
pnpm --dir backend test --runInBand           # Jest, always with coverage
pnpm --dir frontend test                      # Vitest, always with coverage
NODE_OPTIONS=--experimental-vm-modules pnpm --dir backend exec jest src/config/scheduling.spec.ts   # one backend spec
pnpm --dir frontend exec vitest run src/ui/Modal.test.tsx                                           # one frontend file
pnpm verify:baseline                          # lint + build + test, both packages
```

- Single-test paths are relative to the package. Vitest finds nothing for `frontend/src/...`, and `pnpm --dir frontend test -- <file>` runs every file.
- Before you push, run what PR CI runs without Docker: `pnpm verify:baseline && pnpm test:engineering && pnpm test:security && pnpm audit:production`. `test:security` needs `python3` and the audit needs network. `backend/src/engineering/gates.spec.ts` pins the CI wiring.
- `pnpm audit:production` is the required high/critical gate (CI runs it on every PR; also run it after dependency changes). Never suppress registry failures or advisories. Keep lower-severity findings visible in `docs/dependency-security.md`. Packages with install scripts need an `allowBuilds` entry in `pnpm-workspace.yaml`.
- With Docker: `pnpm test:e2e:critical` (PR profile), `pnpm test:e2e` (full suite, nightly in CI) and `pnpm test:e2e:down` use `tests/e2e/compose.yml` (`docs/testing-and-migrations.md`).
- `pnpm specs:validate`: run it only where `openspec/` exists. CI doesn't run it.

## Boundaries

**Always**
- Use synthetic data and credentials in tests, fixtures, screenshots, logs and CI artifacts.
- Preserve private configuration. Leave `frontend/nginx.conf` alone: it is the owner's host configuration, and the images use `deploy/container-nginx.conf`.
- Write code, specs, docs and commits in English.
- Fix security bugs you find, in an ordinary PR. `SECURITY.md`'s private reporting is for outside reporters.

**Ask the owner first**
- Destructive schema or data changes, or anything that touches the production server, its database or the `production` environment.
- New costs or paid services, private data leaving the device, or a change to an owner decision.
- A release that changes the server runner, inventory, normalizer, Compose, pins or resume helper. The dispatcher refuses it until the owner runs `scripts/manual-mvp-dispatcher-install.sh update` as root from that commit and re-runs the release (`docs/manual-mvp-release.md`); say so in the PR.

**Never**
- Commit `openspec/`, `CONTINUITY.md`, `.env` files, secrets, keys, dumps or real owner data.
- Run tests against the production `docker-compose.yml` or owner data. Use `tests/e2e/compose.yml`.
- Delete Docker volumes (`down -v`, pruning) or clear the request ledger to make a test pass.
- Print private keys, env values or private response bodies, or upload dumps, keys or recovery codes as CI artifacts (`docs/deployment-security-verification.md`).
- Invent provider capabilities or command output.
- Consolidate into the owner's original local repository before the full refactor is verified, replace it wholesale, or discard its nested repositories or worktrees (`docs/consolidation-plan.md`).

## Sources of truth

- Before continuing, read `git status` and the Git diff, and preserve unrelated edits.
- The owner decisions in §1 of `docs/product-requirements.md` override the brief (`capital-tracker-openspec-prompt.md`) where they differ; for example, D6 makes the UI English. The brief in turn overrides older MVP exclusions and stale architecture or status descriptions in other docs (for example `README.md` and `docs/post-mvp-backlog.md`). Read at least the brief sections your change touches.
- Some docs still say production is disabled, not deployed or not release-ready (for example `README.md`, `docs/owner-authentication.md`, `docs/testing-and-migrations.md`). Those lines are stale: `.github/workflows/cd.yml` and the "Approved release" part of `docs/manual-mvp-release.md` are current.
- `openspec/` and `CONTINUITY.md` are local-only. If they exist, read the active change and the ledger (goal, constraints, decisions, done/now/next, open questions, evidence) first, and never write secrets into them.
- With `openspec/`, take each slice through propose, apply, independent review, verify and archive. Record verification in the change, and archive only verified work: specs describe implemented behaviour.
- If `openspec/` and `CONTINUITY.md` are absent (fresh clone or cloud session), don't create them. Work from the task, `git log` and the docs linked here, and put your plan and evidence in the PR. Never rely on chat memory alone.

## Verification and done

- Scope checks to the change and its risks: relevant unit and integration tests, real PostgreSQL probes, and the critical HTTPS Playwright cases it affects. You don't need a full `pnpm test:e2e` for each change.
- For behaviour changes and fixes, write the acceptance test first and see it fail on the intended assertion. An install, compile or environment failure is not RED. For pure refactors, keep the existing passing characterization tests unchanged as the baseline.
- Mocks of repositories, HTTP or your own backend don't verify database or browser behaviour. Never weaken financial or security oracles, skip failing tests or edit expected results to get a green run.
- PR CI runs every gate, including every critical acceptance shard. A push to `main` runs no lint or unit tests and fails unless the merged PR's run passed (`Merged Pull Request CI`); it reruns acceptance unless the trees match and it can reuse that run's images. Keep the PR branch up to date with `main` and let CI finish before the owner merges it. If you can't run Docker or reach a provider, say so; PR CI is then the E2E evidence.
- The critical profile must keep the real PostgreSQL, provider, CLI and artifact gates and the selected real HTTPS journeys. A paused, skipped, partial or candidate-unbound critical run is not release evidence. Neither it nor PR CI replaces the full suite or the separate encrypted backup/restore and server gates (`docs/critical-release-coverage.md`).
- The verification record (the OpenSpec change, or the PR) is the authority for which checks actually ran. List there the checks run, with why you chose them and their results, and the checks not run, with the reason. Record coverage limitations and existing warnings. Never call a targeted run a full or release pass. No coverage threshold is enforced, so never claim one passed.
- You're done when `pnpm lint` reports no more warnings than on `main` (both packages already carry some, and lint exits 0 with them), the builds pass, the relevant tests and PR CI are green, and every review thread is fixed or answered with a reason and a follow-up.

## Money, data and time

- Missing is not zero. A missing price, cost, quantity or history shows as missing, and any total that depends on it is marked incomplete or estimated, with the reason. Keep "estimated" and stale-data flags.
- Money is exact wherever it is stored, returned or computed into a result: decimal strings over the API, PostgreSQL `numeric`, BigInt atoms in the backend (`backend/src/accounting/money.ts`). In the backend, never use `Number()`, `parseFloat` or a float tolerance on an amount. In the frontend, keep API amounts as strings; `Number()` is acceptable only for chart coordinates, sorting, comparisons with zero and totals marked display-only. Format amounts with `frontend/src/features/portfolio/format.ts`.
- Savings-goal projections (`backend/src/goals/goal-forecast.ts`, the goal cases and the goal chart) are float estimates of compound growth at a constant return, by owner decision (2026-10-15). They stay out of stored money, come back as plain decimal strings, and are labelled as projections.
- Never show a figure better than the real one. Round what the owner has down and what is still missing up. Show entered amounts as entered.
- Days are Moscow calendar dates (`moscowDate`, `backend/src/fx-rates/fx-conversion.ts`), not UTC or browser dates. Test 21:00–24:00 UTC and month ends.
- A label claims only what the data supports. An effective rate is not "official", and a reward is not a purchase.
- One user action is one idempotent backend command with a client `requestId`, never a chain of browser writes. Enforce account and security boundaries in the backend, not only in the UI.
- Stay read-only toward chains, exchanges and brokers: no seed phrases, spending keys, signing or orders. Refuse tokens that can trade, and delete a stored credential with its account. Use free provider tiers only, with no paid fallback.
- Parse provider responses strictly. Build fixtures from documented or recorded responses, never guessed ones. If a provider is unreachable from your environment, say so and ask the owner for a probe.
- When a review names one instance of a defect, fix and test every instance of the pattern.

## Auth invariants

- Owners are created only by the CLI (`pnpm --dir backend owner:bootstrap`, `owner:recover`; Argon2id). There is no registration.
- A password alone gives only a pending session, until mandatory TOTP or a single-use recovery code succeeds. Sessions are opaque Secure, HttpOnly, SameSite=Strict cookies, and the CSRF token stays in memory only.
- The global `SessionGuard` (`backend/src/auth/auth.module.ts`) requires a fully verified session on every route. `@Public()` lifts that requirement; `@AllowPending()` also accepts a password-only pending session.
- Read `docs/owner-authentication.md` (exact HTTPS origin, expiry, logout/recovery, session caps) before changing sign-in, session, CSRF, MFA, recovery or cookie behaviour, for example in `backend/src/auth/`, `backend/src/main.ts` or `frontend/src/api/`.

## Database and migrations

- Startup never migrates or synchronizes the schema. Run migrations only through the explicit CLI, with reviewed `DB_*` variables: `pnpm --dir backend build && pnpm --dir backend migration:show` (or `migration:run`). The CLIs load no env file; don't add implicit env-file loading to them.
- New migrations go in `backend/src/migrations/`: hand-written raw SQL (not `migration:generate`), additive unless the owner approved a destructive change, with a `down()` that throws. Name the file `<timestamp>-<PascalName>.ts` and the class and its `name` field `<PascalName><timestamp>`. The timestamp is the latest file's plus 100000000, not `Date.now()`: existing timestamps run ahead of the clock, so a real one sorts before them and `tests/e2e/migrations.cjs` fails on the order. Only one open PR adds a migration at a time; the next one rebases its timestamp.
- A merged migration runs on the production database at the next approved release, after `scripts/manual-mvp-release.sh` dumps and restore-checks it.
- Destructive schema or data changes need a backup or export, a migration plan and owner approval. Never bypass preflight, edit migration ledger rows or rewrite applied migrations. Read `docs/brownfield-audit.md` before upgrading an existing database: preflight refuses unsafe legacy history.

## When you change X, also update Y

CI fails when these drift, except where noted:

- **New migration:** put each new table in `backupTables` or `notBackedUp` in `backend/src/owner-export/backup-tables.ts`. Then bump the migration count and name lists pinned in `tests/e2e/*.cjs`. Search for the old count in digits and in words, and for the previous latest name.
- **New containerized probe** (`tests/e2e/<name>.cjs`, usually `*-db.cjs`): add `{ name, shard }` to `CHECKS` in `scripts/acceptance-shards.cjs`, add the name at the same position in `legacyChecks` in `scripts/acceptance-shards.test.cjs`, and run `pnpm test:engineering`.
- **New Playwright spec** (`tests/e2e/*.spec.ts`): the nightly full suite runs it with no registration. To gate PRs, add `{ file, title }` to `tests/e2e/manual-mvp-manifest.json`; the title must be unique in the suite. Then update every number derived from the manifest length (case counts and partition sizes) in `scripts/critical-release-profile.test.cjs` and `docs/critical-release-coverage.md`.
- **New page:** add a lazy entry in `frontend/src/features/shell/route-pages.ts`, a route in `frontend/src/App.tsx` and a section in `frontend/src/features/shell/navigation.ts`. If the page shows its own API errors, add its prefix to `pageHandlesError` in `frontend/src/api/client.ts`.
- **New or changed endpoint:** update its row in the API Endpoints table of `README.md`. CI doesn't check this.

## Code and tests

- The Biome config in each package is the style source for its `src/`; run `pnpm --dir <pkg> check` before committing. Elsewhere (`scripts/`, `tests/`, root config files), match the existing style: two-space indentation and single quotes. Keep the design simple, and add an abstraction only for a demonstrated need.
- Frontend: reuse `frontend/src/ui/`, read through `useCachedRead` or `frontend/src/api/cached-reads.ts`, call the API only through `apiClient`, and never depend on another feature's CSS.
- UI copy is English and written inline in components (owner decision D6; the brief's "Russian UI" is superseded). Don't add i18next keys or Russian strings; nothing in the UI reads translations.
- When a test covers a stable scenario ID, start its `describe` or `it`/`test` title with the ID (for example `describe('XFER-PROPOSED-UI: …')` or `it('OPS-DELETE-GUARD …')`), and cite the IDs with their actual results in the verification record.
- Frontend tests use real backend response shapes, and every test asserts what its title claims.
- E2E is real: HTTPS Chromium at `https://127.0.0.1:8443` (not `localhost`) through the backend to PostgreSQL. Never mock your own backend; stub providers at the server's outbound HTTP boundary.
- Keep `pnpm test:e2e` and its test files for regression and release. Prune the E2E pyramid only as its own reviewed change: move coverage lower first, keep critical financial and auth paths covered, and keep the existing test files until equivalent coverage is reviewed.

## Git and pull requests

- Work on a feature branch and never commit directly to `main`. In a cloud session keep the assigned `claude/<slug>` branch; elsewhere use a short descriptive name.
- PRs are squash-merged. GitHub takes the `main` subject from the single commit's message, or from the PR title when there are several commits, and every commit message lands in the body. Use Conventional Commits for both: a lowercase, plain outcome and no trailing period, for example `feat(goals): show the nearest goal on the dashboard`.
- One change per PR. The body covers Before / After / How and any migration or server step.
- `docs/screenshots/` holds the current look of each screen, with synthetic data: `<screen>-390-light.png` (phone, light theme) and `<screen>-1440-dark.png` (desktop, dark theme), where `<screen>` names the page, dialog or state (for example `dashboard`, `add-transaction`, `goals-empty`). A PR that changes a screen replaces or adds that screen's two images, and deletes them when the screen goes away, so the folder always matches `main`.

## Parallel work

- Parallelize only independent work, each task in its own isolated Git worktree (or its own clone, as in cloud sessions) with an exclusive file list. Editing another lane's file needs the coordinator's approval.
- The owner's named roles: Astra orchestrates only; Root coordinates integration and assigns exclusive file ownership; Sol implements or reviews when assigned; Luna takes bounded documentation, audit and simple tasks. When no named roles run, the coordinator is whoever assigned the lanes: the owner or the orchestrating session.
- Migrations, `pnpm-lock.yaml` and deployment files (for example `deploy/`, `docker-compose*.yml`, the Dockerfiles, `env.production.example`, `scripts/manual-mvp-*`, `.github/workflows/cd.yml` and the release jobs in `ci.yml`) are owned centrally by the coordinator; never edit them concurrently.
- When you delegate, give straightforward bounded tasks to a simpler model and keep a stronger model for architecture, security, complex implementation and independent review. A delegated task states its inputs, allowed files, acceptance criteria and verification commands. A handoff lists the files changed, tests run with results, open findings and the next task.
- Review every change in a separate context (a subagent, a separate session or the Codex PR review), whether or not `openspec/` exists. Never claim an independent review that didn't run.
- Review a worktree's diff before integrating it. After verified integration, remove a worktree only after checking that its HEAD is an ancestor of `main` or patch-equivalent and that it has no unique tracked or untracked changes. Use a non-force `git worktree remove`, and keep its branch, other active worktrees and owner data (`docs/worktree-cleanup.md`).

## Review guidelines

- Treat a break of "Money, data and time", "Auth invariants", "Database and migrations" or "Boundaries" as P1, and cite the rule.
- Judge UI copy and scope against the owner decisions in `docs/product-requirements.md`, not against older wording in the brief.
