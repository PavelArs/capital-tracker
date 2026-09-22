## Why

The current authentication limiter uses the Nginx socket address, so one client's
failed logins can exhaust another client's quota. Explicit single-edge attribution
is needed before persisting these budgets in the next change.

## What Changes

- Require explicit exact proxy peer IP configuration for HTTP startup; support an
  explicit direct-connection mode without implicitly trusting forwarded headers.
- Resolve canonical client identities only for CSRF, password and factor request
  quotas, validating trusted forwarding metadata before session operations.
- Sanitize headers and correct API prefix forwarding in the owned Nginx template.
- Prove source isolation and spoof resistance with two real HTTPS clients, retaining
  all current browser/MFA/session and financial assertions.

## Capabilities

### New Capabilities

- `auth-client-attribution`: exact proxy trust, source normalization and observable
  quota separation through the real reverse proxy.

### Modified Capabilities

- `owner-sessions`: document source-validation rejection precedence without changing
  exact-Origin/CSRF requirements or granting authentication from an IP address.
- `owner-second-factor`: document the same source prerequisite for factor requests.

## Impact

Depends on verified MFA and completion of patch-production-dependency-advisories.
Affects HTTP configuration, a small address resolver/auth guard integration, owned
Nginx template, isolated network/client fixtures and operator documentation. No schema,
owner data, accounting change or public rollout. Preserve frontend/nginx.conf.

Non-goals: persistent or account-level request budgets, multiple replicas/CDNs,
new authentication factors, generic API quota changes, complete DoS protection or
release readiness. Current 30/5/5 per-handler quotas remain process-local; persistence
and associated admission ordering are the immediately following change.
