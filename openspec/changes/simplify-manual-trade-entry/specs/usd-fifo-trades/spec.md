## MODIFIED Requirements

### Requirement: TRADE-002 Exact bounded USD execution inputs
Swap events SHALL share the account chronology namespace with trades, transfers, and rewards. Each swap SHALL atomically debit outgoing principal, consume any held fee after that debit and before crediting the incoming asset, and credit gross incoming quantity less any incoming-asset fee. Its effective key SHALL be unique account-wide and at or after coverage. A same-account swap SHALL use distinct outgoing and incoming instrument UUIDs.

Every execution SHALL identify a manual owned instrument UUID, buy/sell side, explicit
UTC-normalized millisecond instant, a same-instant integer order, positive
quantity/gross USD and nonnegative USD fee. Amounts SHALL retain numeric(78,30) raw
string boundaries and explicit SQL finite checks. All declared raw types and unknown
fields SHALL be validated before coercion. Effective chronology SHALL be unique per
account and at/after coverage. Same symbols MUST NOT merge identities or account lots.
A trade create or correction command MAY omit the order key; the system SHALL then
assign, under the same account lock and validation, one more than the highest order
already occupied at that instant in the account by trades (excluding the corrected
trade itself), rewards, swaps and transfers touching it, or 0 when none. The saved
version SHALL hold the resolved explicit order; the request's canonical payload SHALL
record the order as automatic so an identical retry replays its receipt. A `null` or
non-integer order SHALL remain invalid, an explicit order SHALL keep conflicting on a
duplicate key, and an automatic order beyond 2147483647 SHALL be refused with 409.

Transfer events SHALL have an explicit effective UTC-millisecond instant and same-instant order
at or after both participant coverage instants. Their chronology key SHALL be unique against
trade and transfer events in each touched account; equal keys on disjoint accounts may commute.

Reward events SHALL occupy the same account chronology namespace as trades/transfers and obey coverage, raw type and precision rules.

#### Scenario: TRADE-002-A Precision and chronology survive restart
- **WHEN** amounts above 2^53, quantity 0.000000000000000000000000000001 and valid 48/30 boundaries are submitted in reverse chronological API order
- **THEN** exact canonical strings survive PostgreSQL/restart and FIFO uses explicit time/order, never arrival order or UUID
- **AND** equivalent offsets normalize to the same instant, duplicate-looking trades with distinct keys/order remain separate, and duplicate effective chronology returns 409
- **AND** same-symbol UUIDs and separate accounts retain independent queues

#### Scenario: TRADE-002-B Invalid values and unsupported operations fail before mutation
- **WHEN** raw numbers, arrays, malicious objects, whitespace, exponent/comma/NaN forms, excess raw scale, overflow, gross 0, invalid dates, unsafe integer order/revision, unknown currency/owner/server fields or pre-coverage executions are submitted
- **THEN** syntax/type failures return 400 and pre-coverage returns 409 without any trade, version, head, revision or request-key write
- **AND** buy gross plus fee overflow returns 400 before persistence without reserving a request key
- **AND** direct PostgreSQL NaN/infinities/null identity/value writes fail constraints

#### Scenario: TRANSFER-TRADE-ORDER Transfer chronology uses both account journals
- **GIVEN** a transfer touches two covered account histories with explicit trade/transfer event order
- **WHEN** its effective key duplicates an event in either participant account or predates either coverage
  instant
- **THEN** the movement is rejected atomically; the same key on disjoint accounts remains independent

#### Scenario: REWARD-TRADE-ORDER
- **WHEN** a reward overlaps a trade/transfer time/order or predates coverage
- **THEN** the entire command is409 without persistence; distinct account keys remain independent

#### Scenario: SWAP-TRADE-CHRONO
- **GIVEN** a covered account has a trade at a specific instant and order
- **WHEN** a swap is recorded at that same chronology key, or before coverage
- **THEN** the whole swap is rejected without persistence; a unique key at or after coverage records both legs as one event

#### Scenario: TRADE-002-C Automatic same-instant order
- **GIVEN** a covered account with a buy at `2025-06-13T00:00:00.000Z` order 0 and a reward at the same instant order 1
- **WHEN** the owner creates a buy at that instant without an order
- **THEN** it is saved with order 2 and FIFO applies it after both events
- **WHEN** the same request ID is retried without an order
- **THEN** the original receipt is replayed with order 2 and nothing else is written
- **WHEN** a command sends `orderWithinTimestamp: null` or an explicit duplicate order 0
- **THEN** they return 400 and 409 respectively without persistence
