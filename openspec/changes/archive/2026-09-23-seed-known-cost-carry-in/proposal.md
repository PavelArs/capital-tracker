## Why

The USD journal and reviewed CSV importer start only from an attested empty account.
Existing manual openings retain quantity and aggregate cost but cannot support a sale
without explicit acquisition-lot provenance. A reviewed known-cost carry-in can unlock
those accounts while preserving their opening evidence and avoiding invented purchases.

## What Changes

- Preview an explicit bounded set of original acquisition lots against the current
  opening snapshot; require exact per-instrument remaining quantity/cost reconciliation.
- Initialize a distinct carry-in journal origin at that opening's coverage instant,
  atomically pinning immutable reviewed lot evidence without modifying prior snapshots.
- Seed the same exact FIFO calculation used by manual and CSV commands with original
  quantity/cost and prior-disposal offsets; preserve residual allocation across partial lots.
- Expose explicit carry-in provenance and initial recorded cost without adding historical
  purchase totals, fees, external flows, profit or a second copy of opening holdings.
- Add a protected Russian preview/review/initialize journey with original-command replay,
  read-only coherent projections, actual database/browser tests and an additive migration.

Non-goals: unknown-cost FIFO, inferred acquisition dates/costs, converting an opening
without attestation, editing/resetting an initialized baseline, carry-in CSV ingestion,
owned transfers, swaps, cash movements, valuations, returns, provider synchronization,
production rollout or repository consolidation. Baseline amendment is later required
work with a separate calculation-revision contract; this slice clearly discloses its
immutable initial baseline before acceptance. Ordinary trade corrections remain available.

## Capabilities

### New Capabilities

- `known-cost-carry-in`: Explicit reviewed initialization from reconciled original
  acquisition lots, cumulative allocation offsets and distinguishable provenance.

### Modified Capabilities

- `usd-fifo-trades`: Allow an explicit carry-in origin alongside the unchanged empty
  origin; seed shared FIFO with immutable baseline lots, expose their provenance and
  expand the justified aggregate bound while preserving trade version/replay semantics.
- `manual-opening-positions`: Distinguish empty-origin exclusion from explicit carry-in
  eligibility; retain the referenced snapshot and opening-write dependency/replay rules.
- `usd-csv-imports`: Apply the same baseline to preview, confirmation and rollback;
  retain all limits, atomic ranges, private originals and historical receipt behavior.
- `explicit-migrations`: Add migration16, preserving populated15 including CSV originals,
  terminal imports, immutable commands/provenance and all earlier financial/auth data.

## Impact

Extend the existing accounting module, typed FIFO provenance and journal origin, with
bounded input/preview endpoints, immutable baseline persistence and a small caller-owned
EntityManager baseline reader. Reuse exact amount/time validators, account locking,
repeatable-read projections and existing authentication/CSRF. No new dependency, queue,
provider, external service or parallel accounting system is required.

This proposal is prepared in an isolated design worktree while CSV verification runs.
Implementation and predecessor-image RED depend on verified archive of
`import-usd-trades-csv`. Preserve every old empty-origin response/receipt and passing
characterization; demonstrate genuine missing-carry-in API/UI failure before new behavior.
Root owns DDL, shared fixtures, dependency locks and deployment; independent worktrees
own bounded tests/implementation/review. Never read or migrate the owner's database.
