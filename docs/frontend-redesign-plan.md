# Frontend redesign backlog

Owner direction,2026-09-26, after reviewing the local preview: the current visual
design and usability are unacceptable. Redesign the whole frontend, including the
navigation and user journeys. This is required remaining work, not optional polish.
Functional acceptance of the existing accounting forms is not visual/UX acceptance.
The owner plans the next UI review after the redesign is ready.

## Direction

Build a modern, restrained, responsive Russian interface centered on functionality
and everyday use. Early-2000s software can inform the compact layout, clear borders,
legible tables and direct controls; it is an optional influence, not a requirement
to imitate dated usability. Avoid ornamental animation, oversized empty panels,
decorative effects, excessive gradients and unnecessary motion. Respect reduced-motion
preferences. Use a coherent spacing, typography, color, focus and component system.

Organize around the owner's questions and actions: what is held, what it is worth,
what changed, what is missing, and how to record/import/correct an operation. Replace
the current accumulation of permanently expanded technical forms with focused screens,
clear primary actions and on-demand details. Keep exact amounts, original evidence and
copyable identities accessible; show technical revision pins where needed for review
and recovery rather than as the primary visual hierarchy. Missing prices/costs must
remain distinct from zero. Financial scope must remain honest.

Retain React/TypeScript, existing backend contracts, authentication, exact accounting
and owner data. Deliver the complete redesign through small OpenSpec changes, not an
unreviewable rewrite. Audit the installed component/chart tools first; the brief's
Mantine/ECharts preference remains applicable where it improves the result without
unnecessary migration. No paid UI kit/service or new production deployment.

## Delivery tasks

- [ ] FUI-01 Inventory every routed screen and critical journey; identify duplicate
  forms, navigation problems, excessive vertical scrolling and missing states. Define
  the target information architecture, component rules and responsive prototypes.
- [ ] FUI-02 Replace the application shell, navigation and login/MFA presentation;
  implement shared layout, typography, tables, forms, feedback and accessible controls.
- [ ] FUI-03 Redesign account/asset lists and details, operation creation/review/history,
  trades, swaps, rewards, transfers and CSV import as coherent task-oriented workflows.
  Preserve exact retry, correction/void protections and independent drafts.
- [ ] FUI-04 Redesign portfolio overview, allocation, history/performance and charts;
  remove misleading legacy Dashboard emphasis. Surface only supported metrics and
  periods; missing whole-portfolio/cash/provider capabilities remain separate backend
  tasks. Keep the requested maximum-period chart review explicitly tracked.
- [ ] FUI-05 Apply the same system to settings/integration health and the remaining
  screens, including later optional AI. Retire superseded frontend code/styles/routes
  only after replacement behavior passes; retain data and needed compatibility notices.
- [ ] FUI-06 Independently review usability, responsive behavior and accessibility;
  run selected real HTTPS/Playwright journeys with PostgreSQL and MFA, verify final
  screens at mobile/tablet/desktop widths, update the preserved local preview, and
  deliver it for the owner's next review. Record remaining findings honestly.

## Acceptance criteria for the individual OpenSpec changes

- At360px,768px and1440px widths, primary navigation and actions remain usable without
  page-level horizontal overflow; wide data tables may have an explicit contained
  scroll area. Dialogs/forms fit the viewport and preserve entered data across errors.
- Important read views lead with their purpose, useful totals and primary actions;
  the owner does not need to scroll through unrelated editors to inspect a portfolio.
  Financial details, original versions, precision and provenance remain reachable.
- Forms have clear Russian labels, useful defaults, explicit time-zone meaning and
  field-associated validation. Saving, errors, stale data, missing evidence, empty
  states and ambiguous delivery have visible, actionable outcomes.
- Keyboard users can complete login/MFA, navigate and perform a critical operation;
  focus is visible, modal focus returns correctly, and status never relies on color
  alone. Avoid unnecessary animations and honor prefers-reduced-motion.
