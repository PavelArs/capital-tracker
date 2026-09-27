## Context

At a03371b, manual financial/authentication capabilities and responsive workbench evidence are delivered. The owner has explicitly authorized manual + CSV MVP deployment through GitHub Actions to the existing server; automatic networks and AI are deferred. Current local CD is contained, but remote old CD still auto-deploys main: neutralize it before publishing/integration. Root owns remote/Docker/data-sensitive actions. Sol owns acceptance/artifacts; separate runtime/deployment implementers and independent review preserve bounded ownership.

## Goals / Non-Goals

**Goals:** deploy the verified existing manual MVP with safe operator recovery and traceable images.
**Non-Goals:** automatic synchronization/AI, broader portfolio analytics, chart expansion, new UX, original-project consolidation or claiming the whole target complete.

## Decisions

- Extend exact `BACKGROUND_JOBS_ENABLED=false` semantics to suppress CryptoPrices constructor collection and CurrencyUpdate module initialization as well as cron registration. Preserve true/unset behavior and explicit supported display-FX collection. This flag is not a global outbound kill switch: authenticated legacy demand-read APIs retain semantics. Supported manual-account/CSV views cause no provider calls; legacy crypto stays segregated and outside the supported MVP. Give enabled fiat HTTP collection a10000ms timeout. This avoids an extra runtime mode and does not fabricate cache entries.
- Resolve the two documented Router findings with a verified supported version and retained navigation/authentication. Dependency audit remains fail-closed; no advisory suppression.
- Retain existing repository/GHCR/server topology. Promote identical tested backend/frontend outputs by digest after a trusted successful candidate run for an exact commit; do not rebuild at deployment. Release metadata contains run/commit/digest identities, never runtime secrets. Separate provenance validation from the server shell orchestrator (`scripts/manual-mvp-release.sh`, `preflight|deploy`) so invalid metadata is rejected before SSH/mutation.
- Pin SSH host identity from a trusted source; never learn it with ssh-keyscan. Run read-only preflight through Actions to determine origin, Compose project/volumes, current images, migration ledger and MFA readiness. Hold a server deployment lock. Existing credentials are reused privately.
- Before application/database mutation, make a fail-closed encrypted PostgreSQL backup with checksum and verify restoration in an isolated disposable database. These rehearsal writes never target the owner database. Keep the MFA key backup separately protected. Run existing explicit migration CLI; its legacy destructive-schema refusal is binding. Never edit migration ledger/preflight to force an upgrade.
- Update only application services without compose down, pruning or volume replacement. Verify readiness and HTTPS anonymous private denial. Preserve previous backend+frontend digests/configuration; rollback both only when the post-migration schema is known compatible. Otherwise stop safely for operator recovery. Never restore an old database over newer writes automatically.
- Reuse19 existing critical journeys (the18manual/auth cases plus SHELLRouter compatibility): MFA pending/full, copied-cookie logout, CSRF/Origin denial; OPEN, TRADE, SWAP, REWARD, TRANSFER, full CSV import/rollback, FLOW, PRICE, VAL, VCH, MPV, PROFIT, XIRR, TWR. Use real HTTPS/MFA/backend/PostgreSQL with external fixtures only and retain exact original oracles. Runtime profile changes may require explicit real supported API cache setup; they do not authorize backend/auth mocks or financial/provider-count weakening.

## Risks / Trade-offs

- Unknown server schema → read-only preflight; fresh and supported migrated installations use existing CLI, unsafe prior schemas stop for a separate preservation plan.
- Failed dump/restore/provenance/SSH identity → no deployment mutation; never a best-effort backup.
- Partial application failure after migration → compatible two-image rollback only; record schema/data recovery boundaries.
- Changed manual startup affects old fixture warm-cache assumptions → distinguish explicit authenticated setup from acceptance, preserving all financial/provider assertions.
- Budget limits → staged relevant gates and reusable recorded evidence; process-mocked orchestration tests are not real deployment/restore proof.

## Migration Plan

Contain remote auto-CD; integrate reviewed change via PR; run trusted candidate gates and publish exact tested outputs. Discover server state read-only through Actions, then verify encrypted backup/isolated restore and perform locked explicit migration/application update. Finish with HTTPS privacy/readiness and owner MFA/read-only manual-screen smoke; record deployed commit/digests/schema. Archive only after actual required gates and deployment evidence.

## Open Questions

Trusted host-key source, actual HTTPS origin/proxy peers, server database/volume and schema state, encryption recipient and recovery-key custody, MFA/bootstrap readiness, and schema compatibility of prior application images must be established privately before deployment. These are operational prerequisites, not missing manual/network features.
