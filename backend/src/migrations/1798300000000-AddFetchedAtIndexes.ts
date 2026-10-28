import { MigrationInterface, QueryRunner } from 'typeorm';

// The snapshot change detector reads the newest fetch time of prices and rates on every history
// read; these indexes answer each max("fetchedAt") from the end of an index instead of a scan.
export class AddFetchedAtIndexes1798300000000 implements MigrationInterface {
  name = 'AddFetchedAtIndexes1798300000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'CREATE INDEX price_observations_fetched ON price_observations ("fetchedAt")',
    );
    await runner.query('CREATE INDEX fx_rates_fetched ON fx_rates ("fetchedAt")');
    await runner.query(
      'CREATE INDEX broker_price_observations_fetched ON broker_price_observations ("ownerId", "fetchedAt")',
    );
  }

  async down(): Promise<void> {
    throw new Error('Fetched-at index downgrade requires an explicit recovery plan');
  }
}
