# Verification: record-usd-fifo-trades

Status: genuine acceptance RED observed; implementation starting. No GREEN claim.

Predecessor manual openings completed85/85 real Chromium cases, all PG/CLI/migration
prerequisites and independent review, then actual archive e2080aa on2026-09-23.
Canonical manual and migration scenarios were compared against both modified deltas;
none removed. Strict OpenSpec validates all11 current items. Separate contexts
reviewed the arithmetic, SQL/transaction/read contract and complete UI state plan.

Independent QA authored maintained real HTTP/UI tests99b5789, integrated0057abd,
before any trade behavior or schema change. Root ran Node22.21.1:
`caffeinate -is node /private/tmp/capital-usd-trades-red.cjs`.
Exit1 in /private/tmp/capital-usd-trades-red.log contains exactly two intended failures:
- TRADE-001-A: actual password/MFA and auth/me200, existing account create/read/history
  succeeded; explicit journal initialization expected201, actual404.
- TRADE-006-A: actual protected account heading was visible, exact Russian journal
  heading was missing.
No future helper/table was a prerequisite. Finally checks preserved every prior
business/factor/admission row (only authorized session activity excluded) and provider
requests. Only external providers are stubbed. Backend/authentication/PG are real.
Actual image migration13/seed/replicas/HTTPS/artifact isolation prerequisites passed.

Exact predecessor images (no rebuild before RED):
- backend sha256:9efd443953ddd723844aca23da46a9de6b016ffbc16b443ed65a933b3f35ce47
- frontend sha256:cca53f6ade800efbb256f5164f37ebf4b4085190bde35253b44fe394ee0bf084

The wrapper completed cleanup; independent Docker reads found no owned Compose
containers/networks. Owner Nginx hash remained
115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432.
No owner data, original folder or production deployment was touched.

Preimplementation unit tests27c7ee5 were independently reviewed; source syntax,
scoped Biome and independent integer arithmetic literals passed. Runtime/full typing
await actual helpers; unavailable imports were never executed or claimed RED.
Independent PG/migration fixturesdfbef7a are syntax checked, runtime UNRUN. Expanded
HTTPS acceptance, source build/tests, PG/image GREEN, review and archive remain pending.
