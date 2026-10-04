## ADDED Requirements

### Requirement: PRC-1 Market catalog and keyless providers
The system SHALL price a fixed catalog of market assets in USD: BTC (Kraken `XBTUSD`,
CoinGecko `bitcoin`), ETH (`ETHUSD`, `ethereum`), SOL (`SOLUSD`, `solana`), ZEC
(`ZECUSD`, `zcash`), TRX (`TRXUSD`, `tron`), XLM (`XLMUSD`, `stellar`), USDT
(`USDTUSD`, `tether`) and USDC (`USDCUSD`, `usd-coin`). It SHALL read Kraken's public
`GET /0/public/OHLC` (no key) and CoinGecko's `GET /api/v3/simple/price` (no key; the
free Demo key header `x-cg-demo-api-key` only when `COINGECKO_DEMO_API_KEY` is set).
A Kraken price SHALL be the close of the latest closed candle and its observed instant
the candle's close; a CoinGecko price SHALL carry the provider's `last_updated_at`.
A response with a non-200 status, a Kraken `error` entry, a non-positive or
non-numeric price or an impossible timestamp SHALL be a provider failure (`rate_limited`
for HTTP 429, else `unavailable` or `invalid_response`), never a stored price.

#### Scenario: PRC-PARSE Provider answers become exact observations
- **GIVEN** Kraken hourly candles whose last entry is the current open candle and CoinGecko prices with `last_updated_at`
- **WHEN** each client reads them
- **THEN** Kraken yields the previous candle's close with observed instant open + 1 hour, the open candle is ignored, CoinGecko yields each requested id's USD price at its `last_updated_at`, ids it omits are reported missing, and malformed, negative or rate-limited answers yield a failure reason and no price.

### Requirement: PRC-2 Hourly collection alternates providers with failover
When `PRICE_COLLECTION_ENABLED` is `true` the system SHALL run one collection per UTC
hour, no earlier than five minutes past the hour, and at most one at a time across
processes (whether the hour is due is decided while holding the collector's lock). The primary provider SHALL be Kraken in even UTC hours and CoinGecko in odd UTC
hours. Every catalog asset the primary does not deliver (whole failure or missing
asset) SHALL be asked from the other provider in the same run. Each provider asked
SHALL update its own sync source; a provider that is not asked keeps its state. When
the switch is unset or `false`, no provider SHALL be called.

#### Scenario: PRC-HOURLY Stored and shown
- **GIVEN** BTC in the catalog and a stubbed Kraken whose last closed hourly BTC candle closes at 84945 USD
- **WHEN** the collection runs in an even UTC hour
- **THEN** one observation (BTC, 84945, USD, the candle's close instant, source `kraken`) is stored, and `GET /prices` shows BTC at 84945 with status `fresh`.

#### Scenario: PRC-FALLBACK Primary fails, the other provider answers
- **GIVEN** Kraken is primary this hour and answers HTTP 500
- **WHEN** the collection runs
- **THEN** CoinGecko is asked, its prices are stored with source `coingecko`, `prices:kraken` is `failed` with error `unavailable` and a readable message, `prices:coingecko` is `synced`, and the assets are `fresh`.

#### Scenario: PRC-ALTERNATE Odd hours start with CoinGecko
- **GIVEN** both providers healthy
- **WHEN** the collection runs in an odd UTC hour
- **THEN** only CoinGecko is asked and every catalog asset it returns is stored with source `coingecko`; an asset it omits is asked from Kraken.

#### Scenario: PRC-OFF Disabled by default
- **GIVEN** `PRICE_COLLECTION_ENABLED` is unset
- **WHEN** the scheduled tick fires
- **THEN** no provider request is made and no row is written.

### Requirement: PRC-3 Append-only idempotent storage
`price_observations` SHALL be unique per asset, quote currency, source, kind and
observed instant (a daily close and an hourly close may share an instant), store the price as an exact positive decimal with its fetch time and kind
(`hourly-close`, `spot`, `daily-close`), and reject every UPDATE and DELETE in the
database. Replaying the same provider answer SHALL add nothing.

#### Scenario: PRC-IDEMPOTENT Same answer twice
- **GIVEN** the same provider answer
- **WHEN** the collection runs twice
- **THEN** exactly one observation per asset exists and the stored rows are unchanged.

#### Scenario: PRC-APPEND-ONLY Observations are never changed
- **GIVEN** stored observations
- **WHEN** any SQL UPDATE or DELETE targets them
- **THEN** the database refuses it and the rows are unchanged.

### Requirement: PRC-4 Daily backfill from 2025-01-01
Until the backfill source has succeeded once, each collection run SHALL first read
Kraken daily candles (`interval=1440`) for every catalog asset from 2025-01-01 and
store each closed candle as a `daily-close` observation at its close instant
(open + 1 day). Assets whose request fails SHALL be retried in the next run while the
stored ones stay; the backfill becomes `synced` once every asset succeeded and is not
repeated afterwards.

#### Scenario: PRC-BACKFILL History since 2025-01-01, once
- **GIVEN** a fresh database and Kraken daily candles from 2025-01-01 to today
- **WHEN** the collection runs, then runs again
- **THEN** the first run stores one `daily-close` observation per closed day per asset (the first at 2025-01-02T00:00Z), skips the open day, sets `prices:backfill` to `synced`, and the second run requests no daily candles and adds no daily rows.

#### Scenario: PRC-BACKFILL-RETRY A failed asset is retried
- **GIVEN** Kraken fails the daily request for one asset
- **WHEN** the collection runs, then runs again with Kraken healthy
- **THEN** the first run stores the other assets' history and leaves `prices:backfill` `failed` naming the asset, and the second run stores the missing asset's history and becomes `synced` without duplicating rows.

### Requirement: PRC-5 Freshness and sync status
`GET /prices` (owner session required) SHALL list every catalog asset with its latest
observation from any source: price, quote currency, observed instant, source and
status `fresh` (observed at most 2 hours ago), `stale` (older) or `none` (never
observed; price `null`, never 0). It SHALL list each price sync source with state
(`synced`, `syncing`, `delayed`, `failed`), last attempt, last success, error code,
readable message without secrets, and next run. A source left `syncing` for more than
15 minutes SHALL read as `failed` with error `interrupted`.

#### Scenario: PRC-STALE Old and missing prices are not zero
- **GIVEN** a BTC observation from 3 hours ago, a fresh ETH observation and no SOL observation
- **WHEN** the owner reads prices
- **THEN** BTC is `stale` with its stored price, ETH is `fresh` and SOL is `none` with price `null`.

#### Scenario: PRC-SOURCES One failing source does not block another
- **GIVEN** CoinGecko is primary and answers HTTP 429
- **WHEN** the collection runs
- **THEN** `prices:coingecko` is `failed` with `rate_limited`, Kraken delivers and `prices:kraken` is `synced`, and the next run time of both sources is the start of the next UTC hour plus five minutes.

### Requirement: PRC-6 Additive migration
Migration `AddHourlyPrices1790800000000` SHALL only create `price_observations`,
`sync_sources` and the append-only trigger; it SHALL leave every existing table and
row unchanged, and its `down` SHALL refuse without an explicit recovery plan.

#### Scenario: PRC-MIGRATION Existing data untouched
- **GIVEN** a populated database at the previous migration
- **WHEN** the migration CLI runs, then runs again
- **THEN** exactly one migration is applied, then none, existing rows are byte-for-byte unchanged and `down` is refused.
