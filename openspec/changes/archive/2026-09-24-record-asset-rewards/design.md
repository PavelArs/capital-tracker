## Context

The accepted transfer ledger dynamically replays original-coordinate FIFO histories under
one owner lock. Its cost types are always numeric, including transfer fees and historical
positions. A reward must become a genuine acquisition event; fabricating a buy or replacing
unknown cost with zero would corrupt purchase totals and realized gains.

## Goals / Non-Goals

**Goals:** immutable manual reward create/correct/void, independently nullable acquisition
basis and declared income, exact holdings/provenance through sales/transfers, coherent
historical restatement and protected Russian review/retry. Preserve every predecessor
known-cost result and old receipt. The detailed wire/evidence contract is persistence.md.

**Non-Goals:** swaps, automatic staking/airdrop detection, general ambiguous-chain-event
classification, new external cash flows, reward-claim/network fee accounting, tax advice,
price inference, chart-period expansion, deployment or dependency replacement. Record
quantity actually received after any withholding; this does not claim to reconstruct
withheld rewards/fees. General fee events and chain reconciliation remain full-goal work.

## Decisions

1. Model a separate reward acquisition, never a purchase or carry-in. An existing initialized
   journal is required; unknown-cost opening eligibility stays unchanged. Owner attests that
   this was already received as a reward/income, not a purchase, owned transfer or external
   contribution. Category is staking/airdrop/other/unclassified; unclassified means the reward
   subtype still needs review, not permission to silently classify an ambiguous external
   movement. Unknown acquisition basis and declared income are explicit null, not omitted.
2. Income and acquisition basis are independent owner declarations, including known zero.
   Income is not automatically cost, market price, an investor flow or an extra addend to
   endpoint profit/XIRR/TWR. This feature does not determine tax treatment. Unclassified
   reward income remains excluded from the known categorized-income subtotal; the complete
   categorized-income total is null until all categories and income values are known.
3. Extend original-coordinate intervals with an explicit unknown-cost case; no sentinel0.
   Splits, arrival/FIFO ordering and quantity conservation operate independently of basis.
   A sale with any unknown consumed portion has null consumedCostUsd and realizedUsd;
   unaffected sales remain exact. Aggregated known realized subtotal includes ONLY fully
   costed sales. A mixed sale's net proceeds minus known cost is never presented as profit.
   Preserve old DTO shapes for histories with no reward evidence and no unknown cost.
4. Let historical holdings/value remain available despite unknown basis. Cost completeness
   is independent of price completeness: quantity2, unknown cost and manual unit price5
   yields value10. Declared income40 must not become value40, price20 or basis40. Shared
   connected snapshot and once-only series loading remain mandatory.
5. Reward writer follows owner advisory -> sorted component account locks, replay before
   CAS/caps, validate old/candidate connected history, then atomically append complete
   version/head and advance every affected account once. Account is immutable through
   correction; instrument/time/category/quantity/basis/income can change. Voids are terminal.
   Existing trade/CSV/transfer writers automatically include rewards in replay.
6. Keep distinct bounded reward heads/versions and reuse shared account revision as the
   CAS/read pin. Counts are actual saved versions, never passive invalidation ticks.
   Count before materializing heads. Limits and immutable replay survive capacity exhaustion.
7. Extend the existing manual-account workflow with a reward section and explicit review,
   rather than adding another valuation preview. Same request/key/pins survive ambiguous
   transport failure and are retried only explicitly; no fresh-key automatic resend.

## Risks / Trade-offs

- Nullable basis spans existing consumers -> explicit typed unions/completeness, old
  all-known characterization and targeted real PG/HTTPS retained journeys before archive.
- Category ambiguity -> require economic reward attestation; visible unclassified subtype
  and separate unknown income, never translate unrelated incoming funds into investment gain.
- Unknown transfer fees -> show exact quantity and unknown consumed basis; never label it0
  or infer a market fee from a reward's declared income.
- Larger connected sums -> preserve arbitrary-width BigInt derived arithmetic, at least83
  atom digits for bounded acquired/remaining cost; never feed sums to the raw input validator.
- Graph-wide revisions -> preserve existing10000tick ceiling/replay semantics and atomic
  rollback on any passive account exhaustion; show that ceiling honestly.

## Migration Plan

Add schema21 reward heads/complete versions with composite owner/account/instrument foreign
keys, deferred head reference, exact numeric checks and immutable receipt/request identity.
Tables start empty; no backfill, destructive rewrite or legacy reinterpretation. Fresh21,
populated20 preservation and no-op replay must pass on synthetic PostgreSQL. Down refuses
rather than erase reward history. Previous application images cannot safely serve newly
recorded rewards; production promotion/rollback needs later explicit release planning.

## Open Questions

No provider or owner credentials are required. General unknown economic classifications,
unknown opening-lot acquisition history, fee/reward gross reconciliation and automatic
collection remain separate full-goal requirements, not silently supported by this change.
