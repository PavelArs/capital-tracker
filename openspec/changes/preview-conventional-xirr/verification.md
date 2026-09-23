# Conventional XIRR verification

Status: specified; implementation and GREEN pending.

Baseline dfa1f64: only owner `frontend/nginx.conf` modified; active changes empty
before this change; OpenSpec1.2.0. Existing guarded GHCR workflow and brownfield
deployment inventory inspected, retained. `pnpm --dir backend test --runInBand
--coverage=false period-profit.spec portfolio-flow.spec portfolio-flow-input.spec`
exit0:111 tests /3 suites,1.776s. No production/data/folder action.

Luna audited exact projection reuse and confirmed Decimal10.6.0 is only a jsdom
dev transitive dependency. Sol independently reviewed the conservative uniqueness
condition, ACT/365F timestamps, rate tolerance, interval endpoints, workload
limits and zero/unavailable cases; no design blocker. Official equation/library
sources and deviations are linked in design. Feasibility probe (not a product
benchmark):1000 exp calls at64/96 precision took298/663ms on host Node22.23.2.

## Risk-based check manifest

| Scenario | Check |
| --- | --- |
| XIRR-YEAR/FLOWS/ORACLES | Pure independently calculated one-year gain/zero/loss, irregular timing, same-instant exact sums, tiny values/time gaps, boundary precision and leap-year convention; real API ten-percent case. |
| XIRR-UNAVAILABLE | Pure each deterministic unavailable reason, both inclusive rate bounds,65-date refusal and1000-flow aggregation without truncation; UI out-of-range reason. |
| XIRR-SNAPSHOT/PRIVATE | Actual PostgreSQL two-connection read barrier, busy/release on error, foreign ownership, full read-only fingerprint, closed transaction before solving; real auth/MFA/CSRF/origin/no-store/400/409. |
| XIRR-UI/LATE | Two new HTTPS cases for explicit calculation, annualization/unavailable and a delayed real response superseded by reviewed profit; no backend/auth mocks. |
| Retained behavior |111 baseline cases, actual PostgreSQL profit fixture and2 retained profit HTTPS journeys. |
| Integration | Scoped E2E TS, backend/frontend build/lint, solver workload benchmark, frozen install/audit, strict OpenSpec and owner-file/cleanup checks. |

No full E2E/default broad regression run per owner instruction. No migration or
release change; complete upgrade matrix, hosted CI and production rollout are
not claimed. Existing CI gates/cases remain intact.
