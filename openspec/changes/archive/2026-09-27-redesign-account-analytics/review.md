# Account analytics independent review

Status: approved within the bounded change; no remaining blocking findings.
The whole redesign and owner visual approval remain open.

## Source and acceptance

A separate gate reviewer, author of neither implementation nor acceptance, reviewed
47c78f5 and its predecessors: original account keys, four controllers,27protected
control/child/chart signatures, exact rendered financial fields and chart transforms/
options remain. Selection keeps owners mounted, uses hidden panels and issues no
requests. Scope, incomplete totals, known zero, unknown prices and provenance survive.

The reviewer inspected original and corrected acceptance diffs. Bulk catalogue setup
uses actual isolated PostgreSQL INSERT/RETURNING with canonical payload and real
readInstrument validation. Financial setup still uses authenticated API; original
50+1UUID pagination, four history reads, no financial writes, fingerprints, admissions
and85call safety ceiling remain. The keyboard helper sends trusted Chromium protocol
keyDown/keyUp for Russian native type-ahead, then detaches; no DOM dispatch or fake
API/auth response. This does not establish macOS popup-arrow or cross-browser support.
Root separately demonstrated the initial expected RED, investigated actual failures,
and ran the corrected application through HTTPS/password/MFA/backend/PostgreSQL.

## Actual visual evidence

Artifacts: `/private/tmp/capital-analytics-workbench-final-artifacts`.
All38final PNGs were inspected individually in separate product-review contexts:

- Gate reviewer:14history frames,7light/7dark;6at360x900,4at768x900,4at1440x900.
  Pattern `valuation-history-*/analytics-history-{theme}-{width}-{segment}.png`.
- Sol acceptance author, not product TSX/CSS author:24accounting/valuation frames,
  each tool has12:both themes at360/768/1440x900, two segments per state.
  Patterns `historical-accounting-jour-*/analytics-accounting-*` and
  `historical-valuation-*/analytics-valuation-*`.

First-run38frames exposed faint dark-chart labels/grid; root6c06299 supplied a scoped
light plot surface. Final14history frames confirm resolved contrast, readable axes/
legend/points/table, controls and provenance, with no new blocker. All24other final
frames show legible guidance, actions, focus and contained horizontal tables. Incomplete
valuation keeps total unavailable distinct from priced subtotal150 and absent price
separate from real price300/value150. Accounting exact quantities/costs and zero totals
remain clear; secondary identity/revision/coverage follows useful results.

Nonblocking cosmetics: mobile chart legend truncation (meaning remains in visible
scope and exact table) and some within-word table-header wrapping. These are recorded
for whole-screen polish, not silent scope completion. Maximum-period expansion remains
explicitly deferred for the owner. No extra animation or provider access added.

Captures cover loaded accounting, incomplete valuation and sampled history with
method disclosures closed. They do not separately show refreshed known-zero valuation,
expanded methods or horizontally scrolled-right mobile cells; those have actual runtime
assertions. This is scoped Chromium/product review, not a full accessibility audit,
whole-redesign acceptance, owner UX approval or release/security certification.

The gate reviewer read final terminal evidence:5/5PASS1.2m followed by completed
synthetic cleanup. See verification.md for actual failed attempts, images, local gates
and unrun scope. No remaining bounded-scope blocker before archive/integration.
