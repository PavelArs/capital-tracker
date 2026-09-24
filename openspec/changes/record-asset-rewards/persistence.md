# Reward API and calculation contract

## Inputs and lifecycle

Private base `/accounting/accounts/:accountId/rewards`. POST base creates; POST
`/:rewardId/correct` corrects; POST `/:rewardId/void` terminally voids. GET base lists
current complete heads (including voids); GET `/:rewardId/versions` reads immutable history.

Create: `{requestId,expectedJournalRevision,assertReward:true,instrumentId,category,
occurredAt,orderWithinTimestamp,quantity,acquisitionBasisUsd,incomeValueUsd}`.
Correction has the same fields plus expectedVersion; account/identity cannot change.
Void: `{requestId,expectedJournalRevision,expectedVersion}` only. Category is the exact
string staking/airdrop/other/unclassified. All fields required; the two USD fields accept
explicit null or canonical nonnegative numeric(78,30) input strings, including known0.
Positive quantity has the existing48integer/30fraction bound; existing strict UUIDv4,
UTC-ms Gregorian1970..9999, order0..2147483647 and raw integer revision0..10000 rules apply.
No implicit number/array/object coercion, extra fields, omitted costs, automatic price,
tax basis or income-basis equality. Category other is reviewed reward income; unclassified
is a review-needed reward subtype. UI explains the distinction before attestation.

Chronology occupies the account's trade/transfer/reward key at or after coverage. Reward
quantity means amount actually received, not an estimate of withheld/gross rewards. This
command records no fee or external-flow leg. A missing journal or invalid prefix is409.
Foreign/missing owner-scoped resources return generic404 after valid input parsing.

New command201; exact replay200 with the byte-equivalent original saved receipt before
live CAS/cap checks; conflicting key/kind/target/full normalized payload409. Request namespace
is owner/account/reward-request, separate from trade/transfer/CSV identities. Include expected
pins and nullable values in canonical payload. Each version stores complete fields plus
rewardId,version,kind,requestId,journalRevision,createdAt; receipt is `{accountId,
journalRevision,reward:<version>}` with saved labels, never live restated quantities.
Same-key replay cannot advance heads. No restore/delete. Corrections preserve old versions.
All affected account pins advance once; actual trade versionCount remains unchanged.

Current list default50/max100, offset0..9999; nonzero offset needs live journalRevision.
Response `{accountId,journalRevision,activeCount,versionCount,limits,items,nextOffset}`.
Supplied stale pin409; no partial response. History default10/max20, exclusive beforeVersion
1..10001, descending version, `{items,nextBeforeVersion}`. Receipts remain immutable even
if later reward/trade/transfer revisions changed derived results.

Limits: per-account1000active rewards/10000reward versions; owner1000active rewards/
10000reward versions; reject the next identity/version atomically, count void history.
The existing component bounds retain32accounts/10000active trades/1000transfers and add
at most1000active rewards, count before loading. Existing per-account trade/carry caps,
100000match/held-fragment replay caps,10000sharedrevision ticks stay intact. Check every
old/candidate component and every participant budget; no truncation. Maximum distinct
connected positions increases from13200 to14200, within existing derivedoffset99999.

## Projection and evidence

Pure `OwnedAccountInput` adds optional `rewards` containing active FifoReward rows:
`{rewardId,version,instrumentId,instrumentName,instrumentSymbol,category,occurredAt,
orderWithinTimestamp,quantity,acquisitionBasisUsd,incomeValueUsd}`. Absence equals[];
unknown is null, never0. Current heads resolve version/kind before entering the projector.
Reward origin has `{accountId,kind:'reward',rewardId,version,category,acquiredAt,
orderWithinTimestamp,originalQuantity,originalCostUsd}`; originalCostUsd can be null.
Latest transfer arrival remains separate. Original intervals never rebase on moves.

