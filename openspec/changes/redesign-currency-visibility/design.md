## Context

Base1fd044f has43canonical specs and no active changes. Target/AGENTS/current Settings,
currency API/service/schema, route callers and CI/CD were audited. CI keeps real release
acceptance; CD remains manually gated with known later hardening work, no replacement
proposed. Frontend baseline118tests/21files PASS3.45s. Actual preferences are per owner;
list and hidden reads are database-only. Only system catalogue rows can be hidden;
hidden inactive rows may be shown in the preference but remain absent from active list.

Keep: owner-scoped list/hidden/hide/show endpoints, all records, sorting/grouping and
existing Settings conditional mount/FX behavior. Simplify: two native selected filters,
paired result publication, explicit pending/error/retry states, row action names and
on-demand complete identity evidence. Remove: old global/unused form/action/animation
CSS, unrouted Currencies.tsx/page variant (only caller is obsolete page), one-line
CurrenciesSection wrapper after Settings imports manager directly. No data deletion.

## Goals / Non-Goals

**Goals:** complete this legacy Settings subview with honest request state, usable
visibility changes and readable evidence at360/768/1440 in both themes.
**Non-Goals:** provider health/collection, network coverage, accounting instrument
availability, catalogue editing, new backend consistency guarantees or pricing.
No API/auth/schema/dependency/deployment changes; rollback is frontend-only.

## Decisions

- Root owns CurrencyManager TSX and direct Settings import/removal of dead wrappers.
  Luna owns only CurrencyManager.css in a separate worktree after RED. Sol owns new
  currency-visibility.spec.ts and necessary focused acceptance helpers. A separate
  reviewer owns no product/test edits. Root alone owns Docker/integration/archive.
- Headed region `Видимость валют`, title `Прежний список валют`; native buttons
  `Показываемые (N)` / `Скрытые (N)` have aria-pressed and controlled result region.
  Before initial successful pair, counts are unavailable, not fabricated zero. Switching
  lists changes no requests. Keep selected list on refresh/mutation. Status distinguishes
  catalogue activation from preference; only system rows get an enabled hide action.
- Load both endpoints together with Promise.all and publish both lists only on success.
  A failed initial pair gives an inline error/retry, not an empty-state claim. Later
  failures retain the last successful lists with a stale warning. A generation/lifetime
  guard prevents an obsolete completion from replacing a current result; pending work
  blocks overlapping reload/mutations. No new generic state abstraction is needed.
- Use original hide/show commands with explicit row identity. While pending, disable
  visibility actions; do not optimistically move rows. On any command/read failure,
  explain that current visibility needs reloading and disable stale row commands until
  an explicit successful `Обновить списки`. This safely handles genuine lost responses,
  including a committed preference whose response was lost, without automatic replay.
  Successful refresh publishes actual state. Announce completion inline, not alert().
  Return focus to the active list button only when the removed action still owned focus;
  delayed completion must not steal focus from another control.
- Group existing fiat/crypto/stablecoin rows. Primary code/name/symbol/status and named
  `Скрыть CODE` / `Показать CODE` actions precede native `Реквизиты CODE` details with full
  stored UUID/contract (explicit absent contract). These identifiers do not assert a
  verified network, current price or adapter. Named focusable table wrappers support
  contained keyboard scrolling;44px controls, visible focus and no decorative motion.

## Risks / Trade-offs

- Partial two-read delivery misleadingly becomes empty → paired publication and real
  lost-read-response test. This is a client view, not a new database snapshot guarantee.
- Command response lost after actual commit → last-good view marked stale, mutation
  disabled, explicit reload resolves it; no assumption of rollback or automatic retry.
- Backend-only/system/inactive behavior confused with network support → explicit scope,
  catalogue status and disabled unsupported hide; show keeps its original semantics.
- Global CSS removals affect unrelated pages → inventory exact imports, scoped selectors,
  retained DFX-UI plus frontend build/tests/lint; do not change shared page styles.
- Owner data modified in tests → only synthetic E2E project/DB and external fixtures;
  fingerprint all business tables except expected owner preference change, then inspect
  that row and foreign preferences exactly. No production/preview access.

## Verification

One new CVIS-UI browser journey through real password/MFA/HTTPS/PostgreSQL: initial
read-loss error and explicit retry; full stored identity/literal labels; native navigation;
pending/last-good command-response loss and real preference reconciliation; hide/show
persistence and owner isolation; no provider/financial effects; six actual themed widths.
Retain DFX-UI unchanged for Settings/FX integration. Before product edits, expected RED
is the missing inline load error after a genuine backend response is lost. Never mock
our backend/authentication; route.fetch reads real responses before deliberate abort.
Preserve118characterization tests; unit tests may cover isolated new lifecycle branches
without adding browser permutations. Required local frontend/tests/build/lint, strict
E2E types, scoped Biome, dependency audit and strict OpenSpec; independently review
source/oracles/actual frames. No full suites, live providers, upgrade/security/release
or owner UX approval claimed. Archive only after required gates; compare43old specs and
new blocks, guard integration and remove only verified merged temporary worktrees.
