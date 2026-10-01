import 'reflect-metadata';
import { MigrationExecutor } from 'typeorm';

class MigrationSafetyError extends Error {}

// These historical migrations discard rows or original values. Never approve an
// existing-schema upgrade implicitly. A separate data-preserving plan is required.
const destructiveLegacy = new Set([
  'MigrateCurrencyToForeignKey1764000000000',
  'DropStubModuleTables1764100000000',
  'DropRemovedModuleTables1764200000000',
  'CleanupCryptoTypeEnum1764300000000',
]);

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'run';
  if (!['run', 'show'].includes(command)) {
    throw new MigrationSafetyError(
      'Use migrate.js [run|show]; automatic rollback is not supported',
    );
  }
  // Validate before import so errors are safe and do not load a default connection.
  for (const name of ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME']) {
    if (!process.env[name])
      throw new MigrationSafetyError(`Missing required migration setting: ${name}`);
  }
  const port = Number(process.env.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MigrationSafetyError('Invalid migration DB_PORT');
  }
  const { default: dataSource } = await import('./typeorm-data-source');
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  let locked = false;
  try {
    await runner.connect();
    const [lock] = await runner.query('SELECT pg_try_advisory_lock(1763669182) AS acquired');
    locked = lock.acquired === true;
    if (!locked) throw new MigrationSafetyError('Another migration command is running');
    const [ledger] = await runner.query("SELECT to_regclass('public.migrations') AS name");
    const applied: { name: string }[] = ledger.name
      ? await runner.query('SELECT name FROM public.migrations ORDER BY id')
      : [];
    const appliedNames = new Set(applied.map((migration) => migration.name));
    const pending = dataSource.migrations.filter(
      (migration) => !appliedNames.has(migration.name ?? migration.constructor.name),
    );
    if (command === 'show') {
      for (const migration of dataSource.migrations) {
        const name = migration.name ?? migration.constructor.name;
        console.log(`${appliedNames.has(name) ? '[X]' : '[ ]'} ${name}`);
      }
      return;
    }
    const tables: { tablename: string }[] = await runner.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('migrations', 'typeorm_metadata')",
    );
    if (
      tables.length > 0 &&
      pending.some((migration) =>
        destructiveLegacy.has(migration.name ?? migration.constructor.name),
      )
    ) {
      throw new MigrationSafetyError(
        'Migration preflight refused: destructive legacy migrations remain on an existing schema. Export and review a data-preserving upgrade plan first.',
      );
    }
    if (tables.length === 0) {
      // Explicit migration privilege, never application-startup privilege.
      await runner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    }
    const executor = new MigrationExecutor(dataSource, runner);
    executor.transaction = 'all';
    const executed = await executor.executePendingMigrations();
    console.log(`Migrations applied: ${executed.length}`);
  } finally {
    try {
      if (locked) await runner.query('SELECT pg_advisory_unlock(1763669182)');
    } finally {
      try {
        await runner.release();
      } finally {
        await dataSource.destroy();
      }
    }
  }
}

main().catch((error: unknown) => {
  // Driver errors may include SQL values or connection data. Never echo them here.
  console.error(
    error instanceof MigrationSafetyError
      ? error.message
      : 'Migration failed; database unchanged if the transaction rolled back. Inspect the isolated migration environment before retrying.',
  );
  process.exitCode = 1;
});
