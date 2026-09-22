## Context

Express trust proxy is false and the existing Throttler uses req.ip, which is the
Nginx peer. Authentication uses 30 CSRF, 5 password and 5 factor requests per minute;
general routes use the existing per-handler 100/minute default. Owner MFA failure
state is already persistent in PostgreSQL. This slice fixes source attribution
without combining a new ledger/migration/account budget into the same change.

## Goals / Non-Goals

**Goals:** Exact peer trust, strict normalized source addresses, independent real
client quotas and anti-spoof evidence through both acceptance and owned deploy Nginx.
Preserve session, CSRF, factor and financial contracts and all 55 browser cases.

**Non-Goals:** Persistent/shared budgets, account login quotas, multiple replicas or
CDNs, general API quota changes, availability guarantees, deployment or data migration.
The current process-local limiter still resets on restart; the next change addresses it.

## Decisions

- HTTP startup requires TRUSTED_PROXY_IPS: JSON array of 0..8 exact standard IP
  literals; [] explicitly means direct mode. No defaults, hostnames, symbolic trust,
  subnet/CIDR, ports, bracketed addresses, zones or canonical duplicates. Operator
  and migration CLIs do not need an irrelevant HTTP peer setting.
- Validate literals with Node net.isIP (and reject zone identifiers), then canonicalize
  using the existing locked ipaddr.js 1.9.1 API, declared directly if imported.
  Map IPv4-mapped IPv6 to IPv4. Compare the complete canonical peer for trust, then
  group ordinary IPv6 client rate subjects by /64 and IPv4 by /32. Hash bounded
  canonical subjects in limiter keys; this is not a claim of IP anonymity.
- For untrusted peers ignore all forwarding metadata. For a trusted peer require
  exactly one raw X-Forwarded-For field containing one strict literal; reject missing,
  comma lists, duplicates, arrays and invalid literals. Cache the validated result
  on the request. Keep Express trust proxy false; no hostname/protocol changes.
- Mark the three auth handlers explicitly; do not infer policy from arbitrary URL
  strings. Integrate the resolver into both quota tracking and the earliest auth
  validation path so malformed trusted metadata fails before quota accounting or SessionService touches
  state regardless of APP_GUARD registration order, even with exhausted quota. Prove
  rejected metadata leaves all five valid request slots available with assembled-app
  negative tests. Preserve existing quota values and other route behavior.
- New source rejection is generic 400 with no-store. Source trust never supplies
  Origin, CSRF, user identity or a session. Existing 401/403 contract assertions remain
  under valid source metadata and available quota; document these prerequisites.
  Persistent admission ordering and read-only auth-session authorization belong to
  the following PostgreSQL ledger slice, not an unverified claim in this change.
- Owned Nginx sets X-Forwarded-For and X-Real-IP to $remote_addr, protocol to $scheme,
  and removes Forwarded/X-Forwarded-Host. Do not enable real_ip or PROXY protocol.
  The actual deploy template needs a trailing slash on its /api/ proxy_pass URI.
  Render only synthetic authority/domain/certificate substitutions and run the real
  template, not merely an imitation in tests. Preserve frontend/nginx.conf.
- Use two actual client containers on a separate internal network, with only Nginx
  joining it and the application network. Clients use the existing Node image,
  real HTTPS jars, actual password/factor flow and only public test TLS certificate.
  Do not inherit backend anchor secrets, DB settings or MFA key mounts. No positive
  cookie injection, auth/backend mocks, external route or diagnostic endpoint.
  Single backend is sufficient here. Verify source separation from actual socket
  evidence. Check subnet collisions before fixed-IP network creation; never mutate
  an unrelated network. Root exclusively owns Docker/network/harness changes.
- Trusted malformed-header probes may use the proxy network namespace with the
  existing Node image and no secrets; a separate direct untrusted negative probe
  demonstrates header rejection. These do not replace normal browser HTTPS flows.

## Acceptance and RED

Before runtime changes, the real two-client fixture sends five wrong passwords from
A and expects B's first correct password to reach pending authentication. The current
single backend instead returns 429 for B. Capture that observed mismatch; absence of
a future resolver/configuration field is not behavior RED. Independent tests cover
canonical vectors and valid-cookie malformed-source state preservation. Retain all
55 browser/security assertions and existing real PG/CLI checks. No new schema/reset
fixture is needed; existing per-test backend restarts remain legitimate isolation.

## Risks / Trade-offs

- A deployment's exact backend socket peer can be a bridge/gateway rather than
  loopback: document how to verify it; no claimed production address is inferred
  from the synthetic container fixture. Network recreation can require config update.
- An attacker sharing the trusted host identity is within that host trust boundary;
  IP settings do not secure a compromised host. IPv6 /64 grouping is intentional.
- Malformed edge metadata fails closed and can deny legitimate requests if misconfigured:
  validate the real template and retain explicit direct mode for isolated development.
- Process-local budgets remain restartable and replicas multiply them: explicitly
  document the limit and follow immediately with shared PostgreSQL admission state.

## Migration and rollback

No database migration or owner data change. Update example HTTP configuration and
owned templates only after synthetic proof. No actual rollout is authorized. A
source rollback would restore the old shared-proxy limiter defect; do not label it
release-ready. Keep immutable tested dependency images and the previous checkpoint.

## Primary references already inspected

Node22.21.1 net.isIP documentation; ipaddr.js v1.9.1 README/declarations;
@nestjs/throttler v6.4.0 source; official Nginx proxy_set_header and proxy_pass docs.
Recheck the exact installed APIs before implementation. The prior independent QA
review recommended this bounded attribution slice ahead of ledger/capacity/replica work.
