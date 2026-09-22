# Final repository consolidation

Inventory checked **2026-09-21** using read-only filesystem metadata, SHA-256,
package identity metadata and Git commands with `GIT_OPTIONAL_LOCKS=0`. No private
configuration contents were printed; no original file, database, Docker resource,
Git reference or worktree was changed. This document is the only inventory output
written to the workspace.

The user authorized moving the completed refactor into the old repository and
deleting the other related code/project folders **at the end**. That authorization
persists; the verified, exact related paths below do not require another generic
confirmation. The full refactor is still incomplete. This inventory is not approval
to perform consolidation now or to delete owner data or unrelated folders.

## Destination and eventual cleanup scope

| Exact path | Evidence and final treatment |
|---|---|
| `/Users/pavelars/Projects/capital-tracker-old` | Final destination. Original NestJS/React/pnpm repository; retain its existing `.git`, local configuration and owner changes. Import the verified refactor branch into this repository. Never replace this directory wholesale with the clone. |
| `/Users/pavelars/Projects/temp/capital-tracker` | Current refactor checkout from the same base commit. Remove this duplicate only after its complete source/evidence/history is transferred and verification passes from the destination. |
| `/Users/pavelars/Projects/capital-tracker` | Related Bun MVP with backend package name `capital-tracker`, frontend and cron/Compose/SQL files. Eligible for eventual code-folder removal after preserving its unique work and both nested Git repositories. **Correction to the initial audit:** no root `.git` does not mean no Git history. |
| `/Users/pavelars/.cursor/worktrees/capital-tracker/aig` | Linked to the original repository; tracked files clean at `3c0857ff6cdfadf924431bf43d5d449ff48a5248`, one unique untracked rules file. Preserve that file, then remove through worktree-aware cleanup. |
| `/Users/pavelars/.cursor/worktrees/capital-tracker/ccj` | Same tracked revision, one different unique untracked rules file. Same preservation requirement. |
| `/Users/pavelars/.cursor/worktrees/capital-tracker/zpj` | Same tracked revision, clean including untracked check. Related redundant worktree; eligible after history and metadata backup. |

Do **not** remove `/Users/pavelars/Projects/temp` as a whole: its `.codex`,
`.pnpm-store` and root `openspec` are outside the proven code-folder cleanup scope.
Also preserve Projects-level `.codex`, `.claude`, `openspec`, `3dp-manager`,
`ai-web-scraper`, `website`, `project` and `project2`. Current package metadata
identifies `project` as `ai-web-scraper-monorepo` and `project2` as
`x402hackahon-project-0` (Hono/thirdweb); there is no evidence to reclassify them.
A directory-name scan through four levels below Projects, excluding dependency,
Git and generated directories, found only the three Capital Tracker paths above.
This is bounded discovery, not a claim that no other copy exists anywhere.

## Preservation evidence

**Original repository.** HEAD/main is
`9c78d80036d6314e8902dc54adb0e26d30d156a2`. It has 18 local branches, 20
remote-tracking refs, eight tags, 113 commits reachable from refs and 119 when
reflogs are included. The working clone has 109 reachable commits and no stashes;
its `origin` refs do not reproduce all original refs. Preserve the original entire
`.git`, including reflogs, config, worktree metadata and both stashes:

- `stash@{0}`: `ce3db2512c284d963dbbda9a8fcff5702320b96a`
- `stash@{1}`: `90d2f99a7462278847e6a6513797f4bea42ec65e`

Both stashes change `backend/package.json` and `backend/package-lock.json`; neither
has an untracked-files parent. A refs-only bundle is insufficient to preserve the
full reflog/stash stack. Neither original nor clone uses object alternates or a
shallow repository. No tracked submodule definition was found.

The original has exactly one working-tree change, `frontend/nginx.conf`, and no
untracked files. Its bytes match the working clone; SHA-256 is
`115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`.
Keep this owner edit, including its uncommitted provenance, in the preservation
snapshot before any branch switch. Ignored files outside dependency/build/coverage
trees are exactly the following; keep them private and preserve in place:

| Path relative to original repository | Bytes | SHA-256 |
|---|---:|---|
| `.env` | 1250 | `1064a2b4148657311ded8b2ee9d12f61fa18ac2c3078d74f2f7c3bb841607800` |
| `backend/.env` | 308 | `c509d46f95b789746afee43a59236afd364c2ebede5149aae2fcd074eab08b0e` |
| `frontend/.env` | 45 | `c8e95bf53e3ef5c3a3e3f688d61a5c223682bbe4301535033a2304fae3c195a4` |

**Bun MVP.** The backend and frontend each have a one-commit Git repository, no
stashes and no additional worktrees. Backend HEAD is
`d3328ee8a1fafd634e912136815788a71ab416a4`; frontend HEAD is
`75ba64af2fe276277d334f380b9e52abf7cb20ad`. These independent histories and dirty
trees are not contained in the working refactor checkout.

- Backend: five modified tracked files (`README.md`, `bun.lock`, `index.ts`,
  `package.json`, `tsconfig.json`) and 26 untracked files (`Dockerfile`,
  `sql/init.sql`, `temp.py`, and 23 files under `src/`, including session/auth,
  snapshots, jobs and financial services). Preserve all, without assuming an
  untracked file is disposable.
- Frontend: four modified tracked files (`src/App.tsx`, `src/index.css`,
  `src/index.html`, `src/index.ts`) and two untracked files (`Dockerfile`,
  `src/types.ts`).
