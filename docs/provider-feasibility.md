# Provider feasibility and selection gates

Verified against public primary documentation on **2026-09-21** for target brief
sections 7–8 and 11. This is a documentation/source audit, not a live contract
test. No account was created, key inspected, wallet queried, provider enabled or
paid service selected. “Documented” means the cited source supports the claim;
“unknown” must remain a deployment gate, not become an assumed capability.

## Existing implementation

- `backend/src/crypto/crypto-update.service.ts`: hourly BTC address balance from
  `https://blockstream.info/api/address/{address}`; ETH and configured ERC-20
  balances through `eth_getBalance`/`eth_call` at `eth.llamarpc.com`,
  `rpc.ankr.com/eth`, and `ethereum.publicnode.com`. The Etherscan fallback uses
  legacy `/api` without a key. No transaction-history adapter exists. Several
  failures become zero/empty tokens and then a successful-looking saved refresh.
- `backend/src/crypto/crypto-prices.service.ts`: CoinGecko `/simple/price` for
  bitcoin/ethereum every 15 minutes, Ethereum `/simple/token_price` on demand,
  memory cache and up to four attempts on 429. Reads can cause provider calls;
  no PostgreSQL price history, persistent quota ledger or coverage ranges.
- `backend/src/currencies/currency-update.service.ts`: hourly legacy
  `https://api.exchangerate-api.com/v4/latest/USD`, Redis current-rate cache,
  and hard-coded USDT = USD 1. No historical FX. Source review does not prove
  any of these legacy endpoints still work.
- No TRON, Solana, Stellar, Zcash, news or LLM adapter was found. A currency
  ticker/contract record is not network support. Provider account quotas and the
  actual configured private portfolio were deliberately not read.

## Capability matrix

Blockchain rows supply chain observations, **not fiat prices**. Market-price rows
do not establish ownership, cost basis or complete transaction history.

