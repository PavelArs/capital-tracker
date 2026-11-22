// Source-level pin of the explicit migration CLI. Importing migrate.ts runs it, so each case
// loads it in an isolated registry against a fake data source; no database is reached.
// tests/e2e/migrations.cjs carries the real PostgreSQL evidence.
const mockDatabase: { source: unknown; loads: number; Executor: unknown } = {
  source: undefined,
  loads: 0,
  Executor: undefined,
};
jest.mock('./typeorm-data-source', () => ({
  __esModule: true,
  get default() {
    mockDatabase.loads += 1;
    return mockDatabase.source;
  },
}));
jest.mock('typeorm', () => ({
  get MigrationExecutor() {
    return mockDatabase.Executor;
  },
}));

const LOCK = 'SELECT pg_try_advisory_lock(1763669182) AS acquired';
const LEDGER = "SELECT to_regclass('public.migrations') AS name";
const APPLIED = 'SELECT name FROM public.migrations ORDER BY id';
const TABLES =
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('migrations', 'typeorm_metadata')";
const EXTENSION = 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"';
const UNLOCK = 'SELECT pg_advisory_unlock(1763669182)';
const USAGE = 'Use migrate.js [run|show]; automatic rollback is not supported';
const BUSY = 'Another migration command is running';
const REFUSED =
  'Migration preflight refused: destructive legacy migrations remain on an existing schema. Export and review a data-preserving upgrade plan first.';
const GENERIC =
  'Migration failed; database unchanged if the transaction rolled back. Inspect the isolated migration environment before retrying.';
const ROLE_CHECK =
  "SELECT r.rolcanlogin AS login, (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AS admin, EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS member, (EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner = r.oid) OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspowner = r.oid) OR EXISTS (SELECT 1 FROM pg_database d WHERE d.datdba = r.oid)) AS owner, has_database_privilege(r.oid, current_database(), 'CREATE') AS creates FROM pg_roles r WHERE r.rolname = $1";
const GRANTS = [
  'REVOKE ALL ON SCHEMA public FROM "capital_app"',
  'GRANT USAGE ON SCHEMA public TO "capital_app"',
  'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "capital_app"',
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "capital_app"',
  'REVOKE ALL ON TABLE public.migrations FROM "capital_app"',
  'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "capital_app"',
  'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "capital_app"',
].join('; ');
const SECRET = 'synthetic-db-password';
const SETTINGS = {
  DB_HOST: 'db.synthetic.invalid',
  DB_PORT: '5432',
  DB_USERNAME: 'synthetic-user',
  DB_PASSWORD: SECRET,
  DB_NAME: 'synthetic',
};

type Step =
  | 'initialize'
  | 'connect'
  | 'ledger'
  | 'execute'
  | 'grant'
  | 'unlock'
  | 'release'
  | 'destroy';
type Role = { login: unknown; admin: unknown; member: unknown; owner: unknown; creates: unknown };
const restricted: Role = { login: true, admin: false, member: false, owner: false, creates: false };
interface Options {
  lock?: unknown;
  ledger?: boolean;
  applied?: string[];
  tables?: string[];
  migrations?: object[];
  executed?: number;
  // The runtime role's row; null when it does not exist.
  role?: Role | null;
  fail?: Partial<Record<Step, Error>>;
}

const named = (name: string) => ({ name });
// A migration without a name field is known by its class name.
const unnamed = (name: string) => {
  const Migration = { [name]: class {} }[name];
  return new Migration();
};
const defaultMigrations = () => [
  named('CreateBase1000000000000'),
  named('MigrateCurrencyToForeignKey1764000000000'),
  unnamed('AddLedger1765000000000'),
];

let log: unknown[][];

function failAt(options: Options, step: Step): void {
  const error = options.fail?.[step];
  if (error) throw error;
}

