const { test } = require('node:test');
const assert = require('node:assert/strict');
const { REQUIRED_JOBS, check, waitForCheck } = require('./check-merged-pr-ci.cjs');

const repository = 'pavelars/capital-tracker';
const commit = 'a'.repeat(40);
const head = 'b'.repeat(40);

function pull(overrides = {}) {
  return {
    number: 7,
    merged_at: '2026-10-05T09:00:00Z',
    merge_commit_sha: commit,
    base: { ref: 'main' },
    head: { sha: head },
    ...overrides,
  };
}

function run(overrides = {}) {
  return {
    id: 11,
    run_number: 3,
    event: 'pull_request',
    path: '.github/workflows/ci.yml',
    head_sha: head,
    head_repository: { full_name: repository },
    status: 'completed',
    conclusion: 'success',
    html_url: 'https://github.com/pavelars/capital-tracker/actions/runs/11',
    ...overrides,
  };
}

function fullSuite() {
  return REQUIRED_JOBS.map((name) => ({ name, conclusion: 'success' }));
}

// A manual (workflow_dispatch) full run of the merged commit itself.
function manualRun(overrides = {}) {
  return run({
    id: 31,
    run_number: 5,
    event: 'workflow_dispatch',
    head_sha: commit,
    html_url: 'https://github.com/pavelars/capital-tracker/actions/runs/31',
    ...overrides,
  });
}

// Synthetic GitHub API: answers only the read-only calls the check makes.
function api({
  pulls = [pull()],
  runs = [run()],
  jobs = fullSuite(),
  manual = [],
  manualJobs = fullSuite(),
} = {}) {
  const calls = [];
  const request = async (path) => {
    calls.push(path);
    if (path === `repos/${repository}/commits/${commit}/pulls`) return pulls;
    if (path.startsWith(`repos/${repository}/actions/workflows/ci.yml/runs?`)) {
      if (path.includes('event=workflow_dispatch')) {
        assert.match(path, new RegExp(`event=workflow_dispatch&head_sha=${commit}&`));
        return { workflow_runs: manual };
      }
      assert.match(path, new RegExp(`event=pull_request&head_sha=${head}&`));
      return { workflow_runs: runs };
    }
    if (path.startsWith(`repos/${repository}/actions/runs/`)) {
      const isManual = manual.some((item) =>
        path.startsWith(`repos/${repository}/actions/runs/${item.id}/`),
      );
      return { jobs: isManual ? manualJobs : jobs };
    }
    throw new Error(`unexpected ${path}`);
  };
  return { request, calls };
}

const options = (fake) => ({ request: fake.request, repository, commit });

test('accepts a merged pull request whose last CI run passed every shard', async () => {
  const fake = api();
  assert.deepEqual(await check(options(fake)), {
    pull: 7,
    run: 11,
    url: 'https://github.com/pavelars/capital-tracker/actions/runs/11',
  });
  assert.equal(fake.calls.at(-1), `repos/${repository}/actions/runs/11/jobs?per_page=100`);
});

test('requires every acceptance shard, the receipt and scan job and the aggregate', () => {
  assert.deepEqual(REQUIRED_JOBS, [
    'Critical acceptance (probes-1)',
    'Critical acceptance (probes-2)',
    'Critical acceptance (browser-1)',
    'Critical acceptance (browser-2)',
    'Critical acceptance (browser-3)',
    'Critical acceptance (browser-4)',
    'Image Security Scan',
    'Acceptance Receipt and Image Security',
    'CI Status',
  ]);
});

for (const name of REQUIRED_JOBS) {
  for (const conclusion of [undefined, 'skipped', 'failure', 'cancelled']) {
    test(`refuses a pull request run whose ${name} is ${conclusion ?? 'missing'}`, async () => {
      const jobs = fullSuite().filter((job) => job.name !== name);
      if (conclusion) jobs.push({ name, conclusion });
      await assert.rejects(check(options(api({ jobs }))), (error) => error.message.includes(name));
    });
  }
}

test('refuses a pull request CI run from before E2E moved to pull requests', async () => {
  // The old pull request layout ran lint and unit only; its shards were skipped.
  const jobs = fullSuite().map((job) =>
    job.name === 'CI Status' ? job : { ...job, conclusion: 'skipped' },
  );
  await assert.rejects(check(options(api({ jobs }))), /lacks successful full-suite jobs/);
});

test('refuses a pull request CI run from the five-shard layout without the parallel scan', async () => {
  // Before the fourth browser shard and the separate scan job a green run had neither.
  const jobs = fullSuite().filter(
    (job) => !['Critical acceptance (browser-4)', 'Image Security Scan'].includes(job.name),
  );
  await assert.rejects(
    check(options(api({ jobs }))),
    /lacks successful full-suite jobs: Critical acceptance \(browser-4\), Image Security Scan/,
  );
});

for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required']) {
  test(`refuses when the newest pull request run concluded ${conclusion}`, async () => {
    const runs = [run(), run({ id: 12, run_number: 4, conclusion })];
    await assert.rejects(check(options(api({ runs }))), /did not succeed/);
  });
}

test('ignores runs of other events, workflows, heads and forks', async () => {
  const runs = [
    run({ id: 21, run_number: 9, event: 'push' }),
    run({ id: 22, run_number: 9, path: '.github/workflows/cd.yml' }),
    run({ id: 23, run_number: 9, head_sha: 'c'.repeat(40) }),
    run({ id: 24, run_number: 9, head_repository: { full_name: 'someone/fork' } }),
  ];
  await assert.rejects(check(options(api({ runs }))), /No pull request CI run/);
  assert.equal((await check(options(api({ runs: [...runs, run()] })))).run, 11);
});

