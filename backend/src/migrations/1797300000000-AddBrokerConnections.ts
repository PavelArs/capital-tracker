import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBrokerConnections1797300000000 implements MigrationInterface {
  name = 'AddBrokerConnections1797300000000';

  async up(runner: QueryRunner): Promise<void> {
    // BROKER-CONNECT: the read-only API token of a broker account, encrypted with a key derived
    // from the server's MFA key and never returned, and which of the broker's own accounts the
    // app reads. One connection per broker account; no other table changes.
    await runner.query(`CREATE TABLE broker_connections (
      "ownerId" uuid NOT NULL,
      "accountId" uuid PRIMARY KEY,
      provider text NOT NULL CHECK (provider = 'tbank'),
      credentials jsonb NOT NULL CHECK (jsonb_typeof(credentials) = 'object'),
      "tokenHint" text NOT NULL CHECK ("tokenHint" ~ '^[0-9A-Za-z_-]{4}$'),
      "brokerAccountId" text NOT NULL CHECK ("brokerAccountId" ~ '^[0-9A-Za-z_-]{1,64}$'),
      "savedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("savedAt")),
      "checkedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("checkedAt")),
      FOREIGN KEY ("ownerId", "accountId") REFERENCES manual_accounts ("ownerId", id) ON DELETE RESTRICT
    )`);
  }

  async down(): Promise<void> {
    throw new Error('Broker connections downgrade requires an explicit recovery plan');
  }
}
