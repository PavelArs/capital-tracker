# Settings workbench

**Настройки** keeps three destinations: **Общие**, **Валюты** and
**Курсы для отображения**. The selected section is announced and marked with a
strong border and text weight. Native buttons support ordinary Tab/Enter/Space
navigation; focus stays on the activated button. All sections remain available
on narrow screens.

General settings provide labeled language and theme controls. Their preferences
are stored in this browser. System theme follows the operating-system preference.
The legacy currency section manages visibility of the previous currency list;
it does not configure accounting instruments or report integration health.

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