// The fake database's answer to each query of the migration CLI.
function answer(sql: string, options: Options): unknown[] {
  if (sql === LOCK) return [{ acquired: 'lock' in options ? options.lock : true }];
  if (sql === LEDGER) {
    failAt(options, 'ledger');
    return [{ name: options.ledger === false ? null : 'migrations' }];
  }
  if (sql === APPLIED) return (options.applied ?? []).map((name) => ({ name }));
  if (sql === TABLES) return (options.tables ?? []).map((tablename) => ({ tablename }));
  if (sql === ROLE_CHECK) return options.role === null ? [] : [options.role ?? restricted];
  if (sql === GRANTS) failAt(options, 'grant');
  if (sql === UNLOCK) {
    failAt(options, 'unlock');
    return [{ pg_advisory_unlock: true }];
  }
  return [];
}

function database(options: Options = {}) {
  const failing = (step: Step) => failAt(options, step);
  const runner = {
    connect: async () => {
      log.push(['connect']);
      failing('connect');
    },
    query: async (sql: string, parameters?: unknown[]) => {
      log.push(parameters ? ['query', sql, parameters] : ['query', sql]);
      return answer(sql, options);
    },
    release: async () => {
      log.push(['release']);
      failing('release');
    },
  };
  const source = {
    migrations: options.migrations ?? defaultMigrations(),
    initialize: async () => {
      log.push(['initialize']);
      failing('initialize');
    },
    createQueryRunner: () => {
      log.push(['createQueryRunner']);
      return runner;
    },
    destroy: async () => {
      log.push(['destroy']);
      failing('destroy');
    },
  };
  mockDatabase.source = source;
  mockDatabase.Executor = class {
    transaction: unknown;
    constructor(dataSource: unknown, queryRunner: unknown) {
      log.push(['executor', dataSource === source, queryRunner === runner]);
    }
    async executePendingMigrations() {
      log.push(['execute', this.transaction]);
      failing('execute');
      return Array.from({ length: options.executed ?? 2 }, () => ({}));
    }
  };
}

async function migrate(...args: string[]) {
  process.argv = ['node', 'migrate.js', ...args];
  await jest.isolateModulesAsync(async () => {
    await import('./migrate');
  });
  for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setImmediate(resolve));
  const printed = JSON.stringify(log);
  expect(printed).not.toContain(SECRET);
  return { log, exitCode: process.exitCode };
}

const opened = [['initialize'], ['createQueryRunner'], ['connect'], ['query', LOCK]];
const closed = [['query', UNLOCK], ['release'], ['destroy']];
const failed = (message: string) => ({ log: [['stderr', message]], exitCode: 1 });

const argv = process.argv;
const env = { ...process.env };
let exitCode: typeof process.exitCode;
beforeEach(() => {
  log = [];
  mockDatabase.loads = 0;
  exitCode = process.exitCode;
  process.exitCode = undefined;
  process.env = { ...env, ...SETTINGS };
  delete process.env.DB_APP_USERNAME;
  jest.spyOn(console, 'log').mockImplementation((message: string) => {
    log.push(['stdout', message]);
  });
  jest.spyOn(console, 'error').mockImplementation((message: string) => {
    log.push(['stderr', message]);
  });
});
afterEach(() => {
  process.exitCode = exitCode;
  process.argv = argv;
  process.env = { ...env };
  jest.restoreAllMocks();
});

