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
const receipt = {
  version: 1,
  commit,
  runId: '123',
  installation: 'existing',
  backend: `ghcr.io/pavelars/capital-tracker-backend@sha256:${'b'.repeat(64)}`,
  frontend: `ghcr.io/pavelars/capital-tracker-frontend@sha256:${'c'.repeat(64)}`,
  postgres: `ghcr.io/pavelars/capital-tracker-postgres@sha256:${'d'.repeat(64)}`,
  files: { runner: 'f'.repeat(64) },
};

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
      "(github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.head_sha == github.sha && github.ref == 'refs/heads/main') || (github.event_name == 'workflow_dispatch' && (github.ref == 'refs/heads/main' || (inputs.mode == 'inventory' && github.ref == 'refs/heads/release/manual-mvp' && github.sha == vars.MVP_PREFLIGHT_COMMIT)))",
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

  it('RAP-001-A promotes, then sends preflight and deploy in one approved job', () => {
    expect(step('Validate trusted successful candidate provenance')?.if).toBe(
      "env.RELEASE_MODE != 'inventory'",
    );
    for (const name of releaseSteps)
      expect(step(name)?.if).toBe("env.RELEASE_MODE == 'promote' || env.RELEASE_MODE == 'release'");
    const send = step('Send a data-only request to the root-owned release dispatcher');
    expect(send?.if).toBe("env.RELEASE_MODE != 'promote' && env.RELEASE_PATH == 'dispatch'");
    const order = [
      'Validate trusted successful candidate provenance',
      ...releaseSteps,
      'Configure restricted release SSH with pinned identity',
      'Send a data-only request to the root-owned release dispatcher',
    ].map((name) => steps.findIndex((candidate) => candidate.name === name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Candidate and receipt identities come from the job environment, never interpolation.
    for (const candidate of steps) expect(candidate.run ?? '').not.toContain('${{');
  });

  it('RAP-001-C manual dispatch offers release and the recovery installation', () => {
    const inputs = cd.on.workflow_dispatch?.inputs ?? {};
    expect(inputs.mode.options).toEqual(['release', 'inventory', 'promote', 'preflight', 'deploy']);
    expect(inputs.mode.default).toBe('inventory');
    expect(inputs.installation.options).toEqual([
      'existing',
      'fresh',
      'resume-fresh',
      'resume-activation',
    ]);
  });
});

describe('RAP-001/RAP-002: the release step sends only generated data requests', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'capital-release-step-'));
    mkdirSync(join(directory, 'bin'));
    mkdirSync(join(directory, 'receipt'));
    writeFileSync(
      join(directory, 'receipt', `${commit}-123.json`),
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
    // Synthetic ssh: records argv and the request on stdin; never contacts a host.
    writeFileSync(
      join(directory, 'bin', 'ssh'),
      `#!/usr/bin/env node
const fs=require('node:fs');
const request=fs.readFileSync(0,'utf8');
fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify({args:process.argv.slice(2),request})+'\\n');
process.exit(process.env.FIXTURE_FAIL_PREFLIGHT==='1'&&request.includes('"preflight"')?2:0);
`,
      { mode: 0o700 },
    );
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  function send(mode: string, failPreflight = false) {
    const script = step('Send a data-only request to the root-owned release dispatcher')?.run ?? '';
    const log = join(directory, 'ssh.jsonl');
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
        HOME: directory,
        DEPLOY_HOST: 'capital.example.invalid',
        DEPLOY_DISPATCH_USER: 'capital-release',
        DEPLOY_SSH_PORT: '2211',
        RELEASE_MODE: mode,
        RUN_ID: '123',
        GITHUB_SHA: commit,
        GITHUB_RUN_ID: '999',
        FIXTURE_LOG: log,
        FIXTURE_FAIL_PREFLIGHT: failPreflight ? '1' : '0',
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
    let calls: { args: string[]; request: string }[] = [];
    try {
      calls = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    } catch {
      calls = [];
    }
    return { result, calls };
  }

  it('RAP-002-A release sends preflight then deploy, each carrying the promoted receipt', () => {
    const { result, calls } = send('release');
    expect(result.status).toBe(0);
    expect(calls.map((call) => JSON.parse(call.request))).toEqual([
      { version: 2, operation: 'preflight', commit, runId: '123', receipt },
      { version: 2, operation: 'deploy', commit, runId: '123', receipt },
    ]);
    for (const call of calls) {
      expect(call.args).toEqual([
        '-T',
        '-p',
        '2211',
        '-i',
        join(directory, '.ssh/release-key'),
        '-o',
        'BatchMode=yes',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'IdentitiesOnly=yes',
        'capital-release@capital.example.invalid',
      ]);
      expect(Buffer.byteLength(call.request)).toBeLessThan(4096);
    }
  });

  it('RAP-001-A a refused preflight never sends deploy', () => {
    const { result, calls } = send('release', true);
    expect(result.status).not.toBe(0);
    expect(calls.map((call) => JSON.parse(call.request).operation)).toEqual(['preflight']);
  });

  it('ENG-002-B manual operations keep the version 1 request without a receipt', () => {
    const { result, calls } = send('deploy');
    expect(result.status).toBe(0);
    expect(calls.map((call) => JSON.parse(call.request))).toEqual([
      { version: 1, operation: 'deploy', commit, runId: '123' },
    ]);
    const inventory = send('inventory');
    expect(inventory.result.status).toBe(0);
    expect(JSON.parse(inventory.calls.at(-1)?.request ?? '{}')).toEqual({
      version: 1,
      operation: 'inventory',
      commit,
      runId: '999',
    });
  });
});

