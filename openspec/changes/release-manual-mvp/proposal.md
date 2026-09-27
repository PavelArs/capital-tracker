## Why

The owner explicitly chose to ship the existing manual + CSV MVP through GitHub Actions to the existing server. Its accounting/authentication journeys are verified, but the current deployment rebuilds unverified images, omits explicit migrations and cannot safely recover both application images; legacy startup/background collectors also remain active outside the agreed scope.

## What Changes

- Release the implemented manual accounts/openings, trades/swaps/rewards/transfers, CSV, manual prices, valuation/history and profit/XIRR/TWR with current scope labels.
- Disable startup/background provider collection in the configured manual runtime; retain explicit supported stored/manual actions and compatibility characterization.
- Resolve the documented Router production advisories and verify existing navigation/authentication.
- Replace unsafe CD with trusted tested immutable image promotion, verified SSH identity, read-only server preflight, fail-closed encrypted backup and isolated restore verification, explicit migration refusal, serialized update and compatible two-image rollback.
- Reuse existing critical acceptance journeys and stage local, GitHub Actions and actual server verification before declaring deployment complete.

## Capabilities

### New Capabilities

- `manual-mvp-release`: Bounded manual-runtime behavior and safe, evidenced Actions promotion to the existing server.

### Modified Capabilities

None. Existing financial, owner-authentication, migration refusal and engineering gate contracts remain intact.

## Impact

Backend startup/scheduling configuration, production Compose wiring, Router dependency/navigation compatibility, existing CI/CD and focused release scripts/tests. No new financial API/schema or destructive data migration. Existing owner data, Nginx edit, original projects and preserved preview remain protected; any actual server mutation follows verified backup and migration preflight.

Dependencies: the delivered manual accounting/authentication capabilities and current isolated HTTPS/PostgreSQL acceptance harness. Non-goals: automatic network synchronization, AI, new whole-portfolio analytics, chart expansion, further UX redesign or original-project consolidation; these remain the post-MVP backlog.

The owner additionally selects PostgreSQL18 for the new fresh installation. This adds version/layout compatibility and refusal acceptance, not an upgrade of existing PostgreSQL16 data or preview. No wider package upgrade is included.