describe('MIGRATE-CLI refusals before any database work', () => {
  it.each([['down'], ['revert'], ['Show'], ['']])(
    'refuses the command %j with its usage, before the settings',
    async (command) => {
      database();
      delete process.env.DB_HOST;
      expect(await migrate(command)).toEqual(failed(USAGE));
    },
  );

  it('reads only the first argument as the command', async () => {
    database({ ledger: false, migrations: [] });
    expect(await migrate('show', 'down')).toEqual({
      log: [...opened, ['query', LEDGER], ['query', UNLOCK], ['release'], ['destroy']],
      exitCode: undefined,
    });
  });

  it.each(Object.keys(SETTINGS))('names the first missing setting, %s', async (name) => {
    database();
    process.env[name] = '';
    expect(await migrate('run')).toEqual(failed(`Missing required migration setting: ${name}`));
  });

  it('loads the data source only after the settings pass', async () => {
    database();
    process.env.DB_HOST = '';
    await migrate('run');
    expect(mockDatabase.loads).toBe(0);
    process.env.DB_HOST = SETTINGS.DB_HOST;
    await migrate('show');
    expect(mockDatabase.loads).toBe(1);
  });

  it('checks the settings in their fixed order', async () => {
    database();
    for (const name of Object.keys(SETTINGS)) delete process.env[name];
    process.env.DB_NAME = 'synthetic';
    expect(await migrate('show')).toEqual(failed('Missing required migration setting: DB_HOST'));
  });

  it.each(['0', '65536', '-1', '5432.5', 'abc', ' '])('refuses the port %j', async (port) => {
    database();
    process.env.DB_PORT = port;
    expect(await migrate()).toEqual(failed('Invalid migration DB_PORT'));
  });

  it.each(['1', '65535', ' 5432 '])('accepts the port %j', async (port) => {
    database({ fail: { initialize: new Error(`connect ${SECRET}`) } });
    process.env.DB_PORT = port;
    expect(await migrate('run')).toEqual({
      log: [['initialize'], ['stderr', GENERIC]],
      exitCode: 1,
    });
  });
});

describe('MIGRATE-CLI lock and cleanup', () => {
  it.each([[false], [1], ['true'], [null]])(
    'refuses while another command holds the lock (acquired %j) and never unlocks',
    async (lock) => {
      database({ lock });
      expect(await migrate('run')).toEqual({
        log: [...opened, ['release'], ['destroy'], ['stderr', BUSY]],
        exitCode: 1,
      });
    },
  );

  it('releases and destroys without unlocking when the connection fails', async () => {
    database({ fail: { connect: new Error(SECRET) } });
    expect(await migrate('run')).toEqual({
      log: [
        ['initialize'],
        ['createQueryRunner'],
        ['connect'],
        ['release'],
        ['destroy'],
        ['stderr', GENERIC],
      ],
      exitCode: 1,
    });
  });

  it('unlocks, releases and destroys after a failed ledger read, with the generic message', async () => {
    database({ fail: { ledger: new Error(`relation ${SECRET}`) } });
    expect(await migrate('show')).toEqual({
      log: [...opened, ['query', LEDGER], ...closed, ['stderr', GENERIC]],
      exitCode: 1,
    });
  });

  it('still releases and destroys when unlocking fails, after the result was printed', async () => {
    database({
      tables: ['users'],
      applied: ['MigrateCurrencyToForeignKey1764000000000'],
      fail: { unlock: new Error(SECRET) },
    });
    const result = await migrate('run');
    expect(result.log.slice(-5)).toEqual([
      ['stdout', 'Migrations applied: 2'],
      ['query', UNLOCK],
      ['release'],
      ['destroy'],
      ['stderr', GENERIC],
    ]);
    expect(result.exitCode).toBe(1);
  });

  it('still destroys when releasing fails', async () => {
    database({ ledger: false, fail: { release: new Error(SECRET) } });
    const result = await migrate('show');
    expect(result.log.slice(-4)).toEqual([
      ['query', UNLOCK],
      ['release'],
      ['destroy'],
      ['stderr', GENERIC],
    ]);
    expect(result.exitCode).toBe(1);
  });

  it('reports a failed destroy generically', async () => {
    database({ ledger: false, fail: { destroy: new Error(SECRET) } });
    const result = await migrate('show');
    expect(result.log.slice(-2)).toEqual([['destroy'], ['stderr', GENERIC]]);
    expect(result.exitCode).toBe(1);
  });
});

