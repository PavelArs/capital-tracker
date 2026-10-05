#!/usr/bin/env node
'use strict';

// Main runs no tests (owner decision 2026-10-05): a push to main may only release code whose
// pull request passed the full CI suite, including every critical acceptance shard.
const { SHARDS } = require('./acceptance-shards.cjs');

const WORKFLOW_PATH = '.github/workflows/ci.yml';
const REQUIRED_JOBS = [
  ...SHARDS.map((shard) => `Critical acceptance (${shard})`),
  'Image Security Scan',
  'Acceptance Receipt and Image Security',
  'CI Status',
];

// Not decided yet: retried up to `attempts` times (a fresh merge may not be linked yet).
class PendingError extends Error {
  constructor(message, attempts = Number.POSITIVE_INFINITY) {
    super(message);
    this.attempts = attempts;
  }
}

function mergedPullRequest(pulls, commit) {
  const merged = (Array.isArray(pulls) ? pulls : []).filter(
    (pull) =>
      pull &&
      pull.merged_at &&
      pull.merge_commit_sha === commit &&
      pull.base?.ref === 'main' &&
      /^[a-f0-9]{40}$/.test(pull.head?.sha ?? ''),
  );
  if (merged.length !== 1) throw new PendingError('No pull request merged as this commit', 4);
  return merged[0];
}

function latestPullRequestRun(response, repository, headSha) {
  const runs = (response?.workflow_runs ?? []).filter(
    (run) =>
      run.event === 'pull_request' &&
      run.path === WORKFLOW_PATH &&
      run.head_sha === headSha &&
      run.head_repository?.full_name === repository,
  );
  if (runs.length === 0) throw new PendingError('No pull request CI run for the merged head');
  // The newest run decides: an older green run of the same head cannot outvote it.
  const latest = runs.reduce((a, b) => (b.run_number > a.run_number ? b : a));
  if (latest.status !== 'completed') throw new PendingError('Pull request CI still running');
  if (latest.conclusion !== 'success') throw new Error('Pull request CI did not succeed');
  return latest;
}

function requireFullSuite(response) {
  const jobs = response?.jobs ?? [];
  const missing = REQUIRED_JOBS.filter(
    (name) => !jobs.some((job) => job.name === name && job.conclusion === 'success'),
  );
  if (missing.length) {
    throw new Error(`Pull request CI lacks successful full-suite jobs: ${missing.join(', ')}`);
  }
}

async function check({ request, repository, commit }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[a-f0-9]{40}$/.test(commit ?? '')) {
    throw new Error('Expected a repository and a full commit SHA');
  }
  const pull = mergedPullRequest(await request(`repos/${repository}/commits/${commit}/pulls`), commit);
  const runs = await request(
    `repos/${repository}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pull.head.sha}&per_page=100`,
  );
  const run = latestPullRequestRun(runs, repository, pull.head.sha);
  requireFullSuite(await request(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`));
  return { pull: pull.number, run: run.id, url: run.html_url };
}

// Waits while the pull request is not yet linked or its CI still runs; failures end at once.
async function waitForCheck(options, { attempts = 90, delayMs = 30_000, log = () => {} } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await check(options);
    } catch (error) {
      if (!(error instanceof PendingError) || attempt >= Math.min(attempts, error.attempts)) {
        throw error;
      }
      log(`${error.message}; checking again`);
      await new Promise((done) => setTimeout(done, delayMs));
    }
  }
}

function githubRequest(token, api = 'https://api.github.com') {
  return async (path) => {
    const response = await fetch(`${api}/${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error(`GitHub API request failed with ${response.status}`);
    return response.json();
  };
}

module.exports = { REQUIRED_JOBS, PendingError, check, waitForCheck };

if (require.main === module) {
  const { GITHUB_REPOSITORY, GITHUB_SHA, GH_TOKEN, GITHUB_API_URL, GITHUB_STEP_SUMMARY } =
    process.env;
  waitForCheck(
    {
      request: githubRequest(GH_TOKEN, GITHUB_API_URL),
      repository: GITHUB_REPOSITORY,
      commit: GITHUB_SHA,
    },
    { log: (message) => console.log(message) },
  ).then(
    ({ pull, run, url }) => {
      const line = `Merged pull request #${pull} passed the full CI suite in run ${run} (${url})`;
      console.log(line);
      if (GITHUB_STEP_SUMMARY) require('node:fs').appendFileSync(GITHUB_STEP_SUMMARY, `${line}\n`);
    },
    (error) => {
      console.error(error instanceof Error ? error.message : 'Merged pull request CI check failed');
      process.exitCode = 1;
    },
  );
}
