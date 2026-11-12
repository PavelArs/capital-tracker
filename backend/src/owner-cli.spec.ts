import { Readable } from 'node:stream';

// Source-level pin of the owner bootstrap and recovery CLI. Importing owner-cli.ts runs it, so
// each case loads it in an isolated registry against a fake data source and a fake password
// hash; no database is reached. tests/e2e/owner-auth.spec.ts and sessions-db.cjs carry the real
// PostgreSQL evidence.
const mockDatabase: { source: unknown; hashed: string[]; log: unknown[][] } = {
  source: undefined,
  hashed: [],
  log: [],
};
jest.mock('./typeorm-data-source', () => ({
  __esModule: true,
  get default() {
    return mockDatabase.source;
  },
}));
jest.mock('./auth/password', () => ({
  ...jest.requireActual('./auth/password'),
  hashPassword: async (password: string) => {
    mockDatabase.log.push(['hash']);
    mockDatabase.hashed.push(password);
    return '$argon2id$synthetic-hash';
  },
}));

const HASH = '$argon2id$synthetic-hash';
const PASSWORD = 'Synthetic owner pass 2026!';
const SECRET = 'synthetic-db-password';
const EMAIL = 'owner@example.invalid';
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SETTINGS = {
  DB_HOST: 'db.synthetic.invalid',
  DB_PORT: '5432',
  DB_USERNAME: 'synthetic-user',
  DB_PASSWORD: SECRET,
  DB_NAME: 'synthetic',
};
const UUID = expect.stringMatching(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);

// The SQL exactly as the CLI sends it, whitespace included.
const SQL = {
  lock: 'SELECT pg_try_advisory_xact_lock(1763669182) AS acquired',
  owner: 'SELECT * FROM owner_auth WHERE id = 1 FOR UPDATE',
  matches: 'SELECT id FROM users WHERE lower(email) = $1',
  exists: 'SELECT EXISTS(SELECT 1 FROM users) AS present',
  insertUser: 'INSERT INTO users(id, email, password) VALUES ($1, $2, $3)',
  insertOwner: 'INSERT INTO owner_auth(id, "userId", "credentialVersion") VALUES (1, $1, $2)',
  lockFactor: 'SELECT 1 FROM owner_mfa WHERE id = 1 FOR UPDATE',
  clearFactor:
    'UPDATE owner_mfa SET "candidateId" = NULL, "candidateEnvelope" = NULL,\n' +
    '        "candidateExpiresAt" = NULL, "candidateAttempts" = 0, "failedAttempts" = 0,\n' +
    '        "failureWindowStart" = NULL, "blockedUntil" = NULL, "consecutiveFailures" = 0 WHERE id = 1',
  rotate: 'UPDATE owner_auth SET "credentialVersion" = $1 WHERE id = 1',
  password: 'UPDATE users SET password = $1, "updatedAt" = now() WHERE id = $2',
  sessions: 'DELETE FROM auth_sessions WHERE "userId" = $1',
  resets:
    'UPDATE password_reset_tokens SET "revokedAt" = clock_timestamp()\n' +
    '      WHERE "userId" = $1 AND "usedAt" IS NULL AND "revokedAt" IS NULL',
};
const USAGE =
  'Use owner-cli.js bootstrap --email EMAIL [--existing-user-id UUID] or recover --user-id UUID; optional --password-stdin';
const GENERIC =
  'Owner command failed; verify configuration and migrated database. No credential details are logged.';

type Step = 'initialize' | 'connect' | 'commit' | 'release' | 'destroy';
interface Options {
  lock?: unknown;
  owner?: Record<string, unknown> | null;
  matches?: { id: string }[];
  present?: boolean;
  failQuery?: string;
  fail?: Partial<Record<Step, Error>>;
  // A failed commit leaves the transaction active unless this says otherwise.
  commitEnds?: boolean;
}

let log: unknown[][];

// What a query was sent with, by its SQL.
const paramsOf = (sql: string) => (log.find((entry) => entry[1] === sql) ?? [])[2];

