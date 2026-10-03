# Verification — import-excel-purchase-sheet

Status: implemented; hosted critical acceptance (SHEET-UI browser journey and the
`excel-purchase-import-db.cjs` probe inside Docker) not yet run. Keep the change active
until it is green, then archive.

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

## Not run here

- SHEET-UI Playwright journey and the probe inside the acceptance Compose stack: hosted
  CI `Run critical real release acceptance`.
- Full 174-case E2E suite: not required per change (owner instruction 2026-09-23).
- The owner's real sheet: not available; synthetic rows and the owner's sample row only.