- Existing financial/security oracles stay intact. Keep passing characterization for
  presentation refactors; demonstrate behavioral RED for changed interactions. Put
  arithmetic/permutation checks below E2E and keep browser tests on critical journeys.
- Each slice records real verification and scope before archive. A working old form
  or passing unit suite alone does not establish completion of this redesign.

## Order and current state

Five bounded changes were independently reviewed and archived on2026-09-26: asset
swaps plus application shell, account directory, account workspace and operation
selection. See the [independent frontend review](reviews/2026-09-26-frontend.md),
[final followup verification](reviews/2026-09-26-verification.md) and owner guides:
[navigation](application-shell.md), [directory](account-directory.md),
[workspace](account-workspace.md), [operations](account-operation-workflows.md).

The latest followup passes118 frontend tests, local build/lint/types, three selected
real HTTPS/MFA/PostgreSQL journeys and the dependency gate. Review found and fixed
instrument-draft retention on parameter-only account navigation. Earlier scoped
checks retain their recorded image/date limits. No full-suite or whole-redesign
completion is claimed. The preserved local preview still uses its old image/data.

FUI-01/02/03/04/05 remain partial; FUI-06 and owner visual approval remain open.
Responsive evidence exists for the completed slices, not every screen. Next bounded
work: integration-health/legacy screens and remaining whole-screen UX findings. Retain chart
maximum-period review separately.

The next bounded step, `compact-journal-context`, reduces initialized-journal prose
to an honest short notice and a native keyboard-accessible disclosure. Exact details,
initialization guidance, mounted drafts and recovery remain;118 characterization tests
and two selected real HTTPS/MFA/PostgreSQL journeys pass. Independent source/visual
review covers compact/expanded360/768/1440px. See [verification](../openspec/changes/archive/2026-09-26-compact-journal-context/verification.md).
This completes only the context item. The subsequent `redesign-trade-workbench` adds
grouped trade fields with accessible guidance, explicit history-editor focus/cancel
return and consistent shared result controls. Exact tables and controllers remain.
See [workbench verification](../openspec/changes/archive/2026-09-26-redesign-trade-workbench/verification.md).
Other operation editors, analytical/result hierarchy and whole-redesign review remain.

`redesign-acquisition-entry` follows with grouped swap/reward fields, associated
financial guidance and shared scoped form styles with trade. Real SWAP-UI, REWARD-UI
and WORKFLOW-UI pass3/3 without weakening existing financial/recovery assertions;
118 frontend characterization tests pass. See
[acquisition-entry verification](../openspec/changes/archive/2026-09-26-redesign-acquisition-entry/verification.md).
Swap/reward history-focus ergonomics remain a separate followup; this slice changes
their fields and actions only. FUI-03 remains partial.

`redesign-csv-workbench` adds a visible file/mapping/review guide, grouped mapping with
associated interpretation hints, batch identity disclosure and responsive exact evidence.
Source/controller/atomic import/rollback and immutable-retry behavior remain. See
[CSV workbench verification](../openspec/changes/archive/2026-09-26-redesign-csv-workbench/verification.md)
for scoped gates, corrected mobile overflow/contrast and final visual evidence.

`redesign-transfer-workbench` adds grouped internal-transfer fields and associated
exact-amount/time/fee guidance, history-to-editor focus with cancel return, and compact
identity disclosure. The existing exact command/review/recovery guards remain. See
[transfer workbench verification](../openspec/changes/archive/2026-09-26-redesign-transfer-workbench/verification.md)
for the selected real HTTPS/MFA/PostgreSQL journeys and scoped review.

`redesign-external-flow-workbench` adds associated USD/time/period guidance, native
rules and identity disclosures, correction/void/version focus and cancellation return,
and contained exact result tables. Both selected real flow/recovery journeys pass;
26 light/dark360/768/1440 viewport frames have independent product review. See
[flow workbench verification](../openspec/changes/archive/2026-09-27-redesign-external-flow-workbench/verification.md).
Remaining editor focus, analytics/settings and whole-redesign review remain open.

