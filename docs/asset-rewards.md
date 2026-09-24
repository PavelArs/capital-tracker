# Manual asset rewards

Implementation is under verification in the active `record-asset-rewards` change.
See its verification record for actual checks; this is not a production release.

After initializing a manual account's trade journal, open its **Вознаграждения**
section. Record only an asset already received as staking, an airdrop or another
reward. The required attestation distinguishes rewards from purchases, internal
transfers and external contributions. **Вид вознаграждения не уточнён** means the
reward subtype needs review; it does not classify an ambiguous incoming payment.

Enter the actual net quantity received and its explicit timestamp/order. This
slice does not reconstruct gross amounts or withheld rewards/network fees.
Acquisition basis and declared reward income are separate USD declarations. Each
can be explicitly unknown or known, including known zero. Neither is a market
price, external cash flow or inferred tax value.

Review the command before saving. A correction records a new complete version;
instrument, time, quantity, category, basis and income can change. Its account
cannot change. A void is terminal. Previously saved receipts/history remain
unchanged, while derived holdings and connected recipient sales are restated.
Any correction that makes subsequent consumption impossible is refused atomically.

For example, two reward units with unknown basis and declared income40 have value10
when an explicit unit price5 is available. Selling one for80 leaves cost and realized
gain unknown. If basis is later corrected to120, that sale consumes60 and realizes20.
Income40 is never added again to the sale result or market value. A transferred
reward keeps its original lot coordinates; recipient accounts do not duplicate income.

Unknown cost displays as **Неизвестно**, alongside the known subtotal where relevant.
Only fully costed sales contribute to the known realized subtotal. A partly unknown
sale's proceeds minus its known cost are not reported as partial profit. Unclassified
reward income is excluded from the known categorized-income subtotal.

If delivery is uncertain, retain the pending command and explicitly choose
**Повторить тот же запрос**. It sends the original key, fields and revision pins;
it does not create a new reward. A receipt confirms the original command, not the
current derived result. Refreshes/corrections preserve the separate trade draft.

The owner and each account allow1000active rewards and10000saved reward versions.
The shared account journal has10000revision ticks; edits can also advance connected
accounts. Old identical commands remain replayable at these limits. A bounded
component permits32accounts,10000trades,1000transfers and1000rewards. Reads use the
database snapshot without external provider calls. The account chart retains its
existing period bound; its expansion is separate work.

Migration21 adds empty reward tables and preserves previous records. Downgrade
refuses deletion; previous application images cannot safely serve newly recorded
rewards. Production promotion and rollback planning remain separately authorized work.
