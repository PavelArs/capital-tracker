#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const profile = require('./critical-release-profile.cjs');
const {
  validateInfrastructurePins,
  validateLoadedImages,
  validateRelease,
} = require('./validate-manual-mvp-release.cjs');

const PROBE_SHARDS = ['probes-1', 'probes-2'];
const BROWSER_SHARDS = ['browser-1', 'browser-2', 'browser-3', 'browser-4'];
const SHARDS = [...PROBE_SHARDS, ...BROWSER_SHARDS];
const RECEIPT_PROFILE = 'critical-shard';

// Canonical order of the real pre-browser checks of the serial `critical` runner. Each has
// exactly one probe shard, balanced by the durations measured in CI runs 37220925062 and
// 37329645150 (s; there probes-1 took 169 s and probes-2 318 s before the last rebalance).
const CHECKS = [
  { name: 'restore-readiness', shard: 'probes-1' }, // 13
  { name: 'provider-proxy', shard: 'probes-1' },
  { name: 'migrations', shard: 'probes-1' }, // 43
  { name: 'auth-limits-db', shard: 'probes-1' }, // 18
  { name: 'manual-opening-db', shard: 'probes-1' },
  { name: 'usd-trades-db', shard: 'probes-1' }, // 28
  { name: 'csv-import-db', shard: 'probes-1' }, // 29
  { name: 'carry-in-db', shard: 'probes-2' }, // 22
  { name: 'historical-accounting-db', shard: 'probes-1' },
  { name: 'external-usd-flows-db', shard: 'probes-1' },
  { name: 'period-profit-db', shard: 'probes-1' },
  { name: 'xirr-preview-db', shard: 'probes-1' },
  { name: 'twr-preview-db', shard: 'probes-1' },
  { name: 'linked-twr-db', shard: 'probes-1' },
  { name: 'manual-usd-prices-db', shard: 'probes-1' },
  { name: 'historical-valuation-db', shard: 'probes-2' },
  { name: 'valuation-history-db', shard: 'probes-2' },
  { name: 'manual-portfolio-valuation-db', shard: 'probes-2' },
  { name: 'owned-transfers-db', shard: 'probes-2' },
  { name: 'owned-transfers-bounds-db', shard: 'probes-1' }, // 67
  { name: 'asset-rewards-db', shard: 'probes-2' },
  { name: 'asset-rewards-bounds-db', shard: 'probes-2' },
  { name: 'asset-swaps-db', shard: 'probes-2' },
  { name: 'asset-swaps-bounds-db', shard: 'probes-2' },
  { name: 'wallet-addresses-db', shard: 'probes-1' }, // 15
  { name: 'asset-classification-db', shard: 'probes-1' },
  { name: 'prices-db', shard: 'probes-1' },
  { name: 'portfolio-valuation-db', shard: 'probes-2' },
  { name: 'fx-rates-db', shard: 'probes-1' },
  { name: 'portfolio-snapshots-db', shard: 'probes-2' },
  { name: 'operation-list-db', shard: 'probes-1' },
  { name: 'capital-flows-db', shard: 'probes-1' },
  { name: 'manual-operations-db', shard: 'probes-2' },
  { name: 'chain-classification-db', shard: 'probes-1' },
  { name: 'chain-transfers-db', shard: 'probes-1' },
  { name: 'chain-swaps-db', shard: 'probes-2' },
  { name: 'chain-pools-db', shard: 'probes-1' },
  { name: 'ethereum-wallets-db', shard: 'probes-1' },
  { name: 'solana-wallets-db', shard: 'probes-2' },
  { name: 'bitcoin-xpub-db', shard: 'probes-2' },
  { name: 'bybit-db', shard: 'probes-1' },
  { name: 'tron-wallets-db', shard: 'probes-2' },
  { name: 'audit-history-db', shard: 'probes-2' },
  { name: 'stellar-wallets-db', shard: 'probes-1' },
  { name: 'zcash-wallets-db', shard: 'probes-2' },
  { name: 'owner-cli', shard: 'probes-1' }, // 25
  { name: 'sessions-db', shard: 'probes-1' }, // 34
  { name: 'mfa-db', shard: 'probes-2' }, // 42
  { name: 'mfa-expiry', shard: 'probes-2' }, // 20
  { name: 'password-reset-db', shard: 'probes-1' },
  { name: 'security-settings-db', shard: 'probes-2' },
  { name: 'owner-export-db', shard: 'probes-1' },
  // Needs the migrated and seeded main database, so its shard migrates and seeds first.
  { name: 'client-source-startup', shard: 'probes-2' }, // 44
];
const HOST_CHECK = 'restore-readiness';
const STARTUP_CHECK = 'client-source-startup';
const IMAGE_NAMES = ['backend', 'frontend', 'postgres', 'redis'];
const imagePattern = /^sha256:[a-f0-9]{64}$/;

