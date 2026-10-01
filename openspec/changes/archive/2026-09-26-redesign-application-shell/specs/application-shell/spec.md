## ADDED Requirements

### Requirement: SHELL-001 Honest accounting entry and grouped navigation
After full owner authentication, the private root SHALL open the existing manual
accounts screen. The application SHALL distinguish current accounting destinations
from legacy views without changing financial APIs, data or exact accounting. Existing
account/editor URLs SHALL remain usable. The legacy dashboard SHALL remain available
at `/legacy-overview` with an explicit scope notice, separate from current accounting.

#### Scenario: SHELL-001-A Working entry and preserved legacy access
- **GIVEN** actual password and second-factor authentication
- **WHEN** the owner opens `/` or completes login
- **THEN** the manual accounts page opens with its real saved accounts and manual/selected scope
- **AND** navigation exposes manual accounts, owned transfers, external flows, manual prices, period profit and settings
- **WHEN** the owner expands “Прежние данные” and opens the old overview
- **THEN** the old view remains accessible with a visible notice that it excludes manual-journal portfolio valuation
- **AND** legacy assets/wallets remain accessible without restoring retired liabilities navigation

### Requirement: SHELL-002 Responsive and keyboard-accessible navigation
The shared shell SHALL provide a named navigation landmark, active-destination
indication with aria-current, a keyboard skip link to main content and a labelled
mobile menu button with accurate expanded/controlled state. At360,768 and1440px
widths shell controls SHALL fit without page-level horizontal overflow. Hidden
navigation SHALL not be keyboard reachable. Decorative navigation motion SHALL be
absent; reduced-motion preferences SHALL be respected.

#### Scenario: SHELL-002-A Narrow navigation and focus
- **GIVEN** a full owner session at360px or768px width
- **WHEN** the owner opens navigation using the keyboard
- **THEN** current accounting destinations and logout are reachable and the menu reports its open state
- **WHEN** Escape closes navigation
- **THEN** focus returns to the toggle and hidden links leave the tab sequence
- **WHEN** the owner follows an account link
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
