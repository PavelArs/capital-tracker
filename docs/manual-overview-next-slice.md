# Next slice: all-owned-manual-account overview

Status: source-backed feasibility handoff, 2026-10-02; not implemented, specified in canonical OpenSpec, runtime-tested or released. Complete the current allocation/UI/image verification before creating this separate change.

## Smallest honest scope

The selected preview accepts at most ten account IDs (`backend/src/accounting/manual-portfolio-valuation-input.ts`). The directory loads fifty accounts per page (`frontend/src/pages/ManualAccounts.tsx`). Client-side selection or summing paginated previews cannot establish all-account discovery or one database snapshot.

Introduce a separate authenticated/CSRF-protected explicit-UTC preview, proposed `POST /accounting/manual-overview-preview {at}`, with no client account IDs. Discover every owned manual account inside one read-only repeatable-read transaction; reuse the existing connected-ledger cache and exact price/allocation projection. Return server-derived account count and a distinct all-owned-manual-account scope. Keep the selected preview unchanged. Label the UI “Все ручные счета”; exclude cash, connected wallets, observed balances and unreconciled overlapping real holdings. It is not an automated whole-portfolio/current-price claim.

## Acceptance to specify before implementation

- Eleven and fifty-one owned accounts: include each exactly once, including accounts beyond page one; exclude another owner's accounts. Use an independent exact aggregate oracle.
- Missing history, a precoverage instant or missing exact price: retain priced subtotal, but total and all allocation percentages are unknown. Covered empty accounts and explicitly zero-priced positions remain known zero.
- Owned transfers are replayed coherently; concurrent account/price corrections leave an in-flight response wholly old and a later response current. Invalid saved replay is an error, never a partial successful total.
- Anonymous, MFA-pending, missing-CSRF, malformed instant and extra-field requests fail. The preview writes no business rows and calls no provider.
- Editing UTC or leaving the view prevents a delayed response from reviving stale results. Real HTTPS/password/MFA/browser → backend → PostgreSQL acceptance is mandatory for the affected journey. Keep decimal permutations at lower levels.

## Open decisions and boundaries

Measure a finite total-account/work limit before promising arbitrary scale. Exceeding it must return an explicit unavailable error and no partial all-account total. The existing 32-account connected-transfer-component replay limit (`backend/src/accounting/owned-transfer-fifo.ts`) is a separate boundary; do not silently raise it or infer a global 32-account cap. Clarify current catalog versus historical discovery in the proposed contract. No migration, external provider, runtime upgrade or production rollout is implied.

Next ready task: create a small OpenSpec change using installed commands; review these oracles, write acceptance tests, demonstrate the intended failure, implement and independently verify.
