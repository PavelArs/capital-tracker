## Why

The verified manual profit preview separates contributed capital from gains, but does not express the timing of invested money. The target brief requires dated XIRR and honest handling of unsupported or undefined results. This slice adds a bounded conventional-flow calculation without inventing valuations or choosing an arbitrary root.

## What Changes

- Add an owner-only XIRR preview using the existing reviewed manual valuations and complete effective external-flow snapshot.
- Support exact cash-flow preparation and arbitrary-precision approximate rates for one negative-to-positive sign transition, with explicit bounds, tolerance and unavailable reasons.
- Add an explicit XIRR action to the existing Russian period form; retain the existing profit API and action.

## Capabilities

### New Capabilities

- `conventional-xirr-preview`: Bounded ACT/365F XIRR, snapshot consistency, workload limits and honest annualization UI.

### Modified Capabilities

None. Existing profit and flow requirements remain in force.

## Impact

Depends on verified manual period profit and external USD flows. Backend accounting, one UI/API binding, focused tests and docs. Declare pinned `decimal.js@10.6.0` as a backend production dependency; its existing frontend-dev transitive occurrence is not a runtime contract. Root owns the package/lock change and audit. No migration, persisted valuation, provider, paid service or deployment change.

Non-goals: arbitrary-sign root enumeration, larger-date-series optimization, negative manual valuations, TWR, automatic prices, financial advice, charts, repository consolidation or deletion. This is partial XIRR support, not completion of the whole performance brief.
