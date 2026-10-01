## Context

Actual CSV-006-A HTTPS/PostgreSQL RED with 60 low UUID instruments shows a successful first CSV load-more request returning the same first 50 choices. CsvMapping seeds choices from the account page but starts a separate cursor at undefined. The unchanged E2E helper correctly requires visible progress. Evidence: `/private/tmp/capital-mvp-ci4-csv-pagination-red.json` and the selected CSV trace.

## Goals / Non-Goals

Goals: one authoritative instrument catalog, first-click visible progress to the exact later UUID, truthful exhaustion, explicit error retry and preservation of CSV intent. Non-goals: accounting, API/security/provider changes, catalog search, changing the retained E2E helper or weakening its financial/recovery assertions.

## Decisions

- ManualAccountDetail retains choices, server cursor, loading, error and its existing route-safe loader. Pass catalog controls through TradeJournal and CsvImports to CsvMapping; render the supplied instrument choices directly. Remove the child catalog state/effects/requests entirely.
- The delegated action uses the stored server cursor and appends only subsequent pages; failed requests retain cursor and existing choices, so explicit retry requests the same page. Initial-load failure can also be retried from CSV.
- Hide load-more after known exhaustion. Disable the catalog action while loading or while CSV commands lock the form, show Russian loading/error feedback, and keep mapping controls and mounted File/recovery/receipt state untouched.
- Do not guess a cursor from maximum UUID: parent choices can include independently created instruments. Do not prime an invisible cursor through an extra user click. Component tests cover delegation and parent cursor requests; real retained CSV acceptance remains required.

## Risks / Trade-offs

- Prop wiring could omit catalog state → focused parent/child tests, strict types and independent four-file review.
- Async parent changes could reset CSV intent → no new keys/effects/controller changes; component state-preservation coverage and unchanged real CSV recovery/journey oracles.
- Unit mocks are narrower than real acceptance → archive only after an exact rebuilt frontend passes selected HTTPS/PostgreSQL CSV journeys with the populated catalog.

## Migration Plan

Frontend-only rebuild. No migration, data mutation, authentication, quota, provider or dependency change. Rollback replaces the frontend source/image; no database recovery is needed. Do not deploy or archive from component evidence alone.

## Open Questions

None; real runtime and independent review remain explicit gates.
