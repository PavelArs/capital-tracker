import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const { parse } = require('yaml') as { parse: (source: string) => unknown };

const repositoryRoot = resolve(__dirname, '../../..');
const gatePath = resolve(repositoryRoot, 'scripts/check-ci-results.cjs');
const requiredJobs = [
  'backend-check',
  'backend-test',
  'backend-build',
  'frontend-check',
  'frontend-test',
  'frontend-build',
  'release-images',
  'critical-acceptance',
  'docker-build',
  'spec-check',
  'dependency-audit',
];
// Release work: one image build, the critical acceptance shards and the final merge/scan job.
const releaseJobs = ['release-images', 'critical-acceptance', 'docker-build'];

type Needs = Record<string, unknown>;
type WorkflowStep = {
  name?: string;
  id?: string;
  with?: Record<string, unknown>;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  'continue-on-error'?: boolean;
  'working-directory'?: string;
};
type WorkflowJob = {
  name?: string;
  needs?: string | string[];
  if?: string;
  steps?: WorkflowStep[];
  'continue-on-error'?: boolean;
  defaults?: { run?: { 'working-directory'?: string } };
};
type Workflow = {
  env?: Record<string, string>;
  on: Record<string, { branches?: string[] } | null>;
  jobs: Record<string, WorkflowJob>;
};

function workflow(name: string): Workflow {
  return parse(
    readFileSync(resolve(repositoryRoot, `.github/workflows/${name}.yml`), 'utf8'),
  ) as Workflow;
}

function successfulNeeds(): Needs {
  return Object.fromEntries(requiredJobs.map((job) => [job, { result: 'success' }]));
}

