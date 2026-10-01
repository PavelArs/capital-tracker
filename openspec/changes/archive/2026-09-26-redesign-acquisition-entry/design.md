## Context

Swap/reward form components already separate presentation from immutable command,
review and recovery controllers. Native fields are suitable; another library would
add churn without improving these straightforward forms. Reuse the verified trade
entry pattern and extract its styles once for all three forms.

## Goals / Non-Goals

Goals: deliberate field groups, associated financial guidance, responsive actions
and consistent themes. Non-goals: input coercion, accounting, controller/navigation
changes, validation redesign, history/receipt composition, dependencies or deployment.

## Decisions

- Shared OperationForm.css supplies section/grid/field/hint/action primitives. TradeForm
  reuses them without changing its markup positions, input handlers or focus workbench.
  Checkbox rules remain separate from44px text/select controls. No generic form engine.
- Keep exact existing labels, options, onChange/submit handlers, disabled/required and
  conditional-field semantics. Amounts remain text; no number/datetime conversion.
- Swap groups: exchanged assets/quantities; USD evidence; fee source; execution time.
  Attach existing valuation/unknown-vs-zero and FIFO fee-source explanation to relevant
  controls. Explain that incoming quantity is before the incoming-asset fee.
- Reward groups: asset/category/quantity; independent basis/income; receipt time.
  Attach unknown-vs-known-zero and unclassified-category explanations to controls.
- Use useId for unique descriptions outside labels. Keep full recovery content before
  the disabled fieldset and review/errors before the grouped explicit action row.
  Never hide or implicitly accept review, confirmation checkboxes or unresolved commands.
- Extracted trade styles are a pure refactor with retained passing characterization.
  New accessible description assertions have real predecessor RED; no artificial CSS RED.

## Risks / Trade-offs

- Reordering JSX could change handlers/conditional fields → bounded component ownership,
  independent diff review and unchanged real null/zero/fee/retry/stale-review assertions.
- Global styling could leak → scope every shared rule to operation-form; retain trade
  workbench CSS and verify existing WORKFLOW journey after the extraction.
- Long guidance/IDs may overflow → wrap hints without truncation and inspect both themes
  at360/768/1440. Use settled screenshots; no new animation or provider call.

## Migration Plan

No schema/data/auth/provider/dependency changes. Existing Dockerfiles, synthetic Compose
and CI remain; no replacement pipeline or production rollout. Build frontend against
unchanged backend/PG, source/image rollback only. Preserve owner Nginx and durable preview.

## Open Questions

None for this form slice. Broader frontend requirements remain on the redesign plan.
