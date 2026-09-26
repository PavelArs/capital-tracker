# Verification — account directory

## Baseline and acceptance first, 2026-09-26

Source60ee94e, isolated `capital-tracker-account-directory` worktree on
`refactor/account-directory`. Read AGENTS, target brief/amendment, continuity,
active swap/shell changes, OPEN-001..004 and MPV-1..3. Root owns frontend/test/doc
files for this slice and shared Docker; no available agent was retried after quota
errors. Independent review stays required. Preview volume/key/credentials/image and
owner Nginx are protected. No dependency or backend/schema/deployment edits.

Inventory: keep actual private account APIs, cursor loading, name/request-ID state,
create replay, success link and all exact valuation state/oracles; simplify page
hierarchy, creation entry and supplementary valuation visibility; remove permanent
expanded forms and checkbox sizing inherited from text inputs. React/native controls
provide the existing equivalent; no new library is needed for this bounded slice.

Used actual OpenSpec1.2.0 `new change`, `status`, `instructions proposal/design/specs/
tasks/apply`; spec-driven artifacts are ready with six tasks. MPV-3 delta copies the
entire canonical requirement and old scenario, then adds collapse semantics. Other
MPV requirements stay untouched (the active swaps delta changes different blocks).
Strict baseline validates31/31, `/private/tmp/capital-directory-specs-baseline.log`.

Temporary root/frontend/backend node_modules symlinks reuse the existing integration
installation; no package/lock changes. Host Node22.23.2, pnpm10.33.0, Vitest4.1.2.

- Retained frontend baseline112 tests /18 files PASS2.82s, exit0,
  `/private/tmp/capital-directory-baseline-unit.log`.
- Two new initial-presentation SSR tests failed for genuine missing “Новый счет”
  trigger and valuation disclosure before product edits. No API/context/auth stubs;
  static rendering runs no network effects. `/private/tmp/capital-directory-unit-red.log`,
  exit1,2/2 expected failures in664ms. This proves initial presentation only.
- Real DIRECTORY-UI RED on the unchanged BEdd90a8c5/FE62543d34 completed actual
  password/MFA and created51 synthetic accounts using the protected backend. It then
  failed expected hidden account-name input versus actual visible input. No unrelated
  setup/compiler failure was counted as RED. `/private/tmp/capital-directory-browser-red.log`,
  exit1; trace/screenshot in `...-browser-red-artifacts`. Harness uses only synthetic
  capital-tracker-e2e, actual fresh22 migrations/CLI seed/two backend replicas and
  artifact checks. Finally cleanup removed its containers/networks.

## Implementation checks

Creation remains in ManualAccounts with its original request-ID/name/error state.
The inline hidden panel is kept mounted; focus and Escape use native controls. Success
keeps the created-account link outside the closed panel. Catalog loading/retry/cursor
logic is unchanged. The native valuation disclosure keeps the original component and
response-generation state mounted; page departure behavior stays unchanged. New page
styles are scoped; the one valuation checkbox rule prevents global full-width sizing.

