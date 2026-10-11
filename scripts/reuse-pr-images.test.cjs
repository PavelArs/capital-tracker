const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { ARTIFACTS, decide, main } = require('./reuse-pr-images.cjs');

const pins = require('../deploy/manual-mvp-infrastructure-pins.json');
const repository = 'pavelars/capital-tracker';
const commit = 'a'.repeat(40);
const tested = 'c'.repeat(40);
const runId = 4711;

function manifest(overrides = {}) {
  const imageId = (digit) => `sha256:${digit.repeat(64)}`;
  return {
    schemaVersion: 3,
    commit: tested,
    runId: String(runId),
    backend: { tag: 'capital-tracker-backend:acceptance', imageId: imageId('1') },
    frontend: { tag: 'capital-tracker-frontend:acceptance', imageId: imageId('2') },
    infrastructure: {
      postgres: { ...pins.postgres, imageId: imageId('3') },
      redis: { ...pins.redis, imageId: imageId('4') },
    },
    ...overrides,
  };
}

function artifacts(overrides = {}) {
  const live = ARTIFACTS.map((name) => ({ name, expired: false }));
  return { artifacts: live, ...overrides };
}

function options({ listing = artifacts(), downloaded = manifest(), trees = {}, found } = {}) {
  const calls = [];
  const treeTable = { [tested]: 'tree-1', [commit]: 'tree-1', ...trees };
  return {
    calls,
    request: async (path) => {
      calls.push(path);
      return listing;
    },
    find: async () => found ?? { pull: 7, run: runId },
    downloadManifest: (run) => {
      calls.push(`download ${run}`);
      return downloaded;
    },
    treeOf: (sha) => treeTable[sha],
    repository,
    commit,
    pins,
  };
}

test('REUSE-001-A reuses the pull request run when its tested tree equals this commit tree', async () => {
  const fixture = options();
  const decision = await decide(fixture);
  assert.deepEqual(decision, { reuse: true, run: '4711', testedCommit: tested, pull: 7 });
  assert.ok(fixture.calls.includes(`repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`));
});

test('REUSE-001-B the tested commit may be this very commit (a green manual run of main)', async () => {
  const decision = await decide(options({ downloaded: manifest({ commit }) }));
  assert.equal(decision.reuse, true);
  assert.equal(decision.testedCommit, commit);
});

test('REUSE-002-A refuses when the tested tree differs from this commit tree', async () => {
  await assert.rejects(decide(options({ trees: { [tested]: 'tree-2' } })), /another tree/);
});

for (const name of ARTIFACTS) {
  test(`REUSE-002-B refuses when the ${name} artifact is missing, expired or ambiguous`, async () => {
    const others = ARTIFACTS.filter((other) => other !== name).map((other) => ({
      name: other,
      expired: false,
    }));
    for (const listed of [[], [{ name, expired: true }], [{ name }], [{ name, expired: false }, { name, expired: false }]]) {
      await assert.rejects(
        decide(options({ listing: { artifacts: [...others, ...listed] } })),
        new RegExp(`Artifact ${name} of run ${runId} is not available`),
      );
    }
  });
}

test('REUSE-002-C refuses a manifest of another run or another shape', async () => {
  for (const downloaded of [
    manifest({ runId: '1' }),
    manifest({ commit: 'not-a-commit' }),
    manifest({ schemaVersion: 2 }),
    manifest({ backend: { tag: 'capital-tracker-backend:acceptance', imageId: 'latest' } }),
    null,
  ]) {
    await assert.rejects(decide(options({ downloaded })), /Invalid release provenance|Invalid release image|Cannot read|Invalid/);
  }
});

test('REUSE-002-D refuses when the pull request run is not proven by the merged check', async () => {
  const fixture = options();
  fixture.find = async () => {
    throw new Error('Pull request CI did not succeed');
  };
  await assert.rejects(decide(fixture), /did not succeed/);
});

test('REUSE-003-A main never fails: any error becomes reuse=false in the job output', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'reuse-output-'));
  const output = join(directory, 'output');
  const summary = join(directory, 'summary');
  writeFileSync(output, '');
  writeFileSync(summary, '');
  const env = { GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary };
  const failed = await main(env, async () => {
    throw new Error('GitHub API request failed with 502');
  });
  assert.equal(failed.reuse, false);
  assert.equal(readFileSync(output, 'utf8'), 'reuse=false\n');
  assert.match(readFileSync(summary, 'utf8'), /Building and testing in this run: GitHub API request failed with 502/);
});

test('REUSE-003-B main exports the run and the tested commit only for a proven reuse', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'reuse-output-'));
  const output = join(directory, 'output');
  writeFileSync(output, '');
  await main({ GITHUB_OUTPUT: output }, async () => ({
    reuse: true,
    run: '4711',
    testedCommit: tested,
    pull: 7,
  }));
  assert.equal(readFileSync(output, 'utf8'), `reuse=true\nrun_id=4711\ntested_commit=${tested}\n`);
});

test('REUSE-003-C a re-run of the push run never reuses: it builds and tests everything', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'reuse-output-'));
  const output = join(directory, 'output');
  writeFileSync(output, '');
  const result = await main({ GITHUB_OUTPUT: output, GITHUB_RUN_ATTEMPT: '2' });
  assert.equal(result.reuse, false);
  assert.match(result.reason, /re-run/);
  assert.equal(readFileSync(output, 'utf8'), 'reuse=false\n');
});
