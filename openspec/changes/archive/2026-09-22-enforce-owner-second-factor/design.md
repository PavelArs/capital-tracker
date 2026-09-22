## Context

Owner/password provisioning and opaque cookie sessions are verified. Password-only
access remains transitional. No real owner database is accessed by this change.

## Goals / Non-Goals

**Goals:** Protected CLI enrollment; password→pending→full authentication; replay-safe
TOTP/recovery; bounded guesses; Russian UI and real PostgreSQL/browser acceptance.
**Non-Goals:** Public enrollment, WebAuthn, hosted OTP services, recent-MFA settings,
complete distributed password/IP throttling, public rollout or consolidation.

## Decisions

- Pin `otpauth@9.5.2`, whose tagged package supplies CommonJS/types. Use its TOTP
  implementation with a library-generated20-byte secret, SHA1, six ASCII digits,
  30-second period and window1. Validate against fresh PostgreSQL time after locks;
  accept only a counter greater than the last consumed one. Confirmation also consumes
  its counter. Never implement OTP/HMAC manually in production.
- Encrypt secrets using Node AES-256-GCM, random12-byte nonce/tag16 and authenticated
  owner ID/enrollment UUID/format/key ID. `MFA_KEY_FILE` must name a regular private
  file (0400/0600; no symlink/group/world access) containing32 raw random bytes;
  `MFA_KEY_ID` is a non-secret identifier. No key default, image layer or database key.
  Missing/invalid key configuration fails startup; wrong key/tampered ciphertext
  fails authentication generically without plaintext/driver logs. Changing key files
  alone is not rotation; coordinated re-encryption remains a documented operation.
- Add `owner_mfa` singleton bound to a user, active/candidate encrypted envelopes,
  candidate UUID/expiry/attempts, last accepted counter and account failure window.
  Add recovery hash rows bound to enrollment version. Keep existing users/owner and
  all portfolio tables unchanged. Extend auth_sessions with pending_mfa state,
  failedAttempts and mfaVerifiedAt. Revoke old transient sessions during migration.
- `mfa-cli prepare --user-id UUID --output PATH [--replace]` requires the established
  owner. Replacement of an active factor requires --replace. Prepare generates an
  encrypted10-minute candidate and writes provisioning URI/candidateId/expiresAt only
  to a newly created exclusive0600 regular output file. It does not remove the active
  factor. No secrets on ordinary stdout, in argv or environment.
- `mfa-cli confirm --user-id UUID --candidate-id UUID --output PATH [--code-stdin]`
  reads one hidden code or bounded stdin JSON `{code}`. It validates the candidate
  code/time and atomically activates it, consumes the counter, rotates credential
  revision, revokes pending/full sessions and replaces recovery codes. Wrong codes
  consume candidate attempts (max5), never modify the active factor. Existing output
  paths/symlinks are rejected, never overwritten. Flush/close the private file before
  DB commit. An ordinary publication failure rolls back changes; after a confirmed
  rollback, remove only the same inode created by this invocation. PostgreSQL and
  files cannot commit atomically: crashes or ambiguous COMMIT outcomes may leave a
  protected orphan file. Do not remove recovery output if the DB may have committed.
- Generate ten independent128-bit recovery codes, formatted as four groups of eight
  hexadecimal characters. Output once through the confirm0600 file. Store only
  domain-separated SHA256 hashes bound to owner/enrollment UUID. Verification accepts
  exactly four hyphen-separated groups of eight ASCII hex characters, case-insensitive;
  unhyphenated, whitespace and Unicode variants are malformed400. It consumes the matching code in the same
  transaction as session issuance. An authenticator code or recovery code always
  follows valid password verification; neither can log in independently.
