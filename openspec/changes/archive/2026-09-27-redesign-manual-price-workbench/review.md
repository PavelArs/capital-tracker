# Independent manual-price workbench review

Reviewed 2026-09-27. Verdict: **no blocking finding for this bounded frontend change**.

Candidate `366b1b3cd1b334e4fd615c92abac8e02713c666a`, base `d4dd415`, worktree `/Users/pavelars/Projects/temp/capital-tracker-price-workbench`. Product authors: root and Luna. Acceptance author: Sol, integrated as `c7937ab`. This reviewer authored neither product nor acceptance additions, made no repository changes, and ran no Docker commands.

## Scope and source review

Read AGENTS, continuity, the target brief/redesign amendment, active proposal/design/specifications, canonical manual-price requirements, original and candidate ManualPrices TSX/CSS, and the acceptance diff. The product diff affects only `frontend/src/pages/ManualPrices.tsx` and `ManualPrices.css`. Backend/API/authentication, schemas, dependencies, deployment and provider behavior are unchanged.

- The editor is now after instrument selection and visible recovery/receipt/error output, before saved-price/history evidence. It remains the same unconditional controlled subtree inside the owner-keyed controller. No new key or conditional editor mount discards its draft or retained command.
- `ManualPrices.tsx:49` adds separate page/editor/history heading refs and separate void/history opener refs. The layout effect runs only for the sequenced focus-request state; that state changes only in explicit row/date action handlers. Read completion does not request focus, and history pagination does not replace the original opener.
- Action handlers capture `event.currentTarget` synchronously, then invoke the original state/read actions. Heading refs have tabindex-1. Explicit heading focus styling also covers programmatic focus; existing global focus-visible styling still covers ordinary controls.
- `restoreActionFocus` at line68 checks that the saved action is connected and enabled, otherwise focuses the page heading. The page heading is always present while this owner component is mounted. This handles a row replaced by a subsequent book read without focusing a stale detached node.
- Void cancel at line518 retains the original clearHistory/stagedVoid/review changes, then restores focus. It does not change observedAt/priceUsd or any recovery state. History close at line630 calls the original clearHistory first, invalidating pending read generations before restoring focus. Neither path sends a price command.
- The original recovery map/subscription, send/runCommand logic, replay identity, accepted-refresh release condition, saving/canEdit/canSave/canVoid guards, catalog/book/history generations and instrument selection checks remain intact. Save, confirmation and load payloads/callbacks are unchanged.
- Original explicit input IDs/labels remain; new aria-describedby references associate instrument UUID identity, explicit timezone/UTC and exact nonnegative USD/unit price guidance with the corresponding fields. Values remain raw strings; no numeric formatting, truthiness fallback or implicit zero was introduced.
- Native rules details retain identity/correction/void rules and explain the existing tab-memory/full-reload recovery limit honestly. Essential manual, unreconciled, isolated-point/no-continuous-coverage scope remains outside the disclosure. Unknown/accepted recovery notices and receipts remain visible above the editor.
- Saved prices retain real table/row/cell elements, exact timestamp and price strings, manual source, caption and column scopes. Flex is applied to the nested action wrapper, not td. The named tabindex0 scroll region contains narrow overflow. History retains exact revision/kind/price/createdAt and the explicit void label.
- Styles retain bounded page/card widths, min-width0, readable theme tokens, 44px main targets, wrapping receipt/history UUIDs and focus outlines. Exact table values remain unrounded in the contained horizontally scrollable table.

## Acceptance review

Reviewed `c7937ab` independently before product implementation and again against the candidate. No original financial/security/recovery assertion was removed or weakened.

- Native SUMMARY/DETAILS, initially closed state, Enter/Space operation, associated field descriptions and editor-before-book document order are explicitly asserted.
- Staging/cancelling exclusion checks immediate heading focus, disabled confirmation before review, unchanged unsaved draft115/date, reset review, returned row-action focus, no POST and unchanged exact price rows.
- The new delayed-history helper intercepts only the actual history GET, calls the real service, and requires200 with revisions2/1 and prices110/100 before delaying its unchanged response. Completion must not steal focus from the draft input. Closing while pending must return focus and prevent late panel restoration. Cleanup releases the gate and awaits the started handler before removing the route.
- Existing actual committed-response loss still requires explicit200 replay with an identical full command body. The actual201 correction plus failed refresh still leaves saving blocked until successful refresh. Exact100/110, stale instrument-read rejection, confirmed void/history/reload, original accounting rows, provider equality and admission deltas remain.
- Capture assertions cover both themes at360/768/1440, no horizontal page overflow, visible main controls at least44px, a captioned named tabindex0 scroll region and actual ArrowRight scrolling at360. Presentation checks preserve exact price rows/provider counts.
- No fabricated application/authentication response was added. Delays and delivery failures use actual upstream results.

## Observed evidence

Root executed the commands. This reviewer read the terminal logs and inspected artifacts.

- `/private/tmp/capital-price-workbench-red.log`: predecessor frontend `78436d00...` reached the real authenticated page after setup; expected failure was the missing `Правила ручных цен` summary, bounded by10s. This was behavior RED, not startup/import failure. Cleanup completed.
- `/private/tmp/capital-price-workbench-controls.log`: four input/select signatures,20 financial/read/recovery definitions and six save/confirm/load button guards/callbacks are unchanged. I read the verifier implementation; this structural evidence does not by itself prove focus behavior or accessibility, which were reviewed separately above.
- `/private/tmp/capital-price-workbench-green.log`: **1 passed (16.7s)**, selected PRICE-UI / PRICE-RECOVERY journey16.1s, one Chromium worker. Release/proxy checks identify frontend `sha256:0ffbe36b31fa94fe3a8e931b2f6bdd4e53f2065916d12069ffb75245d6a26c3f` and unchanged backend `sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2`. Cleanup completion is recorded.

## Independent visual review

Personally inspected all18 header/book/history frames in:

`/private/tmp/capital-price-workbench-green-artifacts/manual-usd-prices-PRICE-UI-a19ff-ores-a-late-instrument-read-chromium/`

The frames cover light/dark themes at360,768and1440. Header scope and native rules, associated guidance, receipt identity, exact stored110, unsaved115, revision2 and historical100/110 remain readable. The receipt/history content wraps at360. The narrow price table stays inside its own focused scroll region, and the focus outline is clearly visible in both themes. At768/1440, manual-source and row actions are visible with intact table alignment. No overlapping or inaccessible clipped page content was observed. Some book/history captures intentionally share the same viewport because the document cannot scroll farther; this does not omit either section.

The closed native select truncates a long instrument option on narrow widths. Full UUIDs remain in option text and in the visible accepted receipt; native popup readability before a first save is not established by these static captures. This is a native-control visual limitation, not a new identity/payload change. A separate editor screenshot review was assigned to Sol; I do not claim independent inspection of those six editor-specific files.

## Limits

The connected/enabled-opener restoration paths were exercised by the selected real journey; disconnected/disabled-opener fallback was reviewed in source, not forced in a separate browser case. The new screenshots cover normal corrected history, while the retained journey also verifies void history and reload. They do not enumerate every exact-decimal boundary or native select popup/platform. This is not a complete screen-reader, cross-browser or whole-product UX approval.

I did not rerun local test/build/lint/types/style/audit commands, full backend/E2E/API/PG precision suites, populated upgrades, live providers, scanners, hosted CI, production or durable preview. No deployment/readiness claim follows from this review.

No mandatory correction identified.
