# Compact journal context verification — 2026-09-26

Baseline93b2ae8; implementation worktree `capital-tracker-journal-context` and
independent acceptance worktree `capital-test-journal-context`. Sol wrote acceptance,
Luna inventoried retained copy/actions, and a separate Sol reviewer inspected source,
test oracles and six compact/expanded screenshots. Root alone operated Docker.
See [independent review](review.md). No quota fallback or paid service was needed.

## ATDD and actual browser evidence

- Before product edits,118 existing frontend tests/21files passed in3.46s.
- Independent acceptance commits8d3bacd/0c3c57a extend existing WORKFLOW-UI and
  WORKSPACE-UI; they add no E2E suite. On predecessor FE64923db4, WORKFLOW-UI failed
  at the intended assertion: exact revision1/UTC coverage was expected hidden but
  was visible. `browser-red.log` exit1 is genuine behavioral RED.
- Product changes only move informational JSX into native details/summary and add
  scoped styling. The component body before its JSX return is byte-identical to
  baseline. Existing controllers, editor positions/keys and recovery guards remain.
- First candidate run:1passed/1failed in2.2m. WORKSPACE passed; WORKFLOW timed out
  because its new identity assertion used a visible-role trade locator while the
  imports workflow was selected. This was a test locator defect, not a demonstrated
  product remount. Independent review identified it; QA correction8df86c6 selects
  the matching workflow before each strict original-node identity assertion.
  isConnected, element identity, exact draft, same File and no-request oracles remain.
- Final `browser-green2.log`: exit0, **2passed in26.5s**,1worker0retries:
  WORKFLOW-UI14.1s and WORKSPACE-UI11.7s. Same product image as the first candidate.
  CONTEXT-001/002 cover keyboard focus/open/close, exact hidden/visible metadata and
  full scope/precision copy,360/768/1440px overflow and compact/expanded screenshots,
  mounted editors/CSV File/drafts, section/workflow retention and no accounting or
  provider activity. CONTEXT-002/003 cover actual account remount, uninitialized
  guidance, frozen committed-request recovery outside details/sections, live expanded
  revision2/count2 metadata and original receipt replay with exact112.35/SQL no-duplicate
  assertions. Existing account/instrument isolation assertions remain.
- Real HTTPS/password/MFA, two actual backend processes and PostgreSQL16.10 tmpfs;
  all22 migrations, actual owner seed CLI and release artifact checks pass. Only
  external providers are stubbed. route.fetch/abort loses an actual committed response;
  our backend and authentication are never mocked.

## Scoped commands and results

Local logs have prefix `/private/tmp/capital-context-`:

| Check | Result / log |
| --- | --- |
| `pnpm --dir frontend test` |118/21PASS3.84s; `unit.log` |
| `pnpm --dir frontend build` |exit0; existing >500kB bundle warning; `build.log` |
| `pnpm --dir frontend lint` |exit0;27 existing warnings; `lint.log` |
| Frontend Biome check of two product/two E2E files |exit0,4files, no fixes; `style2.log` |
| Backend `pnpm exec tsc --noEmit --strict --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck ../tests/e2e/*.ts` |exit0 after locator correction; `types2.log` |
| `openspec validate --all --strict --no-interactive` with telemetry disabled |34/34PASS before archive; `specs2.log` |
| `pnpm audit:production` |exit0,2moderate/nohighcritical; `production-audit.log`; findings remain documented |
| Existing frontend Docker build |exit0; `image.log` |
| Disposable harness `/private/tmp/capital-context-browser.cjs green` |exit0 after correction; selected Playwright command below |

Playwright: `pnpm exec playwright test tests/e2e/account-operation-workflows.spec.ts tests/e2e/account-workspace.spec.ts --grep 'WORKSPACE-UI:|WORKFLOW-UI:' --workers=1`.
Logs also retain `baseline.log`, `browser-red.log`, failed `browser-green.log` and
final `browser-green2.log`. Artifacts: `capital-context-red-artifacts`, failed
`capital-context-green1-artifacts`, final `capital-context-green-artifacts` under
`/private/tmp`; final workflow folder contains six journal-context screenshots and
twelve retained workflow screenshots. Temporary evidence is local, not committed.

Predecessor FEsha256:64923db446c89cc808f1de71bc28392484e60e06208136a84bb77ab2df528631.
Candidate FEsha256:ab29708ca75a9b60c738ecd9d63d92abb2150c51a3f12e221a4a001756c822b4.
Unchanged BEsha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2.

## Preservation and limits

Final labeled E2E container/network inventories are empty. Preview containers remain
stopped32hours; durable `capital-tracker-preview_preview_data` and pinned FE7eff01d1
remain. No preview start/reset/update, owner DB access or original-folder deletion.
Integration owner Nginx remains the sole unrelated edit: mode0644,size1348,SHA256
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432.
Lock SHA256 remains6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d.

No backend/schema/dependency/auth/provider/pipeline change; no full E2E, repeated
backend/SQL/security matrix or production release claim. This bounded presentation
step does not complete the whole frontend redesign or owner visual approval. Fields,
results, focus followups and analytical/settings screens remain on the redesign plan.
Archive/comparison results are appended only after that procedure completes.