for (const [label, pulls] of [
  ['no pull request', []],
  ['an unmerged pull request', [pull({ merged_at: null })]],
  ['a pull request merged as another commit', [pull({ merge_commit_sha: 'd'.repeat(40) })]],
  ['a pull request into another branch', [pull({ base: { ref: 'release' } })]],
]) {
  test(`refuses a push with ${label}`, async () => {
    await assert.rejects(check(options(api({ pulls }))), /No pull request merged as this commit/);
  });
}

test('rejects malformed inputs before calling GitHub', async () => {
  const fake = api();
  await assert.rejects(check({ ...options(fake), commit: 'main' }), /full commit SHA/);
  await assert.rejects(check({ ...options(fake), repository: '' }), /full commit SHA/);
  assert.deepEqual(fake.calls, []);
});

test('waits while the pull request CI still runs, then accepts it', async () => {
  let polls = 0;
  const fake = api();
  const request = async (path) => {
    if (path.includes('/workflows/ci.yml/runs?')) {
      polls++;
      return { workflow_runs: [run(polls < 3 ? { status: 'in_progress', conclusion: null } : {})] };
    }
    return fake.request(path);
  };
  const result = await waitForCheck({ request, repository, commit }, { delayMs: 0 });
  assert.equal(result.run, 11);
  assert.equal(polls, 3);
});

test('gives up on a commit without a merged pull request after a few attempts', async () => {
  let attempts = 0;
  const request = async () => {
    attempts++;
    return [];
  };
  await assert.rejects(
    waitForCheck({ request, repository, commit }, { delayMs: 0 }),
    /No pull request merged as this commit/,
  );
  assert.equal(attempts, 4);
});

test('does not retry a failed pull request CI run', async () => {
  let runsCalls = 0;
  const fake = api({ runs: [run({ conclusion: 'failure' })] });
  const request = async (path) => {
    if (path.includes('/workflows/ci.yml/runs?event=pull_request')) runsCalls++;
    return fake.request(path);
  };
  await assert.rejects(
    waitForCheck({ request, repository, commit }, { delayMs: 0 }),
    /did not succeed/,
  );
  assert.equal(runsCalls, 1);
});

// Owner decision 2026-10-05: a stuck main is re-proven by a manual full run of its commit.
const stale = () =>
  fullSuite().filter(
    (job) => !['Critical acceptance (browser-4)', 'Image Security Scan'].includes(job.name),
  );

test('uses the pull request run alone when it proves the full suite', async () => {
  const fake = api({ manual: [manualRun({ conclusion: 'failure' })] });
  assert.equal((await check(options(fake))).run, 11);
  assert.ok(!fake.calls.some((path) => path.includes('event=workflow_dispatch')));
});

test('accepts a green manual full run of the merged commit when the pull request run is stale', async () => {
  const fake = api({ jobs: stale(), manual: [manualRun()] });
  assert.deepEqual(await check(options(fake)), {
    pull: 7,
    run: 31,
    url: 'https://github.com/pavelars/capital-tracker/actions/runs/31',
    manual: true,
  });
  assert.equal(fake.calls.at(-1), `repos/${repository}/actions/runs/31/jobs?per_page=100`);
});

test('accepts a green manual full run of the merged commit when the pull request run failed', async () => {
  const fake = api({ runs: [run({ conclusion: 'failure' })], manual: [manualRun()] });
  assert.equal((await check(options(fake))).run, 31);
});

for (const name of REQUIRED_JOBS) {
  test(`refuses a manual run whose ${name} did not succeed`, async () => {
    const manualJobs = fullSuite().map((job) =>
      job.name === name ? { ...job, conclusion: 'skipped' } : job,
    );
    await assert.rejects(
      check(options(api({ jobs: stale(), manual: [manualRun()], manualJobs }))),
      (error) => error.message.includes(name),
    );
  });
}

test('the newest manual run decides: an older green one cannot outvote a failed one', async () => {
  const manual = [manualRun(), manualRun({ id: 32, run_number: 6, conclusion: 'failure' })];
  await assert.rejects(
    check(options(api({ jobs: stale(), manual }))),
    /Manual full CI run did not succeed/,
  );
});

test('ignores manual runs of other commits, workflows, events and forks', async () => {
  const manual = [
    manualRun({ id: 41, head_sha: head }),
    manualRun({ id: 42, head_sha: 'c'.repeat(40) }),
    manualRun({ id: 43, path: '.github/workflows/cd.yml' }),
    manualRun({ id: 44, event: 'push' }),
    manualRun({ id: 45, head_repository: { full_name: 'someone/fork' } }),
  ];
  await assert.rejects(
    check(options(api({ jobs: stale(), manual }))),
    /lacks successful full-suite jobs: Critical acceptance \(browser-4\), Image Security Scan/,
  );
});

test('still needs a pull request merged as this commit', async () => {
  await assert.rejects(
    check(options(api({ pulls: [], manual: [manualRun()] }))),
    /No pull request merged as this commit/,
  );
});

test('waits while the manual full run still runs, then accepts it', async () => {
  let polls = 0;
  const fake = api({ jobs: stale(), manual: [manualRun()] });
  const request = async (path) => {
    if (path.includes('event=workflow_dispatch')) {
      polls++;
      if (polls < 3)
        return { workflow_runs: [manualRun({ status: 'in_progress', conclusion: null })] };
    }
    return fake.request(path);
  };
  const result = await waitForCheck({ request, repository, commit }, { delayMs: 0 });
  assert.equal(result.run, 31);
  assert.equal(polls, 3);
});
