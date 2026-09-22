# Capital Tracker contributor pointers

Read [AGENTS.md](AGENTS.md), [CONTINUITY.md](CONTINUITY.md), the full
[refactor brief](capital-tracker-openspec-prompt.md), the active OpenSpec change and
Git diff before continuing. The full refactor is incomplete; the current slice's
verification record is the authority for checks actually run.

Use Node 22.21.1 and pinned pnpm 10.33.0. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm verify:baseline
pnpm test:e2e
OPENSPEC_TELEMETRY=0 openspec validate --all --strict --no-interactive
```

Focused checks: `pnpm --dir backend test --runInBand`, `pnpm --dir frontend test`,
and each package's `lint` and `build` scripts. Coverage limitations and existing
warnings are recorded in continuity; do not assume a configured threshold passed.
Use the OpenSpec propose/apply/review/verify/archive sequence with actual acceptance
RED before behavior changes. Repository mocks do not establish database/browser safety.

The existing application uses NestJS/TypeORM/PostgreSQL, React/Vite and pnpm.
Owner provisioning is CLI-only with Argon2id. Browser auth now uses opaque protected
cookies and memory-only CSRF; a password grants only pending state until mandatory
TOTP or a single-use recovery code succeeds. See [owner authentication](docs/owner-authentication.md)
for exact HTTPS origin, expiry, logout/recovery and session-cap requirements.

Startup never performs migrations or schema synchronization. Use the explicit
migration CLI with reviewed DB_* settings; no implicit environment-file loading.
See [testing and migrations](docs/testing-and-migrations.md) for commands, isolated
HTTPS acceptance and refusal of unsafe historical schemas. Never use production
Compose or real owner data for tests; never delete volumes to resolve a test failure.
Production rollout remains disabled pending the full release and recovery work.

Preserve private configuration and unrelated edits, especially the owner's
`frontend/nginx.conf`. English Conventional Commits, feature branches and no direct
commits to main remain required. Use Biome, two-space indentation, single quotes
and the existing package configurations. Keep file ownership bounded across agents.

The user authorized final consolidation only after the full verified refactor.
Follow [the consolidation inventory](docs/consolidation-plan.md); retain original
Git history, stashes, private configuration/data and unrelated projects. Do not
replace the original repository wholesale or discard nested repositories/worktrees.
