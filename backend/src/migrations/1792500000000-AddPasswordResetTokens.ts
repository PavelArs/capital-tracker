import { MigrationInterface, QueryRunner } from 'typeorm';

// Additive: a new empty table for emailed reset links and one more admission scope.
export class AddPasswordResetTokens1792500000000 implements MigrationInterface {
  name = 'AddPasswordResetTokens1792500000000';

  async up(runner: QueryRunner): Promise<void> {
    // RESET-REQUEST/RESET-USE: only the SHA-256 digest of a link's 256-bit token is stored.
    // A link lives 30 minutes and ends used (it set the password) or revoked (a newer link,
    // another reset or an operator recovery replaced it), never both.
    await runner.query(`CREATE TABLE password_reset_tokens (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      "userId" uuid NOT NULL CONSTRAINT password_reset_tokens_user_fk
        REFERENCES users(id) ON DELETE CASCADE,
      "tokenHash" varchar(64) NOT NULL CONSTRAINT password_reset_tokens_hash_key UNIQUE
        CONSTRAINT password_reset_tokens_hash_check CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
      "createdAt" timestamptz NOT NULL
        CONSTRAINT password_reset_tokens_created_check CHECK (isfinite("createdAt")),
      "expiresAt" timestamptz NOT NULL,
      "usedAt" timestamptz,
      "revokedAt" timestamptz,
      CONSTRAINT password_reset_tokens_lifetime_check
        CHECK ("expiresAt" = "createdAt" + interval '30 minutes'),
      CONSTRAINT password_reset_tokens_outcome_check CHECK ("usedAt" IS NULL OR "revokedAt" IS NULL)
    )`);
    await runner.query(
      'CREATE INDEX password_reset_tokens_user ON password_reset_tokens ("userId", "createdAt")',
    );
    // RESET-LIMIT: reset requests from one client share a fixed window of 5 per 60 seconds,
    // the existing default the hits and expiry checks already apply to every other scope.
    await runner.query(`ALTER TABLE auth_request_limits
      DROP CONSTRAINT auth_request_limits_scope_check,
      ADD CONSTRAINT auth_request_limits_scope_check
        CHECK (scope IN ('csrf-ip', 'login-ip', 'mfa-ip', 'login-account', 'reset-ip'))`);
  }

  async down(): Promise<void> {
    throw new Error('Password reset downgrade requires an explicit recovery plan');
  }
}
