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
frontend/nginx.conf modification. No real database access, production deployment
or private data disclosure during isolated preparation. The owner authorized removing
already integrated worktrees on 2026-09-27: verify ancestry or patch equivalence and
absence of unique working changes, preserve branches, active worktrees and owner data,
then use non-force `git worktree remove`. Original-project consolidation is separate.
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
Default to verification scoped to the changed code and its critical risks: relevant
unit/integration checks, real PostgreSQL and selected critical HTTPS Playwright cases.
Record the selected scenarios, rationale, actual results and unrun checks. A full E2E
run is not required for every incremental change (owner instruction2026-09-23).
Keep `pnpm test:e2e` and its test files for broad regression/release verification
when justified. Owner instruction 2026-10-01 temporarily pauses only the hosted E2E
and real-DB browser/runtime bundle until PM-TEST coverage cleanup; keep the manual
command and restore the source flag in a reviewed commit after cleanup, then rerun
full release acceptance before candidate export/promotion. All non-E2E CI gates
remain intact, and a green run with this bundle paused is not tested-release evidence.
This cleanup is a temporary prerequisite to restoring release E2E, not a deferral of
that release gate.
Review the E2E pyramid separately: move suitable coverage down before removing
redundant cases, preserving critical financial/authentication paths.
See docs/testing-and-migrations.md for the isolated environment and commands.
Never use the production Compose file for tests or alter the owner Nginx edit.

For the current authorized manual + CSV MVP release and durable whole-target
handoff, read [docs/post-mvp-backlog.md](docs/post-mvp-backlog.md) and the top
checkpoint in CONTINUITY.md first. Astra handles orchestration only; Root
coordinates integration and assigns exclusive ownership; Sol implements/reviews
when assigned; Luna handles bounded documentation/audit/simple tasks. The backlog distinguishes
mandatory in-progress release gates from deferred product work; it does not replace
the full target brief or canonical OpenSpecs.