function parseShard(value) {
  const match = /^(probes|browser)-([1-9])$/.exec(typeof value === 'string' ? value : '');
  const names = match?.[1] === 'probes' ? PROBE_SHARDS : BROWSER_SHARDS;
  if (!match || !names.includes(value)) throw new Error(`Unknown acceptance shard: ${value}`);
  return { name: value, kind: match[1], index: names.indexOf(value), count: names.length };
}

function probePlan(shard) {
  const parsed = parseShard(shard);
  if (parsed.kind !== 'probes') throw new Error(`Not a probe shard: ${shard}`);
  return CHECKS.filter((check) => check.shard === parsed.name).map((check) => check.name);
}

function browserCases(manifest, shard) {
  const parsed = parseShard(shard);
  if (parsed.kind !== 'browser') throw new Error(`Not a browser shard: ${shard}`);
  return profile.partition(manifest, parsed.index, parsed.count);
}

// Ordered steps of one acceptance invocation. `run` and unsharded `critical` keep the serial
// sequence; a shard keeps that relative order for its subset and only uses prebuilt images.
function plan(command, shard) {
  if (!['run', 'critical'].includes(command)) throw new Error(`No acceptance plan for ${command}`);
  if (shard !== undefined && command !== 'critical')
    throw new Error('Only critical acceptance is sharded');
  const parsed = shard === undefined ? undefined : parseShard(shard);
  const steps = [];
  if (command === 'run') steps.push('build:backend,frontend,postgres');
  else if (!parsed) steps.push('verify-postgres-pin', 'build:backend,frontend');
  else steps.push('verify-prebuilt-images');
  const checks = CHECKS.filter(
    (check) =>
      (command === 'critical' || check.name !== HOST_CHECK) &&
      (!parsed || check.shard === parsed.name),
  ).map((check) => check.name);
  if (checks.includes(HOST_CHECK)) steps.push(`check:${HOST_CHECK}`);
  steps.push('fixture-ownership', 'infrastructure-up');
  for (const name of checks) {
    if (name !== HOST_CHECK && name !== STARTUP_CHECK) steps.push(`check:${name}`);
  }
  const browser = !parsed || parsed.kind === 'browser';
  const startup = checks.includes(STARTUP_CHECK);
  if (browser || startup) steps.push('migrate', 'seed');
  if (startup) steps.push(`check:${STARTUP_CHECK}`);
  if (browser) {
    steps.push('application-up');
    if (command === 'critical' && !parsed) steps.push('verify-postgres-identity');
    steps.push(
      'ingress',
      'artifacts',
      `browser:${parsed ? parsed.name : command === 'run' ? 'full' : 'critical'}`,
    );
  }
  if (parsed) steps.push('verify-tested-images');
  return steps;
}

