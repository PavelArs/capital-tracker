const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } = require('node:fs');
const { resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');

const profile = require('./critical-release-profile.cjs');
const { withPreservedFile } = require('./preserve-file.cjs');
const manifest = JSON.parse(readFileSync(resolve(__dirname, '../tests/e2e/manual-mvp-manifest.json'), 'utf8'));
const listing = JSON.parse(execFileSync('pnpm', ['exec', 'playwright', 'test', '--list', '--reporter=json'], {
  cwd: resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env, CI: 'true' },
}));
const commit = 'a'.repeat(40);

test('critical profile selects every exact declared file and title once', () => {
  const selection = profile.select(manifest, listing);
  assert.equal(selection.cases.length, 21);
  assert.equal(selection.cases.filter((item) => item.title.startsWith('CSV-006-B regression')).length, 1);
  assert.equal(selection.matches.length, 21);
  const routed = JSON.parse(execFileSync('pnpm', ['exec', 'playwright', 'test', ...selection.files,
    '--grep', selection.grep, '--list', '--reporter=json'], {
    cwd: resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env, CI: 'true' },
  }));
  assert.equal(profile.assertRouted(selection, routed).length, 21);
});

test('critical profile refuses empty, duplicate, missing, and ambiguous selections', () => {
  assert.throws(() => profile.select([], listing));
  assert.throws(() => profile.select([...manifest, manifest[0]], listing));
  assert.throws(() => profile.select([{ ...manifest[0], title: 'absent' }], listing));
  const selection = profile.select(manifest, listing);
  assert.throws(() => profile.assertRouted(selection, { suites: [], errors: [] }));
  const bad = structuredClone(listing);
  bad.suites[0].specs.push(structuredClone(bad.suites[0].specs[0]));
  assert.throws(() => profile.select([{ file: `tests/e2e/${bad.suites[0].file}`, title: bad.suites[0].specs[0].title }], bad));
});

test('critical receipt requires all selected cases actually passed and exact identity', () => {
  const selection = profile.select(manifest, listing);
  const result = { suites: selection.matches.map((item) => ({
    file: item.file.replace('tests/e2e/', ''),
    specs: [{ title: item.title, tests: [{ status: 'expected', expectedStatus: 'passed', results: [{ status: 'passed' }] }] }],
  })), errors: [] };
  const receipt = profile.receipt(selection, result, commit, '123');
  assert.equal(profile.verify(receipt, manifest, commit, '123').profile, 'critical');
  assert.throws(() => profile.verify(receipt, manifest, 'b'.repeat(40), '123'));
  assert.throws(() => profile.verify({ ...receipt, profile: 'full' }, manifest, commit, '123'));
  assert.throws(() => profile.verify({ ...receipt, runId: '124' }, manifest, commit, '123'));
  assert.throws(() => profile.verify({ ...receipt, manifestSha256: '0'.repeat(64) }, manifest, commit, '123'));
  assert.throws(() => profile.verify({ ...receipt, cases: receipt.cases.slice(1) }, manifest, commit, '123'));
  assert.throws(() => profile.verify({ ...receipt, cases: [...receipt.cases, receipt.cases[0]] }, manifest, commit, '123'));
  assert.throws(() => profile.verify({ ...receipt, cases: receipt.cases.map((item, index) => index === 0 ? { ...item, status: 'skipped' } : item) }, manifest, commit, '123'));
  assert.throws(() => profile.verify({ ...receipt, unexpected: 'field' }, manifest, commit, '123'));
  result.suites[0].specs[0].tests[0].results[0].status = 'skipped';
  assert.throws(() => profile.receipt(selection, result, commit, '123'));
  result.suites[0].specs[0].tests[0].results[0].status = 'passed';
  result.suites[0].specs[0].tests[0].status = 'skipped';
  assert.throws(() => profile.receipt(selection, result, commit, '123'));
  result.suites.pop();
  assert.throws(() => profile.receipt(selection, result, commit, '123'));
});

