# Linked TWR product visual review — 2026-09-27

Verdict: no blocking visual finding in the inspected linked-TWR states.

Role: I authored the PROFIT-UI/LATE and LTWR-UI test extensions and shared capture helper (74f464c, header followup b8a229a). I did not author the product. This is a separate visual review of root/Luna's product candidate bcb9699b239a7e204f7ab09c8339a03dbc33b85e. It does not claim independent review of my own tests. The separate gate_acceptance reviewer owns source/oracle review and profit visuals. No product edits or Docker commands were performed here.

Root supplied frontend candidate image sha256:78436d00c6a36f0109abe0505dbff20fc21d8fe67642cc605b79d3dc51b3fa41. I inspected the actual runtime viewport PNG files with view_image, using the worktree test-results files as they appeared. The source read of LinkedTwr/PeriodProfit.css was limited context for interpreting the visuals, not a separate full controller review.

## Exact evidence inspected

Directory: /Users/pavelars/Projects/temp/capital-tracker-period-workbench/test-results/linked-twr-preview-LTWR-UI-f597f-ses-stale-plans-and-replies-chromium/

All22 linked-review-*.png viewport frames were viewed individually across light/dark ×360/768/1440:
- Target1: manual period and opening/closing values1000/2310 —8frames (two360segments per theme; one768/1440segment per theme).
- Target2: mounted linked editor with real boundary plan revision1, exact intermediate value1100 and checked explicit review —6frames (one per theme/width).
- Target3: actual linked result and opened journal/boundary evidence —8frames (two360segments per theme; one768/1440segment per theme).

All images are actual1000px-high viewport screenshots, not element clips, masks, resized mockups or hidden-skip-link compositions. The second360result segment is visually redundant because document-end scroll clamping produces the same view; it was inspected and counted as an artifact, not extra state coverage.

## Findings

No blocking overlap, visual page overflow, clipped primary metric, unreadable text, obscured action or broken mobile grouping was found in the inspected frames. Manual input dates/values are visible at all widths. On360the guidance and labels wrap within the card, the boundary date label remains complete, and the checked review stays beside its text. Load/calculate actions fit and appear comfortably usable. At768/1440manual inputs use two columns and the linked editor remains readable.

Linked result leads with the exact21percent value labeled TWR, % за период. Profit310USD remains separate and visible. The complete selected interval, manual valuation/unreconciled/temporary scope, period-only/nonforecast/rounding caveats and opened revision1/coverage evidence are readable. Native summary markers remain visible. The boundary table shows the exact flow1000 and before1100/after2100 at wider widths. At360its right-hand columns are intentionally inside the contained horizontal region; the viewport image does not independently prove keyboard reachability, which is exercised by acceptance assertions. The table region's focus outline is visibly clear in both themes.

The linked disclosure is open in these reviewed result captures. Collapse/reopen retention, closed-state valuation edits, missing-value/unavailable/error states, late/stale invalidation, financial/provider/admission preservation and exact backend economics are runtime/source oracles, not facts inferable from static images. They remain the separate gate review's scope. Profit/header/method and endpoint XIRR/TWR visual review are not claimed here.

## Runtime evidence and limits

I observed the final /private/tmp/capital-period-workbench-green.log summary:4passed51.7s, with LTWR-UI14.7s, PROFIT-UI/LATE13.1s, TWR-UI11.7s and XIRR-UI/LATE11.5s. Root separately confirmed terminal session39428exit0 with cleanup complete and the same FE78436d00 candidate. This is observed root-run evidence; I did not run Docker/runtime myself. The visual verdict remains bounded to the captured linked states.

No manual browser interaction, screen-reader/zoom audit, full backend/E2E run, live provider verification, production deployment or owner-preview change was performed by this reviewer. Approval is bounded to the22captured linked product viewport frames and their visible layout/readability.
