## Context

Checkpoint 93f7f94 has passing real MFA/owner/wallet characterization: 401 backend,
81 frontend and 55 HTTPS Chromium checks. The 2026-09-22 production audit reports
25 high/38 moderate/3 low findings over 324 production dependencies. No finding
references OTPAuth 9.5.2. Reachability has not been inferred from severity alone.

## Goals / Non-Goals

**Goals:** Remove high/critical production dependency findings with compatible
reviewed updates; freeze exact resolutions; require the production audit in CI;
retain the verified application/database behavior and record residual scope.

**Non-Goals:** New application behavior, destructive migrations, broad major-version
upgrades, production rollout, full image/static/secret/DAST coverage or a security
certification. Persistent auth limits follow this change.

## Decisions

- Use the existing pinned pnpm 10.33.0 audit command, production graph and native
  high severity threshold. A package script is reused by local verification and a
  dedicated CI job. Do not ignore advisories, mute registry errors or turn a failed
  audit into a success. Reports may contain lower-severity open findings; document
  those separately with paths, applicability, owner and follow-up date.
- Keep Node 22, Nest 11, TypeORM 0.3 and current frontend major versions. Prefer
  explicit compatible direct/parent updates and normal semver resolution. Any
  necessary scoped transitive override must identify the affected parent/range,
  selected exact version and compatibility rationale. No floating latest in CI.
- Review authoritative advisory/registry metadata and actual dependency paths
  before changing manifests. The exact selected versions and package API risks
  are recorded in the verification/security report after feasibility review.
- Add dependency-audit as the ninth required CI aggregate input. Preserve always()
  and exact-success semantics for failure/cancelled/skipped/missing/malformed input.
  Unit tests execute the actual aggregate script/workflow command; a missing audit
  dependency must fail before workflow implementation changes.
- This is a dependency refactor: preserve passing app characterization rather than
  breaking application code artificially. Existing actual audit findings are the
  remediation failure evidence. Independently test the new gate behavior before
  implementation, then rerun frozen install, audit, source checks and real release
  images with PostgreSQL/HTTPS. External market providers remain the only stubs in
  application acceptance.
- Audit metadata changes over time. Record date, pnpm/Node, lock checksum, command,
  terminal status and tested image IDs. Never describe no current high findings
  as proof of complete vulnerability coverage or a completed production pipeline.

## Risks / Trade-offs

- Compatible version labels do not prove runtime compatibility → run existing
  source and real database/browser characterization without weakening assertions.
- Registry outage can block the security check → fail closed and report the actual
  outage; offline app acceptance remains independent of external market availability.
- Lower-severity fixes may require major upgrades → retain explicit open findings
  and follow-up rather than silently accepting or suppressing them.
- Dependency updates can alter transitive resolution → inspect lock diff and freeze
  install, avoiding unrelated updates where possible.

## Migration and rollback

No database migration or owner-data operation. Build and test only synthetic images.
The preceding verified Git checkpoint remains available; do not promote a rollback
containing known high/critical findings. No current CD rollout is authorized.

## Observed transport compatibility discovery

The first rebuilt-image run passed 54/55 browser cases but retained BTC acceptance
failed: expected 1.25000000 BTC, received 0.00000000. Axios 1.18.0's installed HTTP
adapter now uses CONNECT for HTTPS proxy targets; the old external fixture explicitly
returned 501 for CONNECT. Keep the secure client behavior and financial assertions.
Adapt only the external fixture: terminate allowlisted CONNECT locally with synthetic
TLS, bind the exact CONNECT authority, SNI and HTTP Host, and reject tunneled controls
and unknown destinations. No outbound socket is created. Backend/tools trust only a
mounted public synthetic certificate via isolated NODE_EXTRA_CA_CERTS. Among runtime
services only the provider receives its separate fixture TLS key, never the MFA key;
trusted short-lived test/seed tools retain their existing whole-fixture-directory
mounts and can also read synthetic TLS material. Preserve normal TLS
verification and independently probe these transport boundaries before the full run.
