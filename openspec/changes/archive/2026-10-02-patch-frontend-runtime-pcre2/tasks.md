## 1. Establish the failing image evidence

- [x] 1.1 Record IMG-PCRE2-001-A from the actual PR #29 Trivy report and confirm the exact fixed package exists in official Alpine v3.24 main x86_64.

## 2. Patch the final runtime image

- [x] 2.1 Pin `pcre2=10.49-r0` in the frontend release stage without changing the base digest, builder, lockfile or scan gate.

## 3. Verify and hand off

- [x] 3.1 Run source diff checks and strict OpenSpec validation; document actual results and unrun local Docker checks.
- [x] 3.2 Obtain independent review and rebuild/scan the exact frontend image in CI; require high/critical scan GREEN and candidate-bound acceptance before considering this change complete.
