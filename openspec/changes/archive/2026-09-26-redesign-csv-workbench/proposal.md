## Why

CSV import remains an undifferentiated column of upload, archived batches, source,
mapping, review and rollback controls. The required frontend redesign needs a clear
workflow with readable field groups and secondary technical details on demand.

## What Changes

- Show a non-interactive three-stage guide derived from actual file/inspection/preview
  state, with clear file, mapping and review sections; never imply automatic acceptance.
- Group mapping into columns, source-value mappings and numeric/time interpretation;
  attach existing financial/time explanations to the relevant controls.
- Put selected-batch identifiers/hash in a keyboard-operable disclosure; keep status,
  receipt, errors, original-request recovery and rollback consequences visible.
- Apply consistent scoped responsive tables/forms/actions in both themes, retaining
  full source/provenance and exact unknown/zero/completeness evidence.

## Capabilities

### New Capabilities
- `csv-workbench`: guided responsive CSV workflow and accessible evidence presentation.

### Modified Capabilities
None. Existing `usd-csv-imports` financial, privacy, request and rollback contracts remain.

## Impact

CsvImports/Mapping/Preview/BatchDetail presentation and scoped CSS; existing CSV browser
journeys gain assertions, not a new suite. Depends on completed account operation
selection and acquisition-entry design conventions. No controller/parser/backend/schema,
auth, provider, dependency, pipeline or data changes. Non-goals: new CSV formats, guesses,
durable browser recovery, virtualized rows, automatic retries, production or preview rollout.