| Candidate | Free access, key and quota evidence | Documented coverage and history | Retention and feasibility decision |
| --- | --- | --- | --- |
| CoinGecko Demo | Free registered Demo key; current API overview advertises 100 calls/minute and 10,000 calls/month. Batch current prices by provider asset IDs. [API overview](https://www.coingecko.com/en/api) | `/simple/price` supports current prices. Demo `/coins/{id}/market_chart/range` covers only the preceding 365 days; automatic intervals are 5 minutes for the latest day, hourly for other short ranges up to 90 days, daily above 90 days. Never label daily observations intraday. [History reference](https://docs.coingecko.com/demo/reference/coins-id-market-chart-range) | **Not approved for permanent archival history.** Terms require secure storage, recommend at least daily cache refresh, and require deletion on access termination; §6.2 limits storage beyond express permission. Durable historical retention past the accessible window is not explicitly established. Obtain written permission compatible with the brief or select another free source. [API terms §§6,10](https://www.coingecko.com/en/api_terms) |
| Bitcoin: Blockstream Esplora | Public base `https://blockstream.info/api/`; documented requests have no API key. No hosted-service numeric quota/SLA was established by the API reference. | Address confirmed/mempool totals, UTXOs, transactions with inputs/outputs/fee/status. Confirmed address history uses 25-record pages and `last_seen_txid`; mempool list is capped at 50 without paging. One address is not an HD wallet. [Official API](https://github.com/Blockstream/esplora/blob/master/API.md) | Technical candidate. Reference explicitly permits indefinite caching for specified block resources; that is not a blanket contractual grant for all address data. Hosted retention terms and acceptable polling/backfill rate remain unknown. Track individual addresses and disclose missing change addresses. |
| Ethereum: JSON-RPC plus Etherscan V2 indexer | Standard RPC defines reads but no free host entitlement. Legacy RPC host quotas/terms are unverified. Etherscan Free advertises 3 calls/sec, 100,000/day, selected chains, no PRO endpoints; server-side key required. [RPC](https://ethereum.org/developers/docs/apis/json-rpc/), [Etherscan quota](https://docs.etherscan.io/rate-limits) | `eth_getBalance`/`eth_call` cover native/configured contract balances. V2 address endpoints document normal, internal and ERC-20 history with block bounds/pagination. Free history pages are at most **1,000** from July 1, 2026; internal history **by block range** is now PRO. Use the distinct **by address** candidate, not the paid endpoint. [Normal](https://docs.etherscan.io/api-reference/endpoint/txlist), [internal](https://docs.etherscan.io/api-reference/endpoint/txlistinternal), [tokens](https://docs.etherscan.io/api-reference/endpoint/tokentx), [changelog](https://docs.etherscan.io/changelog) | **Complete address history unproven.** A free key, actual chain-1 entitlement, earliest usable ranges, receipt/log identities, failed transactions, internal-transfer semantics and storage permission need verification. The supported-chain table was not rendered in the fetched official page, so its per-chain free entitlement was not inferred. [Chain eligibility](https://docs.etherscan.io/supported-chains) |
| TRON: TronGrid | Official CLI documents a free tier, with reduced unkeyed limits. Production guidance requires `TRON-PRO-API-KEY`; current documentation defers numeric quotas to the console/plan/response. Do not carry forward old “100,000/day, 20 QPS” claims as verified. [Free access](https://developers.tron.network/docs/cli), [limits](https://developers.tron.network/reference/rate-limits) | Account state and TRX/TRC-10 history; separate TRC-20 transfer history with contract filter, timestamps, confirmation flags and fingerprint pagination, max 200/page. Internal calls/receipts require their own coverage. [TronGrid overview](https://developers.tron.network/docs/trongrid), [native history](https://developers.tron.network/reference/get-transaction-info-by-account-address), [token history](https://developers.tron.network/reference/get-trc20-transaction-info-by-account-address) | Technical candidate; free account quota, oldest reliable history and retention permission unknown. Current interactive reference examples use Shasta: production adapter must explicitly select documented mainnet configuration and test chain identity. TRON USDC is legacy, not currently Circle-supported. [Circle announcement](https://www.circle.com/blog/circle-is-discontinuing-support-for-usdc-on-the-tron-blockchain) |
| Solana: public RPC, then an owner-selected free host | Public no-key endpoint documented as `https://api.mainnet.solana.com`. Published limits: 100 requests/10sec/IP, 40/10sec/method, 40 concurrent connections, 100MB/30sec; explicitly changeable. Public endpoints are explicitly not intended for production. [Clusters](https://solana.com/docs/references/clusters) | `getBalance`, token-account discovery, `getSignaturesForAddress` with `before`/`until`, followed by `getTransaction` for operations/fees/errors. Owner signature history is not necessarily the history of every owned token account; model both and handle closed accounts. [Signature scope](https://solana.com/docs/rpc/http/getsignaturesforaddress), [transaction](https://solana.com/docs/rpc/http/gettransaction) | Public RPC is a limited development candidate. Free production host, archival depth and storage terms remain unknown. A missing/pruned transaction cannot be interpreted as a zero balance or complete history. No paid or self-hosted full-node fallback. |
| Stellar: Horizon provider | Official provider directory lists a publicly accessible mainnet LOBSTR endpoint, `https://horizon.stellar.lobstr.co`; vendor-specific entitlement/quota still needs verification. Horizon's **software default**, not a promise by every host, is 3,600 requests/hour/IP. [Providers](https://developers.stellar.org/docs/data/apis/horizon/providers), [rate limiting](https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/rate-limiting) | Account balances, operations and transactions with cursors. Official docs record SDF public history truncated to one year; do not transfer that retention promise to LOBSTR or advertise full genesis history. [Horizon](https://developers.stellar.org/docs/data/apis/horizon) | Provider retention permission and actual oldest ledger remain unknown. Store total, reserved and spendable separately; reserve depends on subentries/sponsorship and selling liabilities reduce spendable balance. [Reserve model](https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves) |
| Zcash transparent: lightwalletd community service | Investigated an actual protocol path rather than inventing explorer REST URLs. zec.rocks publishes community infrastructure and a server directory. No universal free quota, API key policy or archival terms established. [Operator](https://zec.rocks/), [directory](https://hosh.zec.rocks/) | Official protocol has `GetTaddressBalance`, block-range `GetTaddressTransactions` and `GetAddressUtxos`. The history method excludes mempool transactions; older `GetTaddressTxids` is deprecated despite returning transactions. [Protocol](https://github.com/zcash/lightwallet-protocol/blob/main/walletrpc/service.proto) | **Feasibility spike required**, no approved host yet: confirm TLS host/port, protocol version, transparent-index support, limits, completeness, server retention and reuse terms. Blockchair docs could not be fetched (401), so no Blockchair free-tier claim is made. Shielded holdings require labeled manual/import data; a transparent receiver cannot represent a unified wallet. |
| USD/EUR/RUB FX: ExchangeRate-API open access | No key; current documented endpoint `https://open.er-api.com/v6/latest/USD`, daily updates, attribution required. Daily caching is recommended; 429 imposes a 20-minute restriction. [Open API](https://www.exchangerate-api.com/docs/free) | Current USD-base conversion; this endpoint does not backfill earlier dates. Verify required currency codes and publication timestamps before enabling. | Terms explicitly permit storage and reuse for customer end use, prohibit redistribution. Viable for **new daily observations**, not evidence of free historical coverage. [Storage terms](https://www.exchangerate-api.com/terms) |

Ethereum completeness needs independent evidence beyond endpoint names. JSON-RPC
does not enumerate every transaction involving an address. An indexer history
adapter must reconcile normal and internal native transfers, configured ERC-20
events, reverted transactions and once-per-wallet transaction fees. Obtain
receipts where needed for stable event/log identities; do not key token events
only by transaction hash. An empty indexer page or successful balance query does
not prove coverage back to account creation. Record ranges, missing categories,
finality/reorg boundaries and unresolved reconciliation explicitly. No provider
in this audit was live-tested for that completeness.

Contract presets are not approved by this research. Verify USDT/USDC identifiers
against their issuers separately for Ethereum/TRON, keep `(network, contract or
mint)` identity, and distinguish legacy TRON USDC from supported USDC elsewhere.
Never substitute a symbol match or fixed USD 1 price for this verification.

Historical FX remains an open selection task. ECB publishes downloadable time
series but stopped EUR/RUB reference rates after March 1, 2022; it alone cannot
cover the required current RUB history. Select and verify a free historical
RUB source and its reuse terms; until then disclose missing periods and accept
dated owner imports. [ECB coverage](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)

## Optional AI and news

Gemini Developer API is a candidate, disabled by default. The pricing page lists
free input/output for selected text models, including Gemini 2.5 Flash-Lite;
the owner must supply a server-side key for an eligible, non-billing project.
Actual RPM/TPM/RPD are project/model-dependent and shown in AI Studio, not a
fixed allowance this audit can promise. No account was opened and no prompt sent.
[Pricing](https://ai.google.dev/gemini-api/docs/pricing),
[limits](https://ai.google.dev/gemini-api/docs/rate-limits)

Unpaid-service terms generally allow product/model improvement and human review
of inputs/outputs, and prohibit submitting sensitive/confidential/personal data.
EEA/Switzerland/UK have a stated exception applying the paid-services data-use
terms; the user's timezone does not establish account eligibility. Abuse
monitoring separately documents 55-day prompt/context/output retention. This
does **not** establish a 55-day ceiling for all unpaid-service data use. No
zero-retention promise is made. Previewing allocations can still reveal private
information; opt-in does not override provider terms. Keep external AI off if
the approved summary remains sensitive under the applicable terms.
[Terms](https://ai.google.dev/gemini-api/terms),
[abuse retention](https://ai.google.dev/gemini-api/docs/usage-policies)

The app must show the exact minimal summary before opt-in: percentages and
owner-selected objectives where sufficient, without addresses, TXIDs, secrets,
cookies or raw operations. Only backend-computed metrics, allowlisted retrieved
source IDs and times enter the prompt. No arbitrary URLs, browsing/trading tools,
code execution or database writes are granted to the model. Validate output,
cite only supplied sources, store the analysis privately and stop at free limits.
No news provider is selected: feeds still need verified availability, terms and
retention rules before retrieval. News absence must produce an explicit evidence
gap, not invented context. No paid grounding/search fallback is approved.

## Request budget: estimates, not measured portfolio usage

No private wallet/configuration database was queried. Therefore actual configured
portfolio usage is **unknown**. Source config proves only the BTC/ETH price
batch; token/address counts are runtime data. Before live enablement, calculate
the same budget locally from counts only, without exposing addresses or keys.

Use 15-minute polling: `96 cycles/day`, `2,976 cycles/31-day month`.
Illustrative portfolio: two BTC addresses; two Ethereum addresses, each with two
ERC-20 contracts; one TRON address/two TRC-20 contracts; one Solana owner/one token
account; one Stellar account; one Zcash transparent address; eight distinct
price IDs (BTC, ETH, TRX, SOL, XLM, ZEC, USDT, USDC). Each estimate assumes one
incremental history page per category per cycle and one chain-tip request per
chain per cycle. These are planning assumptions, not claims about actual traffic.

| Work | Requests per cycle | Base requests / 31 days |
| --- | --- | --- |
| Batched eight-ID prices | 1 | 2,976 |
| BTC: balance + recent history per address, shared tip | `2 × 2 + 1` | 14,880 |
| Ethereum: native + two token balances + three history categories per address, shared tip | `2 × (1 + 2 + 3) + 1` | 38,688 split across RPC/indexer; plus receipts/metadata |
| TRON: account + two token reads + native/token/internal history, shared tip | `1 + 2 + 3 + 1` | 20,832 plus receipts/resources |
| Solana: balance + token discovery + owner/token-account signature queries, shared slot | `1 + 1 + 2 + 1` | 14,880 plus one detail call per new signature |
| Stellar: account + operations + transactions, shared ledger | 4 | 11,904 |
| Zcash: balance + bounded transparent history + tip | 3 | 8,928, **conditional on a suitable host** |
| Daily FX observation | one/day | 31 |

General ledger: `cycles × (balance calls + incremental page calls + shared tip)
+ new transaction details + initial metadata + missing-range backfill + manual
refresh + retries`. Batching HTTP requests does not necessarily reduce the
provider's billable/request units; count conservatively until documented.
Cache contract decimals rather than requesting them every poll.

For prices, five allowed manual batches/day and one daily-granularity 365-day
request per eight assets give `2,976 + 155 + 8 = 3,139` calls; a 10% retry reserve
rounds up to **3,453/month**, below the documented 10,000. If contract prices
need a second batch each cycle/manual refresh, the same calculation is
`(5,952 + 310 + 8) × 1.10 = 6,897`. This establishes a request-volume fit only;
CoinGecko's retention gate remains unresolved. Older price data cannot be
manufactured by accumulating new observations.

Initial history is not bounded by these steady-state totals. Budget additional
pages using observed counts and documented page sizes (BTC 25, Etherscan free
1,000, TronGrid 200), plus receipts/transaction details and a final empty page
where the protocol requires one. For example, 500 confirmed BTC transactions
need 20 history pages and possibly a termination probe, not one request. Resume
missing ranges from durable cursors; never restart a full scan on every poll.
AI estimate: at most two button requests/day = 62/month; token usage remains
`62 × (approved input tokens + capped output tokens)` and must fit actual
project limits. All limits need a shared persistent budget across workers,
manual refreshes, retries and backfills.

## Failure contract and next verification slice

Documented provider failure distinctions: Etherscan can return HTTP 200 with
`status=0` for either no records or an error; inspect `message/result` before
advancing coverage. TronGrid can use 403/429 and error bodies. Solana documents
403 blocks and 429 with `Retry-After`; Horizon documents 429. FX distinguishes
HTTP throttling from `result=error`. Handle HTTP and JSON-RPC/gRPC errors,
malformed/truncated pages and unavailable data as failed observations, never zero.
[Etherscan response contract](https://docs.etherscan.io/api-reference/endpoint/txlistinternal)

Next small provider change should implement the transport boundary and synthetic
contract fixtures before adding live credentials: destination allowlist and
redirect/DNS validation, timeouts/size limits, decimal-string parsing, bounded
retries with jitter and `Retry-After`, persistent quota/cursor state, and stale
last-success preservation. Then implement one network end to end through real
PostgreSQL with external HTTP fixtures. Verify duplicate pages, multiple events
per transaction, failure/restart/reorg behavior, oldest coverage and zero
provider calls when stored chart periods change. Keep merge gates offline.

Before enabling each provider, close its explicit gates: actual free key/chain
entitlement; numeric quota; allowed local historical retention (including after
termination); oldest/granularity coverage; preset identities; fee/event/finality
semantics; and a bounded separately triggered contract smoke with synthetic or
explicitly owner-approved public addresses. Do not rotate identities, create
accounts, buy plans or require a full node to conceal a missing free capability.

Evidence tools used: `rg` endpoint search; read the three source services,
`AGENTS.md`, target brief, active OpenSpec config/proposal and `CONTINUITY.md`;
web search/open/find against the linked official documentation and protocol
sources. Some dynamic provider tables and Blockchair documentation were not
readable; their contents were not fabricated. This documentation-only change
has no application tests or live-provider success claim.