describe('RAP-005: the server pull agent releases behind DEPLOY_PULL', () => {
  // A GitHub Actions expression as the workflow file spells it.
  const actions = (body: string) => `\${{ ${body} }}`;
  const chooser = 'Choose who releases on the server';
  const request = 'Hand the release to the server agent';
  const wait = "Wait for the server agent's release";
  const sshSteps = [
    'Configure restricted release SSH with pinned identity',
    'Send a data-only request to the root-owned release dispatcher',
  ];
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

  function releasePath(env: Record<string, string>) {
    const file = join(directory, 'github-env');
    writeFileSync(file, '');
    const result = runStep(chooser, {
      GITHUB_STEP_SUMMARY: join(directory, 'summary'),
      ...env,
      GITHUB_ENV: file,
    });
    expect(result.status).toBe(0);
    return readFileSync(file, 'utf8');
  }

  it('RAP-005-A hands only an approved release of an existing installation to the agent, and only with DEPLOY_PULL', () => {
    expect(step(chooser)?.if).toBeUndefined();
    expect(step(chooser)?.env).toEqual({ DEPLOY_PULL: actions('vars.DEPLOY_PULL') });
    const release = { RELEASE_MODE: 'release', RELEASE_INSTALLATION: 'existing' };
    expect(releasePath({ ...release, DEPLOY_PULL: 'true' })).toBe('RELEASE_PATH=pull\n');
    for (const env of [
      { ...release, DEPLOY_PULL: '' },
      { ...release, DEPLOY_PULL: 'TRUE' },
      { ...release, DEPLOY_PULL: 'false' },
      { ...release, DEPLOY_PULL: 'true', RELEASE_INSTALLATION: 'fresh' },
      { ...release, DEPLOY_PULL: 'true', RELEASE_INSTALLATION: 'resume-activation' },
      { ...release, DEPLOY_PULL: 'true', RELEASE_MODE: 'deploy' },
      { ...release, DEPLOY_PULL: 'true', RELEASE_MODE: 'preflight' },
      { ...release, DEPLOY_PULL: 'true', RELEASE_MODE: 'inventory' },
    ])
      expect(releasePath(env)).toBe('RELEASE_PATH=dispatch\n');
    // Chosen before any step that depends on it.
    const chosen = steps.findIndex((candidate) => candidate.name === chooser);
    expect(chosen).toBeGreaterThanOrEqual(0);
    steps.forEach((candidate, index) => {
      if ((candidate.if ?? '').includes('RELEASE_PATH')) expect(index).toBeGreaterThan(chosen);
    });
  });

  it('RAP-005-B the agent path uploads the promoted receipt as the request and never opens SSH', () => {
    const upload = step(request);
    expect(upload?.if).toBe("env.RELEASE_PATH == 'pull'");
    expect(upload?.uses).toBe(step('Upload the release receipt')?.uses);
    expect(upload?.with).toEqual({
      name: 'server-release-request',
      path: 'receipt/',
      'if-no-files-found': 'error',
      'retention-days': 1,
    });
    expect(step(wait)?.if).toBe("env.RELEASE_PATH == 'pull'");
    for (const name of sshSteps)
      expect(step(name)?.if).toBe(
        "env.RELEASE_MODE != 'promote' && env.RELEASE_PATH == 'dispatch'",
      );
    const order = [
      'Write the release receipt for owner approval',
      'Upload the release receipt',
      request,
      wait,
      'Report the deployed release version',
    ].map((name) => steps.findIndex((candidate) => candidate.name === name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Reading the agent's commit status needs the statuses scope and nothing more.
    expect(step(wait)?.env).toEqual({ GH_TOKEN: actions('github.token') });
  });

  it('RAP-005-D waits longer than one agent pass can take, and only on the agent path', () => {
    const unit = readFileSync(
      resolve(root, 'deploy/agent/capital-tracker-deploy-agent.service'),
      'utf8',
    );
    const start = Number(/^TimeoutStartSec=(\d+)h$/m.exec(unit)?.[1]) * 60;
    const stop = Number(/^TimeoutStopSec=(\d+)min$/m.exec(unit)?.[1]);
    // A pass starts within a minute of the upload and is stopped (with its rollback) by then.
    expect(step(wait)?.['timeout-minutes']).toBe(150);
    expect(150).toBeGreaterThan(1 + start + stop);
    // The steps before the wait (candidate download, promotion) get the rest of the job.
    expect(job['timeout-minutes']).toBe(actions("vars.DEPLOY_PULL == 'true' && 170 || 30"));
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

    function waitFor(responses: (unknown[] | 'fail')[]) {
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
process.exit(fs.readFileSync(process.env.FIXTURE_DIR+'/sleeps','utf8').split('\\n').length>8?9:0);
`,
        { mode: 0o700 },
      );
      const result = runStep(wait, {
        FIXTURE_DIR: directory,
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
