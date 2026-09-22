# Capital Tracker engineering contract

Read CONTINUITY.md, capital-tracker-openspec-prompt.md, active OpenSpec changes,
and Git diff before continuing. The target brief supersedes old MVP exclusions
and stale architecture descriptions in CLAUDE.md. Retain compatible code style
and English Conventional Commit conventions. Do not commit directly to main.

Use pnpm 10.33.0 from packageManager. Install: `pnpm install --frozen-lockfile`.
Backend: `pnpm --dir backend lint`, `pnpm --dir backend build`,
`pnpm --dir backend test --runInBand`. Frontend: `pnpm --dir frontend lint`,
`pnpm --dir frontend build`, `pnpm --dir frontend test`.
Repository/HTTP mocks are not real database/browser verification.
Run `pnpm audit:production` for the required high/critical production dependency
gate. Preserve visible lower-severity findings in docs/dependency-security.md;
registry failures and advisory findings must never be suppressed.

OpenSpec 1.2.0: `OPENSPEC_TELEMETRY=0 openspec validate --all --strict --no-interactive`.
Core workflow: propose -> apply -> independent review -> verify -> archive.
Current specs describe verified implemented behavior. Stable scenario IDs connect
requirements, tests and actual command results. Observe intended acceptance failure
before changing behavior; preserve passing characterization for pure refactors.
Never weaken financial/security oracles.

Use separate review contexts with bounded file ownership. Do not concurrently edit
migrations, dependency locks or deployment files. Preserve the existing owner's
frontend/nginx.conf modification. No real database access, folder removal,
production deployment or private data disclosure during isolated preparation.
Destructive schema changes need backup/export, migration plan and owner approval.

Use isolated Git worktrees for independent parallel implementation tasks and review
their diffs before integration. Use a simpler agent model for straightforward bounded
tasks; retain a stronger model for architecture, security, complex implementation and
independent review. Keep migration, lockfile and deployment ownership centralized.
Keep code clean and consistent with compatible project conventions. Use current
practices supported by the installed tools, and choose simple architecture patterns
that fit the task rather than introducing unnecessary abstractions.

Maintain concise CONTINUITY.md with goal, constraints, decisions, done/now/next,
open questions and evidence. Never record secrets. Read docs/brownfield-audit.md
before database upgrades: explicit migration preflight refuses unsafe legacy history.
Run real isolated verification with `pnpm test:e2e`; see docs/testing-and-migrations.md.
Never use the production Compose file for tests or alter the owner Nginx edit.