Local reward lot: `{sourceKind:'reward',instrumentId,instrumentName,instrumentSymbol,
origin,intervalStart,intervalEnd,remainingQuantity,remainingCostUsd}`. Local reward sale
match adds sellTradeId/sellVersion/quantity/costUsd and the same origin/interval fields.
Transferred reward keeps sourceKind transfer and reward origin. Only unknown-containing
lot/match costs are null. Explicit known0 remains string0. No fabricated buy IDs.

Summary consumedCostUsd/realizedUsd/remainingCostUsd and per-sale consumedCostUsd/
realizedUsd become nullable ONLY when their own relevant evidence is incomplete.
When at least one is incomplete, summary additionally returns `basisCoverage`:
`{consumed:{knownSubtotalUsd,unknownCount},remaining:{knownSubtotalUsd,unknownCount},
realized:{knownSubtotalUsd,unknownCount}}`. Consumed unknownCount counts sale matches,
remaining counts held fragments, realized counts incomplete sales. Known realized subtotal
sums only fully costed sales; do not include a mixed unknown sale's proceeds. A sale also
returns `basisCoverage:{knownConsumedCostUsd,unknownMatchCount}` only when incomplete.
All complete predecessor summary/realization objects retain their exact old fields.

Transfer allocation totals principalBasisUsd/feeConsumedBasisUsd and transfer summaries
receivedBasisUsd/sentBasisUsd/feeConsumedBasisUsd are null individually when any relevant
portion is unknown. Only incomplete results add basisCoverage with entries principal/fee
or received/sent/fee respectively, each `{knownSubtotalUsd,unknownCount}`; count consumed
portions. A fee row with unknown portions retains exact quantity, null consumedBasisUsd,
and `{knownBasisSubtotalUsd,unknownCostQuantity}`. Full allocation totals/evidence appear
on every bounded page; current pins include upstream reward corrections.

Historical positions retain exact quantity and nullable costUsd. If incomplete, add
knownCostSubtotalUsd and unknownCostQuantity (same instrument units); otherwise retain
old shape. Cost gaps alone never null valueUsd/totalValueUsd or price completeness.
Valuation history/selected portfolio load rewards once in the same caller snapshot.

`rewardSummary` appears on the source journal/current or historical result if it has any
retained reward identity, including voided ones. At a historical instant aggregate only
active receipts effective by that time: `{activeCount,declaredBasisUsd,declaredIncomeUsd,
knownBasisSubtotalUsd,knownIncomeSubtotalUsd,unknownBasisCount,unknownIncomeCount,
unclassifiedCount}`. Basis subtotal includes all known receipt bases. Income subtotal
includes only categorized receipts with known income. Complete income is null if any
income is unknown OR category unclassified. Counts of unclassified and unknown income
are independent; a receipt may contribute to both. Known zeros stay0. Empty summary is
all0. Recipient accounts get reward origin through lots, not duplicated source income.
These receipt totals do not describe remaining held basis and never enter purchase,
external-flow, or realized-sale totals. Chart series omits per-point rewardSummary just
as it omits transferSummary; underlying quantity/cost stays correct. No data/provider
mutation is performed by reads, no income/market-price/basis substitutions.

## UI and security

Russian manual-account section heading `Вознаграждения`, button `Проверить вознаграждение`
then `Записать вознаграждение`. Form has explicit subtype and known/unknown selectors for
basis/income (blank is not0); default unknown selections may be reviewed but never submitted
without assertReward. Show separate labels for acquisition basis, declared reward income,
unknown subtype, no tax inference and no invented gross/withheld-fee treatment. Existing
result consumers render null as `Неизвестно`, exact0 as0, with incomplete known subtotals.

Create/full correction/void use fresh explicit reviewed current journal pin and target
version. Changed inputs invalidate review; late responses cannot restore old review or
overwrite another account/input. Preserve frozen command/key/pins on ambiguous delivery;
only explicit identical retry, no automatic resubmit/new key. Preserve parent trade draft.
Old receipts remain visible as receipts; no claim they show current state. Real full owner
sessions, Origin/CSRF, private no-store, generic error envelopes and no secret/financial logs.
