# application-shell Specification

## Purpose
Provide the responsive English application shell (new sections, Legacy group, theme setting) and honest entry while preserving real authentication, legacy data and operation recovery.
## Requirements
### Requirement: SHELL-001 Honest accounting entry and grouped navigation
After full owner authentication, the private root SHALL open the new Dashboard at
`/dashboard`. The navigation SHALL list the new sections Dashboard, Portfolio,
Transactions, Wallets and Settings first, followed by a group labelled "Legacy" that
holds every current screen with its existing URL and Russian label: manual accounts,
owned transfers, external flows, manual prices, wallet addresses, period profit,
legacy settings, the old overview, legacy assets and legacy crypto wallets. The
change SHALL NOT alter financial APIs, data or exact accounting. Existing
account/editor URLs SHALL remain usable. The legacy dashboard SHALL remain available
at `/legacy-overview` with an explicit scope notice, separate from current accounting.
Retired liabilities SHALL NOT return to navigation.

#### Scenario: SHELL-001-A Working entry and preserved legacy access
- **GIVEN** actual password and second-factor authentication
- **WHEN** the owner completes login or opens `/`
- **THEN** `/dashboard` opens inside the new shell
- **AND** navigation exposes Dashboard, Portfolio, Transactions, Wallets and Settings in that order
- **AND** the open "Legacy" group exposes manual accounts, owned transfers, external flows, manual prices, wallet addresses, period profit, legacy settings, the old overview, assets and crypto wallets under their existing URLs
- **WHEN** the owner opens manual accounts from "Legacy"
- **THEN** the manual accounts page opens with its real saved accounts
- **WHEN** the owner opens the old overview
- **THEN** it remains accessible with a visible notice that it excludes manual-journal portfolio valuation
- **AND** no retired liabilities link is present

### Requirement: SHELL-002 Responsive and keyboard-accessible navigation
The shared shell SHALL provide a navigation landmark named "Main navigation",
active-destination indication with aria-current, a keyboard skip link "Skip to
content" to main content and a mobile menu button "Menu" with accurate
expanded/controlled state. At360,768,1280 and1440px widths shell controls SHALL fit
without page-level horizontal overflow; at1280 and1440px the full sidebar SHALL be
visible without the menu button. Hidden navigation SHALL not be keyboard reachable.
Decorative navigation motion SHALL be absent; reduced-motion preferences SHALL be
respected.

#### Scenario: SHELL-002-A Narrow navigation and focus
- **GIVEN** a full owner session at360px or768px width
- **WHEN** the owner opens navigation using the keyboard
- **THEN** the new sections, the legacy screens and "Log out" are reachable and the menu reports its open state
- **WHEN** Escape closes navigation
- **THEN** focus returns to the toggle and hidden links leave the tab sequence
- **WHEN** the owner follows a link
- **THEN** its destination opens, navigation closes and the active destination is identified

#### Scenario: SHELL-002-B Desktop, exact content and retained drafts
- **GIVEN** the owner has an entered trade draft and a retained ambiguous swap command
- **WHEN** navigation is toggled or viewport width changes between360,768 and1440px
- **THEN** the shell remains usable, exact amounts remain unchanged and no command is submitted automatically
- **AND** the editor is not remounted merely by the shell changes
- **WHEN** the owner navigates away and returns
- **THEN** the established frozen same-request recovery and independent trade-draft behavior remain intact

### Requirement: SHELL-003 Restrained login and private session preservation
Login/password, second-factor/recovery, errors, loading and logout SHALL use clear
Russian controls and consistent restrained styling while preserving real session,
CSRF and MFA behavior. Private shell/account information SHALL remain unavailable
to anonymous and password-only sessions. Theme preferences SHALL remain usable.

#### Scenario: SHELL-003-A Real authentication at compact width
- **GIVEN** an unauthenticated360px browser and real PostgreSQL-backed owner credentials
- **WHEN** it opens a private account URL
- **THEN** it reaches the login surface without private navigation or account data
- **WHEN** only the correct password is entered
- **THEN** the second-factor step remains required and the protected API still denies access
- **WHEN** a valid second factor succeeds and the owner later logs out
- **THEN** the manual-account entry is usable, and logout revokes access through the real API
- **AND** labels, errors and focused controls remain visible without decorative animation or viewport overflow

### Requirement: SHELL-004 Bounded redesign preserves existing data
This shell change SHALL preserve legacy and accounting data, existing backend
security boundaries, exact evidence and explicit retry semantics. It SHALL NOT
claim completion of the entire frontend redesign, full portfolio coverage or owner
visual approval. New browser coverage SHALL focus on navigation/authentication;
arithmetic boundaries SHALL remain on lower test levels.

#### Scenario: SHELL-004-A Retained financial journey
- **WHEN** the selected real swap create/review/lost-response/SPA-retry/correct/void journey runs through the redesigned shell
- **THEN** the same PostgreSQL financial, immutable receipt, stale-review and separate draft assertions pass
- **AND** no own backend or authentication response is mocked, no owner database is reset and no external provider is required by accounting

### Requirement: SHELL-005 New sections with honest placeholders
The shell SHALL route Dashboard to `/dashboard`, Portfolio to `/portfolio`,
Transactions to `/transactions`, Wallets to `/wallets` and Settings to `/preferences`.
Each new section SHALL show its English title as the page heading. Until the change
that builds it ships, Dashboard, Portfolio, Transactions and Wallets SHALL state that
the section is not built yet and link to the legacy screen that holds the same data
(manual accounts for Dashboard, Portfolio and Transactions; wallet addresses for
Wallets). A placeholder SHALL NOT claim the portfolio is empty, show invented
numbers, issue API requests or change data.

#### Scenario: SHELL-005-A Open each new section
- **GIVEN** a full owner session with existing accounts
- **WHEN** the owner opens Dashboard, Portfolio, Transactions and Wallets from the sidebar
- **THEN** each URL matches its section, the section is marked current and its heading is shown
- **AND** each page says it is not built yet and links to its legacy screen, which opens when followed
- **AND** no placeholder says "Your portfolio is empty" and opening placeholders issues no API request

### Requirement: SHELL-006 Theme setting with System default
Settings SHALL offer the theme choices System, Dark and Light as a labelled single
choice. With no stored choice the selection SHALL be System and the applied theme
SHALL follow the device colour scheme, including changes while the app is open.
Choosing Dark or Light SHALL apply that theme immediately regardless of the device,
persist it in this browser and keep it after reload; choosing System again SHALL
return to following the device. Changing the theme SHALL NOT issue API requests or
change financial data.

#### Scenario: SHELL-006-A Follow the device by default
- **GIVEN** a browser with no stored theme and a dark device scheme
- **WHEN** the owner opens Settings
- **THEN** System is selected and the dark theme is applied
- **WHEN** the device scheme changes to light
- **THEN** the light theme is applied without reload

#### Scenario: SHELL-006-B Explicit choice persists
- **GIVEN** System is selected on a light device
- **WHEN** the owner chooses Dark
- **THEN** the dark theme is applied at once and stays applied after reload and after the device scheme changes
- **WHEN** the owner chooses System
- **THEN** the theme follows the device again

### Requirement: SHELL-007 Sync indicator slot
The sidebar SHALL reserve a sync status area above the owner block. Until background
synchronization exists it SHALL state that automatic sync is not set up yet; it SHALL
NOT claim that prices or wallets are synced.

#### Scenario: SHELL-007-A Honest sync slot
- **GIVEN** a full owner session
- **WHEN** the sidebar is shown at1440px
- **THEN** the sync area reads "Sync not set up" and does not claim prices or wallets are synced

