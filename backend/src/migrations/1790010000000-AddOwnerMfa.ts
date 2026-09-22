import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOwnerMfa1790010000000 implements MigrationInterface {
  name = 'AddOwnerMfa1790010000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE owner_mfa (
      id smallint PRIMARY KEY CHECK (id = 1),
      "userId" uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
      "activeVersion" uuid, "activeEnvelope" jsonb, "lastCounter" bigint,
      "candidateId" uuid, "candidateEnvelope" jsonb, "candidateExpiresAt" timestamptz,
      "candidateAttempts" integer NOT NULL DEFAULT 0 CHECK ("candidateAttempts" BETWEEN 0 AND 5),
      "failedAttempts" integer NOT NULL DEFAULT 0 CHECK ("failedAttempts" BETWEEN 0 AND 10),
      "failureWindowStart" timestamptz, "blockedUntil" timestamptz,
      CHECK (("activeVersion" IS NULL AND "activeEnvelope" IS NULL AND "lastCounter" IS NULL)
        OR ("activeVersion" IS NOT NULL AND "activeEnvelope" IS NOT NULL AND "lastCounter" IS NOT NULL)),
      CHECK (("candidateId" IS NULL AND "candidateEnvelope" IS NULL AND "candidateExpiresAt" IS NULL)
        OR ("candidateId" IS NOT NULL AND "candidateEnvelope" IS NOT NULL AND "candidateExpiresAt" IS NOT NULL))
    )`);
    await runner.query(`CREATE TABLE owner_mfa_recovery (
      "codeHash" varchar(64) PRIMARY KEY CHECK ("codeHash" ~ '^[a-f0-9]{64}$'),
      "userId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      "enrollmentVersion" uuid NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "usedAt" timestamptz
    )`);
    // Transient authentication is intentionally revoked; no user/financial rows change.
    await runner.query('DELETE FROM auth_sessions');
    await runner.query('ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_state_check');
    await runner.query('ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_identity');
    await runner.query(`ALTER TABLE auth_sessions
      ADD COLUMN "failedAttempts" integer NOT NULL DEFAULT 0 CHECK ("failedAttempts" BETWEEN 0 AND 5),
      ADD COLUMN "mfaVerifiedAt" timestamptz,
      ADD CONSTRAINT auth_sessions_state_check CHECK (state IN ('anonymous','pending_mfa','authenticated')),
      ADD CONSTRAINT auth_sessions_identity CHECK (
        (state = 'anonymous' AND "userId" IS NULL AND "credentialVersion" IS NULL AND "mfaVerifiedAt" IS NULL) OR
        (state = 'pending_mfa' AND "userId" IS NOT NULL AND "credentialVersion" IS NOT NULL AND "mfaVerifiedAt" IS NULL) OR
        (state = 'authenticated' AND "userId" IS NOT NULL AND "credentialVersion" IS NOT NULL AND "mfaVerifiedAt" IS NOT NULL))`);
  }
  async down(): Promise<void> {
    throw new Error('MFA downgrade requires an explicit recovery plan');
  }
}
