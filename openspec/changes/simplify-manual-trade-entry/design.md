## Context

Effective chronology `(occurredAt, orderWithinTimestamp)` is unique per account across
trades, rewards, swaps and transfers (`calculateOwnedTransfers`). The trade command
required the order explicitly and the browser defaulted it to 0.

## Decisions

- **Resolve on the server, inside the existing transaction.** `mutate` already holds
  the owner accounting lock and reads the connected ledger before projecting. The
  automatic order is computed from that ledger, so it sees every event kind and
  concurrent writers serialize on the same lock. The browser cannot see swaps,
  rewards or transfers of the account, so it does not guess.
- **After, not first free.** "Max + 1" keeps the natural reading that a later entry
  of the same day happened later; filling a gap could place it before an existing
  sale. Overflow past 2147483647 is a 409.
- **Idempotency on intent.** The canonical payload stores `orderWithinTimestamp: null`
  for an automatic request, so a retry with the same request ID matches the saved
  receipt even though the saved version holds the resolved order. Explicit payloads
  are byte-identical to before.
- **Absent, not null.** Only an absent key means automatic; `null` and other raw types
  remain 400, so the existing strict raw-type contract is unchanged.
- **Corrections exclude themselves.** When a correction omits the order, the trade's
  own current head is not counted. The form keeps the existing order for corrections,
  so this path is only used when the owner clears it.

## Risks

- An owner who enters a same-day sale before the purchase gets a 409 (insufficient
  quantity) as today; the order disclosure still allows an explicit order.

## Rollback

Revert both commits. Rows written with an automatic order carry ordinary explicit
orders, so they stay valid after a revert.
