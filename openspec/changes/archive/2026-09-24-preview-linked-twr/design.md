## Context

Current endpoint TWR deliberately refuses intermediate net flows. Linked TWR needs
whole-portfolio valuations immediately before those flows. Existing manual profit
snapshots and a separately owned frontend section keep this addition bounded.
The GIPS Handbook describes subperiod valuation and geometric linking; the formula
below applies that method to explicitly reviewed manual data, without a compliance
claim. Reference (checked2026-09-24): https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/

## Goals / Non-Goals

**Goals:** reviewed linked period return, strict revision matching, explicit gaps,
exact arithmetic and visible manual/unreconciled provenance.
**Non-goals:** automatic valuation, annualization, stored plans/reports, provider,
schema/dependency changes, charts/max-period, migration or production deployment.

## Decisions

- Keep all existing endpoints and contracts unchanged. Add GET
  `/accounting/portfolio/twr-boundaries?from=ISO&to=ISO` and POST
  `/accounting/portfolio/linked-twr-preview`. Each request gets one owner-scoped
  RR READ ONLY snapshot of coverage/revision and complete effective flow heads.
  No client-side flow pagination or server-side plan/session storage.
- Same-UTC-ms flows net exactly. From flows adjust manual opening; to is excluded.
  Only strictly interior nonzero-net instants require valuations. Limit32 such
  instants (<=33 subperiods) bounds rational products; >32 returns explicit
  `too-many-boundaries` with actual count and empty boundary list, never a partial plan.
- GET strictly accepts only from/to with existing explicit-zone normalization and
  positive-duration rules. Output: from,to,coverageFrom,journalRevision,
  basis:'owner-declared-usd-flows',completeness:'unreconciled',boundaryLimit:32,
  netFlowAtStartUsd,interiorNetFlowDateCount,status:'ready'|'unavailable',
  reason:null|'too-many-boundaries',boundaries:[{at,netFlowUsd}] sorted by UTC.
- POST accepts exactly profit inputs plus expectedJournalRevision (integer0..10000)
  and boundaryValuations (array0..32 of exactly {at,valueBeforeUsd}). Use existing
  48/30 nonnegative money and zoned timestamp parsers; normalize instants, reject
  duplicates after normalization and non-interior timestamps. Share existing flow
  revision validator instead of weakening it. Unknown fields/numeric/exponent/negative
  money or malformed structure =>400 before any DB read.
- Compare expected revision inside the snapshot before semantic set checks. Stale
  revision or missing/before coverage =>409. Then >32 required instants produces
  unavailable; otherwise extraneous valuation instants =>400, missing required
  instants =>unavailable `missing-flow-boundary-valuations`. Partial supplied sets
  are allowed to diagnose missing values; UI normally requires all fields.
- Adjusted start S=opening+netAtFrom must be positive. For each ordered boundary i,
  multiply factor Vi/previousPostValue, then set previousPostValue=Vi+netFlow_i.
  Check every denominator is positive, including after a zero numerator; zero
  before-flow or terminal values are valid if all later denominators remain positive.
  Final factor is closing/lastPostValue. Subtract1 after exact rational linking,
  round once to12 places nearest/ties away from zero. Percent=100*publishedrate.
  Share grouping/rate formatting with endpoint TWR, retaining its passing tests.
  No Number money, per-subperiod rounding, interpolation or iterative solver.
- POST returns unchanged profit payload plus linkedTwr: method:'geometrically-linked-UTC-ms',
  rateRoundingBound:'0.0000000000005' (arithmetic only), boundaryLimit:32,
  netFlowAtStartUsd,startingCapitalUsd,interiorNetFlowDateCount,status,reason,
  periodRate,periodPercent,boundaries:[{at,netFlowUsd,valueBeforeUsd,valueAfterUsd}].
  Missing values and their after-values are null. For >32 boundaries the list is
  empty and count is complete. Rates are null when unavailable. Reason precedence:
  too-many-boundaries, missing-flow-boundary-valuations, nonpositive-opening-capital,
  nonpositive-subperiod-capital; malformed/extraneous sets are400 as above.
- UI: separate `LinkedTwr` section in PeriodProfit receiving from/to/opening/closing
  props. Heading `TWR с промежуточными оценками`, button `Загрузить моменты потоков`,
  fields labelled `Оценка перед потоком {at}, USD`, explicit checkbox
  `Я проверил промежуточные оценки и потоки`, button `Рассчитать связанный TWR`.
  Result region `Результат связанного TWR`, numeric label `TWR, % за период` and exact
  profit/revision/boundary values. Show net flows and pinned revision while editing.
  Explain total portfolio including cash, before-flow timing, manual/unreconciled
  basis, up-to32 limit and period-only rounded percent. No stored drafts/auto requests.
- Period/owner changes and409 discard plan/values and require explicit preparation.
  Opening/closing/boundary edits retain the visible plan but clear result/review.
  Late GET after period change and late POST after any input change cannot reappear.
  New linked actions/errors clear previous linked results. Existing modes remain
  independent; authenticated parent lifecycle handles owner changes. Use existing
  styles, with small responsive additions only if needed.

## Risks / Trade-offs

Manual data accuracy is not guaranteed by exact arithmetic: disclose provenance.
Pinning even corrections outside the interval conservatively invalidates old plans.
32 boundaries is a visible initial capacity limit, not truncation or fabricated TWR.
Zero-capital gaps remain unsupported even if one earlier factor is zero.

## Migration / rollout / verification

No schema or provider/quota impact; source revert rolls back safely. Keep GHCR/Compose,
manual protected CD and owner Nginx unchanged; no original-folder or data deletion.
Baseline existing TWR/profit/XIRR109tests/3suites pass. Inventory: keep journal/auth/
snapshots/forms, simplify shared TWR grouping/rounding, remove nothing.

Verify pure parsing/math/set/cap oracles, actual PG plan/POST revision and RR barrier,
all-row/provider preservation, two new HTTPS cases LTWR-API/LTWR-UI plus retained
TWR-UI, relevant unit/lint/build/types/advisory/spec gates. Full E2E/full backend,
older upgrade matrix, hostedCI/release/live-provider/production checks not selected.
