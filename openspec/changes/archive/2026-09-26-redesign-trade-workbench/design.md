## Context

Native React controls already preserve exact string drafts and committed-response
recovery. The redesign must improve everyday entry and history navigation without
replacing those controllers. Shared results have semantic tables and precise provenance.

## Goals / Non-Goals

Goals: purposeful field groups, local accessible guidance, explicit focus/scroll for
history actions, coherent theme-safe controls and readable results. Non-goals: new
accounting rules, conversion/rounding, datetime parsing, field-validation redesign,
other workflow editors, table pagination changes, new libraries or preview rollout.

## Decisions

- Retain existing labelled native controls and submit/cancel callbacks. Group identity,
  amounts and time in the same mounted form. Text inputs preserve decimal/UTC strings;
  guidance uses useId and aria-describedby instead of changing accessible labels.
- Keep a stable focusable workbench around the trade/void editor. Only accepted explicit
  history selection schedules post-render focus and instant scroll; no focus on typing,
  refresh, resize or ordinary workflow changes. Record the actual triggering button for
  cancellation; if it is disconnected/disabled, focus the current workbench instead.
  Preserve all existing selection/cancel/retry locks before any focus intent is accepted.
- Preserve TradeResults controllers and all dt/dd adjacency, table captions, columns,
  precision, provenance, unknown-vs-zero and action callbacks. Refine results only with
  scoped theme CSS, consistent action targets and contained table scrolling. No new
  result cards/DTO transformations or architecture layer is required.
- Reuse installed native controls/equivalent CSS primitives. No dependency, paid service,
  API or auth change; the existing Compose/CI/image pipeline is retained.

## Risks / Trade-offs

- Focus could fire after an unrelated rerender → tie it to explicit accepted intent only;
  assert exact target, cancellation return and no focus change on draft input/disclosure.
- Layout could remount editors or change amounts → retained original node/File/draft,
  real committed-replay checks and118 characterization tests; no arithmetic edits.
- Dense tables exceed mobile width → retain explicit local overflow, complete exact
  values and column semantics; inspect light/dark360/768/1440 screenshots.

## Migration Plan

Presentation/focus only; no migrations, owner data, provider quotas or production
changes. Build/verify the existing frontend image against unchanged backend and
disposable PostgreSQL. Source/image rollback is sufficient. Preserve preview and Nginx.

## Open Questions

None for this scope. Full frontend backlog and owner visual review remain outstanding.