test('a failed cleanup or preservation clears stale evidence and never publishes a passing receipt', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'capital-critical-receipt-'));
  const path = resolve(directory, 'receipt.json');
  const config = resolve(directory, 'nginx.conf');
  const accepted = { profile: 'critical', cases: [] };
  try {
    writeFileSync(config, 'original');
    writeFileSync(path, '{"stale":true}');
    await assert.rejects(profile.publishAfterGates(() => withPreservedFile(config, async () => {
      try { return accepted; }
      finally { throw new Error('Compose cleanup failed'); }
    }), path), /Compose cleanup failed/);
    assert.equal(existsSync(path), false);
    writeFileSync(path, '{"stale":true}');
    await assert.rejects(profile.publishAfterGates(() => withPreservedFile(config, async () => {
      writeFileSync(config, 'changed');
      return accepted;
    }), path), /Configuration preservation failed/);
    assert.equal(existsSync(path), false);
    await assert.rejects(profile.publishAfterGates(async () => undefined, path), /without a receipt/);
    assert.equal(existsSync(path), false);
    writeFileSync(config, 'original');
    assert.deepEqual(await profile.publishAfterGates(async () => accepted, path), accepted);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), accepted);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('ENG-007-C partition splits the manifest deterministically by index modulo shard count', () => {
  const parts = [0, 1, 2].map((index) => profile.partition(manifest, index, 3));
  assert.deepEqual(parts.map((part) => part.length), [7, 7, 7]);
  parts.forEach((part, index) => {
    assert.deepEqual(part, manifest.filter((_item, position) => position % 3 === index));
    // Each subset is itself a valid exact selection against actual Playwright discovery.
    assert.equal(profile.select(part, listing).cases.length, 7);
  });
  assert.deepEqual(profile.partition(manifest, 1, 3), parts[1]);
  for (const [index, count] of [[3, 3], [-1, 3], [0, 0], [0, 22], [1.5, 3], ['0', 3]]) {
    assert.throws(() => profile.partition(manifest, index, count));
  }
});

test('ENG-007-D merge combines shard results into the unchanged receipt and rejects any gap', () => {
  const run = (cases) => ({ errors: [], suites: cases.map((item) => ({
    file: item.file.replace('tests/e2e/', ''),
    specs: [{ title: item.title, tests: [{ status: 'expected', expectedStatus: 'passed', results: [{ status: 'passed' }] }] }],
  })) });
  const parts = () => [0, 1, 2].map((index) => {
    const cases = profile.partition(manifest, index, 3);
    return { cases, result: run(cases) };
  });
  const merged = profile.merge(manifest, parts(), commit, '123');
  const whole = profile.receipt(profile.select(manifest, listing), run(manifest), commit, '123');
  assert.deepEqual(merged, whole);
  assert.equal(profile.verify(merged, manifest, commit, '123').cases.length, 21);
  const reject = (value) => assert.throws(() => profile.merge(manifest, value, commit, '123'));
  reject([]);
  reject(parts().slice(1));
  const duplicated = parts();
  duplicated[1].cases.push(duplicated[0].cases[0]);
  duplicated[1].result.suites.push(duplicated[0].result.suites[0]);
  reject(duplicated);
  const swapped = parts();
  swapped[0].result = swapped[1].result;
  reject(swapped);
  const foreign = parts();
  foreign[2].cases.push({ file: 'tests/e2e/mfa.spec.ts', title: 'absent title' });
  reject(foreign);
  const failed = parts();
  failed[2].result.suites[0].specs[0].tests[0].results[0].status = 'failed';
  reject(failed);
  const skipped = parts();
  skipped[0].result.suites[3].specs[0].tests[0].status = 'skipped';
  reject(skipped);
  const errored = parts();
  errored[1].result.errors = [{ message: 'worker crashed' }];
  reject(errored);
  const empty = parts();
  empty[0] = { cases: [], result: { errors: [], suites: [] } };
  reject(empty);
  assert.throws(() => profile.merge(manifest, parts(), 'b'.repeat(39), '123'));
  assert.throws(() => profile.merge([], parts(), commit, '123'));
});
