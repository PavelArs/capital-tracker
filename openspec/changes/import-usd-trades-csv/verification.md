# Verification: import-usd-trades-csv

Status: specified and independently reviewed; CSV tests/RED and implementation have
not run. Artifact completeness is not successful implementation or runtime evidence.

Predecessor record-usd-fifo-trades was actually archived in97a7a2d on2026-09-23 after
all101 real Chromium cases passed in21.7 minutes, one worker and zero retries, plus
actual migration/PostgreSQL/CLI/authentication/artifact/network prerequisites.
See its archived verification for source/audit results and retained earlier failures.
Exact predecessor images, required for initial CSV RED without a rebuild:
- backend sha256:17283e22fdc410782a31ebdd86e627e8c07cb576fd1f0b82ffb9bc87e39fc2c3
- frontend sha256:ebf4d8ce70cd660fc854459c6c84519fec7d54ab087a8019fc8f37f57a6234ad

Independent contexts reviewed the planned acceptance matrix, backend transaction
seam/security and parser/transport against actual installed sources and primary docs.
Coordinator resolved inspection-before-mapping, invalid-preview discriminants,
whole-candidate source ordering, conditional rollback reallocation, state-pinned
provenance and versioned replay-before-parse. No product/schema/dependency change
was made to demonstrate those design claims; runtime verification remains required.

| Scenarios | Planned executable evidence | Current result |
| --- | --- | --- |
| CSV-001-A / CSV-006-A | Maintained predecessor-image real MFA upload/UI RED, then full journey GREEN | Not run |
| CSV-001-B / CSV-002 | Independent csv-input/csv-parser tests plus actual Nest/HTTPS transport and format cases | Not written/run |
| CSV-001-C / CSV-003 / CSV-004 | Production CsvImportService with real PG exact vectors, races, caps, provenance, deferred COMMIT and retry | Not written/run |
| CSV-005 | Real RR read barriers and state-pinned provenance; replica hash equality and stale preview denial | Not written/run |
| CSV-006 / CSV-007 | Real Russian browser and private HTTPS/auth/CSRF/owner/log tests, actual transport faults | Not written/run |
| CSV-TRADE-001 | All retained manual/USD source/PG/HTTPS characterization plus atomic range assertions | CSV not run; predecessor passed |
| CSV-MIG-001 | Release-image fresh15/replay and populated14-to15 plus all older upgrade/refusal cases | Not written/run |

Runtime note: external host update removed Node22.21.1 and switched global pnpm.
New local commands use compatible Node22.23.2 and a temporary wrapper invoking
cached pnpm10.33.0; repository and release-image pins remain unchanged. Use
PATH=/private/tmp/capital-task-bin:/Users/pavelars/.nvm/versions/node/v22.23.2/bin:$PATH.
No paid service, owner DB, production deploy, remote push or original-folder removal.
