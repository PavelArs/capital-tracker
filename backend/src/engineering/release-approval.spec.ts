import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { parse } = require('yaml') as { parse: (source: string) => unknown };

const root = resolve(__dirname, '../../..');
type Step = { name?: string; if?: string; run?: string; env?: Record<string, string> };
type Job = { if?: string; environment?: string; env?: Record<string, string>; steps?: Step[] };
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
  redis: `redis@sha256:${'e'.repeat(64)}`,
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
    expect(Object.keys(cd.jobs)).toEqual(['deploy']);
    expect(job.environment).toBe('production');
    // Exact expression: an OR/always() escape must not pass string-presence checks.
    expect(expression(job.if)).toBe(
      "(github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.ref == 'refs/heads/main') || (github.event_name == 'workflow_dispatch' && (github.ref == 'refs/heads/main' || (inputs.mode == 'inventory' && github.ref == 'refs/heads/release/manual-mvp' && github.sha == vars.MVP_PREFLIGHT_COMMIT)))",
    );
    expect(job.env).toEqual({
      RELEASE_MODE: "${{ github.event_name == 'workflow_run' && 'release' || inputs.mode }}",
      RUN_ID:
        "${{ github.event_name == 'workflow_run' && github.event.workflow_run.id || inputs.ci_run_id }}",
      RELEASE_INSTALLATION:
        "${{ github.event_name == 'workflow_run' && 'existing' || inputs.installation }}",
    });
  });

  it('RAP-001-A promotes, then sends preflight and deploy in one approved job', () => {
    expect(step('Validate trusted successful candidate provenance')?.if).toBe(
      "env.RELEASE_MODE != 'inventory'",
    );
    for (const name of releaseSteps)
      expect(step(name)?.if).toBe("env.RELEASE_MODE == 'promote' || env.RELEASE_MODE == 'release'");
    const send = step('Send a data-only request to the root-owned release dispatcher');
    expect(send?.if).toBe("env.RELEASE_MODE != 'promote'");
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
