# Reviewed CSV imports into the USD journal

The verified CSV slice passed all 124 real HTTPS Chromium cases, including 101
retained cases, plus PostgreSQL and migration checks. The
[current specification](../openspec/specs/usd-csv-imports/spec.md),
[persistence contract](../openspec/changes/archive/2026-09-23-import-usd-trades-csv/persistence.md)
and [verification record](../openspec/changes/archive/2026-09-23-import-usd-trades-csv/verification.md)
define the exact API, supported limits and observed results. The full refactor and production
release hardening remain incomplete; this feature does not authorize production migration.

## Supported history and source

Import only purchases and sales into an existing, explicitly initialized
[USD trade journal](usd-trade-journal.md). Its declared empty origin and coverage
instant still apply. Aggregate manual openings, unknown acquisition cost, cash
balances and legacy wallet observations are not converted into acquisition lots.
The importer makes no provider calls and calculates recorded costs and realized
journal results, not market value, investment returns or taxes.

Export a UTF-8 CSV from Excel; an XLSX workbook and UTF-16 CSV are unsupported.
Choose comma or semicolon as the delimiter. Standard quoted delimiters/newlines and
doubled quotes work. LF and CRLF may coexist, including within quoted cells; a bare
CR, invalid UTF-8 or NUL is rejected. An optional leading BOM is retained in the
original and ignored for parsing. Headers must be nonempty after whitespace checking
and must not be exact duplicates. Every data record needs the same number of cells;
an all-empty record is invalid. A final line ending does not add an empty record.

| Boundary | Limit |
| --- | --- |
| Original file | 1..262144 bytes (256 KiB), including BOM/line endings |
| Data records | 1..100, plus one header record |
| Columns | At most 32 |
| Decoded cell | At most 4096 UTF-8 bytes |
| Display filename | 1..120 Unicode code points; no control characters or path separators |
| Whole multipart body at HTTPS edge | 1048576 bytes (1 MiB), including multipart overhead |
| Retained originals per account | 256 files across all states; at most 64 MiB of source bytes |
| Journal after import | At most 1000 active trades and 10000 immutable versions |

The source-byte total follows from the file/count limits; it is not a global storage
quota. Inspection/mapping errors may leave a retained draft: upload validates bytes
and metadata before delimiter-dependent parsing. No invalid prefix becomes trades.

## Russian form workflow

1. Open the account's **Импорт CSV** section. Choose **Файл CSV**, then **Загрузить CSV**.
   The retained filename identifies the selected batch. Selecting another file clears
   the old inspection, mapping and preview; upload it before preparing its import.
2. Choose **Разделитель**, then **Просмотреть исходные строки**. **Исходные строки**
   shows decoded literal cells, record ordinals and physical starting lines. Source
   text is displayed as text, including markup and formula-looking strings.
3. Map instrument, side, timestamp, order within the timestamp, quantity, gross USD
   total and USD fee columns. Currency is optional. Map every observed instrument
   source key to an existing owned instrument UUID, and each side key to buy/sell.
   Source keys retain case and spaces; identical symbols do not establish identity.
   The form can load more instruments when the needed UUID is beyond the first page.
4. Explicitly choose **Десятичный разделитель** and **Формат времени**. Offset mode
   requires an offset in each timestamp; fixed-offset mode requires local ISO times
   and one supplied offset, at most ±14:00. There is no machine-timezone or DST guess.
   Confirm **Валовые суммы и комиссии выражены в USD**. If mapped, every currency
   cell must be exactly `USD`.
5. Select **Проверить импорт**. Review ignored columns, row/whole-batch errors and
   exact before/after amounts. Invalid previews cannot be confirmed and create no
   trades. Fix the source or mapping rather than importing a valid subset.
6. Select **Подтвердить импорт CSV** only after reviewing a valid current preview.
   The entire batch commits atomically. A changed journal requires a new preview;
   the application does not automatically retry a mutation.
7. Use **Сохранённая партия CSV** and **Показать происхождение сделок** to review the
   source record linked to its immutable create version and, if present, rollback
   version. Later manual corrections do not rewrite that evidence.

Quantities and gross totals must be positive decimal strings; fees are required and
nonnegative. Use the chosen decimal separator without grouping, signs, exponent
notation or surrounding whitespace. Missing fees are not assumed zero. Existing
48-integer/30-fractional-digit bounds, strict calendars and exact FIFO allocation apply.
Gross means the complete trade amount, not unit price. See the USD journal guide
for the $250 realized/$100 remaining example and fee/residual rules.

