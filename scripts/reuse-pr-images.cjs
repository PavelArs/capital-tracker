#!/usr/bin/env node
'use strict';

// A push to main may take its release images and its critical acceptance result from the pull
// request run that already tested them (owner decision 2026-10-11), but only when all of this
// holds; otherwise the push builds, scans and tests as before:
//   - the pull request merged as this commit passed the full suite (the check
//     "Merged Pull Request CI" applies), in a run whose images, image manifest and acceptance
//     receipt artifacts are still available;
//   - this is the first attempt of the push run (a re-run builds and tests everything);
//   - that run's own manifest is valid for that run, and the commit it tested has exactly the
//     same git tree as this commit, so the tested sources are the shipped sources.
// Any doubt, error or missing artifact ends in "no reuse"; nothing here can fail the run.
const { execFileSync } = require('node:child_process');
const { appendFileSync, mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { waitForCheck, githubRequest } = require('./check-merged-pr-ci.cjs');
const { validateRelease } = require('./validate-manual-mvp-release.cjs');

// A pull request merged while its CI still runs is waited for, as "Merged Pull Request CI" waits:
// that gate cannot finish before the pull request run does, so waiting loses nothing against a
// parallel full build, and it turns the common mid-CI merge into a reuse.
const WAIT = { attempts: 60, delayMs: 30_000 };

const ARTIFACTS = ['release-images', 'release-images-manifest', 'critical-release-acceptance'];

class NoReuse extends Error {}

async function decide({ request, find, downloadManifest, treeOf, repository, commit, pins }) {
  const found = await find();
  const listing = await request(
    `repos/${repository}/actions/runs/${found.run}/artifacts?per_page=100`,
  );
  for (const name of ARTIFACTS) {
    const matches = (listing?.artifacts ?? []).filter((artifact) => artifact.name === name);
    if (matches.length !== 1 || matches[0].expired !== false) {
      throw new NoReuse(`Artifact ${name} of run ${found.run} is not available`);
    }
  }
  const manifest = downloadManifest(found.run);
  validateRelease(manifest, manifest?.commit, String(found.run), pins);
  if (treeOf(manifest.commit) !== treeOf(commit)) {
    throw new NoReuse('The tested commit has another tree than this commit');
  }
  return { reuse: true, run: String(found.run), testedCommit: manifest.commit, pull: found.pull };
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

// The test merge commit of a pull request is no longer on any branch after the merge, but
// GitHub still serves it by its SHA.
function treeOf(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new NoReuse('Invalid commit');
  try {
    return git('rev-parse', `${sha}^{tree}`);
  } catch {
    git('fetch', '--no-tags', '--depth=1', 'origin', sha);
    return git('rev-parse', `${sha}^{tree}`);
  }
}

function downloadManifest(repository, run) {
  const directory = mkdtempSync(join(tmpdir(), 'pr-manifest-'));
  execFileSync(
    'gh',
    ['run', 'download', String(run), '-R', repository, '-n', 'release-images-manifest', '-D', directory],
    { stdio: 'inherit' },
  );
  return JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
}

function decideWithGitHub(env) {
  // A re-run is how a failed reuse is recovered: it builds, tests and scans everything.
  if (Number(env.GITHUB_RUN_ATTEMPT ?? '1') > 1) throw new NoReuse('This run is a re-run, so everything runs again');
  const { GITHUB_REPOSITORY: repository, GITHUB_SHA: commit, GH_TOKEN, GITHUB_API_URL } = env;
  const request = githubRequest(GH_TOKEN, GITHUB_API_URL);
  return decide({
    request,
    repository,
    commit,
    pins: JSON.parse(
      readFileSync(join(__dirname, '../deploy/manual-mvp-infrastructure-pins.json'), 'utf8'),
    ),
    find: () =>
      waitForCheck(
        { request, repository, commit },
        { ...WAIT, log: (message) => console.log(message) },
      ),
    downloadManifest: (run) => downloadManifest(repository, run),
    treeOf,
  });
}

async function main(env, decideReuse = decideWithGitHub) {
  let result;
  try {
    result = await decideReuse(env);
  } catch (error) {
    result = { reuse: false, reason: error instanceof Error ? error.message : 'Unexpected error' };
  }
  const line = result.reuse
    ? `Reusing the images and critical acceptance of pull request #${result.pull} (run ${result.run}, tested commit ${result.testedCommit}): same tree as this commit.`
    : `Building and testing in this run: ${result.reason}.`;
  console.log(line);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
  if (env.GITHUB_OUTPUT) {
    appendFileSync(
      env.GITHUB_OUTPUT,
      result.reuse
        ? `reuse=true\nrun_id=${result.run}\ntested_commit=${result.testedCommit}\n`
        : 'reuse=false\n',
    );
  }
  return result;
}

module.exports = { ARTIFACTS, WAIT, NoReuse, decide, main };

if (require.main === module) {
  // Never fails the job: a push without reuse simply builds and tests.
  main(process.env).catch((error) => console.error(error));
}
