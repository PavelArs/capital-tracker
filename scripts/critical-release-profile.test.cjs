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
  assert.equal(selection.cases.length, 20);
  assert.equal(selection.cases.filter((item) => item.title.startsWith('CSV-006-B regression')).length, 1);
  assert.equal(selection.matches.length, 20);
  const routed = JSON.parse(execFileSync('pnpm', ['exec', 'playwright', 'test', ...selection.files,
    '--grep', selection.grep, '--list', '--reporter=json'], {
    cwd: resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env, CI: 'true' },
  }));
  assert.equal(profile.assertRouted(selection, routed).length, 20);
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
