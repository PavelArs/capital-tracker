# Critical release acceptance coverage

The shortened profile is an owner-authorized real acceptance path for the manual +
CSV release. It is intended to preserve the highest-risk finance and authentication
journeys while keeping the existing full regression suite available. The reviewed
source inventory at `/private/tmp/capital-critical-profile-inventory.md` maps the
browser candidates and real PostgreSQL probes; it is planning evidence only. The
implementation, CI wiring, 20-case manifest and receipt contract are source-complete
at `0823122ec202f7fd69e3bb89711200a6214b1949` and independently approved; 196 Jest
checks and four Node acceptance checks passed. The hosted/runtime profile remains
unrun, so this document reports no release acceptance pass.

## Browser journeys selected

The reviewed selection contains 22 manifest entries: the original 19 browser cases,
CSV-006-B session-renewal recovery, since 2026-10-03 ADDR-UI wallet-address import and,
since 2026-10-04, PORTFOLIO-UI whole-portfolio valuation. Each entry may cover more than one scenario ID; these are
browser journeys over the actual frontend, proxy, backend and isolated PostgreSQL,
using synthetic owner data and provider fixtures.

| Scenario IDs | Critical assertion retained |
|---|---|
| MFA-002-A/B | Password alone leaves private data denied; TOTP plus CSRF establishes the owner session. |
| SES-001-B | Logout revokes a copied session credential and replay fails. |
| SES-002-A | Missing CSRF or foreign Origin cannot read owner currencies or change preferences. |
| OPEN-001-A / OPEN-002-A | Opening amounts preserve the distinction between unknown and zero cost across restart/history. |
| TRADE-003-A / TRADE-006-A | FIFO proceeds, cost and profit stay exact; pending edits lock; restart and correction history remain consistent. |
| SWAP-UI | A committed exchange survives lost response and SPA remount without duplicate posting. |
| REWARD-UI | Unknown basis and zero remain distinct; category and receipt-bound retry intent persist. |
| TRANSFER-UI | Review, retry, correction and terminal void preserve transfer receipts and basis. |
| CSV-006-A | Sale-first import preserves FIFO/provenance and replay safety; whole-batch rollback works. |
| FLOW-004-A | Flow initialization, contribution, correction and review remain distinct from trades. |
| PRICE-UI / PRICE-RECOVERY | Price retry preserves a committed command; late responses cannot overwrite newer state. |
| VAL-UI | Account totals remain exact and refresh/late replies preserve the trade draft. |
| VCH-UI | Empty and zero chart history render correctly; late period replies do not lose drafts or show stale data. |
| MPV-UI | Selected portfolio totals and missing-price gaps are accurate; stale replies are ignored. |
| PROFIT-UI / PROFIT-LATE | Profit preview stays tied to reviewed inputs after edits, errors and delayed replies. |
| XIRR-UI / XIRR-LATE | Available/unavailable rates stay tied to reviewed inputs. |
| TWR-UI | Return handles missing flow valuation and invalidates delayed stale results. |
| SHELL-UI | Owner MFA login/logout, responsive keyboard access and honest legacy scope. |
| CSV-006-B | A committed CSV confirm survives session expiry, 401, MFA reauthentication and SPA return without duplicate posting. |
| ADDR-UI / ADDR-PRIVATE | Bitcoin address history imports through the Esplora fixture in three pages; anonymous, missing-CSRF and foreign requests are denied; every USD value is shown as missing, never zero. |
| PORTFOLIO-UI | Whole-portfolio value, average buy price, cost basis, unrealized and realized P&L and allocation come from real accounts and a stored price; anonymous and query-carrying reads are refused. |

The separate inventory identifies additional browser coverage not selected here:
two-replica competing-sale/initialization journeys, browser-visible persistent lockout
and expiry, and safe HTTPS 500 presentation for deferred opening rollback. Their core
database invariants remain in real PostgreSQL probes; the additional browser layer
covers replica/HTTPS/SPA presentation behavior. This is a narrower browser set, not a
claim that those broader tests are absent or previously passed.

An independent source review inspected handlers for the 19 selected entries and
CSV-006-B. It found only unchanged `route.fetch` responses or browser delivery loss
after a real backend response, with no synthetic own-backend or authentication
decision in those inspected handlers. This is a bounded source audit, not a blanket
claim about every test file, nor execution evidence.

## Acceptance gates outside the browser selection

The browser profile is not a substitute for the existing real PostgreSQL acceptance
probes. The runner must retain the populated migration and auth-limit fixtures,
`manual-opening-db`, `usd-trades-db`, `csv-import-db`, `mfa-db` and other applicable
domain PostgreSQL probes, migration checks, seed/readiness checks and startup refusal
checks. These exercise persistence, concurrency, rollback and authentication state at
the database/service boundary. Synthetic external provider fixtures and the real
transport/TLS checks remain part of acceptance; external providers themselves are not
live-tested.

CLI MFA/session checks and release-artifact/network/image checks also remain mandatory.
They verify actual command behavior and the built delivery boundary, respectively.
The command is `pnpm test:e2e:critical`; it writes
`test-results/critical-release-acceptance.json`. The candidate-bound receipt records schema
version, profile, commit, CI run ID, manifest SHA-256, and each selected file/title
with its passed status. CI verifies the receipt against the exact source, run and
manifest and requires the named critical gate before candidate export/promotion.
Receipt verification proves the selected browser cases ran and passed; it does not
by itself prove the separate database/provider/CLI/artifact runner gates or
backup/restore and server gates passed. Runtime execution remains unrun.

The full `pnpm test:e2e` suite and all existing test files remain available for broad
regression and the full release profile. The historical full-suite count is 174 test
cases; a shortened-profile pass does not claim those 174 passed. Cleanup of redundant
coverage remains separate work and must preserve meaningful assertions before any
later removal.

Encrypted backup/restore is a separate release gate, not part of the acceptance
runner. `scripts/manual-mvp-release.sh` performs encrypted database backup, isolated
disconnected restore and fingerprint comparison. Off-host custody/key recovery and
the real-server restore/deployment checks remain separate operational evidence.

## Evidence status

This map is source-planning documentation. It records no new runtime result, CI pass,
candidate artifact, promotion or deployment. Consult
[`docs/deployment-security-verification.md`](deployment-security-verification.md)
for the current release checkpoint and required host/backup gates.
