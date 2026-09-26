## Context

CSV already has separate presentation components and tested immutable source/command
controllers. Preserve all callbacks, conditions, exact labels and saved request state.
The current monolithic visual hierarchy obscures the next action and consequences.

## Goals / Non-Goals

Goals: understandable file → mapping → review progression; grouped fields; responsive
evidence and explicit rollback. Non-goals: wizard navigation/state machine, automatically
advancing focus, parser/controller changes, dependency replacement or hidden errors.

## Decisions

- Derive a noninteractive ordered stage guide from existing state, without a new state
  machine: preview or accepted batch = review; valid inspection = mapping; otherwise file.
  Use aria-current=step on the current item, never claim a preview is a saved import.
- Group existing JSX only. Keep recovery/errors/receipts outside secondary disclosures.
  Retain exact upload/file, list, refresh, inspect, preview, confirm and rollback guards.
  Keep source and candidate tables visible; pagination and raw literals remain unchanged.
- Mapping groups retain every source-key/column option and exact clearing expression.
  useId descriptions outside labels explain total quantity/gross, explicit zero fee,
  optional USD currency, decimal separator, ISO seconds/offset and equal-time order.
  Existing mapping validation and its alert remain; no guessed mappings.
- Selected-batch ID/hash/private-original paragraph moves into native details with
  summary 'Идентификаторы партии'. Filename/status and historical receipts stay visible.
  Opening it is a read-only UI action and does not fetch, remount or reset draft controls.
- Reuse operation-form grid/hint primitives for mapping, add scoped csv-workbench
  sections, guide, summary comparison and controls in CsvImports.css. Do not style
  global inputs or inflate checkboxes. Full exact values remain in semantic tables;
  contain table overflow and use natural word wrapping for ordinary text.

## Risks / Trade-offs

- Grouping could remount selected File or change handlers → preserve JSX instance/order
  across stages; no conditional wrapper replacement; AST/source review and retained
  workflow File/recovery tests. Changes to conditions/controllers are outside ownership.
- Collapsed IDs could conceal recovery → only the ID/hash paragraph is disclosed;
  errors/receipts/rollback and original retry stay visible. Test keyboard disclosure.
- Long literal columns/UUIDs overflow → contained tables plus mobile/tablet/desktop
  screenshots; preserve source whitespace, precision and no HTML interpretation.

## Migration Plan

Existing Docker/Compose/CD pipeline remains. Rebuild only frontend for synthetic HTTPS
tests against unchanged backend and PG; rollback is frontend image/source only. No data,
auth, quota, provider or schema effects; no production/durable-preview update.

## Open Questions

None for this slice. Full frontend redesign and remaining backend/release work stay open.