describe('MIGRATE-CLI show', () => {
  it('lists every migration in order with its applied mark, by name or class name', async () => {
    database({
      applied: ['CreateBase1000000000000', 'AddLedger1765000000000'],
      tables: ['users'],
    });
    expect(await migrate('show')).toEqual({
      log: [
        ...opened,
        ['query', LEDGER],
        ['query', APPLIED],
        ['stdout', '[X] CreateBase1000000000000'],
        ['stdout', '[ ] MigrateCurrencyToForeignKey1764000000000'],
        ['stdout', '[X] AddLedger1765000000000'],
        ...closed,
      ],
      exitCode: undefined,
    });
  });

  it('marks nothing applied without a ledger table and does not read it', async () => {
    database({ ledger: false, applied: ['CreateBase1000000000000'] });
    expect(await migrate('show')).toEqual({
      log: [
        ...opened,
        ['query', LEDGER],
        ['stdout', '[ ] CreateBase1000000000000'],
        ['stdout', '[ ] MigrateCurrencyToForeignKey1764000000000'],
        ['stdout', '[ ] AddLedger1765000000000'],
        ...closed,
      ],
      exitCode: undefined,
    });
  });
});

describe('MIGRATE-CLI run', () => {
  it.each([[[]], [['run']]])('runs by default (%j)', async (args) => {
    database({
      tables: ['users'],
      applied: ['MigrateCurrencyToForeignKey1764000000000'],
      executed: 3,
    });
    expect(await migrate(...args)).toEqual({
      log: [
        ...opened,
        ['query', LEDGER],
        ['query', APPLIED],
        ['query', TABLES],
        ['executor', true, true],
        ['execute', 'all'],
        ['stdout', 'Migrations applied: 3'],
        ...closed,
      ],
      exitCode: undefined,
    });
  });

  it.each([
    ['MigrateCurrencyToForeignKey1764000000000', named],
    ['DropStubModuleTables1764100000000', named],
    ['DropRemovedModuleTables1764200000000', unnamed],
    ['CleanupCryptoTypeEnum1764300000000', unnamed],
  ])('refuses pending %s on an existing schema before any change', async (name, make) => {
    database({
      tables: ['users'],
      migrations: [named('CreateBase1000000000000'), make(name)],
      applied: ['CreateBase1000000000000'],
    });
    expect(await migrate('run')).toEqual({
      log: [
        ...opened,
        ['query', LEDGER],
        ['query', APPLIED],
        ['query', TABLES],
        ...closed,
        ['stderr', REFUSED],
      ],
      exitCode: 1,
    });
  });

  it('installs the extension and applies everything on an empty schema, legacy migrations included', async () => {
    database({ ledger: false, tables: [], executed: 0 });
    expect(await migrate('run')).toEqual({
      log: [
        ...opened,
        ['query', LEDGER],
        ['query', TABLES],
        ['query', EXTENSION],
        ['executor', true, true],
        ['execute', 'all'],
        ['stdout', 'Migrations applied: 0'],
        ...closed,
      ],
      exitCode: undefined,
    });
  });

  it('never echoes a failed migration', async () => {
    database({ tables: [], fail: { execute: new Error(`duplicate key ${SECRET}`) } });
    expect(await migrate('run')).toEqual({
      log: [
        ...opened,
        ['query', LEDGER],
        ['query', APPLIED],
        ['query', TABLES],
        ['query', EXTENSION],
        ['executor', true, true],
        ['execute', 'all'],
        ...closed,
        ['stderr', GENERIC],
      ],
      exitCode: 1,
    });
  });
});

