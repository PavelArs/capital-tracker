# Verification — restrict-owner-provisioning

Scope: CLI-only single-owner bootstrap/password recovery, Argon2id, retained user and
portfolio data, owner/revision-checked transitional JWTs, and removed signup/email
recovery. This does not complete the full brief or establish production readiness.

## Contract and actual RED

Independent QA authored `tests/e2e/owner-auth.spec.ts` against the unchanged application.
The first attempt stopped at a nine-versus-eight migration expectation before browser
execution; this was a prerequisite mismatch, not authentication RED. With the previous
migration harness restored temporarily, `pnpm test:e2e` exited 1 with 11 new failures
and all four retained wallet tests passing. `/tmp/capital-owner-auth-behavior-red.log`:

- Register expected 404, received 201 and changed the users fingerprint.
- Forgot/reset/verify/resend expected 404, received 200/400/400/200 respectively.
- Login still displayed two retired links, and five former URLs still displayed their
  legacy pages instead of redirecting to login.

Only after these failures were observed did backend/frontend implementation begin.
Independent PostgreSQL/CLI scenarios were authored before implementation; absence of
the CLI was not used as behavioral RED. Existing wallet behaviors remained passing
characterization, with no artificial failures introduced.

## Requirement evidence

| Scenarios | Executed oracle |
|---|---|
| OWN-001-A | `tests/e2e/owner-cli.cjs`: concurrent production CLI processes, exactly one succeeds, one user and one constrained binding; repeat cannot mutate rows |
| OWN-001-B/C | Real PG full-table snapshots across explicit adoption; unknown/missing/mismatched/ambiguous selection rejected, all other users/portfolio rows unchanged |
| OWN-002-A | Independent Argon2 verification, algorithm/version, exact named m=65536/t=3/p=1 parameters, 32-byte output, random salts, exact Unicode/space fidelity |
| OWN-002-B | CLI oversized/invalid/unknown/duplicate-option/confirmation/configuration cases, safe errors and no secret output; malformed UTF-8 and lone-surrogate cases |
| OWN-003-A | `owner-auth.spec.ts`: generic wrong/nonowner/unknown credentials; signed legacy and nonowner attack tokens denied; missing binding denies both password and previously real-issued token |
| OWN-003-B | Browser real login → production CLI recovery → old password/token and trimmed replacement rejected → exact replacement browser login; preserved financial and nonowner snapshots |
| OWN-003-C | Production CLI rejects recovery before bootstrap or for different/missing user ID, full snapshot unchanged |
| OWN-004-A/B | Five removed APIs return 404 without public-table mutations; six browser URLs show only Russian owner login guidance |
| OWN-MIG-001 / ISO-001/002 | `migrations.cjs`: nine migrations fresh/replay; previous eight migrated with all old rows/schema unchanged and no implicit owner; unsafe older populated/empty schemas refused unchanged |
| ISO-003/004/005 | Original real login/wallet lifecycle/restart/foreign-wallet journeys; exact release image scans, loopback-only proxy, internal backend network and preserved owner Nginx SHA |

Negative signed-token fixtures are attack inputs only; successful authentication always
uses the actual backend password path. The seed invokes the actual production CLI to
bind/rekey the synthetic owner. Fixture/reset operations remain external mounted test
scripts; no authentication bypass or seed route was added to the production app.

## Independent review and corrections

`audit_security` reviewed the contract and implementation independently. It required
checking owner/revision on every JWT request, not merely password login. It also found
that lone UTF-16 surrogates were accepted then replaced by UTF-8 conversion, causing
distinct input strings to verify identically. A regression was written and executed:
`/tmp/capital-owner-unicode-red.log` expected false but received true. Validation now
rejects malformed Unicode through an exact UTF-8 round-trip check, without normalizing
valid passwords. All 49 auth/input/Passport tests then passed, including valid emoji.

The first image run passed migration/preflight/previous-schema checks and invalid CLI
input checks, then exposed an incorrect QA assumption about PHC parameter ordering.
The maintained library emits m,p,t; the original test assumed m,t,p. QA changed it to
assert the same exact named parameters plus algorithm/version/length/salt checks. No
security parameter or expected authentication outcome was weakened.

`provider_feasibility` independently reviewed backend/config/harness integration and
found stale Swagger reset text, a short DTO example and stale setup/testing documents.
Those references were corrected; the incompatible legacy development override is
explicitly deprecated. Its own frontend implementation is not counted as independent
frontend review. QA's browser tests were authored in a separate context.

## Executed checks

- Initial rerun baseline: `pnpm verify:baseline` exit 0, 264 backend / 59 frontend tests.
- Final behavior regression: same command exit 0, 285 backend / 54 frontend tests,
  both builds/lint and strict specs pass. Obsolete signup/email unit tests were removed
  with their features; new owner tests were added. Logs:
  `/tmp/capital-owner-regression-final.log`, `/tmp/capital-owner-unicode-green.log`.
- Lint retains 77 backend / 30 frontend warnings; the pre-existing frontend coverage
  threshold issue remains (32.6% statement coverage after removed API helpers).
- `pnpm test:e2e` after the Unicode fix exited 0 with all PostgreSQL/CLI/artifact
  checks and 18 HTTPS Chromium cases passing in 41.8 seconds. Log:
  `/tmp/capital-owner-green-rerun.log`. Temporary stacks were removed in finally.
- Hidden TTY manually exercised with synthetic Unicode password plus confirmation:
  neither entry was echoed; it then failed safely for missing DB_HOST before connection.
- Argon2 cost measured with networking disabled in the tested release image: hash
  99 ms; three verifies 91/91/90 ms on this local Docker host. These are observations,
  not deployment capacity or distributed-throttling evidence.

Final image rebuild after Swagger/DTO documentation corrections: `pnpm test:e2e`
exited 0; all real PostgreSQL/CLI/artifact/network checks and 18 Chromium cases passed
in 41.6 seconds. Log: `/tmp/capital-owner-final-image.log`. Final lint and strict
spec validation also exited 0; `git diff --check` passed. The stack was removed.

Exact final tested local image IDs:

- Backend: `sha256:809539256b9ec4f8495052bf0f1fa3e73dea9c40a7187a9f64dafbb36443636d`
- Frontend: `sha256:95fe157de355afd6a814d65f3eb2c26e8fc5570d9eb4a3e2aa6a6b6f811c4c0f`

These are local image IDs, not published registry digests or hosted CI evidence.
The cost measurement above used the preceding image with identical password code
(`sha256:1cb12bbf72dd432f9275002a6a124c91528926452e132c69de302ce7328c4fc0`).
Coordinator review of the separately implemented frontend confirmed removed routes,
helpers, types and links while preserving real login behavior; separate QA assertions
verified those changes through the final images.

## Limits

No real owner database, live provider, hosted CI, remote deployment, paid service or
original project folder was changed. No commits or remote pushes were made. Existing
data is preserved; unsafe historical upgrades remain refused, not automatically fixed.

Passwords still grant transitional JWTs stored in localStorage. Mandatory TOTP,
enrollment/recovery codes, opaque cookie sessions, CSRF, session expiry/logout,
distributed throttling, full ASVS mapping/scanners, least privilege and release/backup
hardening remain required. Public rollout stays disabled. This slice does not satisfy
those remaining requirements and is not a claim of comprehensive security.
