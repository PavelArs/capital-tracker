# Linked TWR verification

Status: implemented, independently reviewed, source/actual PostgreSQL/selected HTTPS
checks passed. Final independent evidence audit passed; archived.

## Scope, inventory and acceptance

Base e19e7d6:24 canonical specs, no active change, owner Nginx edit preserved.
Target capital-tracker-openspec-prompt.md; chart/max-period remains deferred by owner.
Keep owner auth/MFA, complete flow heads, RR READ ONLY snapshots, exact profit/XIRR/
endpoint TWR, schema19, existing GHCR/Compose/manual guarded production pipeline.
Simplify shared TWR grouping/final rational formatter and share unchanged revision
validation; remove nothing. No migration/dependency/provider/deployment/data write.
No original-repository move or deletion; whole brief remains incomplete.

Contract d0fa11f reviewed by Sol, seven implementation/verification tasks. Root pure
and actualPG acceptance f076da6 independently reviewed by Sol; no blocker in financial
oracles, capacity or committed-correction snapshot barrier. Luna wrote exactly two
HTTPS cases64be0fb integratede4c0c2c. Root reviewed and strengthened rendered profit310
and closing-value edit invalidation5cd0791 without adding another browser case.

Baseline `pnpm --dir backend test --runInBand --coverage=false twr period-profit xirr`
passed109tests/3suites in2.844s; /private/tmp/capital-linked-twr-baseline.log.
Pure refactors retain original characterization; no artificial failure introduced.

Risk manifest: strict DTO, exact netting/rational linking/rounding/capital/cap oracles;
real PostgreSQL complete heads/owner isolation/revision/snapshot/preservation;
LTWR-API and LTWR-UI plus unchanged TWR-UI over real HTTPS/password/MFA/backend/PG.
Build/lint/types/production dependency and strict OpenSpec gates. Full backend,
full E2E, older migration upgrade matrix, hostedCI, release scans, live providers
and production are deliberately unrun. Existing tests and CI gates retained.

## Genuine predecessor RED

At e4c0c2c, before product edits, /private/tmp/capital-linked-twr-red.cjs ran actual
HTTPS cases against unchanged predecessor images (no build):
- Backend sha256:a1975ae4405b23b463845dab0fb46171524b0f9129b8b104d14ae251e7623277
- Frontend sha256:3a3a6c834db933168a0af0aa06b8a5df01e499a3c68cfef2ca1832f19e0aa919

Exit1, exactly two expected failures: valid authenticated plan expected200 got404;
new Russian heading absent after10s. Actual authentication/backend/database, no
import/prerequisite failure counted as RED. /private/tmp/capital-linked-twr-red.log
and red-artifacts; synthetic Docker cleanup completed.

## Implementation and independent review

Root backend bda97f7 followed RED: strict plan/preview parsers, complete owner
snapshot with explicit expectedRevision, bounded exact rational linking and shared
endpoint grouping/final rounding. Installed runner includes linked-twr-db.cjs.
Sol independently reviewed backend arithmetic, parser/revision semantics, snapshot
and private route wiring; no blocker. User-data/schema/provider untouched.

Sol UI83fd26a in isolated worktree integrated97058af. Root reviewed API/types,
separate section, review/plan lifecycle, period-key remount, generation/valuation
checks, exact outputs and responsive boundary table; no blocker. Luna guidec1bc65f
integrated0d78172. Own temporary dependency symlinks removed; worktrees retained.

## Source checks and actual PostgreSQL

- Backend scoped `test --runInBand --coverage=false twr period-profit xirr portfolio-flow`:
 215tests/6suites pass in3.087s; includes retained shared-flow parser/projection.
- Backend build/lint exit0,77 existing warnings. Logs capital-linked-twr-backend-
 {unit,build,lint} under /private/tmp.
- Frontend98tests/12files, build/lint/scopedBiome exit0;27 existing warnings and
 Vite>500kB warning. /private/tmp/capital-linked-twr-frontend-{test,build,lint,biome}.log.
- Root strict/noUnused browser TypeScript, scoped frontend/backend Biome and diff checks pass.
- `pnpm audit:production` exit0, two existing moderate advisories, no high/critical;
 details retained in docs/dependency-security.md; lock unchanged. Audit log same prefix.
- Strict OpenSpec25items (24canonical+active) pass before archive.

