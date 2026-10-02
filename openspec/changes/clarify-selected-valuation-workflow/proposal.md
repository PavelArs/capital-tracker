# Clarify the selected valuation workflow

## Why

The selected manual valuation currently presents its calculation method as a long paragraph and places its wide evidence tables in anonymous scroll containers. This makes the result scope and keyboard scrolling harder to understand.

## What changes

- Keep a concise, honest selected-manual scope warning beside the result and move method detail into a native disclosure.
- Give each result table a named, keyboard-focusable horizontal scroll region with visible focus and a mobile cue.
- Preserve exact values, existing table labels, row headers, and the current request and invalidation behavior.

## Scope

Presentation-only changes in `ManualPortfolioValuation`. No directory, shell, API, accounting, selection, or state-function changes. No extra request on disclosure interaction.
