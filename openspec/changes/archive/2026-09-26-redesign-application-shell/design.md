## Context

The source inventory at4decf5a is in docs/frontend-screen-audit.md. Layout currently
renders nine ungrouped links and positions the mobile user panel through a measured
navigation height, timeout and transition callbacks. Root/login redirects expose the
legacy Dashboard first. Accounting forms remain a separate, verified but overcrowded
surface. The owner requires a complete restrained responsive redesign.

## Goals / Non-Goals

**Goals:** Clear current versus legacy destinations, usable360/768/1440px shell,
keyboard navigation and consistent password/MFA presentation. Preserve all private
operations, precise evidence, preferences and actual authentication.

**Non-Goals:** Rewriting account/operation editors, chart/metrics expansion, new
backend endpoints, dependency migration, schema changes, owner-data cleanup or full
frontend completion. See the proposal and FUI backlog for remaining scope.

## Decisions

### Reuse routing and native controls

Use existing React Router navigation/outlet and auth/theme contexts. A small static
route list can drive grouped NavLinks and their current state; no new global state
or UI framework is needed to replace the existing equivalent shell. Keep original
accounting destinations/labels so deep links and tests retain meaning. Native controls
remain keyboard accessible. Introducing Mantine globally here would also alter
unchanged forms through styles/providers; evaluate it for the later new editor/dialog
work. No chart is replaced in this change; ECharts remains a later scoped decision.

### Use an in-flow mobile disclosure

Desktop has a compact fixed-width navigation column and flexible content column.
Below the selected breakpoint, a labelled button reveals navigation in document
flow. Hidden links cannot receive focus. Escape closes it and returns focus to its
button; following a link closes it without discarding the active editor's saved
recovery state. No overlay/focus trap, measured panel position or animation timer.
This avoids importing an unverified modal pattern and keeps the small slice bounded.
Use CSS layout/media queries; assert behavior at360/768/1440px rather than testing
implementation-specific breakpoint values.

### Land on supported accounting

The authenticated root redirects to `/manual-accounts`; account details remain at
their current URLs. Preserve Dashboard at `/legacy-overview`, grouped with `/assets`
and `/crypto` under “Прежние данные”, with visible notice that its metrics do not
represent manual-journal portfolio value. Do not change legacy metric calculation,
category labels or storage. Keep the retired liability notice and no liability nav.
The first landing is deliberately named “Ручные счета”, not a fabricated complete
portfolio summary. Later FUI work will provide the proper supported overview.

### Apply restrained visuals without changing transactions

Use shared existing theme tokens with neutral surfaces, muted blue accent, thin
borders, compact spacing, legible type/tabular numbers and small radii. Retain dark
and light preferences. Scope new shell/auth styles; avoid sweeping overrides of
financial tables/editors. Remove decorative shell/login gradients and animation.
Keep a visible focus outline and skip-to-main link. Do not key/remount the Outlet
when toggling navigation/resizing; no amount parsing/formatting/API retry changes.

## Risks / Trade-offs

- Default landing changes → specify real browser RED for root/login landing and
  verify the labelled legacy destination retains access.
- Shared CSS leaks into unchanged editors → scope selectors; run the retained swap
  recovery/SPA/draft journey through the actual release image plus render/build checks.
- Authentication styling hides errors/focus → retain existing auth logic and test
  real password/MFA/logout plus compact viewport and keyboard checks.
- Shell alone leaves long account forms → state partial redesign explicitly; FUI-03
  will replace workflow composition rather than adding more global CSS patches.
- Agents are quota-limited → independent review remains a required pending gate;
  do not archive or label owner UX approval based on root self-review.

## Migration Plan

No database migration, provider request, free-tier quota, Redis/job or deployment
pipeline change. Build the frontend release image only after true acceptance RED;
test against the existing backend image and isolated PostgreSQL. Keep owner preview
image/data unchanged until a separately verified preview update. Source/image rollback
of this shell preserves the database; do not interpret that as swap schema downgrade.

## Open Questions

No owner answer is needed for this bounded slice. Exact colors/spacing are routine
implementation decisions within the stated direction and are reviewed via actual
screenshots. Whole-portfolio coverage, chart maximum period, provider availability,
independent review quota and final owner UX review remain explicitly outside this slice.