// Docker Compose arguments of one containerized check, exactly as the serial runner used them.
function checkInvocation(name, root) {
  if (!CHECKS.some((check) => check.name === name) || name === HOST_CHECK) {
    throw new Error(`No containerized acceptance check: ${name}`);
  }
  const env = ['-e', 'NODE_PATH=/app/backend/node_modules'];
  if (name === 'provider-proxy') {
    return [
      'run',
      '--rm',
      '--no-deps',
      '-v',
      `${join(root, 'tests/e2e/provider-proxy.cjs')}:/tests/provider-proxy.cjs:ro`,
      ...env,
      'migrate',
      'node',
      '/tests/provider-proxy.cjs',
    ];
  }
  const mount = ['-v', `${join(root, 'tests/e2e')}:/tests:ro`];
  if (name === STARTUP_CHECK) {
    return ['run', '--rm', '--no-deps', ...mount, ...env, 'migrate', 'node', `/tests/${name}.cjs`];
  }
  return [
    'run',
    '--rm',
    '--no-deps',
    ...mount,
    ...env,
    'migrate',
    'env',
    '-u',
    'TRUSTED_PROXY_IPS',
    'node',
    `/tests/${name}.cjs`,
  ];
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',')
  );
}

function imageIds(images) {
  return {
    backend: images.backend.imageId,
    frontend: images.frontend.imageId,
    postgres: images.infrastructure.postgres.imageId,
    redis: images.infrastructure.redis.imageId,
  };
}

// The same schema-v3 manifest the candidate export writes, for the images built once.
function imageManifest(commit, runId, pins, inspectId) {
  const manifest = { schemaVersion: 3, commit, runId: String(runId) };
  for (const name of ['backend', 'frontend']) {
    const tag = `capital-tracker-${name}:acceptance`;
    manifest[name] = { tag, imageId: inspectId(tag) };
  }
  manifest.infrastructure = {};
  for (const name of ['postgres', 'redis']) {
    manifest.infrastructure[name] = { ...pins[name], imageId: inspectId(pins[name].tag) };
  }
  return manifest;
}

// Refuses a build manifest of another commit/run and any loaded image that differs from it.
function verifyImages(images, commit, runId, pins, inspect) {
  validateRelease(images, commit, runId, validateInfrastructurePins(pins));
  validateLoadedImages(images, inspect);
  return imageIds(images);
}

function shardReceipt({ shard, commit, runId, images, probes, cases, playwright }) {
  const parsed = parseShard(shard);
  const value = {
    schemaVersion: 1,
    profile: RECEIPT_PROFILE,
    commit,
    runId: String(runId),
    shard,
    images,
  };
  if (parsed.kind === 'probes') value.probes = probes;
  else Object.assign(value, { cases, playwright: profile.project(playwright) });
  return verifyShardReceipt(value, commit, runId);
}

function verifyShardReceipt(value, commit, runId) {
  const kind = parseShard(value?.shard).kind;
  const keys = ['schemaVersion', 'profile', 'commit', 'runId', 'shard', 'images'];
  keys.push(...(kind === 'probes' ? ['probes'] : ['cases', 'playwright']));
  if (
    !exactKeys(value, keys) ||
    value.schemaVersion !== 1 ||
    value.profile !== RECEIPT_PROFILE ||
    !/^[a-f0-9]{40}$/.test(value.commit) ||
    value.commit !== commit ||
    !/^[1-9][0-9]*$/.test(value.runId) ||
    value.runId !== String(runId) ||
    !exactKeys(value.images, IMAGE_NAMES) ||
    IMAGE_NAMES.some((name) => !imagePattern.test(value.images[name]))
  ) {
    throw new Error(`Invalid critical shard receipt: ${value.shard}`);
  }
  if (kind === 'probes') {
    const expected = probePlan(value.shard);
    if (
      !Array.isArray(value.probes) ||
      value.probes.length !== expected.length ||
      value.probes.some((name, index) => name !== expected[index])
    ) {
      throw new Error(`Probe shard did not complete its exact ordered checks: ${value.shard}`);
    }
  }
  return value;
}

