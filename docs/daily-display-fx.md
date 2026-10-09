# Daily USD display conversion

> **Retired (M20):** the display rates panel left with the old Settings screen (2026-10-08), and the
> backend module, its API, collector and `display-fx-db` probe were removed with the other legacy
> modules. The two tables and their rows stay; the JSON backup lists them as not backed up. USD/EUR/RUB
> values now come from Bank of Russia rates (M5). The rest of this page describes the retired feature.

The private Settings panel can convert an entered USD amount to EUR and RUB
using the latest saved daily observation. It is an indicative display only: it
does not change USD trades, account values, profit, or XIRR. It is not a trade
quote or historical exchange rate.

The panel reads only stored data. Opening it or choosing “Рассчитать по сохранённым
курсам” or “Обновить из базы” makes a private read; none calls the provider.
Editing the amount clears the old result and does not itself request data.
“Получить свежие курсы” explicitly requests collection, then reads the saved
observation. When enabled, the scheduled collector uses the same persistent
limits. No collection happens at startup. With no observation, the result is
unavailable; an explicit zero amount or zero converted value remains a valid
value.

Rates come only from the fixed [open.er-api.com daily USD endpoint](https://open.er-api.com/v6/latest/USD).
Each successful response stores one immutable observation batch with its
publication, fetch, next-update and optional end-of-life timestamps. The panel
shows freshness; when a later collection fails, it keeps the last good batch
and marks it stale. It does not backfill older dates or export a general-purpose
rate history. The UI links to the provider as required by its [free-service
documentation](https://www.exchangerate-api.com/docs/free) and [terms](https://www.exchangerate-api.com/terms),
reviewed 2026-09-24. Use is limited to this authenticated owner's conversion.

Collection is opt-in: `DISPLAY_FX_ENABLED=false` and
`DISPLAY_FX_TRUST_PROXY=false` are the defaults. Direct outbound requests use
the fixed provider host and validate DNS destinations used by the connection.
Setting `DISPLAY_FX_TRUST_PROXY=true` delegates destination enforcement and
transport to the configured trusted egress proxy; use it only when that proxy
enforces the required outbound policy. The collector reserves at most three
attempts in a rolling 24-hour period, enforces at least 20 minutes between
attempts, and schedules success no sooner than 24 hours later or the provider's
next-update time. Valid `Retry-After` values can extend a failed attempt's
cooldown. Reservations survive process restarts.

Migration 19 adds the observation and collection tables; it does not rewrite
existing accounting. There is no automatic destructive downgrade or removal.

The [verification record](../openspec/changes/archive/2026-09-24-collect-daily-display-fx/verification.md)
records real fresh/populated PostgreSQL migration, concurrency/failure checks and
three selected HTTPS acceptance cases, all passing. External provider responses
were controlled fixtures; no live-provider success is claimed.

The [Settings workbench](settings-workbench.md) provides labeled preferences,
explicit section selection and separate stored-read/provider-collection areas.
Exact conversion now precedes its timestamp evidence in a contained keyboard
scroll region. Existing freshness, failed-provider and stale-intent behavior remains.
