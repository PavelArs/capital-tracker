# Acquisition entry verification — 2026-09-26

Baseline `0fc48f7`. Acceptance authored independently in `capital-test-acquisition-entry`
(Sol), swap/reward components in separate Luna worktrees; root integrates shared CSS,
tests and synthetic runtime. Scope is presentation and associated guidance only.
Existing Dockerfiles, acceptance Compose and `.github/workflows/cd.yml` were inspected
and retained. No backend, authentication, schema, controller, dependency or provider change.

## ATDD and preservation

Baseline frontend:118 tests/21 files pass,3.49s. Existing SWAP-UI and REWARD-UI were
extended before product edits. Real predecessor image
`sha256:8e48e2fa1d3efd6196e1267446cf5bdde47afa79b772d395a80684bc8589844a`
failed both new accessible-description assertions with received empty strings.
This is expected semantic RED; shared CSS extraction uses passing characterization.
No artificial refactor failure or financial assertion weakening was introduced.

QA initially used the default formatter; root restored repository formatting and
unrelated API-test prefixes. Root tightened the order-description matcher to actual
same-time wording, added exact populated-value and database/provider stability checks,
and retained original null/zero/fee/stale-review/immutable-retry/SQL oracles. These edits
precede GREEN and do not change the observed missing-description RED.

Root integration retained original swap manual-form/fieldset classes and explicit ISO
guidance. Installed TypeScript AST comparison confirms43 control signatures unchanged
across trade11/swap17/reward15: type/inputMode/value/checked/required/disabled and all
change/submit/click handlers. Independent review additionally compares option values
(67 nodes total) and checks recovery/conditional-field placement. This source evidence
complements real browser/backend/PG verification, not a replacement for it.

## Scoped checks

Logs/artifacts: `/private/tmp/capital-entry-*`; retained failed RED artifacts separately.

| Check | Actual result |
| --- | --- |
| Frontend characterization (`pnpm --dir frontend exec vitest run`) |118/21 PASS,3.15s |
| Frontend build |exit0; existing >500kB bundle warning |
| Frontend lint |exit0;27 existing warnings |
| Scoped per-package Biome |7 files pass,no fixes |
| Strict standalone E2E TypeScript |exit0 |
| `pnpm audit:production` |exit0;2 moderate,no high/critical; unchanged lock |
| Strict OpenSpec before archive |36 items pass:35 canonical plus active change |
| Real SWAP-UI/REWARD-UI/WORKFLOW-UI |3/3 PASS,44.0s;15.9s workflow,13.7s each reward/swap;0 retries |
| Independent settled screenshots |26 inspected:swap10,reward10,trade6;both themes360/768/1440;approved |

Type command from backend cwd: `pnpm exec tsc --noEmit --strict --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck ../tests/e2e/*.ts`.
Browser command: `pnpm exec playwright test tests/e2e/asset-swaps.spec.ts tests/e2e/asset-rewards.spec.ts tests/e2e/account-operation-workflows.spec.ts --grep 'SWAP-UI:|REWARD-UI:|WORKFLOW-UI:' --workers=1`; configured0 retries.
The preserved-file harness `/private/tmp/capital-entry-browser.cjs green` builds a
fresh synthetic PG16.10 tmpfs environment, runs all22 migrations and owner bootstrap,
and starts actual release frontend/backend, HTTPS edge and password/TOTP authentication.
Only external providers use fixtures; committed-response loss aborts the real response
after `route.fetch`, then verifies actual SQL and original-command replay. It runs the
existing release-artifact checks and cleans only `capital-tracker-e2e` afterward.

Candidate frontend `sha256:73f4c11a8eee1496177581248c26642c77accb953173e762130eb392c8a9a707`;
unchanged backend `sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2`.
Host Node22.23.2, images22.21.1, pnpm10.33.0, OpenSpec1.2.0, Playwright1.63.0.

## Limits and finalization

No full E2E/backend/SQL/security/migration-upgrade matrix, hosted CI, production rollout,
owner UX approval or complete-redesign claim. Those suites remain intact; no backend
behavior changed. Existing Nginx http2 deprecation and dependency/bundle warnings remain.
The durable preview stays on its original image/data until the wider redesign is ready.
Independent source/runtime/visual review approved this bounded slice with no remaining
findings; see review.md. Long synthetic names retain native select truncation as before;
amounts and descriptions inspected in the screenshots remain readable.

Final labeled inventory: no e2e containers or networks remain. Preview containers remain
stopped33hours, volume `capital-tracker-preview_preview_data` and original tags remain;
frontend preview `sha256:7eff01d148e8f286c025655ffa0dd88cfa842fc051d9dd9240318c11cc60768c`.
Integration owner Nginx remains the sole unrelated edit, mode0644,size1348,SHA256
`115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`.
Lock SHA256 `6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d`.
Worktree tracked Nginx/backend/deploy/CI/Compose/Dockerfile/lock match baseline. Only the
three verified task dependency symlinks were removed; source worktrees/folders retained.
Archive and canonical comparison are the remaining procedural step.
