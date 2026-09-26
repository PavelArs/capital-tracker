# CSV workbench verification — 2026-09-26

Baseline `fd698a6`. Keep: immutable source, controller/parser/accounting/recovery and
exact evidence. Simplify: undifferentiated presentation into file/source/mapping/review
groups, shared operation-form primitives and responsive comparisons. Move secondary
ID/hash into native disclosure; remove no capabilities, data, tests or project folders.
Existing frontend Dockerfile, synthetic Compose and contained CD pipeline are retained.

Worktrees: root `capital-tracker-csv-workbench`, Sol acceptance
`capital-test-csv-workbench`, Luna mapping `capital-tracker-csv-mapping`; separate Sol
source/visual review. Acceptance `6e6d9d7` integrated as `b779907`; mapping `38ecd2f`
integrated as `9618a3f`. Root preserved the independent source conditional and restored
the UUID caveat, clarified optional currency column, and attached order/time guidance.

## ATDD and selected gates

Baseline118 tests/21 files PASS5.01s. The extended existing CSV-006-A journey ran through
actual HTTPS/password/MFA/backend/PG on predecessor FE73f4c11a and failed because the
ordered stage guide was absent (expected OL, element not found). No product edits
preceded this actual RED. Other added assertions were not reached in RED; CSS/grouping
retains passing characterization, without manufactured failures.

Final manifest: full CSV-006-A sale-first import/restart/provenance/deduplication/whole
rollback, two CSV-006-B lost committed confirm/rollback real403+SPA exact replay cases,
and WORKFLOW-UI mounted independent drafts/File. Four cases,1worker0retries. All original
exact250/100/0.5, SQL/private-source/admission/provider/retry assertions remain; new
descriptions, guide, keyboard disclosure and presentation-only no-request/no-write
checks extend the existing full journey. No own backend or authentication is mocked.

| Check | Actual result |
| --- | --- |
| Frontend Vitest |118/21 PASS,3.24s |
| Frontend build/lint |exit0;existing bundle warning and27 lint warnings |
| Per-package scoped Biome |6 files pass,no fixes |
| Standalone strict E2E tsc |exit0 |
| Production audit |exit0,2 moderate,no high/critical;lock unchanged |
| OpenSpec before archive |37 items pass:36 canonical plus active change |
| Selected real Playwright |4/4 PASS1.1m on8d319fc1; final contrast-only image full CSV1/1 PASS27.5s |
| Independent visual review |44 clean final viewport captures reviewed:Sol30,Luna14;approved |

Root AST comparison confirms24 form-control semantic signatures unchanged. An initial
printer-string comparison caught only a formatter-added line break/trailing comma in
the timestamp callback; structural AST comparison preserves node kinds/literal values
and ignores formatting. Independent review also verifies unchanged controller/helper
bodies, render guards, options, source/provenance and unknown-cost completeness.

Commands: `pnpm --dir frontend exec vitest run`, `pnpm --dir frontend build`,
`pnpm --dir frontend lint`, `pnpm audit:production`; E2E types from backend cwd:
`pnpm exec tsc --noEmit --strict --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck ../tests/e2e/*.ts`.
Browser: `pnpm exec playwright test tests/e2e/csv-import-journey.spec.ts tests/e2e/account-operation-workflows.spec.ts --grep 'CSV-006-A: full Russian sale-first|CSV-006-B: lost committed (confirm|rollback), real403|WORKFLOW-UI:' --workers=1`.

Harness `/private/tmp/capital-csv-workbench-browser.cjs` uses only synthetic PG16.10
tmpfs/e2e project, all22 migrations, actual owner bootstrap and release-artifact checks;
only external providers use fixtures. Host Node22.23.2/images22.21.1,pnpm10.33.0,
OpenSpec1.2.0,Playwright1.63.0. Logs and retained RED/GREEN artifacts share
`/private/tmp/capital-csv-workbench-*` prefix.
Initial candidate frontend `sha256:62dfea8a9a7c848945bdc2087b1f4c5a7890386d84c6075d603a19bb20ad7a32`;
unchanged backend `sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2`.

