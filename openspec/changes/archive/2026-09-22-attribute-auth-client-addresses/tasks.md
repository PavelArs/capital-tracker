## 1. Scenario review and acceptance first

- [x] 1.1 Independently review PROXY-001..004, rejection precedence and unchanged MFA/CSRF/data invariants; confirm dependency remediation is verified before implementation.
- [x] 1.2 Write real two-client HTTPS source isolation acceptance and demonstrate B incorrectly receives 429 on the preceding image (PROXY-001-A).
- [x] 1.3 Write config/canonicalization and trusted/untrusted spoof tests, including actual assembled-app state-preservation oracles (PROXY-001-B, PROXY-002, PROXY-003).

## 2. Bounded implementation

- [x] 2.1 Implement explicit HTTP peer config and canonical resolver with declared exact dependency; keep Express proxy trust false and CLI requirements unchanged.
- [x] 2.2 Integrate only named CSRF/login/MFA source quotas and pre-session validation, retaining 30/5/5 values, exact Origin and all authentication checks.
- [x] 2.3 Sanitize owned Nginx forwarding and fix API prefix; verify the actual rendered deployment template and preserve owner checkout configuration (PROXY-004-A).
- [x] 2.4 Add isolated two-client topology/negative probes and artifact checks without credentials on clients or external provider access.
- [x] 2.5 Document exact peer discovery, direct mode, upgrade steps and remaining process-local persistence limitations.

## 3. Independent verification and closure

- [x] 3.1 Independently review implementation/test oracles and add regressions for demonstrated findings.
- [x] 3.2 Pass frozen install, production audit, lint/build/unit and strict OpenSpec checks.
- [x] 3.3 Pass actual PostgreSQL/CLI/MFA/session checks, all retained 55 browser cases and new HTTPS attribution/template scenarios without retries or weaker assertions.
- [x] 3.4 Record RED/GREEN command exits, scope, image identities and preservation evidence; sync/archive and checkpoint only after required verification.
