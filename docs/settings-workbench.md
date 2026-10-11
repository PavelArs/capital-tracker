# Settings workbench

> **Retired screen (M20, 2026-10-08):** `/settings` now opens the new Settings (`/preferences`). The currency visibility list and display rates panel are gone from the interface; their APIs stay until the legacy modules are removed.

**Настройки** keeps three destinations: **Общие**, **Валюты** and
**Курсы для отображения**. The selected section is announced and marked with a
strong border and text weight. Native buttons support ordinary Tab/Enter/Space
navigation; focus stays on the activated button. All sections remain available
on narrow screens.

General settings provide labeled language and theme controls. Their preferences
are stored in this browser. System theme follows the operating-system preference.
The legacy currency section manages visibility of the previous currency list;
it does not configure accounting instruments or report integration health.

**Валюты** offers **Показываемые** and **Скрытые**, with counts from a successfully
loaded pair of stored lists. Switching these controls makes no request. **Обновить
списки** explicitly reloads both lists. Failed reads show a retryable error; previously
loaded rows remain visible with a stale warning. Counts stay unavailable until the
first successful pair rather than claiming an empty catalogue.

**Скрыть CODE** applies only to system records; **Показать CODE** clears the owner's
hidden preference. Neither deletes records or accounting history. An inactive catalogue
record can leave the hidden list without becoming an active visible currency. Catalogue
activation, accounting availability and network support are separate concepts.

While a command is pending, row actions and refresh are disabled. Rows move only after
both lists are read successfully. If delivery fails, reload explicitly before another
command; the server may already have saved the preference. The browser never replays it
automatically. Leaving and returning waits for the previous client command to settle,
then reads fresh lists. This is browser request ordering, not a server transaction lock
or a guarantee that a timed-out server operation can never commit later.

Native **Реквизиты CODE** details expose the complete stored UUID and contract (or an
explicit missing-contract label). These are catalogue evidence, not verified network
support. Wide tables scroll inside named keyboard-focusable regions; filters, actions
and disclosures support keyboard navigation. No provider collection occurs here.

The FX workbench separates calculation from collection. Enter an exact nonnegative
USD decimal using a point; explicit zero is valid. **Рассчитать по сохранённым
курсам** and **Обновить из базы** read stored observations. **Получить свежие курсы**
is a separate explicit provider action subject to the existing collection limits.
Changing the amount clears the previous result without requesting the provider.

Freshness and failed-collection notices stay visible. The exact EUR/RUB table
precedes publication/fetch/update timestamps; on narrow screens it scrolls inside
its named keyboard-focusable region. Attribution remains visible. Conversion is
indicative and does not change USD accounting or supply historical transaction FX.

Opening the FX section reads the saved result for USD1. Switching to another
section closes the converter; returning starts it again at USD1. Activating its
already-selected button keeps the mounted converter. This preserves the existing
section lifecycle rather than adding cross-section draft persistence.

See the [verification record](../openspec/changes/archive/2026-09-27-redesign-settings-workbench/verification.md)
for the scoped real HTTPS/MFA/PostgreSQL journey and independent review. This slice
does not complete broader integration health or the whole frontend redesign.

Currency visibility has its own [verification record](../openspec/changes/archive/2026-09-27-redesign-currency-visibility/verification.md)
and [independent review](../openspec/changes/archive/2026-09-27-redesign-currency-visibility/review.md).
