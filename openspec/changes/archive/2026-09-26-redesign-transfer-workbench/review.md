# Independent review: redesign-transfer-workbench

Reviewed 2026-09-26. Base `859f267`, final product/source HEAD `5d52cac` in `/Users/pavelars/Projects/temp/capital-tracker-transfer-workbench`.

## Result

No unresolved blocking findings in the reviewed source, acceptance assertions or twelve history screenshots. This is approval of the bounded transfer workbench slice, not whole-product UX approval or production readiness.

An intermediate form draft had insufficient explicit recipient-fee wording and attached only one of the two fee explanations to each fee control. The author resolved this before integration: quantity explicitly excludes the fee; both fee controls reference both zero/no-fee-asset and historical/non-market guidance. The final integrated form was re-read. Ordering guidance now correctly describes operations rather than only transfers.

## Source and oracle review

- Read AGENTS.md, continuity, target brief and all active change proposal/design/spec/tasks/verification artifacts; compared the product and acceptance delta against base.
- Reviewed OwnedTransfers.tsx, OwnedTransfers.css, final OwnedTransferForm.tsx, existing shared operation/manual/journal CSS and TransferAllocationDetails. The actual product delta is limited to these three transfer presentation/controller files; no backend/API/migration/auth/dependency/deployment change appears in the reviewed commit range.
- Focus requests occur only after an allowed history staging action and run in a layout effect after the selected editor renders. Asynchronous review does not update focus requests. Cancellation retains review-generation invalidation and existing draft/target/reset behavior, then restores a connected enabled initiating action or the persistent editor heading.
- Existing recovery, write lock, needs-refresh, generation checks, account/version review, CAS payload construction, receipt retention and explicit identical retry remain intact. All field values remain strings. Correction account locking, void fieldset disabling, attestation and review/write disabled expressions, option identities and handlers remain unchanged.
- Final form associates unique useId guidance outside labels, retains native controls and separates review status from the action flex row. No client numeric conversion was added.
- Acceptance retains original committed-create route.fetch/abort and immutable exact retry, principal/fee/holdings/privacy/provider assertions. New held review delivery uses the actual backend response via route.fetch and delays its delivery; no backend/auth response fabrication is added. New assertions cover heading focus before review, no late focus theft, locked accounts/void fields, cancel return, no selection writes, description semantics and review invalidation after economics changes.
- Native identity disclosure remains keyboard-operable and keeps the exact ID in selectable DOM text. Receipt, current allocation and version loading stay distinct and reachable.
- CSS changes are scoped to transfers. Readable theme foreground tokens are used for disclosure/links/focus; error text now uses body foreground with an error border and retained textual message/alert role. Responsive grids, wrapping identifiers, 44px main controls and action wrapping are compatible with the retained shared rules.

## Actual visual inspection

Viewed all twelve original PNG captures under:

`/private/tmp/capital-transfer-workbench-green-artifacts/owned-transfers-TRANSFER-U-7319a-inal-void-use-real-receipts-chromium/`

Files: `transfer-history-{light,dark}-{360,768,1440}-{1,2}.png` (all combinations).

The inspected state is the saved active transfer with its identity disclosure closed and allocation/version evidence expanded. At all six theme/width combinations the amount/asset and account direction lead the card, action buttons fit and wrap, and long account/asset/lot/request identifiers wrap within the card. Main/secondary text and links are readable in both themes; allocation basis labels/values remain distinguishable. Narrow screens show a tall but readable evidence list without overlap or horizontal clipping. Desktop alignment preserves separate summary labels and exact values. The two frames per state cover the top and lower history portions; viewport frame boundaries are not application clipping.

Editor screenshots are assigned to another reviewer; they were not visually inspected in this review. Correction/void editor states, recovery/receipt/error states and a focused ring were not visually captured here. Their source and relevant browser assertions were reviewed, which is narrower than visual inspection of every state. No whole frontend, assistive-technology or full release accessibility audit is claimed.

## Verification evidence and limits

The reviewer did not run Docker or mutate product/tests. Root owns runtime/gates/integration. Read actual unit/build logs: 21 files / 118 frontend tests passed; Vite build completed with the existing >500kB warning. Read the actual green runtime log: selected TRANSFER-UI and WORKFLOW-UI both passed (2/2, 31.5s), including TRANSFER-UI 14.8s, followed by disposable E2E container/network cleanup. Root reports frontend lint, strict E2E types and audit exit0 (27 existing lint warnings and 2 existing moderate production advisories); these are root-executed gates, not independently rerun here.

Runtime used FE `sha256:ebdc0e74e6e439bc93a492f46f71f61b2e45f8ad8308900fa321664aa54da0b7` and unchanged BE `sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2`; root reports actual synthetic HTTPS/password/MFA/backend/PostgreSQL and 22 migrations/artifact gates. Read the acceptance-first record: predecessor recipient description was empty, producing the intended RED before implementation. Source and final GREEN agree with that requirement.

Unrun by this reviewer: backend/full E2E suites, populated upgrade matrix, live providers, scanners/DAST, hosted CI, production/preview deployment and owner UX approval. Source review and selected synthetic browser evidence do not replace those gates. Original repositories, owner Nginx edit, preview data and lockfile are outside this implementation scope; root handles final preservation hashes, documentation/archive comparison and integration.
