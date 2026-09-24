## Context

The brownfield inventory retires household liabilities from the target portfolio UI.
The existing editor owns its forms, cards, list, chart, CRUD wrapper and types.
Dashboard still consumes aggregate liability metrics and five category labels.
The backend and persisted records remain compatible and private.

## Goals / Non-Goals

**Goals:** remove this isolated frontend surface, give old bookmarks a clear path
to manual accounts, and prove saved financial records and authentication survive.
**Non-goals:** dashboard/assets/crypto cleanup, API retirement, data deletion/export,
provider changes, chart maximum-period changes, schema/dependency/deployment changes.

## Decisions

1. Replace the protected `liabilities` route with `liabilities/*` and a small static
   Russian notice: heading `Раздел обязательств закрыт`, statement
   `Сохранённые записи не удалены.`, link `Перейти к ручным счетам` to
   `/manual-accounts`. Retain existing PrivateRoute and Layout authentication.
   Nested legacy bookmarks also reach the notice. No financial reads, editor,
   list, chart, or provider request is initiated by this page.
2. Remove only the liabilities navigation entry and dedicated frontend page/CSS,
   feature directory, CRUD adapter/barrel export, six adapter tests and unused
   shared liability declarations. Keep aggregate Metrics fields, Dashboard,
   `liabilities.categories` labels in both locales and shared chart dependencies.
   Remove obsolete navigation/UI translation keys only after dependency review.
3. Preserve backend code and schema byte-for-byte. GET/list remains owner-scoped;
   anonymous and password-only sessions get private no-store denials, foreign
   records stay inaccessible. Existing CRUD/service characterization stays green.
4. Use one grouped real HTTPS/MFA/PostgreSQL scenario, LIR-UI, plus retained
   MPV-UI. Seed representative owner/foreign liability records only into guarded
   synthetic PG. Fingerprint all tables except legitimate auth session/request
   ledger updates after authentication; compare before/after reads and navigation.
   Existing financial assertions are not weakened; only obsolete thin-wrapper
   tests are deleted with the removed module.

## Risks / Trade-offs

Removing an editor is a deliberate user-visible retirement, so new acceptance must
fail against the accepted predecessor before removal. Saved records remain available
through the unchanged private API and source history retains the old implementation.
The current Dashboard still displays legacy metrics; its replacement is separate.
A static notice avoids silently redirecting old bookmarks or implying migrated data.

## Rollout / Verification

Local isolated acceptance only. Keep GHCR/Compose pipeline and guarded production
rollout unchanged. No owner database or original project directory is touched.
Run frontend unit/lint/build, backend liabilities and manual-portfolio characterization,
scoped test formatting/type checks, production dependency gate, strict OpenSpec,
and selected HTTPS cases on tmpfs PostgreSQL. Record actual RED, GREEN, image IDs,
independent review, preserved owner Nginx/lock hashes and cleanup. No full E2E or
migration matrix is needed for this frontend-only change. Rollback is source revert.
