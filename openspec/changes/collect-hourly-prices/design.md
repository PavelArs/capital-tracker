## Context

Owner decisions (2026-10-04, `docs/product-requirements.md` Q3, Q4, Q7): prices come
from both Kraken and CoinGecko free public APIs, alternating, with failover; history
from 2025-01-01 is backfilled from Kraken daily candles because free CoinGecko history
reaches back only 365 days and its terms limit long storage; tokens in the MVP are
USDT and USDC only; no paid services. The owner holds BTC, ETH, SOL, ZEC, TRX, XLM,
USDT, USDC and RUB cash. RUB and other fiat rates come from the Bank of Russia in M5.

## Decisions

### Observations are keyed by a market code, not by an accounting instrument
`accounting_instruments` rows belong to an owner and their `symbol` is optional and not
unique, while a market price is a property of the market asset. Observations are
therefore keyed by a catalog code (`BTC`, …). Change M2 gives an instrument its price
source and provider reference; that reference is the catalog code, and M4 joins on it.
This keeps M3 independent of M2's schema and lets prices exist before the owner has
an instrument for the asset.

### Catalog in code
The eight MVP assets and their provider identifiers live in `price-catalog.ts`. A new
asset is a one-line code change reviewed with its provider ids; nothing about the
table schema depends on the catalog. Live checks against Kraken and CoinGecko were
not possible from the build sandbox (its egress proxy refuses both hosts); the pairs
and ids follow the providers' published documentation and are listed in the PR.

### Kraken hourly candle instead of the ticker
Kraken's ticker has no timestamp. The last closed hourly OHLC candle gives a provider
instant (its close), makes a replay naturally idempotent and uses the same endpoint
and parser as the daily backfill. The job runs a few minutes after the hour, so the
price is at most about an hour old, well inside the 2 hour freshness window. Kraken
returns at most the 720 most recent candles whatever `since` says; for daily candles
that reaches back to 2025-01-01 until about 2026-12-21. A backfill run later would
start at the oldest candle Kraken still returns; this is recorded rather than worked
around.

### CoinGecko keyless with optional free Demo key
`simple/price` works without a key at a low public rate; one request per hour is far
below it. When `COINGECKO_DEMO_API_KEY` (free) is set it is sent as
`x-cg-demo-api-key`. The key is never logged or stored in sync status. CoinGecko is
never used for the backfill, and observations keep `source` so a later retention
decision can act on CoinGecko rows only.

### Alternation and failover
Primary provider = Kraken when `floor(epoch hours)` is even, else CoinGecko. Assets the
primary does not deliver go to the secondary in the same run. The planner
(`gatherQuotes`) is a pure function over provider interfaces, unit-tested with fake
providers; the service persists its result in one transaction.

### Schedule and switch
Production runs with `BACKGROUND_JOBS_ENABLED=false` (checked by the release and resume
scripts), which disables `@Cron` jobs. The service therefore uses a 5-minute
`@Interval` tick (intervals stay enabled) that does nothing unless
`PRICE_COLLECTION_ENABLED=true`. A run is due when no price source was attempted in the
current UTC hour. A PostgreSQL session advisory lock on a dedicated connection keeps
one run at a time across processes. Provider calls happen outside database
transactions; all writes of a run happen in one transaction afterwards.

Turning collection on in production needs the variable in the server environment and
in the release/resume scripts' exact environment key list. Those deploy files are
also changed by the frozen PR #33, so that step is separate and owner-approved.

### Storage
- `price_observations`: primary key (`asset`, `quoteCurrency`, `source`, `observedAt`),
  `price numeric(78,30) > 0`, `kind` in (`hourly-close`, `spot`, `daily-close`),
  `fetchedAt`. Inserts use `ON CONFLICT DO NOTHING`. A trigger rejects UPDATE and
  DELETE so history is append-only in the database, not only in code. An index on
  (`asset`, `quoteCurrency`, `observedAt` DESC) serves "latest at or before t".
- `sync_sources`: `key` primary key matching `^(prices|fx|wallet):[a-z0-9-]{1,64}$`,
  `state` in (`synced`, `syncing`, `delayed`, `failed`), timestamps, `errorCode`
  (`^[a-z_]{1,40}$`), `errorMessage` up to 300 characters. Messages are composed by the
  app from fixed texts and asset codes, never from provider bodies or headers.
- Prices are global market data, not owner data, so neither table has an owner column.

## Risks / Trade-offs

- Provider answers are trusted only within strict parsing: exact decimal strings for
  Kraken; CoinGecko JSON numbers are converted with JavaScript's shortest round-trip
  representation (exponent forms are rejected).
- Quota: Kraken 8 requests per hourly run (one pair each, 1.1 s apart) plus 8 once
  for the backfill; CoinGecko one request per run.
- Rollback: the module can be disabled by the switch; `down` refuses because dropping
  observations would lose history that providers may no longer serve.
- Migration timestamp `1790600000000` is reserved in team memory; M2 uses
  `1790500000000`. Whichever change merges second updates the probes' migration counts.