Retained account-create entry tests now click the explicit new action. MPV-UI loads
catalog pages before selection (so it works with previous cases' saved accounts), then
retains all exact/gap/stale/private/provider assertions. It adds same-mounted-element,
selection/time/exact-result and unchanged request-count checks across collapse.

- Frontend114 tests /19 files PASS3.20s, `...-unit-green.log`; build exit0 in
  `...-build.log` with existing >500kB bundle warning. Lint exit0 with27existing warnings,
  `...-lint.log`. Root source inspection caught an unattached input ref; it was attached
  before the image build and is verified by actual browser focus assertions.
- Strict E2E TypeScript exit0 before and after test edits, `...-e2e-types-red.log` and
  `...-e2e-types.log`: backend cwd, `pnpm exec tsc --noEmit --strict --noUnusedLocals
  --noUnusedParameters --skipLibCheck --target ES2022 --module commonjs --moduleResolution
  node --esModuleInterop --types node --typeRoots ./node_modules/@types ../tests/e2e/*.ts`.
- `pnpm audit:production` exit0, two moderate findings and no high/critical findings,
  `/private/tmp/capital-directory-production-audit.log`. No advisory suppression.
- Actual frontend build exit0, `/private/tmp/capital-directory-image-build.log`:
  sha256:340b653f8c3dbf678a193120c03bfeeb0b43e9892a4e09e849fad32260dea89d.
  Retained backend sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.
  Preview tag was not changed. Browser GREEN evidence follows only after completion.

## Final scoped GREEN

`caffeinate -is node /private/tmp/capital-directory-browser.cjs green` exited0.
Actual FE340b653f / retained BEdd90a8c5 above, fresh22 production migrations/CLI seed,
two real backend replicas, HTTPS/password/MFA and PostgreSQL. **3/3 PASS37.1s**, one
Chromium worker, zero retries; `/private/tmp/capital-directory-browser-green.log`:

- DIRECTORY-UI12.6s: creates51 accounts through the protected API, verifies two cursor
  pages against the actual returned owned IDs/names/revisions and exact loaded counts.
  Initial forms hidden, focus/Escape at360/768/1440, no overflow or implicit writes.
  Real201 committed response is dropped in transit; same mounted input/name survives
  close/reopen and explicit retry returns200/the same receipt/request ID. SQL count
  remains one and detail reload preserves the account. Own backend/auth not mocked.
- SHELL-UI11.6s: retained private/password-only denial, real login/MFA, saved account
  creation/root reload, keyboard menu, themes/legacy routes and logout revocation.
  Only the explicit create-action entry was added to the existing journey.
- MPV-UI12.1s: retained exact308.64 aggregate and61.728/246.912 per-account values,
  null/gaps and late stale-result refusal. Same valuation element, selection, time
  and exact result survive collapse with no extra preview. Business fingerprint and
  external-provider requests remain unchanged. Catalog paging supports earlier cases'
  saved accounts; no dependency on an empty database was introduced.

Synthetic artifacts in `/private/tmp/capital-directory-browser-green-artifacts/`:
DIRECTORY-UI directory-create-360/768/1440 and directory-1440 screenshots plus retained
SHELL-UI login/error/recovery/menu/light-dark screenshots. Root inspected the new
360/768/1440 layouts. This is not independent review or owner visual acceptance.
Changed frontend check and five E2E files' formatting pass with no new diagnostics,
`...-scoped-format.log` and `...-e2e-format.log`. Strict OpenSpec31/31 passes in
`...-final-specs.log`. Existing27frontend warnings, Vite large chunk and proxy http2
warnings remain visible; no suppression or weakened financial/security oracle.

Final live labeled inventory has no capital-tracker-e2e containers or networks.
Preview volume `capital-tracker-preview_preview_data` remains and its original
frontend preview tag still points to7eff01d148e8f286c025655ffa0dd88cfa842fc051d9dd9240318c11cc60768c.
Owner Nginx SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432;
lock SHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d.
No preview reset, owner data change, project deletion or production deployment.

Unrun: full E2E/device matrix, the longer opening-positions journey (entry selector
updated and typechecked, its exact assertions retained), unrelated backend/SQL/
migration suites, hosted CI, full release/security/backup gates and other FUI screens.
Backend/schema logic is unchanged. Broader regressions remain for final release.
Independent review and archive remain pending because observed agent quotas persist;
no paid fallback or repeated agent retry. Tasks1.1/2.1/2.2/3.2 complete (4/6),3.1/3.3
pending. Canonical requirements must not be synchronized/archived before those gates.

Local implementation committed f391bdc and fast-forwarded into the integration branch.
The account-directory worktree is clean after removing only its three explicit
node_modules symlinks; actual installed packages and every project folder remain.
Post-integration strict OpenSpec passes31/31 (`...-integrated-specs.log`). Backend,
deployment/CI, canonical specs, lock and tracked Nginx have no committed changes from
60ee94e; the owner's separate Nginx edit and both protected hashes remain unchanged.