`redesign-period-review-workbench` starts FUI-04 with compact method disclosure,
grouped manual period inputs, distinct primary profit/XIRR/TWR results and an optional
mounted linked-TWR editor. Folding retains boundary values/review/results; original
date/valuation invalidation and stale-plan refusal remain. Four selected real journeys
pass, including late responses and unavailable rates. See
[period workbench verification](../openspec/changes/archive/2026-09-27-redesign-period-review-workbench/verification.md).
This does not complete portfolio/allocation/history/chart redesign or owner approval.

`redesign-manual-price-workbench` adds focused entry before evidence, associated
identity/time/exact-unit guidance, native rules, void/history focus and close/cancel
return. Existing recovery/receipt/selection guards remain. The selected real price
journey passes;24light/dark360/768/1440 viewport frames have separate product review.
See [manual-price workbench verification](../openspec/changes/archive/2026-09-27-redesign-manual-price-workbench/verification.md).
Settings, wider analytics, remaining editor focus and whole-redesign review remain open.

`redesign-settings-workbench` starts FUI-05 with announced section selection, labeled
language/theme preferences and clear stored-read versus external-collection actions.
Exact FX results precede original timestamp evidence; all controllers/guards and
conditional mounting remain. The selected real DFX-UI journey passes and18actual
light/dark360/768/1440 frames support review. See
[Settings guide](settings-workbench.md) and [verification](../openspec/changes/archive/2026-09-27-redesign-settings-workbench/verification.md).
The subsequent currency visibility slice below completes the legacy manager; broader
integration health remains separate.

`focus-acquisition-review` completes bounded swap/reward correction/void/history focus:
explicit actions enter named editors/history headings, cancel/close return to their
origin after rendering, and late genuine history delivery cannot steal focus or reopen
a closed panel. Original reset/recovery/exact command behavior remains. Selected
SWAP-UI/REWARD-UI/WORKFLOW-UI pass3/3;19new360dark/1440light focus frames were independently
reviewed. See [verification](../openspec/changes/archive/2026-09-27-focus-acquisition-review/verification.md).
This does not complete wider analytics, integration health, FUI-06 or owner approval.

`redesign-account-analytics` focuses the three existing read tools behind a native task
selector, preserves mounted intent/results, associates UTC/price/sampling guidance and
leads with exact results before secondary evidence. Real WORKSPACE/HISTlate/HISTpinned/
VAL/VCH journeys pass5/5; the chart retains30elapsed-day/31point bounds. See
[analytics verification](../openspec/changes/archive/2026-09-27-redesign-account-analytics/verification.md).
This completes a bounded account-analysis slice, not whole-portfolio history or FUI-06.

Carry these nonblocking review findings into the next suitable UX slice:
- Give the swap editor focus outline more breathing room before the following record
  count when polishing the whole screen; current text remains readable.
- Trade correction/void focus is handled by the workbench; carry this convention to
  remaining operation editors as they are redesigned.
- Avoid stealing focus when a delayed account creation completes after the owner
  has closed its form and moved into another control.
- Verify focus transfer when resizing desktop navigation to its hidden mobile state.
- Audit foreground token contrast on the remaining dark-theme screens; CSV disclosure
  and current-stage labels now use the existing readable foreground token.

Original repositories, owner data, preview volume/MFA/credentials and Nginx edit
remain preserved. Broader providers/import/security/release work remains separate.


`redesign-currency-visibility` completes the existing legacy Settings preference view:
selected lists, paired successful publication, explicit retry/stale/pending states,
serialized commands across remounts, and full stored identity disclosures in scoped
responsive tables. Actual HTTP acceptance also exposed and fixed the old frontend's
missing required visibility flag; backend validation remains intact. CVIS/retainedDFX
pass2/2 through actual HTTPS/MFA/PostgreSQL. All 36 actual final frames have independent approval;
see [Settings guide](settings-workbench.md) and
[verification](../openspec/changes/archive/2026-09-27-redesign-currency-visibility/verification.md). This does
not supply integration health, accounting instruments, network support or FUI-06.