- Outside those repositories: `.dockerignore`, `AGENTS.md`, `CONTINUITY.md`,
  `README.md`, `docker-compose.yml`, `cron/Dockerfile`, `cron/crontab` and
  `docs/MVP.md` are unversioned project material to preserve.
- Each nested repository has the symlink
  `.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc -> ../../CLAUDE.md`.
  Archive links as links; do not dereference during copying. No other symlinks
  were found outside the excluded dependency/Git/generated trees.

**Cursor worktrees.** Their `.git` pointer files reference the former, absent
`/Users/pavelars/capital-tracker/.git/worktrees/<name>` location. Normal `git status`
there fails. Read-only status succeeds with explicit
`--git-dir=/Users/pavelars/Projects/capital-tracker-old/.git/worktrees/<name>` and
`--work-tree=<actual path>`. Do not discard them on the assumption that broken links
mean empty or stale work. Their detached commit is reachable from original refs.
Unique untracked files are:

| Worktree-relative path | Bytes | SHA-256 |
|---|---:|---|
| `aig/.cursor/rules/backend-nestjs.mdc` | 26 | `4447cbe12c1750119e004a2da96193874937baa12c3da210f3baa09e6f9d44d1` |
| `ccj/.cursor/rules/nestjs-backend-best-practices.mdc` | 19773 | `9112aa890635a23f429906a2b05ee09ad96957a1e898914c7f06281ede01024a` |

## Data boundaries and unknowns

Filename/metadata inspection found no local database dump, upload directory or
backup archive outside excluded trees. This is **not** proof of no owner data.
Original Compose declares named `postgres_data` and `redis_data` volumes; Bun
Compose declares `db_data` plus the `backend/sql/init.sql` bind mount. Actual Docker
volume names, contents, deployment state and external backup locations were not
queried. They must remain untouched by code cleanup. Do not use `down -v`, volume
pruning, database recreation or a broad filesystem delete during consolidation.
An SQL initialization file is not evidence of a recoverable database backup.

Dependency folders, `.git`, `dist`, `build`, `coverage`, `.next`, Playwright reports
and test-results were excluded from source-tree hashing. Inspect unexpected local
files there before final removal; preserve required evidence and unique data.
The clone's `tests/e2e/.runtime/tls` contains generated synthetic TLS files, not
owner credentials; regenerate them when testing at the destination.

For drift detection, the original non-generated regular-file inventory contained
267 files / 1,017,743 bytes, manifest SHA-256
`622691be0d2e11749c6e9f4d67aea6ba4a32b2f3244817e056a079845206ef5a`.
The Bun inventory contained 59 regular files / 127,280 bytes plus the two symlinks,
manifest `c4f03b467c4a3676236b96b9114c6c951ce135786a4c0e03500d6cac5f6995ce`.
Manifest input is UTF-8, sorted relative paths, one `path<TAB>bytes<TAB>SHA256` per
line, joined by newline with no trailing newline; links are recorded separately.
These snapshots must be regenerated immediately before consolidation.

The artifact gate's local-checksum portability issue is resolved by the verified
`preserve-checkout-configuration` change. Acceptance now captures the existing
regular Nginx file's hash/permissions before side effects and verifies them after
cleanup, including failures. Clean/local baselines and tampering paths have18
independent tests; real image acceptance passed. The exact owner checksum above
remains local preservation evidence. Keep that unrelated edit outside refactor
commits; image builds use separate `deploy/container-nginx.conf`.

## Final migration, verification and deletion sequence

1. Complete the **entire** refactor brief and its requirement audit, security and
   financial/provider gates, real database/browser tests, and backup/restore and
   rollback exercises. The completed owner-provisioning slice alone is insufficient.
   Finish and preserve the refactor's Git history and verification evidence.
2. Recheck all exact paths, filesystem types, Git status/refs/reflogs, links and
   hashes above. Capture any work done since this inventory. Do not follow a newly
   introduced symlink or broaden cleanup to a similarly named folder.
3. Create a private, verified preservation archive outside all cleanup candidates:
   original Git metadata and owner changes/configuration; both complete nested MVP
   histories and dirty/untracked trees; Cursor metadata and unique files; necessary
   test evidence. Preserve permissions and symlinks, encrypt sensitive configuration,
   and perform a restoration/hash check. Do not commit private files or their values.
   Retained preservation archives are data safeguards, not duplicate active projects.
4. Import the verified refactor branch/history locally into the original repository,
   preserving existing refs, stashes, reflogs and remote configuration. Use a feature
   branch, not a direct commit to `main`. Preserve the dirty Nginx edit before branch
   transition; transfer only reviewed source/evidence paths, including tracked
   configuration examples. Never mirror `.git`, private environment files, live
   data or generated dependency trees over the destination.
5. Reinstall frozen dependencies and run the final complete verification from
   `/Users/pavelars/Projects/capital-tracker-old`, with isolated synthetic services.
   Confirm source manifest/commit identity, owner Nginx/config hashes, retained Git
   refs/stashes, and documented commands. Code relocation must not start the app
   against the owner's database or implicitly authorize production rollout.
6. Once preservation and destination checks pass, remove only the duplicate clone,
   Bun project folder and three proven-related Cursor worktrees listed above.
   Repair the relocated worktree linkage first and use Git-aware removal after
   unique files are preserved; verify metadata afterward. Remove the worktree parent
   directory only if empty. Preserve all database volumes and unrelated/shared paths.
7. Record final destination, imported commit, preservation archive location and
   verification hashes privately as appropriate, exact deleted paths and retained
   data boundaries. Confirm the destination works independently of removed paths.
   If a preservation or verification check fails, resolve it before deletion; do
   not replace the user's standing authorization with a redundant blanket approval.
