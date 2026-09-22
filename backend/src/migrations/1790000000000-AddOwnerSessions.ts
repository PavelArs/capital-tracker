import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddOwnerSessions1790000000000 implements MigrationInterface {
  name = 'AddOwnerSessions1790000000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE auth_sessions (
      "tokenHash" varchar(64) PRIMARY KEY CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
      "csrfToken" varchar(43) NOT NULL CHECK ("csrfToken" ~ '^[A-Za-z0-9_-]{43}$'),
      state varchar(20) NOT NULL CHECK (state IN ('anonymous', 'authenticated')),
      "userId" uuid REFERENCES users(id) ON DELETE RESTRICT,
      "credentialVersion" uuid,
      "createdAt" timestamptz NOT NULL,
      "lastSeenAt" timestamptz NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      CONSTRAINT auth_sessions_identity CHECK (
        (state = 'anonymous' AND "userId" IS NULL AND "credentialVersion" IS NULL) OR
        (state = 'authenticated' AND "userId" IS NOT NULL AND "credentialVersion" IS NOT NULL))
    )`);
    await runner.query('CREATE INDEX auth_sessions_expiry ON auth_sessions("expiresAt")');
  }
  async down(): Promise<void> {
    throw new Error('Session downgrade requires an explicit recovery plan');
  }
}
