// Source-level pin of the explicit migration CLI. Importing migrate.ts runs it, so each case
// loads it in an isolated registry against a fake data source; no database is reached.
// tests/e2e/migrations.cjs carries the real PostgreSQL evidence.
const mockDatabase: { source: unknown; Executor: unknown } = {
  source: undefined,
  Executor: undefined,
};
jest.mock('./typeorm-data-source', () => ({
  __esModule: true,
  get default() {
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
const SECRET = 'synthetic-db-password';
const SETTINGS = {
  DB_HOST: 'db.synthetic.invalid',
  DB_PORT: '5432',
  DB_USERNAME: 'synthetic-user',
  DB_PASSWORD: SECRET,
  DB_NAME: 'synthetic',
};

type Step = 'initialize' | 'connect' | 'ledger' | 'execute' | 'unlock' | 'release' | 'destroy';
interface Options {
  lock?: unknown;
  ledger?: boolean;
  applied?: string[];
  tables?: string[];
  migrations?: object[];
  executed?: number;
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

function database(options: Options = {}) {
  const failing = (step: Step) => {
    const error = options.fail?.[step];
    if (error) throw error;
  };
  const runner = {
    connect: async () => {
      log.push(['connect']);
      failing('connect');
    },
    query: async (sql: string) => {
      log.push(['query', sql]);
      if (sql === LOCK) return [{ acquired: 'lock' in options ? options.lock : true }];
      if (sql === LEDGER) {
        failing('ledger');
        return [{ name: options.ledger === false ? null : 'migrations' }];
      }
      if (sql === APPLIED) return (options.applied ?? []).map((name) => ({ name }));
      if (sql === TABLES) return (options.tables ?? []).map((tablename) => ({ tablename }));
      if (sql === UNLOCK) {
        failing('unlock');
        return [{ pg_advisory_unlock: true }];
      }
      return [];
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
  exitCode = process.exitCode;
  process.exitCode = undefined;
  process.env = { ...env, ...SETTINGS };
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