describe('MIGRATE-ROLE: the runtime role gets data access only', () => {
  beforeEach(() => {
    process.env.DB_APP_USERNAME = 'capital_app';
  });

  it('MIGRATE-ROLE-A checks the role before any change and grants it data access after migrating', async () => {
    database({ tables: ['users'], applied: ['MigrateCurrencyToForeignKey1764000000000'] });
    expect(await migrate('run')).toEqual({
      log: [
        ...opened,
        ['query', LEDGER],
        ['query', APPLIED],
        ['query', ROLE_CHECK, ['capital_app']],
        ['query', TABLES],
        ['executor', true, true],
        ['execute', 'all'],
        ['stdout', 'Migrations applied: 2'],
        ['query', GRANTS],
        ['stdout', 'Runtime role capital_app: data access granted'],
        ...closed,
      ],
      exitCode: undefined,
    });
  });

  it('MIGRATE-ROLE-A grants even when nothing is pending, so the first run covers every table', async () => {
    database({
      tables: ['users'],
      migrations: [named('CreateBase1000000000000')],
      applied: ['CreateBase1000000000000'],
      executed: 0,
    });
    const { log: steps, exitCode } = await migrate('run');
    expect(exitCode).toBeUndefined();
    expect(steps).toContainEqual(['query', GRANTS]);
  });

  it('MIGRATE-ROLE-A treats an empty setting as no separate role', async () => {
    process.env.DB_APP_USERNAME = '';
    database({ tables: ['users'], applied: ['MigrateCurrencyToForeignKey1764000000000'] });
    const { log: steps, exitCode } = await migrate('run');
    expect(exitCode).toBeUndefined();
    expect(JSON.stringify(steps)).not.toMatch(/pg_roles|GRANT/);
  });

  it('MIGRATE-ROLE-A neither checks nor grants for show', async () => {
    database({ applied: ['CreateBase1000000000000'] });
    const { log: steps, exitCode } = await migrate('show');
    expect(exitCode).toBeUndefined();
    expect(JSON.stringify(steps)).not.toMatch(/pg_roles|GRANT/);
  });

  it.each([
    ['does not exist', null],
    ['cannot log in', { ...restricted, login: false }],
    [
      'has administrative attributes (superuser, createdb, createrole, replication or bypassrls)',
      { ...restricted, admin: true },
    ],
    ['is a member of another role', { ...restricted, member: true }],
    ['owns database objects', { ...restricted, owner: true }],
    ['may create schemas in the database', { ...restricted, creates: true }],
    // A row the driver did not read as booleans never passes.
    ['cannot log in', { ...restricted, login: 't' }],
    [
      'has administrative attributes (superuser, createdb, createrole, replication or bypassrls)',
      { ...restricted, admin: null },
    ],
  ])('MIGRATE-ROLE-B refuses a role that %s before any change', async (reason, role) => {
    database({ tables: ['users'], applied: ['MigrateCurrencyToForeignKey1764000000000'], role });
    expect(await migrate('run')).toEqual({
      log: [
        ...opened,
        ['query', LEDGER],
        ['query', APPLIED],
        ['query', ROLE_CHECK, ['capital_app']],
        ...closed,
        ['stderr', `Runtime role refused: capital_app ${reason}`],
      ],
      exitCode: 1,
    });
  });

  it.each([
    'Capital_app',
    '1app',
    'app-role',
    'a'.repeat(64),
    'app;drop',
    '"capital_app"',
    ' capital_app',
  ])('MIGRATE-ROLE-B refuses the name %j before loading the data source', async (name) => {
    database();
    process.env.DB_APP_USERNAME = name;
    expect(await migrate('run')).toEqual(failed('Invalid DB_APP_USERNAME'));
    expect(mockDatabase.loads).toBe(0);
  });

  it('MIGRATE-ROLE-B refuses the migration role itself as the runtime role', async () => {
    database();
    process.env.DB_USERNAME = 'capital_app';
    expect(await migrate('run')).toEqual(failed('DB_APP_USERNAME must differ from DB_USERNAME'));
  });

  it('MIGRATE-ROLE-B says the migrations stand when the grant fails, without the driver error', async () => {
    database({
      tables: ['users'],
      applied: ['MigrateCurrencyToForeignKey1764000000000'],
      fail: { grant: new Error(`permission denied ${SECRET}`) },
    });
    const { log: steps, exitCode } = await migrate('run');
    expect(exitCode).toBe(1);
    expect(steps.slice(-6)).toEqual([
      ['stdout', 'Migrations applied: 2'],
      ['query', GRANTS],
      ...closed,
      [
        'stderr',
        'Migrations applied, but granting the runtime role capital_app data access failed; its access is unchanged. Inspect the role before retrying.',
      ],
    ]);
  });
});