First GREEN attempt:3 retained journeys pass; full CSV times out on the new test's
nonexistent theme-select locator. Corrected to the established presentation-only
data-theme fixture/restoration from WORKFLOW-UI, without business events or mocks.
Added six batch/provenance/rollback-review screenshots to the same journey, keeping its
selected batch, unchecked rollback and no-write assertions. Focused rerun then exposed
real mobile page overflow at preview after all six mapping layouts passed. Scoped
preview min-width:0/grid spacing fixes intrinsic sizing around the retained table scroll
container; overflow assertion stays unchanged. Both failures and independent review
are retained. Final frontend build passes on
`sha256:8d319fc174d1a5dcf916812277fd54396b778cce04d0b5c74a33c9a1e631bcf4`;
final style/type checks pass. All four selected cases passed1.1m: workflow15.5s,
full CSV26.3s, committed confirm recovery12.8s and rollback recovery13.0s.

Independent visual review then identified dim dark-theme disclosure/current-stage
text (token contrast2.43:1). Scoped foreground/focus uses the existing light-foreground
token; computed dark contrast9.27:1 and light8.39:1. No global theme or button-background
change. Full-element screenshots also misplaced the unchanged transformed fixed skip
link over some content; these are not counted as final unobscured visual evidence.
Capture now uses actual viewport segments, asserts skip-link stays outside the viewport,
and hides/masks no UI. Six file-stage frames supplement mapping/preview/batch evidence.

Final frontend `sha256:e50994254810e656a7614ed9d2716fe9cdb863c4631fa3e38c17cd6cdd7e8f43`
builds successfully; style6files and strict E2E types pass. Full real CSV journey passes
again1/1 in27.5s (body26.8s), including unchanged exact economics/restart/provenance/
deduplication/rollback and all44 viewport captures. The other three cases are from the
preceding verified image; not rerun for the scoped foreground-only correction.

## Limits and finalization

No full E2E/backend/SQL/security/upgrade matrix or hosted CI repeated; unchanged suites
remain intact. Responsive screenshots cover mapping/preview/committed-batch evidence;
they are not a gallery of every file/error/recovery state. Original critical journeys
still exercise import/provenance/rollback/recovery with their financial/security oracles.
No production/preview update, owner UX approval or whole-redesign completion claim.
Existing Nginx http2 deprecation, bundle/lint warnings and moderate advisories remain.
Final inventory: e2e containers/networks empty; preview remains stopped34hours, original
frontend7eff01d1/backenddd90a8c5 tags and `capital-tracker-preview_preview_data` intact.
Owner Nginx remains mode0644,size1348,SHA256
`115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432`;
lock SHA256 `6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d`.
Worktree backend/Nginx/lock/Dockerfile/deploy/Compose/CI match baseline. Only three
verified task dependency symlinks removed; source folders/worktrees retained.
Independent final source/runtime/visual approval recorded in review.md and
mapping-visual.md. Long native selected labels still truncate on mobile; full options
and explicit candidate UUID evidence remain available. File-stage frames were captured
after inspection, so their current guide step is mapping. No separate visual coverage
claim for initial empty, source-scroll, error/stale/recovery/unknown-completeness or
expanded-identity states; relevant retained runtime/source checks are narrower evidence.
Product/evidence commit `9743139`. Installed CLI `openspec archive redesign-csv-workbench --yes`
archived as `2026-09-26-redesign-csv-workbench`; its warning reflected only the pending
archive/comparison task, with all product/review/runtime work already complete. Replaced
generated Purpose placeholder; all3 new requirement blocks match exactly and36 old
canonical files are byte-identical. Strict validation passes37 canonical specs;
`openspec list --json` returns no active changes. Final task marked after this actual
procedure;6/6complete. Archive/hash/spec logs use the same `/private/tmp` prefix.
