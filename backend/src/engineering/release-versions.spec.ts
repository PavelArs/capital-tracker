import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { parse } = require('yaml') as { parse: (source: string) => unknown };

const root = resolve(__dirname, '../../..');
type Step = { name?: string; id?: string; if?: string; run?: string; env?: Record<string, string> };
type Job = {
  if?: string;
  needs?: string | string[];
  environment?: string;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps?: Step[];
};
const cd = parse(readFileSync(resolve(root, '.github/workflows/cd.yml'), 'utf8')) as {
  jobs: Record<string, Job>;
};
const deploySteps = cd.jobs.deploy.steps ?? [];
const deployStep = (name: string) => deploySteps.find((candidate) => candidate.name === name);
const stepIndex = (name: string) => deploySteps.findIndex((candidate) => candidate.name === name);
const commit = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const version = 'v2026.10.04-a1b2c3d';
const digest = (name: string, fill: string) =>
  `ghcr.io/pavelars/capital-tracker-${name}@sha256:${fill.repeat(64)}`;

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'capital-release-version-'));
  mkdirSync(join(directory, 'bin'));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function stub(name: string, body: string) {
  writeFileSync(join(directory, 'bin', name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o700 });
}

function run(script: string | undefined, env: Record<string, string>, cwd = directory) {
  const files = {
    GITHUB_ENV: 'github.env',
    GITHUB_OUTPUT: 'github.output',
    GITHUB_STEP_SUMMARY: 'summary.md',
  };
  // Each run starts with empty GitHub files and an empty call log.
  for (const file of [...Object.values(files), 'calls.log'])
    writeFileSync(join(directory, file), '');
  const result = spawnSync('bash', ['-e', '-c', script ?? 'exit 99'], {
    cwd,
    env: {
      ...process.env,
      PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
      HOME: directory,
      GITHUB_SHA: commit,
      GITHUB_REPOSITORY: 'PavelArs/capital-tracker',
      GITHUB_REPOSITORY_OWNER: 'PavelArs',
      GITHUB_ACTOR: 'PavelArs',
      GH_TOKEN: 'token-for-fixture',
      FIXTURE_LOG: join(directory, 'calls.log'),
      ...Object.fromEntries(
        Object.entries(files).map(([key, file]) => [key, join(directory, file)]),
      ),
      ...env,
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
  const read = (file: string) => readFileSync(join(directory, file), 'utf8');
  let calls: string[] = [];
  try {
    calls = read('calls.log').trim().split('\n').filter(Boolean);
  } catch {
    calls = [];
  }
  return { result, calls, env: read(files.GITHUB_ENV), output: read(files.GITHUB_OUTPUT) };
}

describe('RVR-001: readable version on promoted images', () => {
  it('RVR-001-A names the version from the commit date in UTC after provenance validation', () => {
    const step = deployStep('Name the release version');
    expect(step?.if).toBe("env.RELEASE_MODE != 'inventory'");
    expect(stepIndex('Validate trusted successful candidate provenance')).toBeLessThan(
      stepIndex('Name the release version'),
    );
    expect(stepIndex('Name the release version')).toBeLessThan(
      stepIndex('Promote the identical tested images'),
    );

    const repository = join(directory, 'repository');
    mkdirSync(repository);
    const git = (...args: string[]) =>
      spawnSync('git', args, {
        cwd: repository,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
          GIT_COMMITTER_NAME: 'Fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
          GIT_AUTHOR_DATE: '2026-10-05T01:30:00+03:00',
          GIT_COMMITTER_DATE: '2026-10-05T01:30:00+03:00',
        },
      });
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'fixture');
    const sha = git('rev-parse', 'HEAD').stdout.trim();

    const named = run(step?.run, { GITHUB_SHA: sha, TZ: 'Europe/Moscow' }, repository);
    expect(named.result.status).toBe(0);
    expect(named.env).toBe(`RELEASE_VERSION=v2026.10.04-${sha.slice(0, 7)}\n`);
  });

  function promote(installation: string, releaseVersion = version) {
    mkdirSync(join(directory, 'candidate'));
    writeFileSync(
      join(directory, 'candidate', 'manifest.json'),
      JSON.stringify({
        backend: { imageId: 'sha256:backendid', tag: 'capital-tracker-backend:candidate' },
        frontend: { imageId: 'sha256:frontendid', tag: 'capital-tracker-frontend:candidate' },
        infrastructure: {
          postgres: { imageId: 'sha256:postgresid', tag: 'capital-tracker-postgres:candidate' },
        },
      }),
    );
    stub('gzip', 'exit 0');
    stub('node', 'cat >/dev/null; exit 0');
    // Synthetic Docker: records commands; never contacts a daemon or registry.
    stub(
      'docker',
      `echo "$*" >> "$FIXTURE_LOG"
case "$1" in
  load|login) cat >/dev/null ;;
  image)
    ref=$3
    name=\${ref#*capital-tracker-}; name=\${name%%[:@]*}
    if [[ $5 == '{{.Id}}' ]]; then echo "sha256:\${name}id"
    else
      case $name in backend) fill=b ;; frontend) fill=c ;; *) fill=d ;; esac
      printf 'ghcr.io/pavelars/capital-tracker-%s@sha256:%s\\n' "$name" "$(printf "%064d" 0 | tr 0 "$fill")"
    fi ;;
esac`,
    );
    const step = deployStep('Promote the identical tested images');
    return run(step?.run, {
      RELEASE_INSTALLATION: installation,
      RELEASE_VERSION: releaseVersion,
    });
  }

  it('RVR-001-B pushes each promoted image under the commit and the version tag', () => {
    const { result, calls, env } = promote('existing');
    expect(result.status).toBe(0);
    const published = calls.filter((call) => /^(tag|push) /.test(call));
    expect(published).toEqual(
      ['backend', 'frontend', 'postgres'].flatMap((name) => [
        `tag sha256:${name}id ghcr.io/pavelars/capital-tracker-${name}:${commit}`,
        `push ghcr.io/pavelars/capital-tracker-${name}:${commit}`,
        `tag sha256:${name}id ghcr.io/pavelars/capital-tracker-${name}:${version}`,
        `push ghcr.io/pavelars/capital-tracker-${name}:${version}`,
      ]),
    );
    // Receipts keep the commit-tag digests; tags never decide what runs.
    expect(env).toContain(`RELEASE_BACKEND=${digest('backend', 'b')}\n`);
    expect(env).toContain(`RELEASE_FRONTEND=${digest('frontend', 'c')}\n`);
    expect(env).toContain(`RELEASE_POSTGRES=${digest('postgres', 'd')}\n`);
  });

  it('RVR-001-B refuses a malformed version before publishing anything', () => {
    const { result, calls } = promote('existing', 'latest');
    expect(result.status).not.toBe(0);
    expect(calls.filter((call) => /^(tag|push|login) /.test(call))).toEqual([]);
  });
});

describe('RVR-002: Git tag for the deployed release', () => {
  it('RVR-002-A reports the version only after a successful deploy or release request', () => {
    const report = deployStep('Report the deployed release version');
    expect(report?.id).toBe('deployed');
    expect(report?.if).toBe("env.RELEASE_MODE == 'release' || env.RELEASE_MODE == 'deploy'");
    expect(stepIndex('Send a data-only request to the root-owned release dispatcher')).toBeLessThan(
      stepIndex('Report the deployed release version'),
    );
    expect(cd.jobs.deploy.outputs).toEqual({ version: '${{ steps.deployed.outputs.version }}' });
    expect(run(report?.run, { RELEASE_VERSION: version }).output).toBe(`version=${version}\n`);
    expect(run(report?.run, { RELEASE_VERSION: 'v1' }).result.status).not.toBe(0);
    // The deploy job keeps its permissions; it never writes repository contents.
    expect(cd.jobs.deploy.permissions).toEqual({
      contents: 'read',
      actions: 'read',
      packages: 'write',
    });
  });

  const tagJob = () => cd.jobs.tag;

  it('RVR-002-A tags in a separate job with only contents write and no secret', () => {
    expect(Object.keys(cd.jobs)).toEqual(['deploy', 'tag']);
    const job = tagJob();
    expect(job.needs).toBe('deploy');
    expect(job.if).toBe("needs.deploy.outputs.version != ''");
    expect(job.permissions).toEqual({ contents: 'write' });
    expect(job.environment).toBeUndefined();
    expect(JSON.stringify(job)).not.toMatch(/secrets\./);
    expect(job.steps?.map((step) => step.name)).toEqual([
      'Tag the deployed commit with its release version',
    ]);
    expect(job.steps?.[0].env).toEqual({
      GH_TOKEN: '${{ github.token }}',
      VERSION: '${{ needs.deploy.outputs.version }}',
    });
    for (const step of job.steps ?? []) expect(step.run ?? '').not.toContain('${{');
  });

  function tag(existing: string | null, releaseVersion = version) {
    // Synthetic gh: answers the matching-refs lookup and records ref creation.
    stub(
      'gh',
      `echo "$*" >> "$FIXTURE_LOG"
if [[ $* == *matching-refs* ]]; then
  ${existing === null ? "echo '[]'" : `printf '[{"ref":"refs/tags/%s","object":{"sha":"%s"}}]' "$VERSION" "${existing}"`}
fi`,
    );
    return run(tagJob()?.steps?.[0].run, { VERSION: releaseVersion });
  }

  it('RVR-002-A creates the version tag on the deployed commit', () => {
    const { result, calls } = tag(null);
    expect(result.status).toBe(0);
    expect(calls).toEqual([
      `api repos/PavelArs/capital-tracker/git/matching-refs/tags/${version}`,
      `api --method POST repos/PavelArs/capital-tracker/git/refs -f ref=refs/tags/${version} -f sha=${commit}`,
    ]);
  });

  it('RVR-002-A accepts an existing tag on the same commit without moving it', () => {
    const { result, calls } = tag(commit);
    expect(result.status).toBe(0);
    expect(calls.filter((call) => call.includes('--method POST'))).toEqual([]);
  });

  it('RVR-002-B refuses a tag on another commit or a malformed version', () => {
    const conflicting = tag('f'.repeat(40));
    expect(conflicting.result.status).not.toBe(0);
    expect(conflicting.calls.filter((call) => call.includes('--method POST'))).toEqual([]);
    for (const malformed of ['latest', 'v2026.10.04-fffffff', `${version};true`]) {
      const refused = tag(null, malformed);
      expect(refused.result.status).not.toBe(0);
      expect(refused.calls).toEqual([]);
    }
  });
});
