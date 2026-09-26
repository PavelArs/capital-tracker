# Trade workbench verification — 2026-09-26

Baseline0370395. Root implementation worktree `capital-tracker-trade-workbench`;
independent Sol acceptance in `capital-test-trade-workbench`; Luna results CSS in
`capital-tracker-trade-results-style`; separate Sol independent review. Root alone
operated Docker. No quota fallback or paid service. See [review](review.md).

## Actual ATDD and scoped evidence

- Baseline118tests/21files PASS3.47s. Acceptance4c0a344 extends existing WORKFLOW-UI.
  Predecessor FEab29708c genuinely fails `expect(correctAction).not.toBeFocused()`:
  the editor is revealed but focus remains on the history button. This preceded
  form/focus product edits; pure results styling retained passing characterization.
- QA0c4ef9d adds actual refresh-driven disconnected-origin fallback and local table
  overflow checks. Original no-request/financial/provider assertions remain before
  the explicit refresh, whose additional accounting requests must be GET-only.
- First candidate:1passed/1failed38.7s. Correction/void keyboard focus, viewport and
  exact original-button cancellation passed. New native-select `getByLabel` visibility
  lookup failed because nested options participate in label text; actual ARIA snapshot
  has visible exact combobox names. Independently reviewed test fixf3a1c16 uses the
  same exact role/name lookup as existing trade acceptance. Assertions remain strict.
  WORKSPACE real committed-response replay passed13.5s. Failure evidence retained.
- Second candidate:1passed/1failed39.4s, same product image. New fallback assertion
  wrongly expected refresh-button focus after its existing loading-disabled state.
  Independent review confirmed the contract is no editor focus on ordinary refresh;
  QA144da88 asserts that directly, retaining actual disconnected/replaced-node identity,
  explicit cancel fallback, GET-only reads and unchanged business/provider assertions.
  WORKSPACE passed12.2s and is retained without another unaffected rerun.
- Visual review found the first dark360 shot mid inherited color transition. Test-only
  63077f1 uses Playwright screenshot animations:'disabled' for the twelve new captures;
  it changes no business state or product behavior. Earlier failed artifacts remain.
- Affected-only third run exited0: WORKFLOW1/1PASS16.9s on the same image, with actual
  disconnected-origin fallback, unchanged business/providers and all12 settled theme
  screenshots. Independent review approved source/oracles and screenshots.
- Root visual followup found legacy character-level wrapping split ordinary trade-type
  words in desktop results. CSS-only461ee0c changes scoped table overflow-wrap to
  break-word, preserving natural word width and exact local overflow. Independent source
  review approved it; final image rebuild includes the refinement.
- Product: grouped native controls with unique accessible descriptions, guarded explicit
  focus intent, connected-origin return/fallback, theme-safe result actions and table
  spacing. Results controllers/DTOs and all financial/retry semantics remain unchanged.

Command logs under `/private/tmp/capital-workbench-`:

| Check | Actual result |
| --- | --- |
| `pnpm --dir frontend test` |118tests/21files PASS3.64s, including exact provenance and unknown-vs-zero; `unit.log` |
| `pnpm --dir frontend build` |exit0 including final helper text; `build-final.log`; existing >500kB warning |
| `pnpm --dir frontend lint` |exit0,27existing warnings; `lint.log` |
| Scoped frontend Biome |exit0,6files; `style-final3.log` |
| Backend strict standalone E2E tsc |exit0 after final test changes; `types-final2.log` |
| `pnpm audit:production` |exit0,2moderate/nohighcritical, no suppression; `audit.log` |
| Strict telemetry-disabled OpenSpec validation |35items pass before archive; `specs.log` |
| Existing frontend Docker build |exit0 including final TypeScript/Vite build; `image2.log` |

Type command: `pnpm exec tsc --noEmit --strict --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck ../tests/e2e/*.ts`.
Browser harness: `/private/tmp/capital-workbench-browser.cjs red|green`; actual
`pnpm exec playwright test tests/e2e/account-operation-workflows.spec.ts tests/e2e/account-workspace.spec.ts --grep 'WORKSPACE-UI:|WORKFLOW-UI:' --workers=1`.
Real HTTPS/password/MFA, backend processes and PostgreSQL16.10 tmpfs;22migrations,
actual owner CLI and release-artifact checks. Only external providers stubbed; retained
route.fetch/abort loses a genuine committed response. No backend/auth mock in E2E.

Predecessor FEsha256:ab29708ca75a9b60c738ecd9d63d92abb2150c51a3f12e221a4a001756c822b4.
First candidate FEsha256:b7948fbfff827f64903d7ed904dcc1eff256ff3e6442dec76c54f5dd89cee54f.
Final FEsha256:8e48e2fa1d3efd6196e1267446cf5bdde47afa79b772d395a80684bc8589844a.
Unchanged BEsha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.
Logs retain predecessor `browser-red.log`, failed `browser-green.log`, rerun
`browser-green2.log`, affected-only `browser-green3.log` and final `browser-green4.log`;
artifacts use `red-artifacts`, failed `green1-artifacts`/`green2-artifacts`, passing
first-candidate `green3-artifacts` and final `green-artifacts` under the same prefix.
Local temporary artifacts are not committed.

## Limits

Two existing browser journeys only,1worker0retries. No full E2E or repeated backend,
SQL/security matrix for this presentation/focus change. No backend, schema, dependency,
auth, provider or deployment change; existing pipeline retained. Other editors/screens,
field-validation redesign, owner UX approval and whole frontend completion remain open.

## Final candidate and preservation

Final two-case `browser-green4.log` exits0: **2/2PASS29.5s**, one worker, zero retries,
on FE8e48e2fa. All twelve settled light/dark360/768/1440 form/results screenshots are
present. Root confirms normal words no longer break by character; exact values and
wide-table scrolling remain. Final strict E2E types and six-file style checks exit0.

Final labeled E2E container/network inventories are empty. Preview remains stopped
33hours, with original durable `capital-tracker-preview_preview_data` and FE7eff01d1
tag intact. No preview start/reset/update or owner-data access. Original repositories
and worktrees retained. Owner Nginx is the sole integration edit: mode0644,size1348,
SHA256115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432.
Lock SHA2566a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d
remains unchanged. No production, remote push or folder consolidation.