Execution order comes from timestamp plus the explicit integer order within that
instant, not source-row order. Distinct legitimate similar trades are retained when
these keys differ. A sale may appear before its purchases in the file provided the
complete chronological history never has negative holdings.

## Identity, privacy and rollback

The exact original bytes are stored privately in PostgreSQL with SHA-256 and their
first filename/time. An identity match also compares bytes. Reuploading identical
bytes into the same account returns the original batch, including after acceptance
or rollback; renaming the file does not bypass this. BOM/line-ending/content changes
produce another file. Overlapping exports and semantically equivalent files are not
automatically deduplicated. Do not import the same history again in a changed export.

There is no public original-file download/delete route. Application list/detail
responses omit raw originals; inspection intentionally reveals cells only to the
fully authenticated owner. Originals remain in database/backups, so access protection
is not a claim of encryption at rest. Neither originals nor private filenames belong
in error responses or logs. Batch rollback retains source, settings and provenance.

Review **До отката** and **После отката**, then check **Я проверил последствия отката
всей партии** before **Откатить партию CSV**. Rollback appends one terminal void for
each imported trade in one transaction. It is allowed only while every imported
head remains its initial create version, the version cap permits the whole operation,
and the remaining complete history stays valid. A later manual correction/void of an
imported trade or insufficient remaining holdings prevents rollback without partial undo.

Rollback can validly reallocate later sales to other purchases. For example, removing
an imported $100 purchase while retaining a $200 purchase and a $300 sale changes
realized result from $200 to $100. Review these consequences; rollback is conditional,
not deletion or a promise to restore every later calculated result.

## Refresh and uncertain outcomes

**Обновить состояние CSV** reads current batch and journal state. Review that state
before another write. A known accepted receipt followed by a failed current-state
read remains blocked until both reads succeed; do not resubmit an already accepted
command merely because its updated display could not load.

After a lost response, **Повторить исходный запрос CSV** repeats the complete original
file or command, including account, batch, mapping, key and expected revision.
Inputs remain locked. A denied retry, a stale read or a read saying “committed” does
not replace the unknown command. For confirm/rollback, only its accepted receipt or
an authoritative conflict from that exact POST resolves the outcome. Receipts describe
the original atomic version range; current results come from fresh reads.

Recovery is held only in browser memory. In-app refresh, route navigation and the SPA
login/MFA flow after session expiry preserve it. Return to the same account after
reauthentication to repeat the original request explicitly. A full browser reload,
closed tab or browser restart discards this pending command and any selected File;
no private source or command is written to localStorage. Retained server batches and
receipts remain discoverable, but do not assume an interrupted request failed or
substitute a new import to resolve uncertainty.

## API, errors and storage

All paths extend `/accounting/accounts/:id/csv-imports` (with `/api` at the HTTPS edge).
Full password/MFA sessions and owner scope apply; writes retain Origin/CSRF protection.

| Method/path | Purpose |
| --- | --- |
| POST base | Bounded multipart upload; new identity 201, exact repeat 200 |
| GET base | Batch metadata; exclusive UUID cursor, default 20/max 50 |
| POST /:batchId/inspect | Explicit delimiter and complete structural inspection |
| POST /:batchId/preview | Explicit settings and complete candidate, without writes |
| POST /:batchId/confirm | Atomic import; new receipt 201, original replay 200 |
| GET /:batchId | Metadata, accepted settings, receipts and current rollback review |
| GET /:batchId/rows | Source/version provenance; default 20/max 100 |
| POST /:batchId/rollback | Conditional atomic void range; new receipt 201, replay 200 |

Provenance continuations require the batch state returned by the first page. Rollback
between pages returns 409; accumulated pages must be discarded and reread. Inspection
and invalid economic previews use structured errors without exposing parser exceptions.
Raw invalid input returns 400, inaccessible resources generic 404, conflicts/caps 409,
size limits 413 and unsupported transport 415. Authentication failures retain 401/403
and existing rate-limit 429 behavior. None triggers an automatic mutation retry.

Migration 15, `AddUsdCsvImports1790050000000`, adds empty `account_csv_imports`,
`account_csv_import_commands` and `account_csv_import_rows` tables. Owner/account/trade
version references retain provenance with RESTRICT constraints. It converts no prior
data and preserves existing accounting/authentication rows. Explicit migration preflight
and historical legacy refusals remain; application startup never migrates implicitly.
An application rollback retains these tables and originals. Do not use a destructive
down migration as import rollback. See [testing and migrations](testing-and-migrations.md).

Acquisition-lot carry-in, crypto swaps/token fees, contributions/withdrawals, transfers,
blockchain matching, valuations, performance and reconciliation remain later slices.
