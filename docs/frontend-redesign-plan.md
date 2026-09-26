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

Swap runtime verification is complete at9/12; its independent review still waits for
the known agent quota and remains required before archive. FUI-01 source inventory and
target hierarchy are recorded in [frontend-screen-audit.md](frontend-screen-audit.md).
The first FUI-02 slice is implemented in active `redesign-application-shell`, 6/8 tasks:
responsive grouped navigation, manual-account landing, preserved labelled legacy
views, restrained login/MFA, theme and keyboard focus. See [the navigation guide](application-shell.md)
and its linked actual verification evidence.112 frontend tests and 3 selected real
HTTPS/PostgreSQL browser journeys pass; independent review/archive remain pending.
The preserved local preview still uses its previous image and data.

FUI-01 remains partial: the shell now has real 360/768/1440px screenshots, while the other
screen prototypes and their review remain. FUI-02 also remains partial: shared table,
form and feedback composition is not yet redesigned. The first FUI-03 account-directory
slice is now implemented in active `redesign-account-directory` (4/6 tasks): accounts
lead, creation is explicit, valuation is collapsible, and drafts/request identity remain.
See [the directory guide](account-directory.md) for scope and evidence.114 frontend tests
and three selected real browser cases pass; review/archive remain pending.
Next implementation slice should address account-detail hierarchy and focused operation
workflows, keeping frozen retries and independent drafts. Do not mark all six frontend tasks complete.
FUI-04/05/06, maximum-period chart work and owner visual review are still pending.
The local preview database, MFA key, credentials and original repositories remain
preserved. Broader blockchain/provider/import/security/release requirements remain open.
