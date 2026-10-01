# Manual price editor product visual review — 2026-09-27

Verdict: no blocking visual finding in the six inspected editor viewport frames.

## Role and candidate

I authored the PRICE-UI/PRICE-RECOVERY test extension9263a91. I did not author the product. This is a separate bounded visual review of root/Luna's product candidate366b1b3cd1b334e4fd615c92abac8e02713c666a. It does not claim independent review of my own tests or a full controller/oracle review. The gate reviewer owns source/oracle and header/book/history review. No product edits or Docker commands were performed here.

Root supplied frontend image sha256:0ffbe36b31fa94fe3a8e931b2f6bdd4e53f2065916d12069ffb75245d6a26c3f. I read the final editor markup only as context for interpreting the captures and viewed the actual runtime PNG files individually with view_image.

## Exact visual scope

Directory: /Users/pavelars/Projects/temp/capital-tracker-price-workbench/test-results/manual-usd-prices-PRICE-UI-a19ff-ores-a-late-instrument-read-chromium/

All6 manual-price-editor-*.png files inspected:
- manual-price-editor-light-360-1.png
- manual-price-editor-light-768-1.png
- manual-price-editor-light-1440-1.png
- manual-price-editor-dark-360-1.png
- manual-price-editor-dark-768-1.png
- manual-price-editor-dark-1440-1.png

Each is an actual1000px-high page viewport screenshot, not an element clip or masked mockup. The inspected state has the exact unsaved price draft115, full observedAt2025-01-02T00:00:00.000Z, unchecked explicit review and saved-book revision2/history110/100 below it. The editor is visibly placed ahead of the saved book. Incidental book/history content in these viewport frames was not a replacement for the separate gate review's assigned scope.

## Findings

No blocking editor overlap, page-edge overflow, clipped input value, unreadable field guidance or obscured action was found. On360the date and price fields form one column, both exact values fit, the review text wraps beside its compact checkbox, and Save/History actions stay within the card. At768/1440the date/price fields share two columns with supporting text directly below the corresponding field. Card spacing and heading hierarchy remain clear in both themes.

The visible date guidance explains explicit timezone/Z/UTC and offset+03:00. The price guidance identifies an exact nonnegative USD unit price, decimal point, explicit zero distinct from missing data and storage without rounding. Disabled Save is distinguishable from enabled History while review is unchecked. Text and boundaries are readable in light/dark captures. Main controls appear appropriately sized; precise44px/no-page-overflow and keyboard behavior are acceptance measurements, not independently proven by static images.

## Runtime evidence and limits

Observed /private/tmp/capital-price-workbench-green.log reports PRICE-UI/PRICE-RECOVERY passed16.1s and the final test summary1passed16.7s. This is observed root-run runtime evidence, not a self-run Docker result or a claim about all suites.

These six frames cover the normal filled editor after exclusion cancellation and delayed-history review. No separate staged-void, unknown-delivery, accepted-refresh, zero-price, empty/error or expanded-rules screenshot was assigned to or visually reviewed here. Their financial/recovery/late-focus behavior belongs to the preserved runtime/source checks and separate gate review. No browser interaction, screen-reader/zoom audit, live provider check, full E2E/backend suite, production deployment or owner-preview change was performed by this reviewer.
