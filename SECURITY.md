# Security policy

## Supported versions

Only the current `main` branch and the release deployed from it receive
security fixes. Older tags are not patched.

## Reporting a vulnerability

Report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/PavelArs/capital-tracker/security/advisories/new).
Do not open a public issue, pull request or discussion for a suspected
vulnerability.

Please include the affected component (backend API, frontend, release or
deployment scripts), steps to reproduce, and the impact you expect. Never include
real credentials, personal data or financial data in a report; use synthetic
values.

You should receive an acknowledgement within 7 days. Confirmed issues are fixed
on `main`, released through the normal reviewed deployment, and disclosed in a
GitHub security advisory once the fix is deployed.

## Scope

In scope: this repository's code, its CI and release workflows, and container
images built from it. Out of scope: third-party services the app reads prices
or chain data from, and findings that require an already compromised owner
account or server.
