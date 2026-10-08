const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const shardsPath = resolve(__dirname, 'acceptance-shards.cjs');
// Missing code is an implementation prerequisite, not the expected behavioral RED.
assert.ok(existsSync(shardsPath), 'Missing implementation prerequisite: acceptance-shards.cjs');
const shards = require('./acceptance-shards.cjs');
const profile = require('./critical-release-profile.cjs');
const pins = require('../deploy/manual-mvp-infrastructure-pins.json');

const manifest = JSON.parse(readFileSync(join(root, 'tests/e2e/manual-mvp-manifest.json'), 'utf8'));
const commit = 'a'.repeat(40);
const runId = '123';

// Characterization of the serial `critical` runner before sharding (scripts/acceptance.mjs).
const legacyChecks = [
  'provider-proxy',
  'migrations',
  'auth-limits-db',
  'manual-opening-db',
  'usd-trades-db',
  'csv-import-db',
  'carry-in-db',
  'historical-accounting-db',
  'external-usd-flows-db',
  'period-profit-db',
  'xirr-preview-db',
  'twr-preview-db',
  'linked-twr-db',
  'manual-usd-prices-db',
  'historical-valuation-db',
  'valuation-history-db',
  'display-fx-db',
  'manual-portfolio-valuation-db',
  'owned-transfers-db',
  'owned-transfers-bounds-db',
  'asset-rewards-db',
  'asset-rewards-bounds-db',
  'asset-swaps-db',
  'asset-swaps-bounds-db',
  'wallet-addresses-db',
  'asset-classification-db',
  'prices-db',
  'portfolio-valuation-db',
  'fx-rates-db',
  'portfolio-snapshots-db',
  'operation-list-db',
  'capital-flows-db',
  'manual-operations-db',
  'chain-classification-db',
  'chain-transfers-db',
  'ethereum-wallets-db',
  'solana-wallets-db',
  'owner-cli',
  'sessions-db',
  'mfa-db',
  'mfa-expiry',
  'password-reset-db',
  'security-settings-db',
  'owner-export-db',
];
const canonical = ['restore-readiness', ...legacyChecks, 'client-source-startup'];
const legacyCritical = [
  'verify-postgres-pin',
  'build:backend,frontend',
  'check:restore-readiness',
  'fixture-ownership',
  'infrastructure-up',
  ...legacyChecks.map((name) => `check:${name}`),
  'migrate',
  'seed',
  'check:client-source-startup',
  'application-up',
  'verify-postgres-identity',
  'ingress',
  'artifacts',
  'browser:critical',
];
const legacyRun = [
  'build:backend,frontend,postgres',
  'fixture-ownership',
  'infrastructure-up',
  ...legacyChecks.map((name) => `check:${name}`),
  'migrate',
  'seed',
  'check:client-source-startup',
  'application-up',
  'ingress',
  'artifacts',
  'browser:full',
];
const checksOf = (steps) =>
  steps.filter((step) => step.startsWith('check:')).map((step) => step.slice(6));

