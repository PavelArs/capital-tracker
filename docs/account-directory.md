# Manual-account directory

> **Screen removed (G1, 2026-10-10).** The Russian browser screen this page describes was removed
> from the application. Accounts are made in Add asset and Add wallet, trades are added in Add
> transaction and the price of a hand-valued asset is changed on its asset page. The wording
> about screens below is historical; the data and API rules still describe the stored records.


Status: `redesign-account-directory` passed independent review and scoped verification
and was archived on 2026-09-26. This is one part of the frontend redesign. The preserved local preview has not yet been updated.

**Ручные счета** now opens with the saved-account list. **Показано счетов** counts only
loaded rows; use **Показать еще счета** when more are available. Account names and
revision metadata remain visible, with their existing detail links.

**Новый счет** opens the creation form and focuses its name. **Закрыть форму** or Escape
hides it and returns focus without discarding the entered name or retry identity. If
a create response is lost, explicitly submitting the unchanged name uses the same
request ID. Successful creation closes the form and leaves a link to the new account,
even if it is outside the currently loaded catalog page. Collapsing does not submit
or cancel an operation; a full page departure/reload is not durable draft storage.

**Оценить выбранные счета** opens the existing selected-account valuation. Closing it
keeps selected accounts, UTC time and result; it sends no new request. Existing exact
prices, unknown-versus-zero distinctions, coverage gaps and manual-subset caveats
remain. This is not the value of all holdings or cash.

Account details, operation editors, chart periods and the remaining screens still
need the [planned redesign](frontend-redesign-plan.md). Actual tests, images,
screenshots and unrun/review gates are in the
[verification record](../openspec/changes/archive/2026-09-26-redesign-account-directory/verification.md).
