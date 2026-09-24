# Owned transfer contract

Design and acceptance contract, not verification evidence. All paths below have
the `/accounting` prefix. Existing full owner/MFA session, CSRF, exact Origin,
private errors and `no-store` apply. No external call or actual funds transfer.

## Commands

Reuse existing strict UUIDv4, decimal string and UTC millisecond parsing, raw
JSON type checks, 48 integer/30 fractional digit and 256-character input bounds.
Unknown keys, numbers in amount fields, invalid object prototypes and duplicate
query values are rejected. Canonical amounts/UUIDs/times follow trade input rules.

`Movement = {instrumentId,occurredAt,orderWithinTimestamp,quantity,
feeInstrumentId,feeQuantity}`. Quantity is positive credited principal. Fee is
nonnegative; exactly zero requires `feeInstrumentId:null`, positive requires an
owned instrument UUID. Order is an integer0..2147483647. Each amount independently
fits input bounds; principal plus same-asset fee may be wider as a derived sum.
No rounding, symbol lookup, implicit fee, negative quantity or price assumption.

| POST path | Required body |
| --- | --- |
| `/transfers` | `{requestId,fromAccountId,toAccountId,expectedFromJournalRevision,expectedToJournalRevision,assertInternal:true,...Movement}` |
| `/transfers/:id/corrections` | `{requestId,expectedVersion,expectedFromJournalRevision,expectedToJournalRevision,assertInternal:true,...Movement}` |
| `/transfers/:id/voids` | `{requestId,expectedVersion,expectedFromJournalRevision,expectedToJournalRevision}` |

Account pair is distinct and permanently attached to the identity. Both journals
must already have declared-empty/known-cost origins. Each effective movement is at
or after BOTH coverageFrom values; `(occurredAt,orderWithinTimestamp)` occupies
both accounts, across all instruments, trades and transfers. A correction rechecks
coverage, chronology and the complete connected candidate. Void is terminal.
Expected account revisions are raw integers0..10000; expectedVersion1..10000.

One owner-wide transfer request namespace covers create/correct/void. Canonical
payload excludes requestId and uses fixed order: `kind`, then `transferId` for
correction/void or `fromAccountId,toAccountId` for create, `expectedVersion` when
required, `expectedFromJournalRevision,expectedToJournalRevision`, then
`assertInternal:true` and Movement fields in the order above for create/correct.
Replay compares the entire canonical payload, before live CAS/cap/terminal-state
checks, and returns the original immutable receipt (200); new version returns201.
Changed kind/target/pins/fields with a used key returns409. Other command namespaces
remain separate. Failed validation/transactions do not reserve a request key.

Malformed input400; absent/foreign account/instrument/transfer404; uninitialized
journals, same account, coverage/order/prefix violation, stale pins/version,
terminal void and capacity409. Neither errors nor projections disclose owner IDs,
canonical payload, SQL, authentication data or identities belonging to another owner.

## Durable receipt and current reads

`TransferVersion = {transferId,version,journalRevision,requestId,kind,createdAt,
fromAccountId,toAccountId,fromJournalRevision,toJournalRevision,...Movement,
instrumentName,instrumentSymbol,feeInstrumentName,feeInstrumentSymbol}`.
Kind is create/correct/void; version begins1; journalRevision is the owner transfer
command journal tick. The two account revisions are the successful command's saved
post-write pins. Void repeats the preceding complete Movement. Null fee has null
labels. Labels use the existing immutable owner-scoped instrument catalog.

`TransferReceipt = {journalRevision,transfer:TransferVersion}`. This is command
history, not current FIFO allocation. Later upstream corrections never rewrite it.

| GET path | Query and result |
| --- | --- |
| `/transfers` | `journalRevision?`, `offset=0`, `limit=50`; returns `{journalRevision,activeCount,versionCount,limits:{activeTransfers:1000,versions:10000},items:TransferVersion[],nextOffset}` |
| `/transfers/:id/versions` | `beforeVersion?`, `limit=10`; returns `{items:TransferVersion[],nextBeforeVersion}` descending version, exclusive cursor |
| `/transfers/:id/allocation` | `fromJournalRevision?`, `toJournalRevision?`, `offset=0`, `limit=50`; returns allocation below |

List includes current heads, including terminal void, ordered by identity UUID;
offset0..9999, limit1..100. Nonzero offset requires current owner transfer journal
pin; supplied stale pin409. Empty reads return revision0 and do not create rows.
Version limit1..20, beforeVersion1..10001, immutable cursor needs no current pin.

