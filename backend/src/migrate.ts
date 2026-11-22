import 'reflect-metadata';
import { DataSource, MigrationExecutor, MigrationInterface, QueryRunner } from 'typeorm';

class MigrationSafetyError extends Error {}

// These historical migrations discard rows or original values. Never approve an
// existing-schema upgrade implicitly. A separate data-preserving plan is required.
const destructiveLegacy = new Set([
  'MigrateCurrencyToForeignKey1764000000000',
  'DropStubModuleTables1764100000000',
  'DropRemovedModuleTables1764200000000',
  'CleanupCryptoTypeEnum1764300000000',
]);

// The backend's own role (DB_APP_USERNAME, docs/manual-mvp-release.md): a plain identifier, so
// it can be quoted into GRANT statements, which take no parameters.
const APP_ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const ROLE_CHECK =
  "SELECT r.rolcanlogin AS login, (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AS admin, EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS member, (EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner = r.oid) OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspowner = r.oid) OR EXISTS (SELECT 1 FROM pg_database d WHERE d.datdba = r.oid)) AS owner, has_database_privilege(r.oid, current_database(), 'CREATE') AS creates FROM pg_roles r WHERE r.rolname = $1";

// Why a role may not run the application, or undefined when it may. Anything but a plain
// boolean counts against it.
function roleRefusal(row: Record<string, unknown> | undefined): string | undefined {
  if (!row) return 'does not exist';
  if (row.login !== true) return 'cannot log in';
  if (row.admin !== false)
    return 'has administrative attributes (superuser, createdb, createrole, replication or bypassrls)';
  if (row.member !== false) return 'is a member of another role';
  if (row.owner !== false) return 'owns database objects';
  if (row.creates !== false) return 'may create schemas in the database';
  return undefined;
}

// Exactly read and write access to the application's rows: no DDL, no TRUNCATE, no ledger.
// One simple-protocol query, so PostgreSQL applies the statements as one transaction.
const grants = (role: string) =>
  [
    `REVOKE ALL ON SCHEMA public FROM "${role}"`,
    `GRANT USAGE ON SCHEMA public TO "${role}"`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${role}"`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`,
    `REVOKE ALL ON TABLE public.migrations FROM "${role}"`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "${role}"`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`,
  ].join('; ');

// A migration's ledger name: its name field, or else its class name.
const migrationName = (migration: MigrationInterface) =>
  migration.name ?? migration.constructor.name;

function checkedCommand(): { command: string; appRole?: string } {
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
  const appRole = process.env.DB_APP_USERNAME || undefined;
  if (appRole !== undefined && !APP_ROLE.test(appRole))
    throw new MigrationSafetyError('Invalid DB_APP_USERNAME');
  if (appRole === process.env.DB_USERNAME)
    throw new MigrationSafetyError('DB_APP_USERNAME must differ from DB_USERNAME');
  return { command, appRole };
}

// The command's work while it holds the migration advisory lock.
async function migrateLocked(
  dataSource: DataSource,
  runner: QueryRunner,
  command: string,
  appRole: string | undefined,
): Promise<void> {
  const [ledger] = await runner.query("SELECT to_regclass('public.migrations') AS name");
  const applied: { name: string }[] = ledger.name
    ? await runner.query('SELECT name FROM public.migrations ORDER BY id')
    : [];
  const appliedNames = new Set(applied.map((migration) => migration.name));
  const pending = dataSource.migrations.filter(
    (migration) => !appliedNames.has(migrationName(migration)),
  );
  if (command === 'show') {
    for (const migration of dataSource.migrations) {
      const name = migrationName(migration);
      console.log(`${appliedNames.has(name) ? '[X]' : '[ ]'} ${name}`);
    }
    return;
  }
  if (appRole) {
    const [role] = await runner.query(ROLE_CHECK, [appRole]);
    const refusal = roleRefusal(role);
    if (refusal) throw new MigrationSafetyError(`Runtime role refused: ${appRole} ${refusal}`);
  }
  const tables: { tablename: string }[] = await runner.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('migrations', 'typeorm_metadata')",
  );
  if (
    tables.length > 0 &&
    pending.some((migration) => destructiveLegacy.has(migrationName(migration)))
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
  // Every run, so tables from earlier releases are covered as well as new ones.
  if (appRole) {
    try {
      await runner.query(grants(appRole));
    } catch {
      throw new MigrationSafetyError(
        `Migrations applied, but granting the runtime role ${appRole} data access failed; its access is unchanged. Inspect the role before retrying.`,
      );
    }
  }
  if (appRole) console.log(`Runtime role ${appRole}: data access granted`);
}

async function main(): Promise<void> {
  const { command, appRole } = checkedCommand();
  const { default: dataSource } = await import('./typeorm-data-source');
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  let locked = false;
  try {
    await runner.connect();
    const [lock] = await runner.query('SELECT pg_try_advisory_lock(1763669182) AS acquired');
    locked = lock.acquired === true;
    if (!locked) throw new MigrationSafetyError('Another migration command is running');
    await migrateLocked(dataSource, runner, command, appRole);
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
