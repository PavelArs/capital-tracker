## Context

The legacy system has multiple retained users, public signup/email reset, bcrypt and
stateless JWTs. Existing wallets reference user IDs. The isolated release harness is
available; neither real owner data nor production is involved in this change.

## Goals / Non-Goals

**Goals:** Explicit single-owner selection, CLI-only password lifecycle, Argon2id,
public provisioning removal, retained data and immediate credential-revision revocation.

**Non-Goals:** TOTP, opaque cookies, CSRF, distributed authentication throttling and
public rollout. These remain mandatory follow-up changes, not waived requirements.

## Decisions

- Add `owner_auth` with a primary key constrained to `1`, unique `userId` foreign key
  and random UUID `credentialVersion`. Leave all existing tables/rows in place. Do
  not infer ownership from first user/email ordering. Bootstrap on a populated database
  requires an explicit `--existing-user-id` matching the supplied email. Once bound,
  recovery requires that exact `--user-id`; there is no CLI owner-transfer operation.
- CLI `node dist/owner-cli.js bootstrap --email EMAIL [--existing-user-id UUID]`
  or `recover --user-id UUID` reads a password twice from a hidden TTY. Explicit
  `--password-stdin` accepts a bounded JSON object with password/confirmation for
  automation. No password argv/env option. Reject unknown options, duplicate options,
  mismatches and malformed/oversized input before DB access. Commands use explicit
  DB settings, safe errors and the migration advisory lock inside a transaction.
- Use the maintained node-argon2 binding with Argon2id, 65536 KiB memory, three
  iterations, parallelism one, random library-generated salts, 32-byte output.
  Passwords contain 15–128 Unicode code points and at most 512 UTF-8 bytes, preserve
  whitespace and normalization, and reject malformed Unicode and NUL/CR/LF. Login bounds input in the service
  because Passport guards precede DTO validation. No bcrypt fallback; explicit CLI
  selection replaces only the selected owner's credential. Reference:
  [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
  [node-argon2](https://github.com/ranisalt/node-argon2), checked 2026-09-21.
- Query the singleton joined to its user at password verification and again at token
  issuance, binding validation to the credential revision observed during verification.
  JWT validation checks the current owner/revision in PostgreSQL on every request.
  Missing binding, legacy token without revision, wrong owner, invalid input and wrong
  password fail with generic 401. Recover rotates the revision and password atomically.
  No weak JWT secret fallback. The following session slice replaces this transport.
- Remove all signup/email flows, their DTOs, forms, API/context/types/tests and unused
  EmailModule/dependencies. Keep old database columns for data safety; clear reset and
  verification tokens only for the explicitly provisioned/recovered owner.
- Return login/profile through an explicit public field projection. No hash/revision
  appears in user/profile objects or CLI/log output. The JWT necessarily carries its
  non-secret revision while bearer transport remains transitional.

## Risks / Trade-offs

- Password-only bearer/localStorage remains → local isolated validation only; rollout
  stays disabled until TOTP, sessions and broader controls pass.
- CLI is a privileged recovery path → require trusted host/database access; never
  expose it over HTTP. Host/device compromise is outside application-login protection.
- Stronger hashing consumes resources → bounded input, existing global rate limit,
  measured verification time; distributed per-account/IP throttling follows.
- Retained non-owner data becomes inaccessible via application → preserve rows and
  explicit chosen user identity; no automatic consolidation, transfer or deletion.
- Case variants in existing emails → select by explicit ID and reject ambiguous
  case-folded email matches; do not merge accounts.

## Migration Plan

Run the explicit migration on isolated current and fresh databases, verify unchanged
user/portfolio snapshots, then exercise bootstrap/recovery. The new migration is
additive and has no automatic destructive downgrade. Unsafe older schema preflight
continues to refuse historical destructive migrations. Production migration/rollout
requires the later backup/release work and explicit authorization. Rolling back to
legacy auth would restore a weaker boundary and cannot be presented as safe recovery.

## Open Questions

Real owner selection and legacy schema status remain unknown; neither blocks
synthetic tests, and neither will be inferred or changed in this task.