Allocation result is `{transferId,version,fromJournalRevision,toJournalRevision,
principalBasisUsd,feeConsumedBasisUsd,items,nextOffset}`. Each item is
`{kind:'principal'|'fee',instrumentId,quantity,costUsd,origin,intervalStart,
intervalEnd,arrival}`. `arrival` describes where the sender acquired this fragment,
null for an original local lot, otherwise `{transferId,version}`. Principal rows
precede fee rows, each in actual FIFO consumption order. Both account pins must be
supplied together or neither; nonzero offset requires both. Offset0..99999,
limit1..100. Stale either pin409. Void returns zero basis and empty items. Every
page repeats the exact full allocation totals; it never totals only that page.

`origin` is `{accountId,kind:'trade',tradeId,version,acquiredAt,
orderWithinTimestamp,originalQuantity,originalCostUsd}` or
`{accountId,kind:'carry-in',lotId,openingRevision,ordinal,acquiredAt,
orderWithinTimestamp,originalQuantity,originalCostUsd}`. Interval coordinates are
canonical quantities in original units. Cost is floor(C*end/Q)-floor(C*start/Q)
in scale30 atoms. A received lot retains these coordinates and becomes available
only at arrival; FIFO subsequently orders by original acquisition/time/order,
origin account/kind/identity, then range start. No copied chain path array.

Received current lots are `{sourceKind:'transfer',instrumentId,instrumentName,
instrumentSymbol,origin,arrival,intervalStart,intervalEnd,remainingQuantity,
remainingCostUsd}`. Sale matches consuming received inventory use
`{sourceKind:'transfer',sellTradeId,sellVersion,origin,arrival,intervalStart,
intervalEnd,quantity,costUsd}`. Original trade/carry-in lot and match shapes stay
unchanged, including their original cost allocation; a returned fragment remains
transfer-tagged. Original metadata alone never makes an arrived lot available early.

Current and historical participant journals add
`transferSummary:{receivedBasisUsd,sentBasisUsd,feeConsumedBasisUsd,
fees:[{instrumentId,instrumentName,instrumentSymbol,quantity,consumedBasisUsd}]}`
and `revisionBudget:{used,limit:10000}`. Fees group/sort by UUID, never symbol.
The existing trade summary remains trade-only except remainingCostUsd, which is
the actual sum of held interval costs. A known fee basis is not a market-valued
network fee and is never subtracted again from trade profit or external flows.
The used budget is the live journal pin, including for historical prefixes.
Accounts with any retained transfer identity (including void) are participants;
untouched account DTOs stay byte-shape compatible. `versionCount` is the actual
local persisted trade-version count, not passive revision ticks.

Derived account-lot, sale-match and historical-position page offsets extend to
0..99999, retaining limit1..100 and existing pin rules. Raw trade-head pages remain
0..9999. At most13200 distinct original lots/instrument identities can arise from
10000 active buys plus32*100 carry-in lots; all such positions are priced, including
those beyond the former single-account1100 maximum. Fragment lists also obey the
100000 allocation bound plus13200 original lots, so apply a separate100000 held
fragment cap per replay before adding any baseline, buy or credit fragment (explicit409, never inaccessible
rows). No string input precision check is applied to a wider derived sum.

Transfer metadata placement: current state fields live inside `journal`; historical
accounting and single-instant valuation fields are top-level. Series metadata may
carry the live revisionBudget but SHALL omit transferSummary rather than showing a
from-point summary as a whole-series total; sample shapes stay unchanged. Selected
portfolio account entries retain their existing explicit field selection (no new
transferSummary), and inherit the exact connected quantities/basis/valuation.
Existing TradeResults/API unions must distinguish trade, carry-in and transfer
variants explicitly. Transfer fragment keys include origin account/kind/identity/
version, arrival transfer/version and interval bounds; sale match keys add sale ID.

## Snapshot, invalidation and bounded replay

Mutation reads and writes use one transaction. Acquire an owner-scoped transaction
advisory lock before ANY economic account-row lock (including origin/opening writers),
then affected account rows in UUID order; do not read stale pre-lock account state.
Replay saved requests first. Load active transfer heads, find old/candidate graph
components and validate the affected union. A transfer's fixed pair cannot change
on correction; void can split a component. Source trade/CSV mutations use the same
component replay and reject deficits anywhere; old source history is never frozen.