const images = () => ({
  schemaVersion: 3,
  commit,
  runId,
  backend: { tag: 'capital-tracker-backend:acceptance', imageId: `sha256:${'b'.repeat(64)}` },
  frontend: { tag: 'capital-tracker-frontend:acceptance', imageId: `sha256:${'c'.repeat(64)}` },
  infrastructure: {
    postgres: { ...pins.postgres, imageId: `sha256:${'d'.repeat(64)}` },
    redis: { ...pins.redis, imageId: `sha256:${'e'.repeat(64)}` },
  },
});
const ids = () => ({
  backend: `sha256:${'b'.repeat(64)}`,
  frontend: `sha256:${'c'.repeat(64)}`,
  postgres: `sha256:${'d'.repeat(64)}`,
  redis: `sha256:${'e'.repeat(64)}`,
});
const passed = (cases) => ({
  errors: [],
  suites: cases.map((item) => ({
    file: item.file.replace('tests/e2e/', ''),
    specs: [
      {
        title: item.title,
        tests: [{ expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed' }] }],
      },
    ],
  })),
});
function receipts() {
  return shards.SHARDS.map((shard) => {
    const kind = shards.parseShard(shard).kind;
    if (kind === 'probes') {
      return shards.shardReceipt({
        shard,
        commit,
        runId,
        images: ids(),
        probes: shards.probePlan(shard),
      });
    }
    const cases = shards.browserCases(manifest, shard);
    return shards.shardReceipt({
      shard,
      commit,
      runId,
      images: ids(),
      cases,
      playwright: passed(cases),
    });
  });
}

test('ENG-007-A shard names are explicit and validated', () => {
  assert.deepEqual(shards.SHARDS, [
    'probes-1',
    'probes-2',
    'browser-1',
    'browser-2',
    'browser-3',
    'browser-4',
  ]);
  assert.deepEqual(shards.parseShard('browser-2'), {
    name: 'browser-2',
    kind: 'browser',
    index: 1,
    count: 4,
  });
  assert.deepEqual(shards.parseShard('probes-1'), {
    name: 'probes-1',
    kind: 'probes',
    index: 0,
    count: 2,
  });
  for (const bad of [
    undefined,
    '',
    'probes-0',
    'probes-3',
    'browser-0',
    'browser-5',
    'Browser-1',
    'browser-1 ',
    'browser-01',
    'all',
  ]) {
    assert.throws(() => shards.parseShard(bad), /shard/i, String(bad));
  }
});

test('ENG-007-B every canonical probe runs in exactly one probe shard, in canonical order', () => {
  assert.deepEqual(
    shards.CHECKS.map((check) => check.name),
    canonical,
  );
  for (const name of canonical) assert.ok(existsSync(join(root, `tests/e2e/${name}.cjs`)), name);
  const union = shards.PROBE_SHARDS.flatMap((shard) => shards.probePlan(shard));
  assert.equal(new Set(union).size, union.length, 'no probe runs twice');
  assert.deepEqual(
    [...union].sort((a, b) => canonical.indexOf(a) - canonical.indexOf(b)),
    canonical,
  );
  for (const shard of shards.PROBE_SHARDS) {
    const planned = shards.probePlan(shard);
    assert.ok(planned.length > 0);
    assert.deepEqual(
      planned,
      canonical.filter((name) => planned.includes(name)),
    );
  }
  assert.throws(() => shards.probePlan('browser-1'));
});

test('ENG-007-B shard plans keep the serial runner semantics and never build', () => {
  assert.deepEqual(shards.plan('critical'), legacyCritical);
  assert.deepEqual(shards.plan('run'), legacyRun);
  const sharded = [];
  for (const shard of shards.SHARDS) {
    const steps = shards.plan('critical', shard);
    assert.equal(steps[0], 'verify-prebuilt-images', shard);
    assert.equal(steps.at(-1), 'verify-tested-images', shard);
    assert.ok(!steps.some((step) => step.startsWith('build:') || step === 'verify-postgres-pin'));
    // Within a shard, steps keep the relative order of the serial critical runner.
    const reference = legacyCritical.filter((step) => steps.includes(step));
    assert.deepEqual(
      steps.filter((step) => legacyCritical.includes(step) && step !== 'browser:critical'),
      reference.filter((step) => step !== 'browser:critical'),
    );
    if (shards.parseShard(shard).kind === 'probes') {
      assert.deepEqual(checksOf(steps), shards.probePlan(shard));
      assert.ok(!steps.some((step) => step.startsWith('browser:') || step === 'application-up'));
      const startup = steps.includes('check:client-source-startup');
      assert.equal(steps.includes('migrate'), startup);
      assert.equal(steps.includes('seed'), startup);
      if (startup) {
        assert.deepEqual(steps.slice(-4), [
          'migrate',
          'seed',
          'check:client-source-startup',
          'verify-tested-images',
        ]);
      }
    } else {
      assert.deepEqual(steps, [
        'verify-prebuilt-images',
        'fixture-ownership',
        'infrastructure-up',
        'migrate',
        'seed',
        'application-up',
        'ingress',
        'artifacts',
        `browser:${shard}`,
        'verify-tested-images',
      ]);
    }
    sharded.push(...checksOf(steps));
  }
  assert.deepEqual(
    [...sharded].sort((a, b) => canonical.indexOf(a) - canonical.indexOf(b)),
    checksOf(legacyCritical),
  );
  assert.throws(() => shards.plan('run', 'browser-1'));
  assert.throws(() => shards.plan('down'));
  assert.throws(() => shards.plan('critical', 'browser-9'));
});

test('ENG-007-B probe commands are byte-identical to the serial runner', () => {
  const mount = `${join(root, 'tests/e2e')}:/tests:ro`;
  const env = ['-e', 'NODE_PATH=/app/backend/node_modules'];
  assert.deepEqual(shards.checkInvocation('provider-proxy', root), [
    'run',
    '--rm',
    '--no-deps',
    '-v',
    `${join(root, 'tests/e2e/provider-proxy.cjs')}:/tests/provider-proxy.cjs:ro`,
    ...env,
    'migrate',
    'node',
    '/tests/provider-proxy.cjs',
  ]);
  for (const name of legacyChecks.slice(1)) {
    assert.deepEqual(shards.checkInvocation(name, root), [
      'run',
      '--rm',
      '--no-deps',
      '-v',
      mount,
      ...env,
      'migrate',
      'env',
      '-u',
      'TRUSTED_PROXY_IPS',
      'node',
      `/tests/${name}.cjs`,
    ]);
  }
  assert.deepEqual(shards.checkInvocation('client-source-startup', root), [
    'run',
    '--rm',
    '--no-deps',
    '-v',
    mount,
    ...env,
    'migrate',
    'node',
    '/tests/client-source-startup.cjs',
  ]);
  assert.throws(() => shards.checkInvocation('restore-readiness', root));
  assert.throws(() => shards.checkInvocation('absent-db', root));
});

test('ENG-007-C browser cases are a deterministic modulo split of the manifest', () => {
  const split = shards.BROWSER_SHARDS.map((shard) => shards.browserCases(manifest, shard));
  assert.deepEqual(
    split.map((cases) => cases.length),
    [9, 8, 8, 8],
  );
  split.forEach((cases, index) => {
    assert.deepEqual(
      cases,
      manifest.filter((_item, position) => position % 4 === index),
    );
  });
  const union = split.flat();
  assert.equal(new Set(union.map((item) => `${item.file}\0${item.title}`)).size, manifest.length);
  assert.deepEqual(shards.browserCases(manifest, 'browser-2'), split[1]);
  assert.throws(() => shards.browserCases(manifest, 'probes-1'));
});

test('ENG-007-D merge produces the unchanged critical receipt only from complete identical shards', () => {
  const merged = shards.mergeShards(images(), receipts(), manifest, commit, runId);
  assert.deepEqual(profile.verify(merged, manifest, commit, runId), merged);
  assert.deepEqual(Object.keys(merged).sort(), [
    'cases',
    'commit',
    'manifestSha256',
    'profile',
    'runId',
    'schemaVersion',
  ]);
});

test('ENG-007-D merge rejects missing, extra, duplicated or reordered probes', () => {
  const mutate = (shard, change) => {
    const all = receipts();
    const item = all.find((candidate) => candidate.shard === shard);
    change(item, all);
    return all;
  };
  const reject = (all, label) =>
    assert.throws(() => shards.mergeShards(images(), all, manifest, commit, runId), Error, label);
  reject(
    mutate('probes-1', (item) => item.probes.pop()),
    'missing probe',
  );
  reject(
    mutate('probes-1', (item) => item.probes.push('absent-db')),
    'extra probe',
  );
  reject(
    mutate('probes-2', (item, all) => item.probes.push(all[0].probes[1])),
    'duplicated probe across shards',
  );
  reject(
    mutate('probes-1', (item) => item.probes.reverse()),
    'reordered probes',
  );
  reject(
    mutate('probes-1', (item) => {
      item.probes = [];
    }),
    'empty probe shard',
  );
});

test('ENG-007-D merge rejects missing, extra, duplicated or failed browser cases', () => {
  const browser = (shard, change) => {
    const all = receipts();
    change(
      all.find((candidate) => candidate.shard === shard),
      all,
    );
    return all;
  };
  const reject = (all, label) =>
    assert.throws(() => shards.mergeShards(images(), all, manifest, commit, runId), Error, label);
  reject(
    browser('browser-1', (item) => item.playwright.suites.pop()),
    'missing executed case',
  );
  reject(
    browser('browser-1', (item) => {
      item.cases.pop();
      item.playwright.suites.pop();
    }),
    'missing declared case',
  );
  reject(
    browser('browser-2', (item, all) => {
      const other = all.find((candidate) => candidate.shard === 'browser-1');
      item.cases.push(other.cases[0]);
      item.playwright.suites.push(other.playwright.suites[0]);
    }),
    'duplicated case across shards',
  );
  reject(
    browser('browser-3', (item) => {
      item.playwright.suites.push(structuredClone(item.playwright.suites[0]));
    }),
    'executed twice',
  );
  reject(
    browser('browser-3', (item) => {
      item.playwright.suites[0].specs[0].tests[0].results[0].status = 'failed';
      item.playwright.suites[0].specs[0].tests[0].status = 'unexpected';
    }),
    'failed case',
  );
  reject(
    browser('browser-3', (item) => {
      item.playwright.suites[0].specs[0].tests[0].results = [
        { status: 'failed' },
        { status: 'passed' },
      ];
      item.playwright.suites[0].specs[0].tests[0].status = 'flaky';
    }),
    'retried case',
  );
  reject(
    browser('browser-2', (item) => {
      item.playwright.errors = [{ message: 'global setup failed' }];
    }),
    'execution error',
  );
  reject(
    browser('browser-1', (item) => {
      item.playwright.suites[0].specs[0].title = 'absent title';
    }),
    'extra case',
  );
});

test('ENG-007-D merge rejects foreign identity, images and missing or extra shards', () => {
  const reject = (all, label, expectedCommit = commit, expectedRun = runId, built = images()) =>
    assert.throws(
      () => shards.mergeShards(built, all, manifest, expectedCommit, expectedRun),
      Error,
      label,
    );
  for (const shard of shards.SHARDS) {
    for (const image of ['backend', 'frontend', 'postgres', 'redis']) {
      const all = receipts();
      all.find((item) => item.shard === shard).images[image] = `sha256:${'f'.repeat(64)}`;
      reject(all, `${shard} tested another ${image}`);
    }
    const commitAll = receipts();
    commitAll.find((item) => item.shard === shard).commit = 'b'.repeat(40);
    reject(commitAll, `${shard} commit`);
    const runAll = receipts();
    runAll.find((item) => item.shard === shard).runId = '124';
    reject(runAll, `${shard} run`);
    reject(
      receipts().filter((item) => item.shard !== shard),
      `missing ${shard}`,
    );
    const extra = receipts();
    extra.push(structuredClone(extra.find((item) => item.shard === shard)));
    reject(extra, `duplicate ${shard}`);
    const extraKey = receipts();
    extraKey.find((item) => item.shard === shard).note = 'unexpected';
    reject(extraKey, `unexpected field in ${shard}`);
  }
  reject(receipts(), 'other commit', 'b'.repeat(40));
  reject(receipts(), 'other run', commit, '124');
  reject(receipts(), 'local run', commit, 'local');
  const otherBuild = images();
  otherBuild.backend.imageId = `sha256:${'0'.repeat(64)}`;
  reject(receipts(), 'other build manifest', commit, runId, otherBuild);
  const renamed = receipts();
  renamed[0].shard = 'probes-3';
  reject(renamed, 'unknown shard');
  assert.throws(() =>
    shards.shardReceipt({
      shard: 'probes-1',
      commit,
      runId,
      images: ids(),
      probes: ['migrations'],
    }),
  );
  assert.throws(() =>
    shards.shardReceipt({
      shard: 'browser-1',
      commit,
      runId,
      images: { ...ids(), redis: 'redis:latest' },
      cases: shards.browserCases(manifest, 'browser-1'),
      playwright: passed(shards.browserCases(manifest, 'browser-1')),
    }),
  );
});

test('ENG-007-A loaded images must equal the build manifest', () => {
  const inspected = (overrides = {}) => {
    const built = images();
    const byTag = {
      [built.backend.tag]: built.backend.imageId,
      [built.frontend.tag]: built.frontend.imageId,
      [pins.postgres.tag]: built.infrastructure.postgres.imageId,
      [pins.redis.tag]: built.infrastructure.redis.imageId,
      ...overrides,
    };
    return (tag) => ({
      Id: byTag[tag],
      Os: 'linux',
      Architecture: 'amd64',
      Config: { Labels: { 'org.opencontainers.image.revision': pins.postgres.originRevision } },
    });
  };
  assert.deepEqual(shards.verifyImages(images(), commit, runId, pins, inspected()), ids());
  assert.throws(() =>
    shards.verifyImages(
      images(),
      commit,
      runId,
      pins,
      inspected({ [pins.redis.tag]: `sha256:${'9'.repeat(64)}` }),
    ),
  );
  assert.throws(() => shards.verifyImages(images(), 'b'.repeat(40), runId, pins, inspected()));
  assert.throws(() => shards.verifyImages(images(), commit, '124', pins, inspected()));
  assert.throws(() =>
    shards.verifyImages({ ...images(), schemaVersion: 2 }, commit, runId, pins, inspected()),
  );
});

test('ENG-007-D merge CLI accepts exactly one receipt file per shard and never leaves stale output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'capital-shard-merge-'));
  const received = join(directory, 'received');
  const output = join(directory, 'out/critical-release-acceptance.json');
  const imagesPath = join(directory, 'manifest.json');
  const merge = () =>
    spawnSync(
      process.execPath,
      [shardsPath, 'merge', imagesPath, received, commit, runId, output],
      { cwd: root, encoding: 'utf8', timeout: 10_000 },
    );
  try {
    mkdirSync(received, { recursive: true });
    mkdirSync(join(directory, 'out'), { recursive: true });
    writeFileSync(imagesPath, JSON.stringify(images()));
    for (const item of receipts()) {
      writeFileSync(join(received, `critical-shard-${item.shard}.json`), JSON.stringify(item));
    }
    writeFileSync(join(received, 'unexpected.json'), '{}');
    writeFileSync(output, '{"stale":true}');
    assert.notEqual(merge().status, 0);
    assert.equal(existsSync(output), false);
    rmSync(join(received, 'unexpected.json'));
    rmSync(join(received, 'critical-shard-browser-4.json'));
    assert.notEqual(merge().status, 0);
    assert.equal(existsSync(output), false);
    const last = receipts().at(-1);
    writeFileSync(join(received, 'critical-shard-browser-4.json'), JSON.stringify(last));
    const result = merge();
    assert.equal(result.status, 0, result.stderr);
    const verified = spawnSync(
      process.execPath,
      [join(root, 'scripts/critical-release-profile.cjs'), 'verify', output, commit, runId],
      { cwd: root, encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(verified.status, 0, verified.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
