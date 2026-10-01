## Context

The current source pins Axios 1.18.0 in backend and frontend. The actual hosted
production audit reports seven high and six moderate production findings (all displayed high findings are Axios). Official npm
metadata and the Axios v1.20.0 release confirm a published exact upgrade; all
reported high findings have a 1.20.0 fix floor. Node 22 and pnpm 10.33.0 remain.

## Goals / Non-Goals

**Goals:** resolve the identified production advisories reproducibly while
preserving HTTP timeouts, redirect refusal, bounded body handling, provider
failure metadata and authenticated frontend behavior.

**Non-Goals:** broad dependency refresh, changing provider/authentication policy,
replacing HTTP clients, database changes, image promotion or deployment.

## Decisions

Use exact Axios 1.20.0 in both importers and a targeted pnpm lock update. A broad
update creates unrelated dependency churn; advisory suppression would bypass
the release gate. Verify lock diff before installing the final frozen graph.

Use the actual hosted audit failure as security RED. Run existing unit/provider
characterization before and after; functional behavior is retained and must not
be deliberately broken. A local Node HTTP fixture additionally exercises the
real Axios HTTP adapter rather than claiming mocked Axios calls test transport.
The existing image probe must assert the new release version. Separate runtime
verification covers real HTTPS/provider TLS and password/MFA/CSRF navigation.

## Risks / Trade-offs

- Upstream runtime-option hardening changes transport internals: retain explicit
  timeout, redirect, 429 and size characterization and real image provider probes.
- The registry may add new findings after verification: record full severities,
  source/time/lock hash and leave the actual CI audit fail-closed.
- Local unit and HTTP fixtures do not prove image/browser/PostgreSQL behavior:
  retain these as separate mandatory independent/runtime tasks before archive.

## Migration Plan

No schema migration. Integrate the reviewed dependency commit, rebuild both
release images and verify their exact source/runtime graph before release gates.
Rollback would restore vulnerable Axios and cannot pass the dependency gate;
do not promote that graph as secure. Provider quotas and persisted data are unchanged.

## Open Questions

Independent review and root-owned image/browser verification remain pending.