Source trade +1 tick, source CSV +N existing contiguous local command ticks; each
other affected account +1 tick. Transfer create/correct/void +1 to every account in
the union of old/new components, including disconnected nodes after void. Check
all account10000 revision budgets before writes. Existing trade/CSV receipts keep
their saved revisions and contiguous command ordinals; gaps between commands are
legal. Version count remains actual COUNT of local versions. No destructive rewrite.

Limits: owner1000 active transfers/10000 transfer versions; affected union at most
32 accounts/10000 active trades/1000 active transfers/100 carry-in lots per account.
Existing per-account1000 active trade/10000 saved local version bounds remain.
Both old and candidate replay are separately limited to100000 allocation matches,
counting principal, fee and sale matches together. The same bounds apply to current
and historical reads of a component. Check sizes before loading excess histories
and increment match count before appending; stop with explicit409, never truncate.
Passive journal budget exhaustion rejects a connected command even if its source
has local capacity. Transfer version limit is checked separately from account pins.

Private reads use one caller-owned REPEATABLE READ READ ONLY snapshot; no global
manager or provider. Historical state/valuation/31-point chart series load the
connected ledger once, then replay inclusive prefixes. A transfer at `at` includes
both legs and fee atomically. Baselines appear only from their own coverageFrom;
no precoverage recipient credit. Selected portfolio values use those same holdings
without double counting moved principal. Page only after full bounded calculation.

CSV preview retains its envelope. A valid current graph but invalid candidate gives
canConfirm:false/candidateSummary:null/previewHash:null; connected prefix failures
use batch error `connected-history`, connected component/match/revision budget
failures use `connected-capacity`. Confirm/rollback refuse these with409. Invalid
already-saved history is409, not a fabricated valid current summary. Existing local
row errors, old batch error codes and immutable provenance reads remain unchanged.

## Internal acceptance seam

`OwnedTransferService` constructor takes the existing DataSource; methods are
`create(owner,input)`, `correct(owner,id,input)`, `void(owner,id,input)`,
`list(owner,query)`, `listVersions(owner,id,query)`, `allocation(owner,id,query)`.
These are tested through production compiled code and actual PostgreSQL, with HTTP
acceptance independently testing the routes. The pure engine surface is specified
by owned-transfer-fifo.spec.ts, not by a fake successful test stub.

## Migration20

Add `owner_transfer_journals` (owner PK, currentRevision0..10000),
`owned_transfers` (id PK, owner, fixed from/to pair, currentVersion) and
`owned_transfer_versions` (complete immutable command and saved receipt pins).
Use owner FKs, composite owner/account and owner/instrument FKs (including optional
fee), distinct-account check, finite positive/nonnegative numeric(78,30), finite
UTC1970..9999 millisecond timestamps, order/version/revision checks, unique
(owner,requestId) and (owner,journalRevision), identity/version PK, deferred head
FK, restrictive deletion. Pair lives on identity and is joined into receipts.
Store no derived cost fragments. New rows are initially absent; existing accounts,
trades, openings, imports, prices, flows and auth rows remain identical. Migration
down refuses rather than deleting accounting data. Upgrade sanitized populated19
and fresh20, verify unchanged-row fingerprints and second-run migration no-op.

## Russian browser surface

Protected `/owned-transfers`, navigation `Переводы между счетами`; heading
`Переводы между своими счетами`. Explain that this records an already performed
movement, sends no funds and is not an external contribution/withdrawal.
Fields: `Со счёта`, `На счёт`, `Актив перевода`, `Количество получателю`,
`Время перевода (UTC)`, `Порядок в эту миллисекунду`, `Актив комиссии`,
`Количество комиссии`; checkbox `Это перевод между моими счетами`.
`Проверить счета` loads both actual journal revisions for review. Submit
`Записать перевод` is enabled only after valid review/attestation. Correction
and void first load current version and both journals; fixed pair cannot be edited.

Show immutable receipt separately from `Текущий разбор лотов` and explicitly
label `Списанная себестоимость комиссии, USD`. No market fee or gain label.
Draft/account changes invalidate review and pending reads. Ambiguous delivery
freezes the exact payload/requestId, retains draft, and offers
`Повторить тот же запрос`; a changed draft is never sent with the saved retry key.
No automatic retry, localStorage, autosubmit or provider requests. Late responses
cannot replace newer input/account state. Existing account trade drafts remain intact.