- POST/auth/login with existing CSRF/Origin returns `{mfaRequired:true,csrfToken}` and
  a newly rotated five-minute pending cookie, never a user or full privileges. An
  owner without confirmed enrollment gets generic401 and no full session.
  POST/auth/mfa accepts `{kind:'totp'|'recovery',code:string}` with pending cookie,
  exact Origin and CSRF. Success consumes pending state and returns `{user,csrfToken}`
  with a newly rotated12h full cookie; stores mfaVerifiedAt. GET/me/private routes
  require full state. Pending permits only MFA completion, CSRF retrieval and logout;
  re-entering password can replace it. Browser reload may restart the password form.
- Extend explicit guard metadata for pending access to MFA/logout; no authorization
  or CSRF bypass. Logout can revoke pending or full cookies but not grant privilege.
  Existing512 cap now covers all anonymous+pending records; authenticated cap10 stays.
- Use owner row→MFA row→session-capacity advisory lock→session rows consistently
  with CLI recovery; check time after all lock waits. Authorization may read owner
  state but must never acquire owner/MFA locks after its session lock. Counter/code
  consumption, session rotation and failure bookkeeping
  are transactional. Return rejection outcomes after committing legitimate failed
  attempt counters, not by accidentally rolling them back with thrown HTTP errors.
- The fifth invalid factor attempt returns401 and retires a pending challenge. The
  tenth invalid factor attempt returns429 and begins the owner cooldown. Ten invalid factor attempts
  in a ten-minute owner window block completion for ten minutes across challenges and
  restarts (429); blocked requests do not extend it. Malformed DTOs return400 without
  spending guesses; well-formed wrong/replayed codes do spend them. Expiry unlocks;
  successful issuance resets failure counts only on commit. Existing real
  per-process IP route limit5/minute also applies. Forwarded headers remain untrusted;
  full shared password/IP rate limits/proxy attribution remain next work, not claimed
  complete here. Trusted CLI confirmation/password recovery clears owner MFA lockout.
- Password recovery revokes sessions and candidate enrollment but retains confirmed
  factor and recovery-code validity. Explicit factor replacement replaces codes,
  revokes sessions and consumes the new confirmation step. Neither path transfers owner.
  Trusted replacement does not require decrypting a lost or unreadable old envelope.
- Russian login UI separates password and factor steps, offers recovery-code entry,
  gives generic code/lockout errors and installs CSRF after each successful rotation.
  Full user state is set only after MFA. No secret/token storage or mutation autoretry.

Official sources checked2026-09-21: [OTPAuth9.5.2 package](https://raw.githubusercontent.com/hectorm/otpauth/v9.5.2/package.json),
[TOTP implementation/API](https://raw.githubusercontent.com/hectorm/otpauth/v9.5.2/src/totp.js),
[RFC6238 replay guidance](https://www.rfc-editor.org/rfc/rfc6238.html#section-5.2),
[OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).

## Verification and migration plan

First RED uses unchanged images: correct password currently exposes private data
and full session rows. Do not use a missing future endpoint404 as that security proof.
Add RFC known-value, envelope/type and independent PostgreSQL CLI/replay/race tests.
Real browser fixtures enroll through the CLI: confirm a prior allowed step, use a
fresh current step, and use unconsumed issued recovery codes for extra same-window
logins. Never reset used counters directly or inject positive sessions. Use database
time, bounded boundary retries and freshly enrolled factors per isolated test.

Generate a synthetic private key outside images under ignored .runtime and mount it
read-only to CLI/runtime. Verify non-root readability; Linux fixtures may set only
that synthetic file's owner to containerUID1000. No production key is generated here.
Upgrade a populated preceding-ten schema, preserve all financial/owner rows, prove
old sessions unusable and replay migrations. No destructive downgrade to password-only.

## Risks / Trade-offs

- Lost key/factor → trusted CLI replacement and encrypted backup/key separation;
  application login cannot solve host compromise. TOTP is not phishing resistant.
- Counter boundary/collision → explicit DB clock, bounded windows, monotonic consumed
  step; independent tests avoid adjacent-code collisions rather than weakening replay.
- Account lockout can affect the single owner → finite cooldown and CLI recovery;
  broader abuse/availability and per-IP policy still need hardening before release.
