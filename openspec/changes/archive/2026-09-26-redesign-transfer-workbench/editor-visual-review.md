# Transfer editor screenshot review

Reviewed all 12 supplied screenshots for `OwnedTransfers` editor in `capital-tracker-transfer-workbench` (the transfer editor only). These are post-create blank-editor captures split across two scroll segments; they do not show a populated correction form, review result, recovery state, or error state. No Docker or runtime was used for this review.

## Findings

- No horizontal overflow, clipped controls, or unreadable/wrapped labels at 360, 768, or 1440 px in either theme. On mobile the form stacks into one column; at 768 px, account/amount and time/order groups use two columns; at desktop account selectors fit three columns and the other groups remain aligned. Segment 2 continues the page naturally and shows the saved-transfers section below the editor.
- Amount and fee semantics are legible and adjacent to their inputs: recipient quantity explicitly excludes the separately charged sender fee; zero fee means no fee instrument; fee cost is historical accounting cost rather than market value. In both themes the helper text has sufficient apparent contrast at the supplied resolution.
- The one layout inefficiency is at 1440 px: recipient quantity sits alone in the next row while the remaining row width is blank. This is visually balanced enough and creates no usability defect; a two-column alignment could use the space more evenly if desired.
- Review and submit actions are vertically grouped under “Проверка и запись” and have clear disabled/enabled visual distinction in the blank state. At 360 px, both fit within the card. The saved-transfers heading appearing at the bottom of segment 2 is a viewport boundary, not evidence of content being clipped in the page.
- No material light/dark readability or border separation problems found. In dark mode disabled submit remains distinguishable from the active review button.

## Exact files reviewed

`/private/tmp/capital-transfer-workbench-green-artifacts/owned-transfers-TRANSFER-U-7319a-inal-void-use-real-receipts-chromium/transfer-editor-light-360-1.png`

`/private/tmp/capital-transfer-workbench-green-artifacts/owned-transfers-TRANSFER-U-7319a-inal-void-use-real-receipts-chromium/transfer-editor-light-360-2.png`

`/private/tmp/capital-transfer-workbench-green-artifacts/owned-transfers-TRANSFER-U-7319a-inal-void-use-real-receipts-chromium/transfer-editor-light-768-1.png`

`/private/tmp/capital-transfer-workbench-green-artifacts/owned-transfers-TRANSFER-U-7319a-inal-void-use-real-receipts-chromium/transfer-editor-light-768-2.png`

`/private/tmp/capital-transfer-workbench-green-artifacts/owned-transfers-TRANSFER-U-7319a-inal-void-use-real-receipts-chromium/transfer-editor-light-1440-1.png`

`/private/tmp/capital-transfer-workbench-green-artifacts/owned-transfers-TRANSFER-U-7319a-inal-void-use-real-receipts-chromium/transfer-editor-light-1440-2.png`

`/private/tmp/capital-transfer-workbench-green-artifacts/owned-transfers-TRANSFER-U-7319a-inal-void-use-real-receipts-chromium/transfer-editor-dark-360-1.png`

`/private/tmp/capital-transfer-workbench-green-artifacts/owned-transfers-TRANSFER-U-7319a-inal-void-use-real-receipts-chromium/transfer-editor-dark-360-2.png`

`/private/tmp/capital-transfer-workbench-green-artifacts/owned-transfers-TRANSFER-U-7319a-inal-void-use-real-receipts-chromium/transfer-editor-dark-768-1.png`

`/private/tmp/capital-transfer-workbench-green-artifacts/owned-transfers-TRANSFER-U-7319a-inal-void-use-real-receipts-chromium/transfer-editor-dark-768-2.png`

`/private/tmp/capital-transfer-workbench-green-artifacts/owned-transfers-TRANSFER-U-7319a-inal-void-use-real-receipts-chromium/transfer-editor-dark-1440-1.png`

`/private/tmp/capital-transfer-workbench-green-artifacts/owned-transfers-TRANSFER-U-7319a-inal-void-use-real-receipts-chromium/transfer-editor-dark-1440-2.png`

## Limits

This review assesses only the visible static captures and their viewport segments. The screenshots show a blank create editor after a completed create journey; they do not establish presentation quality for populated account/instrument values, validation, review output, correction/void modes, or recovery/error messages.
