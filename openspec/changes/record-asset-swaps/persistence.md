# Swap implementation contract

## Wire commands and storage

Private base `/accounting/accounts/:accountId/swaps`. POST base/create semantics;
POST `/:swapId/correct`, POST `/:swapId/void`; GET base current complete heads including
voids, GET `/:swapId/versions`, GET `/:swapId/allocation` current-effective derived evidence.
Create fields:
`{requestId,expectedJournalRevision,assertExecuted:true,outgoingInstrumentId,
incomingInstrumentId,occurredAt,orderWithinTimestamp,outgoingQuantity,
incomingQuantity,considerationUsd,feeSource,feeInstrumentId,feeQuantity}`.
`incomingQuantity` is gross, consideration values the complete gross exchange. Correction
adds expectedVersion and repeats every field; account and swapId are immutable.
Void accepts only requestId,expectedJournalRevision,expectedVersion. All declared fields
are required; no unknown fields/coercion. Nullable consideration is independent of fee
basis and principal basis. Fee0 requires null source/id. Positive fee requires source
held/incoming and owned UUID; incoming requires incoming UUID and fee<=incomingQuantity.
Both principal UUIDs must differ. Existing numeric(78,30), strict ISO UTC-ms Gregorian,
UUIDv4, bounded order and integer pin parsers apply. Normalize lexical decimals/time;
canonical JSON includes kind,target,pins and all normalized fields, excluding requestId.

Receipts: `{accountId,journalRevision,swap:<version>}`. Version includes swapId,version,
kind(create/correct/void),requestId,journalRevision,createdAt plus all economic fields and
saved outgoing/incoming instrumentName/instrumentSymbol, feeInstrumentName/Symbol nullable.
The pure row's names are `outgoingInstrumentName`, `outgoingInstrumentSymbol`,
`incomingInstrumentName`, `incomingInstrumentSymbol`; fee labels are stored for readable
receipts but replay obtains actual source labels from consumed fragments. assertExecuted
is an input attestation, not an economic projection field. Request identity namespace is
owner/account/swap-request. Replay returns immutable original201receipt as200 before live
pins/caps; no automatic retry. Reused key with changed kind/target/pins/fields returns409.
Missing foreign valid resources use existing generic404; bad fields400; invalid history,
stale pins, terminal identity or capacity409. Existing bounded lock error policy applies.

Tables `account_swaps` and `account_swap_versions` follow reward storage: owner/account
composite references, swap version/current-head FK (deferred), owned instrument references
for all nonnull instruments, complete saved fields and canonicalPayload, unique request
namespace, version/currentRevision integrity and economic/date/order/numeric/fee checks.
Root owns migration22. Preserve previous schemas/data; refuse destructive down.

List response `{accountId,journalRevision,activeCount,versionCount,limits,items,nextOffset}`;
default50/max100 offset0..9999, nonzero offset needs current journalRevision, stale supplied
pin409. Versions default10/max20 descending, exclusive beforeVersion1..10001,
`{items,nextBeforeVersion}`. Allocation is current-derived, never saved receipt: default50/
max100, offset0..99999; continuations require live journalRevision and expectedVersion,
optionally pin first page too. Return accountId,journalRevision,swapId,version,kind,
full result totals/evidence plus bounded items,nextOffset; void has no active allocation.
Use current pins of the connected account so upstream correction invalidates continuation.

Caps owner/account/component1000active swaps; owner/account10000versions including voids.
Count before loading. Keep other component and per-account bounds. Distinct holdings upper
bound rises by at most1000 to15200, inside current derived page bound. Every command validates
all participant10000revision budgets; exact replay bypasses capacity checks. Old CSV trade
tick semantics and trade version counts remain unchanged. No row-loading truncation.

## Pure calculation types

`FifoSwap` has swapId,version and the economic fields above excluding attestation/pins,
plus outgoing/incomingInstrumentName/Symbol. Optional OwnedAccountInput.swaps defaults[].
New origin `{accountId,kind:'swap',swapId,version,acquiredAt,orderWithinTimestamp,
originalQuantity,originalCostUsd}` with nullable originalCostUsd. A local `SwapLot` mirrors
RewardLot with sourceKind swap and swap origin; local `SwapSaleMatch` likewise. Transferred
lots/matches retain sourceKind transfer and original swap origin with latest arrival.
No invented buyTradeId/rewardId. Incoming fees consume original interval[0,feeQuantity),
remaining[feeQuantity,incomingQuantity); original quantity/basis never rebase. Held fee
uses inventory after outgoing principal, before incoming credit. Both legs and fee are
one account event and occupy one chronology key. FifoBook.projectLegacy rejects swap
identity in the same way it rejects reward/transfer identity.

`OwnedProjection` adds `swapAllocations: ReadonlyMap<string, SwapAllocation>` (empty if none).
`SwapAllocation`:
`{swapId,considerationUsd,principalBasisUsd,feeConsumedBasisUsd,realizedUsd,
coverage:{consideration,principal,fee,realized},items}`.
Each coverage entry is `{knownSubtotalUsd,unknownCount}`. Unknown consideration count is1
if null else0; principal/fee count unknown consumed portions; realized count1 if any
required component unknown else0, known subtotal includes only fully known result.
Items reuse TransferAllocationItem principal/fee structure: instrumentId,quantity,costUsd,
origin,intervalStart,intervalEnd,arrival. Order principal portions then fee portions;
incoming fee allocation origin is the new swap, arrival null. Known0fee has empty items
and all-zero coverage; missing consideration does not make zero fee cost unknown.

Source-only `swapSummary`:
`{activeCount,considerationUsd,principalBasisUsd,feeConsumedBasisUsd,realizedUsd,
coverage:{consideration,principal,fee,realized}}`.
Aggregate active prefix operations; costs individually null if their own evidence is
missing, known subtotals sum relevant portions, realized subtotal sums only complete
operations. Retained all-void identity yields an all-zero summary; no swap identities
retains predecessor account DTO shape. Received swap-origin lots alone do not add summary.
Existing summary consumedCost/realized/gross trade fields remain actual USD trades;
summary.remainingCost includes all held lots. Historical projection carries swapSummary;
price valuation completeness depends on prices/coverage, never swap basis evidence.
Series points omit per-point swapSummary metadata just as reward/transfer summaries.

## UI anchors and review

Section `Обмены активов`; form accessible name `Редактор обмена`, review region `Проверка обмена`.
Labels: Отдаваемый актив; Получаемый актив; Отдаваемое количество; Получаемое количество до
комиссии; Момент обмена (ISO с часовым поясом); Порядок в моменте; Оценка обмена в USD
(Неизвестна/Известна); Сумма оценки, USD; Источник комиссии (Без комиссии/Из имеющегося
остатка/Из получаемого актива); Актив комиссии; Количество комиссии.
Attestation: Подтверждаю: это уже выполненный обмен внутри этого счёта.
Create Проверить обмен→Записать обмен; correction Проверить исправление→Записать исправление;
void Проверить отмену→Отменить обмен; retry Повторить тот же запрос.
Receipt article accessible name `Обмен <swapId>`. Exact consideration, fee source and
quantities remain visible and copyable with both UUIDs; null renders Неизвестно,0renders0.
Review displays normalized command and pins; no simulated quote or prediction. Existing
trade editor draft remains independent. Frozen retry memory is owner/account scoped and
supports SPA remount, not full reload durability. Existing auth/Origin/CSRF/no-store apply.