At bda97f7, /private/tmp/capital-linked-twr-db.cjs built the backend and ran
linked-twr-db.cjs plus unchanged twr-preview-db.cjs on fresh isolated synthetic PG16.10
with19 actual migrations each. Exit0, four new and four retained families:
- LTWR-COVERAGE: no/precoverage409, malformed400, covered empty plan, unchanged rows.
- LTWR-LINK:61effective flows beyond50-row page, same-ms cancellation, corrected/voided
 heads, excluded upper boundary and foreign records,21percent/profit310, missing-null,
 extraneous400 and exact equality to existing profit preview.
- LTWR-SNAPSHOT: distinct actual PIDs/max1 pools; read paused after real journal SELECT,
 another connection commits correction65->66 moving required boundary. Original preview
 remains coherent with original revision; COMMIT witnessed, later old revision409 before
 boundary mismatch, explicit new plan/current-revision preview succeeds.
- LTWR-BOUND: all1000 heads net correctly, exactly32 boundaries produce2^33-1 return;
 33 returns actual count/empty list/unavailable with no truncation.
- Unchanged TWR-COVERAGE/PRIVATE, TWR-ENDPOINT/EXACT, TWR-SNAPSHOT, TWR-BOUND pass.

Every successful new plan/preview asserts a single RR READ ONLY transaction, no DML,
all-table row fingerprint and external-provider request preservation. No backend,
repository or authentication mock. PG log /private/tmp/capital-linked-twr-db.log.
Backend sha256:8731e328a76f1d35cd33fa8d985ca235f744d58675c89dd10c409ee54b1cfc9c;
that exact image is pinned for the HTTPS run. Synthetic Docker cleanup completed.

## Actual HTTPS GREEN and cleanup

At5cd0791, /private/tmp/capital-linked-twr-green.cjs built only frontend and asserted
backend digest equals the PG-verified image. Fresh19migrations/synthetic owner,
actual HTTPS/password/MFA/backend/PostgreSQL; only external providers stubbed.
Delayed browser responses use real route.fetch(), without fake response bodies.

`pnpm exec playwright test tests/e2e/linked-twr-preview.spec.ts tests/e2e/twr-preview.spec.ts --grep 'LTWR-|TWR-UI:' --workers=1`

Exit0:3/3 in36.9s, one worker, zero retries:
- LTWR-API: valid pinned plan,21percent/profit310, missing-null, actual correction409,
 refreshed revision, malformed400, anonymous/pending401, omitted-CSRF/hostile-origin403,
 no-store, all-financial-row/provider/request-admission preservation.
- LTWR-UI: explicit plan/value/review, exact rendered21percent and310profit, closing
 edit clears result/review but retains pinned plan/value, delayed actual GET after
 period edit and POST after boundary edit cannot resurrect old state, correction409
 drops plan/review and explicit reload supplies current empty inputs.
- Unchanged TWR-UI: endpoint return, missing-boundary state and delayed-result invalidation.

No unexpected GREEN failure, retry or weakened oracle. Proxy/artifact/network checks
pass. /private/tmp/capital-linked-twr-green.log and green-artifacts. Images:
- Backend sha256:8731e328a76f1d35cd33fa8d985ca235f744d58675c89dd10c409ee54b1cfc9c
- Frontend sha256:4dd2bcef305e76c7a1f5e6506b9ee85d90b46ad77fecd6d4a811b8438586c19e

Harness cleanup complete; subsequent live labeled container/network inventories empty. Owner Nginx mode0644/size1348/SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432 preserved;
lock SHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d unchanged.
Listed unrun checks remain unrun. No whole-brief or automatic-valuation completion claim.

Luna independently compared final verification/continuity/guide with actual logs and
assertions; no unsupported success/scope claim or blocker. The guide's archive
link resolves after the supported CLI archive.

## Archive

OpenSpec1.2.0 `archive preview-linked-twr --yes` succeeded, creating four canonical
requirements in archive2026-09-24-preview-linked-twr. The6/7 warning was solely the
self-referential archive task3.2, marked complete only after actual archive success.
Canonical Purpose filled; all24 previous canonical files are byte-identical to base,
and new requirements exactly match the archived delta. Guide archive link resolves.
Post-archive strict validation passed25canonical specs; active changes list empty.
Logs /private/tmp/capital-linked-twr-archive-validation.log. All7tasks complete.
