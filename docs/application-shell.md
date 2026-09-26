# Application navigation

Status: the first frontend redesign slice is implemented in active OpenSpec change
`redesign-application-shell`. Scoped runtime checks pass; independent review and
archive remain pending. The complete frontend redesign and owner visual review are
still required. The saved local preview has not been updated to this candidate.

After password and MFA, the working entry is **Ручные счета**. It lists real manual
accounts; selected-account valuation is not whole-portfolio/cash/provider coverage.
Existing account URLs and editors remain available with their established exact
amounts, correction/void protections and explicit recovery behavior.

On desktop, use the left navigation. On compact screens, **Меню** opens the same
destinations in the page flow. The current section is highlighted. Escape closes an
open menu and returns focus to its button; following a destination closes the menu.
Keyboard users can use **К содержимому** to jump to the main content. Opening the menu
or resizing the viewport does not remount an entered operation or submit it.

**Прежние данные** contains the old overview, assets and crypto wallets. The overview
now lives at `/legacy-overview` and visibly excludes manual accounts. Existing legacy
data remains intact; retired liability URLs still show their existing notice.
**Выход** retains real server-side session revocation. Light/dark/system preferences
remain in Settings; password, authenticator and recovery behavior is unchanged.

This slice replaces only navigation, entry and login presentation. The next active
[directory slice](account-directory.md) now leads with saved accounts and exposes
creation/valuation on demand. Long operation editors, valuation/performance screens
and settings still need the workflow redesign in [the backlog](frontend-redesign-plan.md). See the
[verification record](../openspec/changes/redesign-application-shell/verification.md)
for actual RED/GREEN, images, screenshots, unrun checks and review blocker.
