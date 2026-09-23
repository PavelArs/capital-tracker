## Context

Current profit uses exact atoms, complete effective `[from,to)` flows, strict reviewed manual values and one owner-scoped read-only RR snapshot. It does not calculate returns. Baseline111 pure cases pass at dfa1f64. Existing GHCR/Compose deployment remains gated and unchanged.

## Goals / Non-Goals

**Goals:** A reproducible approximate annual rate from exact dated investor flows, honest unavailable states, and bounded computation without holding a database transaction during solving.

**Non-Goals:** General root enumeration, inferred prices, TWR, signed manual values, saved reports, providers or production changes. More than64 effective dates is explicitly deferred; no data is truncated.

## Decisions

### Input, snapshot and response

POST `/accounting/portfolio/xirr-preview` accepts exactly the existing profit-preview body `{from,to,openingValueUsd,closingValueUsd,assertReviewed:true}` and returns200. Reuse strict validation, owner identity, auth/MFA/CSRF/origin/no-store, coverage409 and bad-input400. The unchanged `/profit-preview` response gains no fields. A small shared valuation-snapshot helper supplies the existing exact profit payload and all period items in one RR READ ONLY transaction. End that transaction before numerical work; later corrections do not change its captured revision.

The new response is the exact existing profit payload plus `xirr`:

```text
{status: 'available'|'unavailable', annualRate: string|null,
 annualPercent: string|null, reason: null|<reason>,
 convention: 'ACT/365F-UTC-ms', rateTolerance: '0.0000000001',
 cashFlowDateCount: number, shortPeriod: boolean}
```

Unavailable never supplies a numeric placeholder. `shortPeriod` means at least two nonzero effective instants less than365 actual days apart; a long selected period with capital invested only near its end can still be short. All displayed rates are approximate annualization, not a forecast.

### Exact preparation and supported domain

Add negative opening at `from`, negative contributions, positive withdrawals, positive terminal at `to`. Valuations are before flows at both boundaries. Use ALL effective items from `[from,to)`. Aggregate identical UTC millisecond instants in BigInt atoms, then discard exact-zero buckets and sort. Do not merge entire calendar days, convert money to Number, or include internal trades/FIFO/household income.

Reason precedence is deterministic: fewer than2 nonzero instants → `insufficient-cash-flows`; missing either sign → `one-sided-cash-flows`; anything except negatives followed only by positives → `unsupported-pattern`; more than64 nonzero instants including boundaries → `too-many-cash-flow-dates`. These are supported-domain decisions, not proofs of multiple/no roots for arbitrary patterns. A conventional pattern has exactly one root for `1+r>0`: the ratio of the positive to negative discounted sums strictly decreases because every positive instant follows every negative instant. Only after those checks, an exact BigInt net sum of zero certifies rate0.

### Numerics and bounds

Use ACT/365F with integer UTC millisecond differences divided by `31536000000` in Decimal. The base equation is documented by [Microsoft XIRR](https://learn.microsoft.com/en-gb/dax/xirr-function-dax). Our millisecond convention deliberately differs from Excel's integer-date truncation documented in [Excel XIRR](https://support.microsoft.com/en-us/Excel/functions/xirr-function).

Declare `decimal.js@10.6.0` directly in backend runtime. Its [official API](https://mikemcl.github.io/decimal.js/) supports cloned independent precision configuration and fractional exponentials. Use96 significant digits (up to81 coefficient digits including aggregation plus15 guard digits). Keep financial amounts as strings/BigInt/Decimal; Number is only for exact integer timestamps/counts and scheduling.

Supported annual decimal rate is inclusive `[-0.999999,1000]`. Evaluate discounted sums with a common exponential factor removed so individual discount factors are at most1: anchor the first instant for nonnegative rate and last instant for negative rate. This preserves zeros/signs without enormous intermediate factors. Evaluate both bounds; outside bracket → `outside-supported-range`, never 'no return'. Keep opposite-sign bracket and bisect at most80 times to width at most1e-14. Finite checks, inclusive endpoint handling and a defensive sign check around the rounded candidate (±1e-10, clipped to supported bounds) guard numerical results; inability to certify yields `numerical-failure`. A numerical zero evaluation cannot silently establish an arbitrary rate: use the surrounding sign check. An exact zero root is separately established from BigInt sums.

Return canonical decimal annualRate rounded to12 fractional places; annualPercent is exactly100 times that published rate, at most10 fractional places. Normalize negative zero. Advertised absolute annual-rate error is1e-10; there is no fixed absolute USD residual promise. Very small nonzero rates can round to0 and all UI results are labeled approximate.

### Resource and UI behavior

Allow one active XIRR request per backend service/process, across snapshot load and solve; excess returns429 without queuing. Always release the slot in finally, including coverage/input/numerical errors. This is per replica, not a global distributed claim. The async solver yields at bounded small batches/iterations so other requests can progress. At most64 terms and80 bisection iterations; benchmark maximum dates and1970–9999 horizon. No provider quota or DB lease/migration. Retained profit reads stay available.

Add `Рассчитать XIRR` alongside the existing profit action on `/period-profit`. Same reviewed inputs and generation guard; editing, either new request, error or auth loss invalidates both outcomes. Disable both actions for the current pending request but keep inputs editable. Ignore late responses from either action. XIRR response displays exact profit and rate from the SAME revision, never composes separate HTTP snapshots. Keep accessible profit result region, add `Доходность XIRR` region with `XIRR, % годовых` dt/dd, approximate/manual/unreconciled labels, ACT/365F, bounds/date limit and short-period warning. Unavailable shows a Russian reason and no rate value. Never auto-submit or persist values.

## Keep / Simplify / Remove Inventory

| Decision | Scope |
| --- | --- |
| Keep | Exact atoms, effective period projection, current auth, migrations17, deployment, old profit contract and tests. |
| Simplify | Share one manual valuation snapshot builder and input form; keep solver a small separate accounting module. |
| Remove | No existing feature/data/folder removal in this slice. |
| Defer | Legacy floating household ratios and FIFO P&L are unsuitable return sources; arbitrary-sign/more-date support needs a separate contract. |

## Risks / Trade-offs

- Manual/incomplete values → explicit labels and reviewed assertion; no verified-price claim.
- General streams can have several roots → conservative pattern refusal, no seed-driven arbitrary root selection.
- Numerical/CPU cost → precision, finite checks, bracket evidence,64-date/80-step bounds, yields, per-process active guard and real benchmark.
- Date cap excludes even ordinary multi-year weekly contributions → disclose restriction; read/sum all records and never truncate.
- New runtime dependency → pinned direct declaration, frozen install and actual production audit; no dependency update sweep.

## Migration Plan

No migration or stored result. Rollback removes only the new API/action and direct dependency; original profit/flows remain. Production deployment and final consolidation need their separately verified stages.