// Combines every shard into the unchanged critical receipt, or throws.
function mergeShards(images, receipts, manifest, commit, runId) {
  if (!/^[1-9][0-9]*$/.test(String(runId))) throw new Error('Merged acceptance requires a CI run');
  const expected = imageIds(images);
  if (!Array.isArray(receipts) || receipts.length !== SHARDS.length) {
    throw new Error('Expected exactly one receipt for every critical shard');
  }
  const byShard = new Map();
  for (const receipt of receipts) {
    verifyShardReceipt(receipt, commit, runId);
    if (byShard.has(receipt.shard))
      throw new Error(`Duplicate critical shard receipt: ${receipt.shard}`);
    if (IMAGE_NAMES.some((name) => receipt.images[name] !== expected[name])) {
      throw new Error(`Shard tested images other than the build manifest: ${receipt.shard}`);
    }
    byShard.set(receipt.shard, receipt);
  }
  if (SHARDS.some((shard) => !byShard.has(shard)))
    throw new Error('Missing critical shard receipt');
  const probes = PROBE_SHARDS.flatMap((shard) => byShard.get(shard).probes);
  const canonical = CHECKS.map((check) => check.name);
  if (
    new Set(probes).size !== probes.length ||
    probes.length !== canonical.length ||
    canonical.some((name) => !probes.includes(name))
  ) {
    throw new Error('Probe shards do not cover every canonical check exactly once');
  }
  const parts = BROWSER_SHARDS.map((shard) => {
    const receipt = byShard.get(shard);
    const assigned = browserCases(manifest, shard);
    if (
      !Array.isArray(receipt.cases) ||
      receipt.cases.length !== assigned.length ||
      receipt.cases.some(
        (item, index) =>
          !exactKeys(item, ['file', 'title']) ||
          item.file !== assigned[index].file ||
          item.title !== assigned[index].title,
      )
    ) {
      throw new Error(`Browser shard did not declare its exact manifest cases: ${shard}`);
    }
    return { cases: receipt.cases, result: receipt.playwright };
  });
  return profile.merge(manifest, parts, commit, String(runId));
}

const receiptFile = (shard) => `critical-shard-${shard}.json`;
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const pinsPath = resolve(__dirname, '../deploy/manual-mvp-infrastructure-pins.json');
const manifestPath = resolve(__dirname, '../tests/e2e/manual-mvp-manifest.json');
const dockerInspect = (tag) =>
  JSON.parse(execFileSync('docker', ['image', 'inspect', tag], { encoding: 'utf8' }))[0];

function mergeDirectory(imagesPath, directory, commit, runId, output) {
  if (existsSync(output)) unlinkSync(output);
  const expected = SHARDS.map(receiptFile).sort();
  const present = readdirSync(directory).sort();
  if (present.join('\n') !== expected.join('\n')) {
    throw new Error('Shard receipt directory must hold exactly one receipt per shard');
  }
  const images = readJson(imagesPath);
  validateRelease(images, commit, runId, validateInfrastructurePins(readJson(pinsPath)));
  const receipts = SHARDS.map((shard) => readJson(join(directory, receiptFile(shard))));
  const merged = mergeShards(images, receipts, readJson(manifestPath), commit, runId);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

module.exports = {
  SHARDS,
  PROBE_SHARDS,
  BROWSER_SHARDS,
  CHECKS,
  parseShard,
  probePlan,
  browserCases,
  plan,
  checkInvocation,
  imageIds,
  imageManifest,
  verifyImages,
  shardReceipt,
  verifyShardReceipt,
  mergeShards,
  receiptFile,
};

if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'verify-images' && args.length === 3) {
      verifyImages(readJson(args[0]), args[1], args[2], readJson(pinsPath), dockerInspect);
      console.log('Loaded images equal the build manifest');
    } else if (command === 'merge' && args.length === 5) {
      const merged = mergeDirectory(...args);
      console.log(
        `Merged ${SHARDS.length} verified shards into ${merged.cases.length} critical cases`,
      );
    } else if (command === 'plan' && args.length === 0) {
      const manifest = readJson(manifestPath);
      for (const shard of SHARDS) {
        const items =
          parseShard(shard).kind === 'probes'
            ? probePlan(shard)
            : browserCases(manifest, shard).map((item) => item.title.split(':')[0]);
        console.log(`${shard} (${items.length}): ${items.join(', ')}`);
      }
    } else {
      throw new Error(
        'Use acceptance-shards.cjs verify-images <manifest> <commit> <runId> | merge <manifest> <receipts-dir> <commit> <runId> <output> | plan',
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Critical shard verification failed');
    process.exitCode = 1;
  }
}
