import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { parse } = require('yaml') as { parse: (source: string) => unknown };

const root = resolve(__dirname, '../../..');
type Step = {
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  'timeout-minutes'?: number | string;
};
type Job = {
  if?: string;
  environment?: string;
  env?: Record<string, string>;
  steps?: Step[];
  'timeout-minutes'?: number | string;
};
type Workflow = {
  on: {
    workflow_run?: { workflows?: string[]; types?: string[]; branches?: string[] };
    workflow_dispatch?: { inputs: Record<string, { options?: string[]; default?: string }> };
  } & Record<string, unknown>;
  jobs: Record<string, Job>;
};
const cd = parse(readFileSync(resolve(root, '.github/workflows/cd.yml'), 'utf8')) as Workflow;
const job = cd.jobs.deploy;
const steps = job.steps ?? [];
const step = (name: string) => steps.find((candidate) => candidate.name === name);
const expression = (value: string | undefined) =>
  (value ?? '')
    .trim()
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const releaseSteps = [
  'Download and verify the tested candidate',
  'Promote the identical tested images',
  'Write the release receipt for owner approval',
  'Upload the release receipt',
];
const commit = 'a'.repeat(40);

describe('RAP-001: approved release after green main CI', () => {
  it('RAP-001-A starts only from completed CI on main and waits for the production environment', () => {
    expect(Object.keys(cd.on).sort()).toEqual(['workflow_dispatch', 'workflow_run']);
    expect(cd.on.workflow_run).toEqual({
      workflows: ['CI'],
      types: ['completed'],
      branches: ['main'],
    });
    expect(Object.keys(cd.jobs)).toEqual(['deploy', 'tag']);
    expect(job.environment).toBe('production');
    // Exact expression: an OR/always() escape must not pass string-presence checks.
    expect(expression(job.if)).toBe(
      "(github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.head_sha == github.sha && github.ref == 'refs/heads/main') || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')",
    );
    expect(job.env).toEqual({
      RELEASE_MODE: "${{ github.event_name == 'workflow_run' && 'release' || inputs.mode }}",
      RUN_ID:
        "${{ github.event_name == 'workflow_run' && github.event.workflow_run.id || inputs.ci_run_id }}",
      RELEASE_INSTALLATION:
        "${{ github.event_name == 'workflow_run' && 'existing' || inputs.installation }}",
    });
  });

  it('RAP-001-D skips an automatic run for a CI commit that is no longer the main head', () => {
    // github.sha of a workflow_run event is the current main head; an older green CI run
    // would only fail provenance after the approval, so it must not ask for one.
    const automatic = expression(job.if).split(' || ')[0];
    expect(automatic).toContain('github.event.workflow_run.head_sha == github.sha');
  });

  it('RAP-001-A promotes, then hands the release to the server agent in one approved job', () => {
    // Every mode is bound to a tested candidate and promotes it.
    for (const name of ['Validate trusted successful candidate provenance', ...releaseSteps])
      expect(step(name)?.if).toBeUndefined();
    const order = [
      'Validate trusted successful candidate provenance',
      ...releaseSteps,
      'Hand the release to the server agent',
      "Wait for the server agent's release",
      'Report the deployed release version',
    ].map((name) => steps.findIndex((candidate) => candidate.name === name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Candidate and receipt identities come from the job environment, never interpolation.
    for (const candidate of steps) expect(candidate.run ?? '').not.toContain('${{');
  });

  it('RAP-001-C manual dispatch offers release, and promotion of a receipt for a new server', () => {
    const inputs = cd.on.workflow_dispatch?.inputs ?? {};
    expect(inputs.mode.options).toEqual(['release', 'promote']);
    // The default reaches no server.
    expect(inputs.mode.default).toBe('promote');
    expect(inputs.installation.options).toEqual([
      'existing',
      'fresh',
      'resume-fresh',
      'resume-activation',
    ]);
  });
});

describe('RAP-005: the server pull agent releases every approved release', () => {
  // A GitHub Actions expression as the workflow file spells it.
  const actions = (body: string) => `\${{ ${body} }}`;
  const check = 'Check the release request';
  const request = 'Hand the release to the server agent';
  const wait = "Wait for the server agent's release";
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'capital-pull-release-'));
    mkdirSync(join(directory, 'bin'));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  function runStep(name: string, env: Record<string, string>) {
    return spawnSync('bash', ['-e', '-c', step(name)?.run ?? 'exit 99'], {
      cwd: directory,
      env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}`, ...env },
      encoding: 'utf8',
      timeout: 10_000,
    });
  }

  it('RAP-005-A refuses to release anything but an existing installation, before promoting', () => {
    expect(step(check)?.if).toBeUndefined();
    expect(step(check)?.env).toBeUndefined();
    for (const env of [
      { RELEASE_MODE: 'release', RELEASE_INSTALLATION: 'existing' },
      // A receipt for a new server is promoted, then installed by hand (docs/manual-mvp-release.md).
      { RELEASE_MODE: 'promote', RELEASE_INSTALLATION: 'existing' },
      { RELEASE_MODE: 'promote', RELEASE_INSTALLATION: 'fresh' },
      { RELEASE_MODE: 'promote', RELEASE_INSTALLATION: 'resume-activation' },
    ])
      expect(runStep(check, env).status).toBe(0);
    for (const installation of ['fresh', 'resume-fresh', 'resume-activation']) {
      const refused = runStep(check, {
        RELEASE_MODE: 'release',
        RELEASE_INSTALLATION: installation,
      });
      expect(refused.status).toBe(1);
      expect(refused.stdout).toContain(
        '::error::The server agent releases only an existing installation',
      );
    }
    for (const mode of ['inventory', 'preflight', 'deploy', ''])
      expect(runStep(check, { RELEASE_MODE: mode, RELEASE_INSTALLATION: 'existing' }).status).toBe(
        1,
      );
    expect(steps.findIndex((candidate) => candidate.name === check)).toBeLessThan(
      steps.findIndex(
        (candidate) => candidate.name === 'Validate trusted successful candidate provenance',
      ),
    );
  });

  it('RAP-005-B no step reaches the server or holds a secret: the agent pulls the release', () => {
    const workflow = readFileSync(resolve(root, '.github/workflows/cd.yml'), 'utf8');
    expect(workflow).not.toMatch(/secrets\.|\bssh\b|DEPLOY_HOST|DEPLOY_KNOWN_HOSTS|DEPLOY_PULL/);
    for (const candidate of steps)
      expect(candidate.run ?? '').not.toMatch(/\bscp\b|\brsync\b|\bsftp\b|bash -s|DOCKER_CONFIG/);
  });

  it('RAP-005-B a release uploads the promoted receipt as the request and waits for the agent', () => {
    const upload = step(request);
    expect(upload?.if).toBe("env.RELEASE_MODE == 'release'");
    expect(upload?.uses).toBe(step('Upload the release receipt')?.uses);
    expect(upload?.with).toEqual({
      name: 'server-release-request',
      path: 'receipt/',
      'if-no-files-found': 'error',
      'retention-days': 1,
    });
    expect(step(wait)?.if).toBe("env.RELEASE_MODE == 'release'");
    expect(step('Report the deployed release version')?.if).toBe("env.RELEASE_MODE == 'release'");
    const order = [
      'Write the release receipt for owner approval',
      'Upload the release receipt',
      request,
      wait,
      'Report the deployed release version',
    ].map((name) => steps.findIndex((candidate) => candidate.name === name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The wait reads the agent's status with the job token: statuses: read, pinned with the
    // rest of the deploy job's permissions in RVR-002-A (release-versions.spec.ts).
    expect(step(wait)?.env).toEqual({ GH_TOKEN: actions('github.token') });
  });

  it('RAP-005-D waits longer than one agent pass can take, and only for a release', () => {
    const unit = readFileSync(
      resolve(root, 'deploy/agent/capital-tracker-deploy-agent.service'),
      'utf8',
    );
    const start = Number(/^TimeoutStartSec=(\d+)h$/m.exec(unit)?.[1]) * 60;
    const stop = Number(/^TimeoutStopSec=(\d+)min$/m.exec(unit)?.[1]);
    // A pass starts within a minute of the upload and is stopped (with its rollback) by then.
    expect(step(wait)?.['timeout-minutes']).toBe(150);
    expect(150).toBeGreaterThan(1 + start + stop);
    // The steps before the wait (candidate download, promotion) get the rest of the job. A
    // promotion alone keeps the short job.
    expect(job['timeout-minutes']).toBe(
      actions("(github.event_name == 'workflow_run' || inputs.mode == 'release') && 180 || 30"),
    );
  });

  describe('RAP-005-C the wait accepts only the agent status of this run attempt', () => {
    const attemptUrl = (attempt: number) =>
      `https://github.com/PavelArs/capital-tracker/actions/runs/999/attempts/${attempt}`;
    const status = (
      state: string,
      description: string,
      attempt = 2,
      creator = 'PavelArs',
      context = 'production-release',
    ) => ({
      state,
      description,
      context,
      target_url: attemptUrl(attempt),
      creator: { login: creator },
    });

    function waitFor(responses: (unknown[] | 'fail')[], sleepLimit = 8) {
      for (const [index, response] of responses.entries())
        writeFileSync(
          join(directory, `response-${index + 1}`),
          response === 'fail' ? 'fail' : JSON.stringify(response),
        );
      // Synthetic gh: answers the queued statuses in order, then fails; never contacts GitHub.
      writeFileSync(
        join(directory, 'bin', 'gh'),
        `#!/usr/bin/env node
const fs=require('node:fs');
const counter=process.env.FIXTURE_DIR+'/calls';
const call=(fs.existsSync(counter)?Number(fs.readFileSync(counter,'utf8')):0)+1;
fs.writeFileSync(counter,String(call));
fs.appendFileSync(process.env.FIXTURE_DIR+'/gh.log',process.argv.slice(2).join(' ')+'\\n');
const file=process.env.FIXTURE_DIR+'/response-'+call;
if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')==='fail'){process.stderr.write('HTTP 502\\n');process.exit(1);}
process.stdout.write(fs.readFileSync(file,'utf8'));
`,
        { mode: 0o700 },
      );
      // Synthetic sleep: records the pause and stops a wait that would never end.
      writeFileSync(
        join(directory, 'bin', 'sleep'),
        `#!/usr/bin/env node
const fs=require('node:fs');
fs.appendFileSync(process.env.FIXTURE_DIR+'/sleeps',process.argv[2]+'\\n');
process.exit(fs.readFileSync(process.env.FIXTURE_DIR+'/sleeps','utf8').split('\\n').length>Number(process.env.FIXTURE_SLEEPS)?9:0);
`,
        { mode: 0o700 },
      );
      const result = runStep(wait, {
        FIXTURE_DIR: directory,
        FIXTURE_SLEEPS: String(sleepLimit),
        GH_TOKEN: 'synthetic',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'PavelArs/capital-tracker',
        GITHUB_REPOSITORY_OWNER: 'PavelArs',
        GITHUB_RUN_ID: '999',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SHA: commit,
      });
      const sleeps = existsSync(join(directory, 'sleeps'))
        ? readFileSync(join(directory, 'sleeps'), 'utf8').trim().split('\n')
        : [];
      const calls = readFileSync(join(directory, 'gh.log'), 'utf8').trim().split('\n');
      return { result, sleeps, calls };
    }

    it('RAP-005-C succeeds only once this attempt is reported verified', () => {
      const { result, sleeps, calls } = waitFor([
        [],
        [status('pending', 'Server release started'), status('success', 'Release verified', 1)],
        [status('success', 'Release verified'), status('pending', 'Server release started')],
      ]);
      expect(result.status).toBe(0);
      expect(sleeps).toHaveLength(2);
      expect(result.stdout).toContain('Server release succeeded: Release verified');
      expect(calls[0]).toBe(
        `api repos/PavelArs/capital-tracker/commits/${commit}/statuses?per_page=100`,
      );
    });

    it('RAP-005-C fails with the agent reason when this attempt failed', () => {
      const { result, sleeps } = waitFor([
        [status('failure', 'Isolated backup restore fingerprint mismatch')],
      ]);
      expect(result.status).toBe(1);
      expect(sleeps).toEqual([]);
      expect(result.stdout).toContain(
        '::error::Server release failed: Isolated backup restore fingerprint mismatch',
      );
    });

    it('RAP-005-C goes by the newest status of this attempt and reports progress once', () => {
      const started = [
        status('pending', 'Server release started'),
        status('failure', 'An older word on this attempt'),
      ];
      const { result, sleeps } = waitFor([
        started,
        started,
        [status('success', 'Release verified'), ...started],
      ]);
      expect(result.status).toBe(0);
      expect(sleeps).toHaveLength(2);
      expect(result.stdout.match(/Server release pending: Server release started/g)).toHaveLength(
        1,
      );
      expect(result.stdout).not.toContain('::warning::');
    });

    it('RAP-005-C fails at once when an agent without attempt links reports this run', () => {
      const { result, sleeps } = waitFor([
        [
          {
            ...status('pending', 'Server release started'),
            target_url: 'https://github.com/PavelArs/capital-tracker/actions/runs/999',
          },
        ],
      ]);
      expect(result.status).toBe(1);
      expect(sleeps).toEqual([]);
      expect(result.stdout).toContain('::error::The server agent is out of date');
      expect(result.stdout).toContain('scripts/deploy-agent-install.sh update');
    });

    it('RAP-005-C warns once when the agent has said nothing for ten minutes', () => {
      const silent = Array.from({ length: 31 }, () => []);
      const { result, sleeps } = waitFor([...silent, [status('success', 'Release verified')]], 40);
      expect(result.status).toBe(0);
      expect(sleeps).toHaveLength(31);
      expect(result.stdout.match(/::warning::/g)).toHaveLength(1);
      expect(result.stdout).toContain('scripts/deploy-agent-install.sh active');
    });

    it('RAP-005-C keeps waiting through an unreachable GitHub', () => {
      const { result, sleeps } = waitFor(['fail', [status('success', 'Release verified')]]);
      expect(result.status).toBe(0);
      expect(sleeps).toHaveLength(1);
    });

    it('RAP-005-C ignores another attempt, another context and a status the agent did not post', () => {
      const { result } = waitFor([
        [
          status('failure', 'Refused: the deploy run no longer waits for this release', 1),
          status('success', 'Release verified', 2, 'github-actions[bot]'),
          status('success', 'Release verified', 2, 'PavelArs', 'ci'),
          {
            ...status('failure', 'Another run'),
            target_url: 'https://github.com/PavelArs/capital-tracker/actions/runs/998',
          },
          {
            ...status('pending', 'Server release started', 2, 'github-actions[bot]'),
            target_url: 'https://github.com/PavelArs/capital-tracker/actions/runs/999',
          },
        ],
      ]);
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toMatch(/Server release (succeeded|failed)/);
    });
  });
});

describe('RAP-004: IPv4 frontend health check', () => {
  it('RAP-004-A targets 127.0.0.1 rather than localhost', () => {
    const compose = parse(readFileSync(resolve(root, 'docker-compose.yml'), 'utf8')) as {
      services: Record<string, { healthcheck?: { test?: string[] } }>;
    };
    expect(compose.services.frontend.healthcheck?.test).toEqual([
      'CMD',
      'wget',
      '-qO-',
      'http://127.0.0.1:80/',
    ]);
    expect(readFileSync(resolve(root, 'docker-compose.yml'), 'utf8')).not.toMatch(/localhost:80\b/);
  });
});