function database(options: Options = {}) {
  const failing = (step: Step) => {
    const error = options.fail?.[step];
    if (error) throw error;
  };
  const runner = {
    isTransactionActive: false,
    connect: async () => {
      log.push(['connect']);
      failing('connect');
    },
    startTransaction: async () => {
      log.push(['startTransaction']);
      runner.isTransactionActive = true;
    },
    query: async (sql: string, params?: unknown[]) => {
      log.push(params === undefined ? ['query', sql] : ['query', sql, params]);
      if (sql === options.failQuery) throw new Error(`duplicate key ${SECRET}`);
      if (sql === SQL.lock) return [{ acquired: 'lock' in options ? options.lock : true }];
      if (sql === SQL.owner) return options.owner ? [options.owner] : [];
      if (sql === SQL.matches) return options.matches ?? [];
      if (sql === SQL.exists) return [{ present: options.present ?? false }];
      return [];
    },
    commitTransaction: async () => {
      log.push(['commitTransaction']);
      if (options.commitEnds !== false) runner.isTransactionActive = false;
      if (options.fail?.commit) {
        runner.isTransactionActive = options.commitEnds === false;
        throw options.fail.commit;
      }
    },
    rollbackTransaction: async () => {
      log.push(['rollbackTransaction']);
      runner.isTransactionActive = false;
    },
    release: async () => {
      log.push(['release']);
      failing('release');
    },
  };
  mockDatabase.source = {
    setOptions: (value: unknown) => log.push(['setOptions', value]),
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
}

const passwordJson = (password = PASSWORD, confirmation = password) =>
  JSON.stringify({ password, confirmation });

async function ownerCli(args: string[], stdin: string | null = passwordJson()) {
  process.argv = ['node', 'owner-cli.js', ...args];
  jest
    .spyOn(process, 'stdin', 'get')
    .mockReturnValue(
      Readable.from(stdin === null ? [] : [Buffer.from(stdin)]) as unknown as typeof process.stdin,
    );
  await jest.isolateModulesAsync(async () => {
    await import('./owner-cli');
  });
  for (let tick = 0; tick < 20; tick++) await new Promise((resolve) => setImmediate(resolve));
  const printed = JSON.stringify(log.filter(([kind]) => kind === 'stdout' || kind === 'stderr'));
  expect(printed).not.toContain(PASSWORD);
  expect(printed).not.toContain(SECRET);
  expect(printed).not.toContain(HASH);
  return { log, exitCode: process.exitCode, hashed: mockDatabase.hashed };
}

const bootstrap = ['bootstrap', '--email', ' Owner@Example.invalid ', '--password-stdin'];
const recover = ['recover', '--user-id', OWNER, '--password-stdin'];
const failed = (message: string) => ({ log: [['stderr', message]], exitCode: 1, hashed: [] });
const opened = [
  ['hash'],
  ['setOptions', { connectTimeoutMS: 5000 }],
  ['initialize'],
  ['createQueryRunner'],
  ['connect'],
  ['startTransaction'],
  ['query', SQL.lock],
  ['query', SQL.owner],
];
const credentialWrites = (userId: unknown) => [
  ['query', SQL.password, [HASH, userId]],
  ['query', SQL.sessions, [userId]],
  ['query', SQL.resets, [userId]],
  ['commitTransaction'],
];
const rolledBack = [['rollbackTransaction'], ['release'], ['destroy']];

const argv = process.argv;
const env = { ...process.env };
let exitCode: typeof process.exitCode;
beforeEach(() => {
  log = [];
  mockDatabase.log = log;
  mockDatabase.hashed = [];
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

describe('OWNER-CLI refusals before any database work', () => {
  it('refuses unknown commands with the usage, before reading the password or settings', async () => {
    database();
    delete process.env.DB_HOST;
    expect(await ownerCli(['register', '--email', EMAIL], '{broken')).toEqual(failed(USAGE));
  });

  it.each([
    ['broken JSON', '{broken', 'Invalid password JSON input'],
    [
      'a mismatched confirmation',
      passwordJson(PASSWORD, `${PASSWORD}?`),
      'Invalid password or confirmation; require matching 15–128 characters, at most 512 UTF-8 bytes, no NUL/CR/LF',
    ],
    ['oversized input', 'x'.repeat(4097), 'Password input exceeds 4096 bytes'],
  ])('refuses %s on stdin before the settings', async (_name, stdin, message) => {
    database();
    delete process.env.DB_HOST;
    expect(await ownerCli(bootstrap, stdin)).toEqual(failed(message));
  });

  it('requires a TTY for hidden input, before the settings', async () => {
    database();
    delete process.env.DB_HOST;
    expect(await ownerCli(['recover', '--user-id', OWNER], null)).toEqual(
      failed(
        'Hidden password input requires a TTY; use --password-stdin for controlled automation',
      ),
    );
  });

  it.each(Object.keys(SETTINGS))('names the first missing setting, %s', async (name) => {
    database();
    process.env[name] = '';
    expect(await ownerCli(bootstrap)).toEqual(failed(`Missing required database setting: ${name}`));
  });

  it('checks the settings in their fixed order', async () => {
    database();
    for (const name of Object.keys(SETTINGS)) delete process.env[name];
    process.env.DB_NAME = 'synthetic';
    expect(await ownerCli(recover)).toEqual(failed('Missing required database setting: DB_HOST'));
  });

  it.each(['0', '65536', '-1', '5432.5', 'abc', ' '])('refuses the port %j', async (port) => {
    database();
    process.env.DB_PORT = port;
    expect(await ownerCli(bootstrap)).toEqual(failed('Invalid database port configuration'));
  });

  it.each(['1', '65535', ' 5432 '])(
    'accepts the port %j and hashes before connecting',
    async (port) => {
      database({ fail: { initialize: new Error(`connect ${SECRET}`) } });
      process.env.DB_PORT = port;
      expect(await ownerCli(bootstrap)).toEqual({
        log: [
          ['hash'],
          ['setOptions', { connectTimeoutMS: 5000 }],
          ['initialize'],
          ['stderr', GENERIC],
        ],
        exitCode: 1,
        hashed: [PASSWORD],
      });
    },
  );
});

describe('OWNER-CLI bootstrap', () => {
  it('provisions a new owner on an empty installation', async () => {
    database();
    const result = await ownerCli(bootstrap);
    expect(result).toEqual({
      log: [
        ...opened,
        ['query', SQL.matches, [EMAIL]],
        ['query', SQL.exists],
        ['query', SQL.insertUser, [UUID, EMAIL, HASH]],
        ['query', SQL.insertOwner, [UUID, UUID]],
        ...credentialWrites(UUID),
        ['stdout', 'Owner provisioned'],
        ['release'],
        ['destroy'],
      ],
      exitCode: undefined,
      hashed: [PASSWORD],
    });
    // One new user ID throughout, and a separate new credential revision.
    const [id] = paramsOf(SQL.insertUser) as string[];
    const [ownerId, revision] = paramsOf(SQL.insertOwner) as string[];
    expect(ownerId).toBe(id);
    expect(revision).not.toBe(id);
    expect(paramsOf(SQL.password)).toEqual([HASH, id]);
    expect(paramsOf(SQL.sessions)).toEqual([id]);
    expect(paramsOf(SQL.resets)).toEqual([id]);
  });

  it('binds the explicitly selected existing user without creating one', async () => {
    database({ matches: [{ id: OWNER }] });
    expect(
      await ownerCli([
        'bootstrap',
        '--existing-user-id',
        OWNER,
        '--email',
        EMAIL,
        '--password-stdin',
      ]),
    ).toEqual({
      log: [
        ...opened,
        ['query', SQL.matches, [EMAIL]],
        ['query', SQL.insertOwner, [OWNER, UUID]],
        ...credentialWrites(OWNER),
        ['stdout', 'Owner provisioned'],
        ['release'],
        ['destroy'],
      ],
      exitCode: undefined,
      hashed: [PASSWORD],
    });
  });

  it.each([
    ['no match', []],
    ['another user', [{ id: OTHER }]],
    ['an ambiguous email', [{ id: OWNER }, { id: OTHER }]],
  ])('refuses an explicit selection with %s', async (_name, matches) => {
    database({ matches });
    expect(
      await ownerCli([
        'bootstrap',
        '--email',
        EMAIL,
        '--existing-user-id',
        OWNER,
        '--password-stdin',
      ]),
    ).toEqual({
      log: [
        ...opened,
        ['query', SQL.matches, [EMAIL]],
        ...rolledBack,
        ['stderr', 'Owner selection is unknown, mismatched or ambiguous'],
      ],
      exitCode: 1,
      hashed: [PASSWORD],
    });
  });

  it('refuses existing users without an explicit selection', async () => {
    database({ present: true, matches: [{ id: OWNER }] });
    expect(await ownerCli(bootstrap)).toEqual({
      log: [
        ...opened,
        ['query', SQL.matches, [EMAIL]],
        ['query', SQL.exists],
        ...rolledBack,
        ['stderr', 'Existing users require explicit --existing-user-id selection'],
      ],
      exitCode: 1,
      hashed: [PASSWORD],
    });
  });

  it('never replaces an established owner', async () => {
    database({ owner: { userId: OWNER }, matches: [{ id: OWNER }] });
    expect(await ownerCli(bootstrap)).toEqual({
      log: [
        ...opened,
        ...rolledBack,
        ['stderr', 'Owner already provisioned; use recover with the established user ID'],
      ],
      exitCode: 1,
      hashed: [PASSWORD],
    });
  });
});

describe('OWNER-CLI recover', () => {
  it('rotates the revision, clears pending enrollment and limits and ends sessions and links', async () => {
    database({ owner: { userId: OWNER } });
    expect(await ownerCli(recover)).toEqual({
      log: [
        ...opened,
        ['query', SQL.lockFactor],
        ['query', SQL.clearFactor],
        ['query', SQL.rotate, [UUID]],
        ...credentialWrites(OWNER),
        ['stdout', 'Owner password recovered; earlier credentials revoked'],
        ['release'],
        ['destroy'],
      ],
      exitCode: undefined,
      hashed: [PASSWORD],
    });
  });

  it.each([
    ['no owner', null],
    ['another owner', { userId: OTHER }],
  ])('refuses %s', async (_name, owner) => {
    database({ owner });
    expect(await ownerCli(recover)).toEqual({
      log: [
        ...opened,
        ...rolledBack,
        ['stderr', 'Recovery requires the established owner user ID'],
      ],
      exitCode: 1,
      hashed: [PASSWORD],
    });
  });
});

describe('OWNER-CLI lock, rollback and cleanup', () => {
  it.each([[false], [1], ['true'], [null]])(
    'refuses while another command holds the lock (acquired %j)',
    async (lock) => {
      database({ lock, owner: { userId: OWNER } });
      expect(await ownerCli(recover)).toEqual({
        log: [
          ...opened.slice(0, -1),
          ...rolledBack,
          ['stderr', 'Another migration or owner command is running; retry later'],
        ],
        exitCode: 1,
        hashed: [PASSWORD],
      });
    },
  );

  it('rolls back a failed write and never echoes it', async () => {
    database({ owner: { userId: OWNER }, failQuery: SQL.sessions });
    const result = await ownerCli(recover);
    expect(result.log.slice(-5)).toEqual([
      ['query', SQL.sessions, [OWNER]],
      ['rollbackTransaction'],
      ['release'],
      ['destroy'],
      ['stderr', GENERIC],
    ]);
    expect(result.exitCode).toBe(1);
  });

  it('rolls back after a failed commit that left the transaction active', async () => {
    database({ owner: { userId: OWNER }, commitEnds: false, fail: { commit: new Error(SECRET) } });
    const result = await ownerCli(recover);
    expect(result.log.slice(-5)).toEqual([
      ['commitTransaction'],
      ['rollbackTransaction'],
      ['release'],
      ['destroy'],
      ['stderr', GENERIC],
    ]);
  });

  it('does not roll back a transaction that is no longer active', async () => {
    database({ owner: { userId: OWNER }, fail: { commit: new Error(SECRET) } });
    const result = await ownerCli(recover);
    expect(result.log.slice(-4)).toEqual([
      ['commitTransaction'],
      ['release'],
      ['destroy'],
      ['stderr', GENERIC],
    ]);
  });

  it('releases and destroys without a rollback when the connection fails', async () => {
    database({ fail: { connect: new Error(SECRET) } });
    expect(await ownerCli(bootstrap)).toEqual({
      log: [...opened.slice(0, 5), ['release'], ['destroy'], ['stderr', GENERIC]],
      exitCode: 1,
      hashed: [PASSWORD],
    });
  });

  it('still destroys when releasing fails after success', async () => {
    database({ owner: { userId: OWNER }, fail: { release: new Error(SECRET) } });
    const result = await ownerCli(recover);
    expect(result.log.slice(-4)).toEqual([
      ['stdout', 'Owner password recovered; earlier credentials revoked'],
      ['release'],
      ['destroy'],
      ['stderr', GENERIC],
    ]);
    expect(result.exitCode).toBe(1);
  });

  it('reports a failed destroy generically', async () => {
    database({ owner: { userId: OWNER }, fail: { destroy: new Error(SECRET) } });
    const result = await ownerCli(recover);
    expect(result.log.slice(-2)).toEqual([['destroy'], ['stderr', GENERIC]]);
    expect(result.exitCode).toBe(1);
  });
});
