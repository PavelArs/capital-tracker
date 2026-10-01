import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthRequestLimits1790020000000 implements MigrationInterface {
  name = 'AddAuthRequestLimits1790020000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE auth_request_limits (
      scope text NOT NULL CHECK (scope IN ('csrf-ip', 'login-ip', 'mfa-ip', 'login-account')),
      "subjectHash" varchar(64) NOT NULL CHECK ("subjectHash" ~ '^[a-f0-9]{64}$'),
      hits integer NOT NULL CHECK (hits BETWEEN 1 AND CASE scope
        WHEN 'csrf-ip' THEN 30 WHEN 'login-account' THEN 10 ELSE 5 END),
      "windowStartedAt" timestamptz NOT NULL CHECK (isfinite("windowStartedAt")),
      "expiresAt" timestamptz NOT NULL CHECK (isfinite("expiresAt")),
      PRIMARY KEY (scope, "subjectHash"),
      CHECK ("expiresAt" = "windowStartedAt" + CASE scope
        WHEN 'login-account' THEN interval '600 seconds' ELSE interval '60 seconds' END)
    )`);
    await runner.query(
      'CREATE INDEX auth_request_limits_expiry ON auth_request_limits ("expiresAt")',
    );
  }

  async down(): Promise<void> {
    throw new Error('Authentication request ledger downgrade requires an explicit recovery plan');
  }
}
