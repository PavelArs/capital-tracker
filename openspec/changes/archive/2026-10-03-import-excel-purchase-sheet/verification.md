# Verification — import-excel-purchase-sheet

Status: verified and archived. Hosted CI run 37150307665 on `8e27413` is green: critical
acceptance (21 cases including SHEET-UI, plus the `excel-purchase-import-db.cjs` probe) and
the exact-image security gate.

Environment of local runs: cloud sandbox, Node 22.22.0, pnpm 10.33.0, a throwaway
PostgreSQL 16.14 cluster (CI uses the pinned PostgreSQL 18 image). Docker and Playwright
browsers cannot run here (sandbox TLS proxy), so no browser case ran locally.

## RED (before behavior changes)

| Check | Result |
| --- | --- |
| `backend: jest csv-sheet.spec.ts csv-reconciliation.spec.ts` | 9 failed, 1 passed. Sheet settings refused with `BadRequestException: Invalid CSV input`; reconciliation skeleton returned empty results. SHEET-EXPLICIT passed already (it asserts refusals that predate the change). |
| `frontend: vitest CsvSheet.test.tsx` | 4 failed: no «Заполнить по таблице покупок» button; `csvSettings` demanded fee and order columns; empty reference columns; no reconciliation table. |
| `tests/e2e/excel-purchase-import-db.cjs` on the pre-change build | FAIL at SHEET-SAMPLE: preview of the sheet settings returned 400 `Invalid CSV input`. |

## GREEN (local)

| Check | Result |
| --- | --- |
| `tests/e2e/excel-purchase-import-db.cjs` (compiled services, real PostgreSQL 16) | PASS all stages: SHEET-SAMPLE, SHEET-SAME-DAY, SHEET-INVALID/EXPLICIT, SHEET-DUPLICATE, SHEET-RECON-SAMPLE, SHEET-RECON-MISMATCH, SHEET-RECON-STATE |
| `tests/e2e/csv-import-db.cjs` (existing CSV characterization, incl. exact v1 preview hash and command payload) | Same as on unchanged `main` in this sandbox: every stage up to CSV-005-A/B passes; both fail at `CSV-007-A referenced account_csv_imports deletion RESTRICT refusal`, a PostgreSQL 16 sandbox difference also seen for other probes on `main`. Not caused by this change; hosted CI runs it on PostgreSQL 18. |
| `pnpm --dir backend test --runInBand` | 60 suites, 1575 tests passed |
| `pnpm --dir frontend test` | 26 files, 133 tests passed |
| `pnpm --dir backend lint` / `pnpm --dir frontend lint` | OK, 77 / 27 existing warnings (unchanged counts) |
| `pnpm --dir backend build` / `pnpm --dir frontend build` | OK (existing frontend chunk-size warning) |
| `pnpm test:engineering` | 196 Jest + 10 Node checks passed (critical manifest now 21 cases) |
| `pnpm specs:validate` | 49 passed, 0 failed |
| `playwright test --list tests/e2e/excel-purchase-import.spec.ts` | 1 test discovered (compiles); not executed locally |

Oracle values for the owner's sample row (0,00918359 BTC for 1000 USD, current rate
84945) were computed independently with Python `decimal` at 80 digits: value
780.10005255, difference −219.89994745, return −21.989994745 %, buy rate
108889.878576896…; the sheet's 780,1000526 / −219,8999475 / −21,99 % / 108889,8786 are
those values rounded to the cell's places.

## Independent review

A separate review context read the diff against this change. No blocking findings;
it confirmed exact rounding/tolerance, byte-identical v1 tuples for existing settings
and the latest-price query. Resolved findings:

- Automatic orders now start above every slot the account occupies (trades, rewards,
  swaps, both transfer sides), not trades only; unit test added. SHEET-1 text updated.
- Reconciliation returns `side`; sale rows carry no cost, checks or price fields and are
  left out of totals; the UI labels P&L as per purchase, ignoring later sales. SHEET-3
  text updated.
- The reconciliation panel appears only when the inspected delimiter equals the batch's
  accepted delimiter, and clears its result on a journal revision change.
- Duplicate message wording covers sales; SHEET-UI also checks the visible journal
  summary; the probe refuses `allRowsSide` with a mapped side, `fixedOffset` in date mode
  and a settings object missing only the order column.
- Backward-compatibility pinning: the existing `csv-import-db.cjs` probe recomputes the v1
  preview hash and command payload independently for legacy settings and still passes
  every stage that exercises them (see GREEN), so no separate golden test was added.

Not added: a PostgreSQL case for a row later corrected into a sale (covered by the
service branch only).

## Hosted CI

| Run | Result |
| --- | --- |
| Run 37146733892 on `3b067fe` | All unit, lint, build and gate jobs green. Critical acceptance: 20 of 21 passed, including SHEET-UI. CSV-006-A failed: the fee column description no longer said that a zero fee must be entered explicitly (`/нул\|ноль\|\b0\b/` expected). Fixed by restoring that sentence next to the new "fee included" statement; the assertion is unchanged. Image scans did not run because acceptance failed first. |
| Run 37148705404 on `c6c2a17` | Critical acceptance passed, all 21 cases, including SHEET-UI and CSV-006-A. The exact-image security gate failed. The diff does not touch any image and the sanitized report was not readable from here; the failure is taken to be the pinned nginx base's pcre2 10.48-r0 finding fixed on PR #30 by requiring `pcre2>=10.49-r0` in `frontend/Dockerfile`, and PR #30 is green with it. The same two lines are ported here; they no-op once #30 merges. |
| Run 37150307665 on `8e27413` | All jobs green, including `Release Images and Security` (critical acceptance and image security gate). |

## Post-archive fix (2026-10-04)

Capturing screenshots for the owner on a local run (throwaway PostgreSQL 16 database, built
backend, Vite over HTTPS, synthetic owner and two synthetic rows) showed that the
reconciliation panel stretched the page: `document.documentElement.scrollWidth` was 2411 at a
1280 px viewport, the column selects were unstyled and the table cells did not wrap. SHEET-UI
now also asserts that the page does not scroll horizontally at 360, 768 and 1440 px after
reconciliation. Fix: the panel uses the shared form grid, the result section is a shrinkable
grid item and the reconciliation table wraps its text cells. After the fix the same local run
measured scrollWidth equal to the viewport at 360, 768, 1280 and 1440 px. Frontend tests (137),
lint and build pass; the browser assertion runs in hosted CI.

## Not run here

- SHEET-UI Playwright journey and the probe inside the acceptance Compose stack: hosted
  CI `Run critical real release acceptance`.
- Full 174-case E2E suite: not required per change (owner instruction 2026-09-23).
- The owner's real sheet: not available; synthetic rows and the owner's sample row only.