function invokeGate(args: string[]) {
  // Missing code is an implementation prerequisite, not the expected behavioral RED.
  expect(existsSync(gatePath)).toBe(true);
  const result = spawnSync(process.execPath, [gatePath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 5_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).not.toBeNull();
  return { status: result.status, output: result.stdout + result.stderr };
}

function dependencies(job: WorkflowJob): string[] {
  return typeof job.needs === 'string' ? [job.needs] : (job.needs ?? []);
}

function expression(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .trim();
}

function gateStep(ci: Workflow): WorkflowStep {
  const matches = (ci.jobs['ci-status'].steps ?? []).filter((step) =>
    step.run?.includes('scripts/check-ci-results.cjs'),
  );
  expect(matches).toHaveLength(1);
  return matches[0];
}

function invokeWorkflowGate(step: WorkflowStep, needs: Needs, event = 'push') {
  const needsExpression = /\$\{\{\s*toJSON\(needs\)\s*\}\}/g;
  const eventExpression = /\$\{\{\s*github\.event_name\s*\}\}/g;
  const render = (value: string) =>
    value.replace(needsExpression, JSON.stringify(needs)).replace(eventExpression, event);
  const env = Object.fromEntries(
    Object.entries(step.env ?? {}).map(([key, value]) => [key, render(value)]),
  );
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', render(step.run ?? '')], {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 5_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).not.toBeNull();
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('ENG-001: fail-closed CI result CLI', () => {
  it('ENG-001-A accepts exact success for all eleven required jobs', () => {
    const result = invokeGate([JSON.stringify(successfulNeeds()), ...requiredJobs]);
    expect(result.status).toBe(0);
  });

  describe.each(requiredJobs)('ENG-001-B required job %s', (job) => {
    it.each(['failure', 'cancelled', 'skipped', 'unknown', '', 'Success', 'success ', null])(
      'rejects and identifies result %p',
      (status) => {
        const needs = successfulNeeds();
        needs[job] = { result: status };
        const result = invokeGate([JSON.stringify(needs), ...requiredJobs]);
        expect(result.status).not.toBe(0);
        expect(result.output).toContain(job);
      },
    );

    it('rejects and identifies a missing required job', () => {
      const needs = successfulNeeds();
      delete needs[job];
      const result = invokeGate([JSON.stringify(needs), ...requiredJobs]);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain(job);
    });

    it.each([null, 'success', {}, { result: true }, { result: ['success'] }])(
      'rejects and identifies malformed job data %p',
      (entry) => {
        const needs = successfulNeeds();
        needs[job] = entry;
        const result = invokeGate([JSON.stringify(needs), ...requiredJobs]);
        expect(result.status).not.toBe(0);
        expect(result.output).toContain(job);
      },
    );
  });

  it.each(['{', '', 'null', '[]', '"success"', 'true', '1', '{}'])(
    'ENG-001-C rejects malformed, non-object or incomplete needs JSON %p',
    (json) => {
      expect(invokeGate([json, ...requiredJobs]).status).not.toBe(0);
    },
  );

  it('ENG-001-C rejects absent CLI arguments', () => {
    expect(invokeGate([]).status).not.toBe(0);
  });

  it.each([[], [''], [' '], [...requiredJobs, requiredJobs[0]]])(
    'ENG-001-C rejects an empty or duplicate required list %p',
    (...jobs) => {
      expect(invokeGate([JSON.stringify(successfulNeeds()), ...jobs]).status).not.toBe(0);
    },
  );
});

const releaseCondition = "github.event_name != 'pull_request'";

describe('ENG-006: release acceptance runs for every event except pull requests', () => {
  const withoutRelease = () => {
    const needs = successfulNeeds();
    for (const job of releaseJobs) needs[job] = { result: 'skipped' };
    return needs;
  };

  it('ENG-006-A skips every release job for pull requests through its only job condition', () => {
    const ci = workflow('ci');
    expect(Object.keys(ci.on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch']);
    expect(ci.on.push?.branches).toEqual(['main']);
    // A manual dispatch accepts no inputs: it runs the unchanged gates for the chosen ref.
    expect(ci.on.workflow_dispatch ?? null).toBeNull();
    for (const job of releaseJobs) expect(expression(ci.jobs[job].if)).toBe(releaseCondition);
  });

  it('ENG-006-A accepts a pull request whose release jobs were skipped', () => {
    const result = invokeWorkflowGate(gateStep(workflow('ci')), withoutRelease(), 'pull_request');
    expect(result.status).toBe(0);
  });

  it.each(['failure', 'cancelled', 'unknown'])(
    'ENG-006-A still rejects a pull request whose other job has result %p',
    (status) => {
      const needs = withoutRelease();
      needs['spec-check'] = { result: status };
      const result = invokeWorkflowGate(gateStep(workflow('ci')), needs, 'pull_request');
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('spec-check');
    },
  );

  it.each(['push', 'workflow_dispatch', '', 'pull_request_target'])(
    'ENG-006-B requires every release job to succeed for event %p',
    (event) => {
      const result = invokeWorkflowGate(gateStep(workflow('ci')), withoutRelease(), event);
      expect(result.status).not.toBe(0);
      for (const job of releaseJobs) expect(result.output).toContain(job);
      for (const job of releaseJobs) {
        for (const status of ['failure', 'cancelled', 'skipped']) {
          const needs = successfulNeeds();
          needs[job] = { result: status };
          const single = invokeWorkflowGate(gateStep(workflow('ci')), needs, event);
          expect(single.status).not.toBe(0);
          expect(single.output).toContain(job);
        }
      }
      expect(invokeWorkflowGate(gateStep(workflow('ci')), successfulNeeds(), event).status).toBe(0);
    },
  );
});

describe('ENG-001-D: repository CI workflow wiring', () => {
  let ci: Workflow;

  beforeAll(() => {
    ci = workflow('ci');
  });

  it('runs for pull requests and pushes to main', () => {
    expect(ci.on.pull_request?.branches).toContain('main');
    expect(ci.on.push?.branches).toContain('main');
  });

  it('aggregates all eleven real jobs, including release shards, specifications and dependency audit', () => {
    expect(dependencies(ci.jobs['ci-status']).sort()).toEqual([...requiredJobs].sort());
    for (const job of requiredJobs) {
      expect(ci.jobs[job]).toBeDefined();
      expect(ci.jobs[job]['continue-on-error']).not.toBe(true);
    }
    for (const job of releaseJobs) expect(expression(ci.jobs[job].if)).toBe(releaseCondition);
  });

  it('always evaluates the aggregate and cannot ignore its failure', () => {
    const aggregate = ci.jobs['ci-status'];
    expect(expression(aggregate.if)).toBe('always()');
    expect(aggregate['continue-on-error']).not.toBe(true);
    const step = gateStep(ci);
    expect(step.if).toBeUndefined();
    expect(step['continue-on-error']).not.toBe(true);
  });

  it('passes the real needs JSON to the actual gate command', () => {
    const step = gateStep(ci);
    const expressions = [step.run ?? '', ...Object.values(step.env ?? {})].join('\n');
    expect(expressions).toMatch(/\$\{\{\s*toJSON\(needs\)\s*\}\}/);
    expect(invokeWorkflowGate(step, successfulNeeds()).status).toBe(0);
  });

  it.each(requiredJobs)('the actual workflow command rejects missing required job %s', (job) => {
    const needs = successfulNeeds();
    delete needs[job];
    const result = invokeWorkflowGate(gateStep(ci), needs);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(job);
  });

  it.each(['failure', 'cancelled', 'skipped', 'unknown', '', null])(
    'DEP-001-A/DEP-001-B: actual workflow command rejects dependency-audit result %p',
    (status) => {
      const needs = successfulNeeds();
      needs['dependency-audit'] = { result: status };
      // Execute the unchanged workflow shell command, not just a newly supplied CLI list.
      // Before wiring the ninth argument, this wrongly returns success for all six cases.
      const result = invokeWorkflowGate(gateStep(ci), needs);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('dependency-audit');
    },
  );
});

describe('DEP-001: required production dependency audit', () => {
  it('provides the pinned reusable production/high command without suppressing advisories or registry errors', () => {
    const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8')) as {
      packageManager: string;
      scripts: Record<string, string>;
      pnpm?: { auditConfig?: { ignoreCves?: unknown[]; ignoreGhsas?: unknown[] } };
    };
    expect(manifest.packageManager).toBe('pnpm@12.9.1');
    expect(manifest.scripts['audit:production']).toBe('pnpm audit --prod --audit-level high');
    expect(manifest.pnpm?.auditConfig?.ignoreCves ?? []).toEqual([]);
    expect(manifest.pnpm?.auditConfig?.ignoreGhsas ?? []).toEqual([]);
    const workspace = parse(
      readFileSync(resolve(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8'),
    ) as { auditConfig?: { ignoreCves?: unknown[]; ignoreGhsas?: unknown[] } };
    expect(workspace.auditConfig?.ignoreCves ?? []).toEqual([]);
    expect(workspace.auditConfig?.ignoreGhsas ?? []).toEqual([]);
  });

  it('runs a mandatory frozen-workspace audit job without conditional or continue-on-error bypasses', () => {
    const audit = workflow('ci').jobs['dependency-audit'];
    expect(audit).toBeDefined();
    expect(audit.if).toBeUndefined();
    expect(audit['continue-on-error'] ?? false).toBe(false);
    expect(audit.defaults?.run?.['working-directory'] ?? '.').toBe('.');
    const steps = audit.steps ?? [];
    expect(steps.some((step) => /^pnpm\/action-setup@[a-f0-9]{40}$/.test(step.uses ?? ''))).toBe(
      true,
    );
    const installIndex = steps.findIndex(
      (step) => step.run?.trim() === 'pnpm install --frozen-lockfile',
    );
    expect(installIndex).toBeGreaterThanOrEqual(0);
    const auditSteps = steps.filter((step) => step.run?.includes('audit:production'));
    expect(auditSteps).toHaveLength(1);
    expect(auditSteps[0].run?.trim()).toBe('pnpm audit:production');
    expect(steps.indexOf(auditSteps[0])).toBeGreaterThan(installIndex);
    for (const step of steps) {
      expect(step['continue-on-error'] ?? false).toBe(false);
      expect(step.if).toBeUndefined();
      expect(step['working-directory'] ?? '.').toBe('.');
    }
  });
});

describe('ENG-004: release work waits for successful early gates', () => {
  const releasePrerequisites = [
    'backend-build',
    'frontend-build',
    'backend-test',
    'frontend-test',
    'dependency-audit',
    'spec-check',
  ];

  it('ENG-004-A/ENG-004-B requires both early gates before any release step starts', () => {
    const ci = workflow('ci');
    // The image build is the only entry into release work; shards and the final job follow it.
    expect(dependencies(ci.jobs['release-images']).sort()).toEqual(
      [...releasePrerequisites].sort(),
    );
    expect(dependencies(ci.jobs['critical-acceptance'])).toEqual(['release-images']);
    expect(dependencies(ci.jobs['docker-build']).sort()).toEqual([
      'critical-acceptance',
      'release-images',
    ]);
  });

  it('ENG-004-A/ENG-004-B has no job-level failure or scheduling bypass', () => {
    const ci = workflow('ci');
    for (const name of [...releaseJobs, ...releasePrerequisites]) {
      const job = ci.jobs[name];
      expect(job).toBeDefined();
      // Default success scheduling is required: always() or OR expressions could bypass failures.
      expect(expression(job.if)).toBe(releaseJobs.includes(name) ? releaseCondition : '');
      expect(job['continue-on-error'] ?? false).toBe(false);
      for (const step of job.steps ?? []) expect(step['continue-on-error'] ?? false).toBe(false);
    }
  });

  it('ENG-004-A/ENG-004-B rejects failed early gates and skipped release in the real aggregate', () => {
    const ci = workflow('ci');
    for (const job of ['dependency-audit', 'spec-check']) {
      for (const status of ['failure', 'cancelled', 'skipped']) {
        const needs = successfulNeeds();
        needs[job] = { result: status };
        for (const release of releaseJobs) needs[release] = { result: 'skipped' };
        const result = invokeWorkflowGate(gateStep(ci), needs);
        expect(result.status).not.toBe(0);
        expect(result.output).toContain(job);
        for (const release of releaseJobs) expect(result.output).toContain(release);
      }
    }
  });
});

const shardNames = ['probes-1', 'probes-2', 'browser-1', 'browser-2', 'browser-3'];
const shardJobNames = shardNames.map((shard) => `Critical acceptance (${shard})`);
const legacyGateNames = [
  'Backend Lint & Format',
  'Backend Tests',
  'Backend Build',
  'Frontend Lint & Format',
  'Frontend Tests',
  'Frontend Build',
  'Release Images and Security',
  'Specification and Engineering Gates',
  'Production Dependency Audit',
  'CI Status',
];
const loadImages = [
  'set -euo pipefail',
  '(cd release-images && sha256sum -c images.tar.sha256)',
  'docker load -i release-images/images.tar',
  'rm release-images/images.tar',
  'node scripts/acceptance-shards.cjs verify-images release-images/manifest.json "$GITHUB_SHA" "$GITHUB_RUN_ID"',
];
const fourImages =
  'capital-tracker-backend:acceptance capital-tracker-frontend:acceptance capital-tracker-postgres:acceptance redis:8.10.2-alpine3.23';

type ProvenanceStep = { name: string; conclusion: string | undefined };
type ProvenanceJob = { name: string; conclusion: string; steps: ProvenanceStep[] };

// A complete successful sharded CI run as the GitHub jobs API reports it.
function provenanceJobs(): ProvenanceJob[] {
  return [...legacyGateNames, 'Build Release Images', ...shardJobNames].map((name) => ({
    name,
    conclusion: 'success',
    steps:
      name === 'Release Images and Security'
        ? [
            { name: 'Merge verified critical acceptance shards', conclusion: 'success' },
            { name: 'Verify critical acceptance receipt', conclusion: 'success' },
          ]
        : shardJobNames.includes(name)
          ? [{ name: 'Run critical real release acceptance', conclusion: 'success' }]
          : [],
  }));
}

function provenanceStep(): WorkflowStep {
  const validation = workflow('cd').jobs.deploy.steps?.find(
    (step) => step.name === 'Validate trusted successful candidate provenance',
  );
  expect(validation?.if).toBe("env.RELEASE_MODE != 'inventory'");
  return validation as WorkflowStep;
}

function runProvenanceScript(jobs: ProvenanceJob[]) {
  const script = provenanceStep().run?.match(/node - <<'NODE'\n([\s\S]*?)\nNODE/);
  expect(script).not.toBeNull();
  const directory = mkdtempSync(resolve(tmpdir(), 'capital-ci-provenance-'));
  try {
    writeFileSync(resolve(directory, 'jobs.json'), JSON.stringify({ jobs }));
    const result = spawnSync(process.execPath, ['-e', script?.[1] ?? ''], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 5_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    return result;
  } finally {
    rmSync(directory, { recursive: true });
  }
}

describe('ENG-005: critical real release acceptance preserves security and blocks incomplete promotion', () => {
  const accepted =
    "success() && steps.critical-release-acceptance.conclusion == 'success' && steps.verify-critical-receipt.conclusion == 'success'";

  it('ENG-005-A runs the reviewed critical profile in every shard and keeps full manual E2E available', () => {
    const ci = workflow('ci');
    expect(ci.env?.CI_E2E_ENABLED).toBeUndefined();
    const shard = ci.jobs['critical-acceptance'];
    expect(shard.name).toBe('Critical acceptance (${{ matrix.shard }})');
    const steps = shard.steps ?? [];
    const browser = steps.filter((step) => step.run?.includes('playwright install'));
    expect(browser).toHaveLength(1);
    expect(browser[0].run?.trim()).toBe('pnpm exec playwright install --with-deps chromium');
    expect(expression(browser[0].if)).toBe("startsWith(matrix.shard, 'browser-')");
    const acceptance = steps.filter((step) => step.run?.includes('scripts/acceptance.mjs'));
    expect(acceptance).toHaveLength(1);
    expect(acceptance[0].run?.trim()).toBe(
      'node scripts/acceptance.mjs critical --shard "$SHARD" --images release-images/manifest.json',
    );
    expect(acceptance[0].env).toEqual({ SHARD: '${{ matrix.shard }}' });
    expect(acceptance[0].id).toBe('critical-release-acceptance');
    expect(acceptance[0].name).toBe('Run critical real release acceptance');
    expect(acceptance[0].if).toBeUndefined();
    expect(acceptance[0]['continue-on-error'] ?? false).toBe(false);
    const scripts = JSON.parse(
      readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
    ).scripts;
    expect(scripts['test:e2e']).toBe('node scripts/acceptance.mjs');
    expect(scripts['test:e2e:critical']).toBe('node scripts/acceptance.mjs critical');
    expect(scripts['test:e2e:down']).toBe('node scripts/acceptance.mjs down');
    const report = steps.find(
      (step) => step.with?.name === 'synthetic-acceptance-report-${{ matrix.shard }}',
    );
    expect(expression(report?.if)).toBe('always()');
  });

  it('ENG-005-A retains all four image scans and security enforcement without pause conditions', () => {
    const steps = workflow('ci').jobs['docker-build'].steps ?? [];
    const scans = steps.filter((step) => step.uses?.startsWith('aquasecurity/trivy-action@'));
    expect(scans.map((step) => step.with?.['image-ref'])).toEqual([
      'capital-tracker-backend:acceptance',
      'capital-tracker-frontend:acceptance',
      'capital-tracker-postgres:acceptance',
      'redis:8.10.2-alpine3.23',
    ]);
    for (const step of scans) {
      expect(step.if).toBeUndefined();
      expect(step['continue-on-error'] ?? false).toBe(false);
    }
    // Scans inspect the loaded build-artifact images whose identities were just verified.
    const loaded = steps.findIndex(
      (step) => step.name === 'Load and verify the exact built images',
    );
    expect(loaded).toBeGreaterThanOrEqual(0);
    expect(loaded).toBeLessThan(steps.indexOf(scans[0]));
    for (const name of [
      'Load and verify the exact built images',
      'Enforce exact-image high and critical security gate',
    ]) {
      const step = steps.find((item) => item.name === name);
      expect(step).toBeDefined();
      expect(step?.if).toBeUndefined();
      expect(step?.['continue-on-error'] ?? false).toBe(false);
    }
    const pull = (workflow('ci').jobs['release-images'].steps ?? []).find(
      (item) => item.name === 'Pull exact reviewed PostgreSQL and Redis images',
    );
    expect(pull?.if).toBeUndefined();
    expect(pull?.run).toContain('validateInfrastructurePins(pins);');
    expect(pull?.run).toContain('docker pull "$postgres"');
    expect(pull?.run).toContain(
      `test "$(docker image inspect "$postgres_tag" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$postgres_origin"`,
    );
  });

  it('ENG-005-C exports a candidate only after successful merged acceptance and receipt validation', () => {
    const steps = workflow('ci').jobs['docker-build'].steps ?? [];
    const exports = steps.filter(
      (step) =>
        step.name === 'Export the actual tested candidate images' ||
        step.with?.name === 'manual-mvp-candidate',
    );
    expect(exports).toHaveLength(2);
    for (const step of exports) {
      expect(expression(step.if)).toBe(accepted);
      expect(step['continue-on-error'] ?? false).toBe(false);
    }
    const exportStep = steps.find(
      (step) => step.name === 'Export the actual tested candidate images',
    );
    expect(exportStep?.run).toContain('critical-release-profile.cjs verify');
    expect(exportStep?.run).toContain(`docker save ${fourImages} | gzip > candidate/images.tar.gz`);
    expect(exportStep?.run).toContain('schemaVersion: 3');
    const merge = steps.find((step) => step.id === 'critical-release-acceptance');
    const verify = steps.find((step) => step.id === 'verify-critical-receipt');
    expect(steps.indexOf(merge as WorkflowStep)).toBeLessThan(
      steps.indexOf(verify as WorkflowStep),
    );
    expect(steps.indexOf(verify as WorkflowStep)).toBeLessThan(
      steps.indexOf(exportStep as WorkflowStep),
    );
    expect(verify?.run).toContain(
      'node scripts/critical-release-profile.cjs verify test-results/critical-release-acceptance.json "$GITHUB_SHA" "$GITHUB_RUN_ID"',
    );
    const receipt = steps.find((step) => step.with?.name === 'critical-release-acceptance');
    expect(receipt?.with?.['if-no-files-found']).toBe('error');
    expect(receipt?.with?.path).toBe('test-results/critical-release-acceptance.json');
  });

  it.each([undefined, 'skipped', 'failure', 'cancelled', 'unknown', 'success'])(
    'ENG-005-B actual CD provenance accepts only a successful merge of verified shards, result %p',
    (conclusion) => {
      const jobs = provenanceJobs();
      // Even an obsolete successful job name must not substitute for actual step evidence.
      jobs.push({ name: 'Release Images and Real Acceptance', conclusion: 'success', steps: [] });
      const release = jobs.find((job) => job.name === 'Release Images and Security');
      if (release) {
        release.steps =
          conclusion === undefined
            ? []
            : [
                { name: 'Merge verified critical acceptance shards', conclusion },
                { name: 'Verify critical acceptance receipt', conclusion: 'success' },
              ];
      }
      const result = runProvenanceScript(jobs);
      expect(result.status).toBe(conclusion === 'success' ? 0 : 1);
      if (conclusion !== 'success') {
        expect(result.stderr).toContain('Critical real acceptance missing or unsuccessful');
      }
      const validation = provenanceStep();
      expect(validation.run).toContain('gh run download "$RUN_ID"');
      expect(validation.run).toContain(
        'critical-release-profile.cjs verify acceptance/critical-release-acceptance.json',
      );
    },
  );

  it('ENG-005-B refuses a successful merge without successful receipt verification', () => {
    const jobs = provenanceJobs();
    const release = jobs.find((job) => job.name === 'Release Images and Security');
    if (release) release.steps = release.steps.slice(0, 1);
    const result = runProvenanceScript(jobs);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Critical real acceptance missing or unsuccessful');
  });

  it('ENG-005-B no longer accepts the serial acceptance step name as merged shard evidence', () => {
    const jobs = provenanceJobs();
    const release = jobs.find((job) => job.name === 'Release Images and Security');
    if (release) {
      release.steps = [
        { name: 'Run critical real release acceptance', conclusion: 'success' },
        { name: 'Verify critical acceptance receipt', conclusion: 'success' },
      ];
    }
    expect(runProvenanceScript(jobs).status).toBe(1);
  });
});

describe('ENG-007: images are built once and critical acceptance runs in verified shards', () => {
  let ci: Workflow;

  beforeAll(() => {
    ci = workflow('ci');
  });

  it('ENG-007-A builds the four exact images once and publishes them with their manifest', () => {
    const job = ci.jobs['release-images'];
    expect(job.name).toBe('Build Release Images');
    const steps = job.steps ?? [];
    const index = (name: string) => steps.findIndex((step) => step.name === name);
    const order = [
      'Pull exact reviewed PostgreSQL and Redis images',
      'Build the backend and frontend acceptance images once',
      'Save the exact images for the acceptance shards',
      'Upload the exact images for the acceptance shards',
    ].map(index);
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(steps[order[1]].run?.trim()).toBe(
      'node scripts/acceptance.mjs images --manifest release-images/manifest.json',
    );
    expect(steps[order[2]].run).toContain(`docker save ${fourImages} -o release-images/images.tar`);
    expect(steps[order[2]].run).toContain('sha256sum images.tar > images.tar.sha256');
    expect(steps[order[3]].with).toMatchObject({
      name: 'release-images',
      path: 'release-images/',
      'if-no-files-found': 'error',
      'compression-level': 0,
    });
    for (const step of steps) {
      expect(step.if).toBeUndefined();
      expect(step.run ?? '').not.toMatch(/playwright|test:e2e|--shard/);
    }
  });

  it('ENG-007-A every shard and the final job load the build artifact and refuse other images', () => {
    for (const name of ['critical-acceptance', 'docker-build']) {
      const steps = ci.jobs[name].steps ?? [];
      const download = steps.findIndex(
        (step) =>
          step.uses?.startsWith('actions/download-artifact@') &&
          step.with?.name === 'release-images',
      );
      const load = steps.findIndex(
        (step) => step.name === 'Load and verify the exact built images',
      );
      const acceptance = steps.findIndex((step) => step.id === 'critical-release-acceptance');
      expect(steps[download]?.uses).toMatch(/^actions\/download-artifact@[a-f0-9]{40}$/);
      expect(steps[download]?.with?.path).toBe('release-images');
      expect(download).toBeGreaterThanOrEqual(0);
      expect(download).toBeLessThan(load);
      expect(load).toBeLessThan(acceptance);
      expect(steps[load].if).toBeUndefined();
      expect(steps[load].run?.trim().split('\n')).toEqual(loadImages);
      // No release job after the build may produce or fetch its own images.
      for (const step of steps) {
        expect(step.run ?? '').not.toMatch(
          /compose\b[^\n]*\bbuild\b|docker (?:build|pull)|acceptance\.mjs images/,
        );
      }
    }
  });

  it('ENG-007-B/C runs exactly the declared shards in parallel, each uploading its receipt', () => {
    const job = ci.jobs['critical-acceptance'] as WorkflowJob & {
      strategy?: { 'fail-fast'?: boolean; matrix?: Record<string, unknown> };
    };
    expect(job.strategy?.matrix).toEqual({ shard: shardNames });
    expect(job.strategy?.['fail-fast']).toBe(false);
    const { SHARDS } = require(resolve(repositoryRoot, 'scripts/acceptance-shards.cjs')) as {
      SHARDS: string[];
    };
    expect(SHARDS).toEqual(shardNames);
    const steps = job.steps ?? [];
    const acceptance = steps.findIndex((step) => step.id === 'critical-release-acceptance');
    const upload = steps.findIndex(
      (step) => step.with?.name === 'critical-shard-receipt-${{ matrix.shard }}',
    );
    expect(upload).toBeGreaterThan(acceptance);
    expect(steps[upload].if).toBeUndefined();
    expect(steps[upload].with).toMatchObject({
      path: 'test-results/critical-shard-${{ matrix.shard }}.json',
      'if-no-files-found': 'error',
    });
  });

  it('ENG-007-D the final job merges all shard receipts before verification and never re-runs acceptance', () => {
    const job = ci.jobs['docker-build'];
    expect(job.name).toBe('Release Images and Security');
    const steps = job.steps ?? [];
    const receipts = steps.find(
      (step) =>
        step.uses?.startsWith('actions/download-artifact@') &&
        step.with?.pattern === 'critical-shard-receipt-*',
    );
    expect(receipts?.with).toMatchObject({ path: 'shard-receipts', 'merge-multiple': true });
    expect(receipts?.if).toBeUndefined();
    const merge = steps.filter((step) => step.id === 'critical-release-acceptance');
    expect(merge).toHaveLength(1);
    expect(merge[0].name).toBe('Merge verified critical acceptance shards');
    expect(merge[0].if).toBeUndefined();
    expect(merge[0].run?.trim()).toBe(
      'node scripts/acceptance-shards.cjs merge release-images/manifest.json shard-receipts "$GITHUB_SHA" "$GITHUB_RUN_ID" test-results/critical-release-acceptance.json',
    );
    expect(steps.indexOf(receipts as WorkflowStep)).toBeLessThan(steps.indexOf(merge[0]));
    for (const step of steps) {
      expect(step.run ?? '').not.toMatch(/playwright|test:e2e|scripts\/acceptance\.mjs/);
    }
  });

  it('ENG-007-E CD provenance requires the build job and every named shard with its acceptance step', () => {
    expect(runProvenanceScript(provenanceJobs()).status).toBe(0);
    for (const name of ['Build Release Images', ...shardJobNames]) {
      const missing = provenanceJobs().filter((job) => job.name !== name);
      const missingResult = runProvenanceScript(missing);
      expect(missingResult.status).toBe(1);
      expect(missingResult.stderr).toContain('Required candidate gate missing or unsuccessful');
      for (const conclusion of ['failure', 'cancelled', 'skipped']) {
        const failed = provenanceJobs();
        const target = failed.find((job) => job.name === name);
        if (target) target.conclusion = conclusion;
        expect(runProvenanceScript(failed).status).toBe(1);
      }
    }
    for (const name of shardJobNames) {
      for (const conclusion of [undefined, 'skipped', 'failure', 'cancelled']) {
        const jobs = provenanceJobs();
        const target = jobs.find((job) => job.name === name);
        if (target) {
          target.steps =
            conclusion === undefined
              ? []
              : [{ name: 'Run critical real release acceptance', conclusion }];
        }
        const result = runProvenanceScript(jobs);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Critical real acceptance missing or unsuccessful');
      }
    }
  });

  it.each([
    ['push', 0],
    ['workflow_dispatch', 1],
    ['pull_request', 1],
    ['schedule', 1],
  ])(
    'ENG-006-C/ENG-007-E the actual CD provenance step accepts only a push run, event %p',
    (event, status) => {
      const directory = mkdtempSync(resolve(tmpdir(), 'capital-cd-provenance-'));
      const commit = 'a'.repeat(40);
      const repository = 'pavelars/capital-tracker';
      try {
        const profile = require(
          resolve(repositoryRoot, 'scripts/critical-release-profile.cjs'),
        ) as {
          receipt: (selection: unknown, result: unknown, sha: string, run: string) => unknown;
        };
        const manifest = JSON.parse(
          readFileSync(resolve(repositoryRoot, 'tests/e2e/manual-mvp-manifest.json'), 'utf8'),
        ) as { file: string; title: string }[];
        const { createHash } = require('node:crypto') as typeof import('node:crypto');
        const passed = profile.receipt(
          {
            cases: manifest,
            manifestSha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
          },
          {
            errors: [],
            suites: manifest.map((item) => ({
              file: item.file.replace('tests/e2e/', ''),
              specs: [
                {
                  title: item.title,
                  tests: [
                    {
                      expectedStatus: 'passed',
                      status: 'expected',
                      results: [{ status: 'passed' }],
                    },
                  ],
                },
              ],
            })),
          },
          commit,
          '123',
        );
        writeFileSync(resolve(directory, 'receipt-fixture.json'), JSON.stringify(passed));
        writeFileSync(
          resolve(directory, 'jobs-fixture.json'),
          JSON.stringify({ jobs: provenanceJobs() }),
        );
        writeFileSync(
          resolve(directory, 'run-fixture.json'),
          JSON.stringify({
            conclusion: 'success',
            status: 'completed',
            event,
            head_branch: 'main',
            head_sha: commit,
            path: '.github/workflows/ci.yml',
            head_repository: { full_name: repository },
          }),
        );
        const bin = resolve(directory, 'bin');
        require('node:fs').mkdirSync(bin);
        // Synthetic gh: serves fixtures for read-only API calls and never contacts GitHub.
        writeFileSync(
          resolve(bin, 'gh'),
          `#!/usr/bin/env node
const fs = require('node:fs');
const [command, path] = process.argv.slice(2);
const fixture = (name) => process.stdout.write(fs.readFileSync(process.env.FIXTURE_DIR + '/' + name));
if (command === 'api' && path.endsWith('/jobs?per_page=100')) fixture('jobs-fixture.json');
else if (command === 'api' && path.endsWith('/git/ref/heads/main')) process.stdout.write(process.env.FIXTURE_MAIN + '\\n');
else if (command === 'api' && /\\/actions\\/runs\\/[0-9]+$/.test(path)) fixture('run-fixture.json');
else if (command === 'run' && path === 'download') {
  const target = process.argv[process.argv.indexOf('-D') + 1];
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(process.env.FIXTURE_DIR + '/receipt-fixture.json', target + '/critical-release-acceptance.json');
} else process.exit(9);
`,
          { mode: 0o700 },
        );
        require('node:fs').symlinkSync(
          resolve(repositoryRoot, 'scripts'),
          resolve(directory, 'scripts'),
        );
        const result = spawnSync('bash', ['-e', '-c', provenanceStep().run ?? ''], {
          cwd: directory,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            FIXTURE_DIR: directory,
            FIXTURE_MAIN: commit,
            RUN_ID: '123',
            GITHUB_SHA: commit,
            GITHUB_REPOSITORY: repository,
            GH_TOKEN: 'synthetic',
          },
          encoding: 'utf8',
          timeout: 10_000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status === 0 ? 0 : 1).toBe(status);
        if (status === 0) {
          expect(result.stdout).toContain('Exact critical release acceptance receipt verified');
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});

describe('ENG-002: controlled manual MVP deployment entry', () => {
  let cd: Workflow;
  let inputs: Record<string, { options?: string[] }>;
  let steps: (WorkflowStep & { name?: string; with?: Record<string, unknown> })[];

  beforeAll(() => {
    cd = workflow('cd');
    const dispatch = cd.on.workflow_dispatch as unknown as {
      inputs: Record<string, { options?: string[] }>;
    };
    inputs = dispatch.inputs;
    steps = cd.jobs.deploy.steps ?? [];
  });

  it('ENG-002-A permits manual dispatch or completed main CI only, never push deployment', () => {
    expect(Object.keys(cd.on).sort()).toEqual(['workflow_dispatch', 'workflow_run']);
    expect(cd.on).not.toHaveProperty('push');
    expect(Object.keys(cd.jobs)).toEqual(['deploy', 'tag']);
    expect(inputs.mode.options).toEqual(['release', 'inventory', 'promote', 'preflight', 'deploy']);
    // Deployment credentials live in an owner-protectable environment.
    const deploy = cd.jobs.deploy as WorkflowJob & { environment?: string };
    expect(deploy.environment).toBe('production');
    for (const step of cd.jobs.deploy.steps ?? []) expect(step.run ?? '').not.toContain('${{');
  });

  it('ENG-002-A allows only read-only inventory of one pinned commit outside main', () => {
    // Exact expression: an OR/always() escape must not pass string-presence checks.
    expect(expression(cd.jobs.deploy.if).replace(/\s+/g, ' ')).toBe(
      "(github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.ref == 'refs/heads/main') || (github.event_name == 'workflow_dispatch' && (github.ref == 'refs/heads/main' || (inputs.mode == 'inventory' && github.ref == 'refs/heads/release/manual-mvp' && github.sha == vars.MVP_PREFLIGHT_COMMIT)))",
    );
  });

  it('ENG-002-B reaches the server only through the restricted data-only dispatcher', () => {
    const commands = steps.map((step) => step.run ?? '').join('\n');
    const serverSteps = steps.filter((step) => /(?:^|[\s|])ssh\s+-/m.test(step.run ?? ''));
    expect(serverSteps.map((step) => step.name)).toEqual([
      'Send a data-only request to the root-owned release dispatcher',
    ]);
    expect(serverSteps[0].if).toBe("env.RELEASE_MODE != 'promote'");
    // The Docker-capable shared deployment key, uploads and remote shell execution are gone.
    expect(JSON.stringify(cd)).not.toMatch(/DEPLOY_SSH_KEY\b|DEPLOY_USER\b/);
    expect(commands).not.toMatch(/\bscp\b|\brsync\b|\bsftp\b|bash -s|DOCKER_CONFIG/);
    expect(serverSteps[0].run).toMatch(
      /jq -cn [^|]*'\{version: 1, operation: \$operation, commit: \$commit, runId: \$runId\}' \| dispatch$/m,
    );
    expect(serverSteps[0].run).toMatch(
      /'\{version: 2, operation: \$operation, commit: \$commit, runId: \$runId, receipt: \.\}' "\$receipt" \| dispatch$/m,
    );
    // The only ssh invocation is the fixed dispatcher principal with a pinned identity.
    expect(serverSteps[0].run?.match(/(?:^|\s)ssh\s/gm)).toHaveLength(1);
    expect(serverSteps[0].run).toMatch(/^\s*"\$DEPLOY_DISPATCH_USER@\$DEPLOY_HOST"$/m);
  });

  it('ENG-002-B publishes images and an approval receipt only from validated promotion', () => {
    const promote = steps.filter(
      (step) => step.if === "env.RELEASE_MODE == 'promote' || env.RELEASE_MODE == 'release'",
    );
    expect(promote.map((step) => step.name)).toEqual([
      'Download and verify the tested candidate',
      'Promote the identical tested images',
      'Write the release receipt for owner approval',
      'Upload the release receipt',
    ]);
    const validation = steps.find(
      (step) => step.name === 'Validate trusted successful candidate provenance',
    );
    expect(validation?.if).toBe("env.RELEASE_MODE != 'inventory'");
    expect(steps.indexOf(validation as never)).toBeLessThan(steps.indexOf(promote[0] as never));
    expect(promote[2].run).toMatch(/python3 scripts\/manual-mvp-receipt\.py /);
  });
});
