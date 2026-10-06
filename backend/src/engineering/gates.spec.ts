import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const { parse } = require('yaml') as { parse: (source: string) => unknown };

const repositoryRoot = resolve(__dirname, '../../..');
const gatePath = resolve(repositoryRoot, 'scripts/check-ci-results.cjs');
// The full suite every pull request (and manual dispatch) must pass.
const fullSuiteJobs = [
  'backend-check',
  'backend-test',
  'backend-build',
  'frontend-check',
  'frontend-test',
  'frontend-build',
  'release-images',
  'critical-acceptance',
  'image-security',
  'docker-build',
  'spec-check',
  'dependency-audit',
];
// A push to main only builds the release after confirming its pull request passed the suite.
const pushJobs = ['release-images', 'merged-pr-ci'];
const requiredJobs = [...fullSuiteJobs, 'merged-pr-ci'];
// Checks that never run on main: everything in the full suite except the image build.
const testJobs = fullSuiteJobs.filter((job) => job !== 'release-images');

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
  'runs-on'?: string;
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

function invokeWorkflowGate(step: WorkflowStep, needs: Needs, event = 'pull_request') {
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
  it('ENG-001-A accepts exact success for all thirteen required jobs', () => {
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

const testCondition = "github.event_name != 'push'";
const pushCondition = "github.event_name == 'push'";

function pushNeeds(): Needs {
  const needs = successfulNeeds();
  for (const job of testJobs) needs[job] = { result: 'skipped' };
  return needs;
}

function pullRequestNeeds(): Needs {
  const needs = successfulNeeds();
  needs['merged-pr-ci'] = { result: 'skipped' };
  return needs;
}

describe('ENG-006: pull requests run every check, a push to main only builds the release', () => {
  it('ENG-006-A skips every check on push and the merged pull request check elsewhere', () => {
    const ci = workflow('ci');
    expect(Object.keys(ci.on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch']);
    expect(ci.on.push?.branches).toEqual(['main']);
    // A manual dispatch accepts no inputs: it runs the unchanged full suite for the chosen ref.
    expect(ci.on.workflow_dispatch ?? null).toBeNull();
    for (const job of testJobs) expect(expression(ci.jobs[job].if)).toBe(testCondition);
    expect(expression(ci.jobs['merged-pr-ci'].if)).toBe(pushCondition);
    expect(ci.jobs['release-images'].if).toBeUndefined();
  });

  it('ENG-006-A accepts a push whose image build and merged pull request check succeeded', () => {
    const result = invokeWorkflowGate(gateStep(workflow('ci')), pushNeeds(), 'push');
    expect(result.status).toBe(0);
  });

  it.each(pushJobs)('ENG-006-A rejects a push whose %s did not succeed', (job) => {
    for (const status of ['failure', 'cancelled', 'skipped', 'unknown']) {
      const needs = pushNeeds();
      needs[job] = { result: status };
      const result = invokeWorkflowGate(gateStep(workflow('ci')), needs, 'push');
      expect(result.status).not.toBe(0);
      expect(result.output).toContain(job);
    }
    const needs = pushNeeds();
    delete needs[job];
    expect(invokeWorkflowGate(gateStep(workflow('ci')), needs, 'push').status).not.toBe(0);
  });

  it.each(['pull_request', 'workflow_dispatch', '', 'pull_request_target'])(
    'ENG-006-B requires every full-suite job to succeed for event %p',
    (event) => {
      const result = invokeWorkflowGate(gateStep(workflow('ci')), pushNeeds(), event);
      expect(result.status).not.toBe(0);
      for (const job of testJobs) expect(result.output).toContain(job);
      for (const job of fullSuiteJobs) {
        for (const status of ['failure', 'cancelled', 'skipped']) {
          const needs = pullRequestNeeds();
          needs[job] = { result: status };
          const single = invokeWorkflowGate(gateStep(workflow('ci')), needs, event);
          expect(single.status).not.toBe(0);
          expect(single.output).toContain(job);
        }
      }
      expect(invokeWorkflowGate(gateStep(workflow('ci')), pullRequestNeeds(), event).status).toBe(
        0,
      );
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

  it('aggregates all thirteen real jobs, including release shards, the image scan, specifications and dependency audit', () => {
    expect(dependencies(ci.jobs['ci-status']).sort()).toEqual([...requiredJobs].sort());
    for (const job of requiredJobs) {
      expect(ci.jobs[job]).toBeDefined();
      expect(ci.jobs[job]['continue-on-error']).not.toBe(true);
    }
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
    expect(invokeWorkflowGate(step, pullRequestNeeds()).status).toBe(0);
  });

  it.each(fullSuiteJobs)(
    'the actual workflow command rejects a pull request missing required job %s',
    (job) => {
      const needs = pullRequestNeeds();
      delete needs[job];
      const result = invokeWorkflowGate(gateStep(ci), needs);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain(job);
    },
  );

  it.each(['failure', 'cancelled', 'skipped', 'unknown', '', null])(
    'DEP-001-A/DEP-001-B: actual workflow command rejects dependency-audit result %p',
    (status) => {
      const needs = pullRequestNeeds();
      needs['dependency-audit'] = { result: status };
      // Execute the unchanged workflow shell command, not just a newly supplied CLI list.
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
    // Skipped only on a push to main, which may release only a pull request that passed it.
    expect(expression(audit.if)).toBe(testCondition);
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

describe('ENG-004: release work runs beside the early gates and the aggregate requires both', () => {
  const earlyGates = testJobs.filter(
    (job) => !['critical-acceptance', 'image-security', 'docker-build'].includes(job),
  );

  it('ENG-004-A builds the images at once; shards and scans follow the build, the final job both', () => {
    const ci = workflow('ci');
    // Actions minutes are free (public repository): acceptance no longer waits for lint and unit.
    expect(dependencies(ci.jobs['release-images'])).toEqual([]);
    expect(dependencies(ci.jobs['critical-acceptance'])).toEqual(['release-images']);
    // The scans need only the images, so they run beside the shards instead of after them.
    expect(dependencies(ci.jobs['image-security'])).toEqual(['release-images']);
    expect(dependencies(ci.jobs['docker-build']).sort()).toEqual([
      'critical-acceptance',
      'image-security',
      'release-images',
    ]);
    expect(dependencies(ci.jobs['merged-pr-ci'])).toEqual([]);
  });

  it('ENG-004-A/ENG-004-B has no job-level failure or scheduling bypass', () => {
    const ci = workflow('ci');
    for (const name of requiredJobs) {
      const job = ci.jobs[name];
      expect(job).toBeDefined();
      // Only the event split is allowed: always() or OR expressions could bypass failures.
      expect(expression(job.if)).toBe(
        name === 'release-images' ? '' : name === 'merged-pr-ci' ? pushCondition : testCondition,
      );
      expect(job['continue-on-error'] ?? false).toBe(false);
      for (const step of job.steps ?? []) expect(step['continue-on-error'] ?? false).toBe(false);
    }
  });

  it('ENG-004-B rejects a pull request with a failed early gate even when release work passed', () => {
    const ci = workflow('ci');
    for (const job of earlyGates) {
      for (const status of ['failure', 'cancelled', 'skipped']) {
        const needs = pullRequestNeeds();
        needs[job] = { result: status };
        const result = invokeWorkflowGate(gateStep(ci), needs);
        expect(result.status).not.toBe(0);
        expect(result.output).toContain(job);
      }
    }
  });
});

const shardNames = ['probes-1', 'probes-2', 'browser-1', 'browser-2', 'browser-3', 'browser-4'];
const shardJobNames = shardNames.map((shard) => `Critical acceptance (${shard})`);
const mergedPrStep = 'Require a successful full pull request CI run';
const exportStepName = 'Export the release candidate images';
const imageStoreLink =
  'if [[ $RUNNER_ENVIRONMENT == self-hosted ]]; then ln -s "/srv/ci-images/$GITHUB_RUN_ID/images.tar.zst" release-images/images.tar.zst; fi';
const loadImages = [
  'set -euo pipefail',
  imageStoreLink,
  '(cd release-images && sha256sum -c images.tar.zst.sha256)',
  // zstd ignores a symbolic link given as a file name, so the stored archive is read from stdin.
  'zstd -dc < release-images/images.tar.zst | docker load',
  'rm release-images/images.tar.zst',
  'node scripts/acceptance-shards.cjs verify-images release-images/manifest.json "$GITHUB_SHA" "$GITHUB_RUN_ID"',
];
const fourImages =
  'capital-tracker-backend:acceptance capital-tracker-frontend:acceptance capital-tracker-postgres:acceptance redis:8.10.2-alpine3.23';

type ProvenanceStep = { name: string; conclusion: string | undefined };
type ProvenanceJob = { name: string; conclusion: string; steps: ProvenanceStep[] };

// A complete successful main push run as the GitHub jobs API reports it.
function provenanceJobs(): ProvenanceJob[] {
  return [
    {
      name: 'Build Release Images',
      conclusion: 'success',
      steps: [{ name: exportStepName, conclusion: 'success' }],
    },
    {
      name: 'Merged Pull Request CI',
      conclusion: 'success',
      steps: [{ name: mergedPrStep, conclusion: 'success' }],
    },
    { name: 'CI Status', conclusion: 'success', steps: [] },
  ];
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

describe('ENG-005: pull request acceptance preserves security; main promotes only checked candidates', () => {
  it('ENG-005-A runs the reviewed critical profile in every shard and keeps full manual E2E available', () => {
    const ci = workflow('ci');
    expect(ci.env?.CI_E2E_ENABLED).toBeUndefined();
    const shard = ci.jobs['critical-acceptance'];
    expect(shard.name).toBe('Critical acceptance (${{ matrix.shard }})');
    const steps = shard.steps ?? [];
    const browser = steps.filter((step) => step.run?.includes('playwright install'));
    expect(browser).toHaveLength(1);
    expect(browser[0].run?.trim()).toBe('pnpm exec playwright install $PLAYWRIGHT_DEPS chromium');
    // GitHub's runners install Chromium's system packages with sudo; the self-hosted runner
    // has them preinstalled by its owner and grants the job no sudo.
    expect(expression(browser[0].env?.PLAYWRIGHT_DEPS)).toBe(
      "runner.environment == 'github-hosted' && '--with-deps' || ''",
    );
    expect(expression(browser[0].if)).toBe("startsWith(matrix.shard, 'browser-')");
    // The browser comes from a cache keyed on the installed Playwright version; the install
    // still runs after it, so a stale or missing cache only costs the download.
    const version = steps.find((step) => step.id === 'playwright');
    expect(version?.run).toContain('pnpm exec playwright --version');
    const cache = steps.filter((step) => step.uses?.startsWith('actions/cache@'));
    expect(cache).toHaveLength(1);
    expect(cache[0].uses).toMatch(/^actions\/cache@[a-f0-9]{40}$/);
    expect(cache[0].with).toEqual({
      path: '~/.cache/ms-playwright',
      key: 'playwright-${{ runner.os }}-${{ runner.arch }}-${{ steps.playwright.outputs.version }}',
    });
    for (const step of [version, cache[0]]) {
      expect(expression(step?.if)).toBe("startsWith(matrix.shard, 'browser-')");
    }
    expect(steps.indexOf(version as WorkflowStep)).toBeLessThan(steps.indexOf(cache[0]));
    expect(steps.indexOf(cache[0])).toBeLessThan(steps.indexOf(browser[0]));
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
    const job = workflow('ci').jobs['image-security'];
    expect(job.name).toBe('Image Security Scan');
    const steps = job.steps ?? [];
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

  it('ENG-005-C exports the candidate only on a push to main, from the images it just built', () => {
    const steps = workflow('ci').jobs['release-images'].steps ?? [];
    const exports = steps.filter(
      (step) => step.name === exportStepName || step.with?.name === 'manual-mvp-candidate',
    );
    expect(exports).toHaveLength(2);
    for (const step of exports) {
      expect(expression(step.if)).toBe(pushCondition);
      expect(step['continue-on-error'] ?? false).toBe(false);
    }
    const build = steps.findIndex(
      (step) => step.name === 'Build the backend and frontend acceptance images once',
    );
    const exportStep = exports[0];
    expect(exportStep.name).toBe(exportStepName);
    expect(steps.indexOf(exportStep)).toBeGreaterThan(build);
    expect(exportStep.run).toContain('set -euo pipefail');
    expect(exportStep.run).toContain(`docker save ${fourImages} | gzip > candidate/images.tar.gz`);
    expect(exportStep.run).toContain('schemaVersion: 3');
    expect(exportStep.run).toContain(
      'node scripts/validate-manual-mvp-release.cjs candidate/manifest.json "$CANDIDATE_COMMIT" "$CANDIDATE_RUN_ID"',
    );
    expect(exports[1].with).toMatchObject({ path: 'candidate/', 'if-no-files-found': 'error' });
    // Pull requests never produce a deployable candidate.
    for (const name of ['critical-acceptance', 'image-security', 'docker-build']) {
      for (const step of workflow('ci').jobs[name].steps ?? []) {
        expect(step.with?.name).not.toBe('manual-mvp-candidate');
      }
    }
  });

  it('ENG-005-C merges and verifies the shard receipts on pull requests after the passed scans', () => {
    const job = workflow('ci').jobs['docker-build'];
    // The receipt job runs only once the scan job passed on the same images.
    expect(dependencies(job)).toContain('image-security');
    const steps = job.steps ?? [];
    const merge = steps.find((step) => step.id === 'critical-release-acceptance');
    const verify = steps.find((step) => step.id === 'verify-critical-receipt');
    expect(steps.some((step) => step.uses?.startsWith('aquasecurity/trivy-action@'))).toBe(false);
    expect(merge).toBeDefined();
    expect(steps.indexOf(merge as WorkflowStep)).toBeLessThan(
      steps.indexOf(verify as WorkflowStep),
    );
    expect(verify?.if).toBeUndefined();
    expect(verify?.run).toContain(
      'node scripts/critical-release-profile.cjs verify test-results/critical-release-acceptance.json "$GITHUB_SHA" "$GITHUB_RUN_ID"',
    );
    const receipt = steps.find((step) => step.with?.name === 'critical-release-acceptance');
    expect(receipt?.with?.['if-no-files-found']).toBe('error');
    expect(receipt?.with?.path).toBe('test-results/critical-release-acceptance.json');
  });

  it('ENG-005-B the main run checks the merged pull request with the script under test', () => {
    const job = workflow('ci').jobs['merged-pr-ci'] as WorkflowJob & {
      permissions?: Record<string, string>;
    };
    expect(job.name).toBe('Merged Pull Request CI');
    expect(job.permissions).toEqual({
      contents: 'read',
      actions: 'read',
      'pull-requests': 'read',
    });
    const steps = (job.steps ?? []).filter((step) => step.name === mergedPrStep);
    expect(steps).toHaveLength(1);
    expect(steps[0].run?.trim()).toBe('node scripts/check-merged-pr-ci.cjs');
    expect(steps[0].if).toBeUndefined();
    const { REQUIRED_JOBS } = require(
      resolve(repositoryRoot, 'scripts/check-merged-pr-ci.cjs'),
    ) as {
      REQUIRED_JOBS: string[];
    };
    // The merged pull request must have run every shard and the receipt/scan job by name.
    expect(REQUIRED_JOBS).toEqual([
      ...shardJobNames,
      workflow('ci').jobs['image-security'].name,
      workflow('ci').jobs['docker-build'].name,
      workflow('ci').jobs['ci-status'].name,
    ]);
  });

  it.each([undefined, 'skipped', 'failure', 'cancelled', 'unknown', 'success'])(
    'ENG-005-B actual CD provenance accepts only a successful merged pull request check, result %p',
    (conclusion) => {
      const jobs = provenanceJobs();
      // An obsolete successful job name must not substitute for actual step evidence.
      jobs.push({ name: 'Release Images and Security', conclusion: 'success', steps: [] });
      const check = jobs.find((job) => job.name === 'Merged Pull Request CI');
      if (check) check.steps = conclusion === undefined ? [] : [{ name: mergedPrStep, conclusion }];
      const result = runProvenanceScript(jobs);
      expect(result.status).toBe(conclusion === 'success' ? 0 : 1);
      if (conclusion !== 'success') {
        expect(result.stderr).toContain('Pull request acceptance evidence missing or unsuccessful');
      }
    },
  );

  it.each([undefined, 'skipped', 'failure', 'cancelled'])(
    'ENG-005-B actual CD provenance refuses a run without a successful candidate export, result %p',
    (conclusion) => {
      const jobs = provenanceJobs();
      const build = jobs.find((job) => job.name === 'Build Release Images');
      if (build)
        build.steps = conclusion === undefined ? [] : [{ name: exportStepName, conclusion }];
      const result = runProvenanceScript(jobs);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Release candidate export missing or unsuccessful');
    },
  );
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
    expect(steps[order[2]].run).toContain('set -euo pipefail');
    expect(steps[order[2]].run).toContain(
      `docker save ${fourImages} | zstd -T0 -3 -q -o release-images/images.tar.zst`,
    );
    expect(steps[order[2]].run).toContain('sha256sum images.tar.zst > images.tar.zst.sha256');
    expect(steps[order[3]].with).toMatchObject({
      name: 'release-images',
      path: 'release-images/',
      'if-no-files-found': 'error',
      'compression-level': 0,
    });
    // The receipt job gets the same manifest file alone, without the images.
    const manifest = steps.findIndex(
      (step) =>
        step.uses?.startsWith('actions/upload-artifact@') &&
        step.with?.name === 'release-images-manifest',
    );
    expect(manifest).toBeGreaterThan(order[2]);
    expect(steps[manifest].with).toMatchObject({
      path: 'release-images/manifest.json',
      'if-no-files-found': 'error',
    });
    // Pull requests hand the images to the shards; a push to main exports them instead.
    for (const position of [order[2], order[3], manifest]) {
      expect(expression(steps[position].if)).toBe(testCondition);
    }
    for (const step of steps) {
      if (
        ![steps[order[2]], steps[order[3]], steps[manifest]].includes(step) &&
        !step.if?.includes('push')
      ) {
        expect(step.if).toBeUndefined();
      }
      expect(step.run ?? '').not.toMatch(/playwright|test:e2e|--shard/);
    }
  });

  it('ENG-007-A every shard and the scan job load the build artifact and refuse other images', () => {
    for (const name of ['critical-acceptance', 'image-security']) {
      const steps = ci.jobs[name].steps ?? [];
      const download = steps.findIndex(
        (step) =>
          step.uses?.startsWith('actions/download-artifact@') &&
          step.with?.name === 'release-images',
      );
      const load = steps.findIndex(
        (step) => step.name === 'Load and verify the exact built images',
      );
      // Shards run acceptance on the loaded images, the scan job scans them.
      const use = steps.findIndex(
        (step) =>
          step.id === 'critical-release-acceptance' ||
          step.uses?.startsWith('aquasecurity/trivy-action@'),
      );
      expect(steps[download]?.uses).toMatch(/^actions\/download-artifact@[a-f0-9]{40}$/);
      expect(steps[download]?.with?.path).toBe('release-images');
      expect(download).toBeGreaterThanOrEqual(0);
      expect(download).toBeLessThan(load);
      expect(load).toBeLessThan(use);
      expect(steps[load].if).toBeUndefined();
      expect(steps[load].run?.trim().split('\n')).toEqual(loadImages);
    }
    // The receipt job reads only the manifest the images were verified against.
    const receiptSteps = ci.jobs['docker-build'].steps ?? [];
    const manifest = receiptSteps.filter(
      (step) =>
        step.uses?.startsWith('actions/download-artifact@') && typeof step.with?.name === 'string',
    );
    expect(manifest).toHaveLength(1);
    expect(manifest[0].uses).toMatch(/^actions\/download-artifact@[a-f0-9]{40}$/);
    expect(manifest[0].with).toEqual({ name: 'release-images-manifest', path: 'release-images' });
    for (const name of ['critical-acceptance', 'image-security', 'docker-build']) {
      // No release job after the build may produce or fetch its own images.
      for (const step of ci.jobs[name].steps ?? []) {
        expect(step.run ?? '').not.toMatch(
          /compose\b[^\n]*\bbuild\b|docker (?:build|pull)|acceptance\.mjs images/,
        );
      }
    }
  });

  it('ENG-007-A the main-only browser cache job gates nothing and builds no images', () => {
    const job = ci.jobs['playwright-cache'] as WorkflowJob;
    expect(job.name).toBe('Warm Playwright Browser Cache');
    expect(expression(job.if)).toBe(pushCondition);
    expect(job['continue-on-error']).toBe(true);
    for (const [name, other] of Object.entries(ci.jobs)) {
      expect(dependencies(other)).not.toContain('playwright-cache');
      if (name !== 'playwright-cache') expect(other.name).not.toBe(job.name);
    }
    const steps = job.steps ?? [];
    const cache = steps.find((step) => step.uses?.startsWith('actions/cache@'));
    const shardCache = (ci.jobs['critical-acceptance'].steps ?? []).find((step) =>
      step.uses?.startsWith('actions/cache@'),
    );
    expect(cache?.uses).toBe(shardCache?.uses);
    expect(cache?.with).toEqual(shardCache?.with);
    for (const step of steps) {
      expect(step.run ?? '').not.toMatch(/docker|acceptance\.mjs|playwright test/);
      expect(step.with?.name).not.toBe('manual-mvp-candidate');
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
    expect(job.name).toBe('Acceptance Receipt and Image Security');
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

  it('ENG-007-E CD provenance requires the image build, the merged pull request check and the aggregate', () => {
    expect(runProvenanceScript(provenanceJobs()).status).toBe(0);
    for (const name of ['Build Release Images', 'Merged Pull Request CI', 'CI Status']) {
      const missingResult = runProvenanceScript(
        provenanceJobs().filter((job) => job.name !== name),
      );
      expect(missingResult.status).toBe(1);
      expect(missingResult.stderr).toContain('Required candidate gate missing or unsuccessful');
      for (const conclusion of ['failure', 'cancelled', 'skipped']) {
        const failed = provenanceJobs();
        const target = failed.find((job) => job.name === name);
        if (target) target.conclusion = conclusion;
        expect(runProvenanceScript(failed).status).toBe(1);
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
else process.exit(9);
`,
          { mode: 0o700 },
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
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it('ENG-006-C the CD provenance step refuses an obsolete commit that is no longer the main head', () => {
    const step = provenanceStep();
    expect(step.run).toContain(
      'test "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" = "$GITHUB_SHA"',
    );
  });
});

// Owner decisions 2026-10-05/06: every CI job may run on the owner's self-hosted runner.
describe('ENG-008: only trusted runs reach the self-hosted runner', () => {
  const ciJobs = Object.keys(workflow('ci').jobs);
  const selfHosted = ['self-hosted', 'linux', 'x64', 'ci'];
  const deployRunner = ['self-hosted', 'linux', 'x64', 'deploy'];
  let ci: Workflow;

  beforeAll(() => {
    ci = workflow('ci');
  });

  // Evaluates a runs-on expression the way Actions does for these operators: a missing
  // property is null, && and || return an operand, fromJSON parses its argument.
  function runner(source: string | undefined, vars: Record<string, string>, github: unknown) {
    if (!source?.trim().startsWith('${{')) return source;
    const body = expression(source)
      .replace(/\bfromJSON\(/g, 'JSON.parse(')
      .replace(/([!=])=/g, '$1==')
      .replace(/(\w)\.(?=[A-Za-z_])/g, '$1?.');
    expect(body).not.toMatch(/[;`]|\$\{/);
    return new Function('vars', 'github', `return (${body});`)(vars, github);
  }

  const repository = 'owner/capital-tracker';
  const pullRequest = (headRepository: string, author: string) => ({
    event_name: 'pull_request',
    repository,
    event: {
      pull_request: { head: { repo: { full_name: headRepository } }, user: { login: author } },
    },
  });
  const cases: [string, Record<string, string>, unknown, unknown][] = [
    [
      'switch off: same-repository pull request',
      {},
      pullRequest(repository, 'owner'),
      'ubuntu-latest',
    ],
    [
      'switch off: push to main',
      {},
      { event_name: 'push', repository, event: {} },
      'ubuntu-latest',
    ],
    [
      'switch set to another value',
      { CI_SELF_HOSTED: 'yes' },
      pullRequest(repository, 'owner'),
      'ubuntu-latest',
    ],
    [
      'switch on: same-repository pull request',
      { CI_SELF_HOSTED: 'true' },
      pullRequest(repository, 'owner'),
      selfHosted,
    ],
    [
      'switch on: push to main',
      { CI_SELF_HOSTED: 'true' },
      { event_name: 'push', repository, event: {} },
      selfHosted,
    ],
    [
      'switch on: manual dispatch',
      { CI_SELF_HOSTED: 'true' },
      { event_name: 'workflow_dispatch', repository, event: {} },
      selfHosted,
    ],
    [
      'switch on: pull request from a fork',
      { CI_SELF_HOSTED: 'true' },
      pullRequest('someone/capital-tracker', 'someone'),
      'ubuntu-latest',
    ],
    [
      'switch on: Dependabot pull request',
      { CI_SELF_HOSTED: 'true' },
      pullRequest(repository, 'dependabot[bot]'),
      'ubuntu-latest',
    ],
  ];

  it('ENG-008-A covers every CI job, the aggregate and the main-only jobs included', () => {
    expect([...ciJobs].sort()).toEqual([...requiredJobs, 'playwright-cache', 'ci-status'].sort());
  });

  describe.each(ciJobs)('ENG-008-A %s', (job) => {
    it.each(cases)('%s', (_case, vars, github, expected) => {
      expect(runner(ci.jobs[job]['runs-on'], vars, github)).toEqual(expected);
    });
  });

  // The deploy holds the dispatcher key: only its own runner may take it, and that runner
  // never takes a CI job, whose code comes from branches and dependencies.
  const deployCases: [string, Record<string, string>, unknown][] = [
    ['switches off', {}, 'ubuntu-latest'],
    ['only the CI switch on', { CI_SELF_HOSTED: 'true' }, 'ubuntu-latest'],
    ['deploy switch set to another value', { DEPLOY_SELF_HOSTED: 'yes' }, 'ubuntu-latest'],
    ['deploy switch on', { DEPLOY_SELF_HOSTED: 'true' }, deployRunner],
    ['both switches on', { CI_SELF_HOSTED: 'true', DEPLOY_SELF_HOSTED: 'true' }, deployRunner],
  ];

  describe.each(Object.keys(workflow('cd').jobs))('ENG-008-D deploy job %s', (job) => {
    it.each(deployCases)('%s', (_case, vars, expected) => {
      for (const event of ['workflow_run', 'workflow_dispatch']) {
        const github = { event_name: event, repository, event: {} };
        expect(runner(workflow('cd').jobs[job]['runs-on'], vars, github)).toEqual(expected);
      }
    });
  });

  it('ENG-008-D CI and deploy runners share no distinguishing label', () => {
    expect(selfHosted).not.toContain('deploy');
    expect(deployRunner).not.toContain('ci');
  });

  // The runner user has no sudo except one sudoers rule for exactly this command
  // (docs/self-hosted-runner.md); any other sudo would fail there.
  it('ENG-008-C the only sudo in CI is the root ownership test the runner allows', () => {
    const sudo = Object.values(ci.jobs).flatMap((job) =>
      (job.steps ?? []).filter((step) => /\bsudo\b/.test(step.run ?? '')),
    );
    expect(sudo.map((step) => step.run?.trim())).toEqual([
      'sudo python3 -B -m unittest discover -s tests/security -p manual_mvp_dispatch_flow_test.py -k test_application_uid_is_accepted_only_at_delegated_paths',
    ]);
  });

  // A private repository's artifact storage cannot hold the image archives, so the owner's
  // runners pass them through a shared store; the checksum still travels in the artifact.
  it('ENG-008-E self-hosted runs keep image archives out of artifacts but verify them', () => {
    const lines = (step: WorkflowStep | undefined) =>
      (step?.run ?? '')
        .trim()
        .split('\n')
        .map((line) => line.trim());
    const build = ci.jobs['release-images'].steps ?? [];
    const save = lines(
      build.find((step) => step.name === 'Save the exact images for the acceptance shards'),
    );
    const checksum = save.indexOf(
      '(cd release-images && sha256sum images.tar.zst > images.tar.zst.sha256)',
    );
    const move = save.indexOf(
      'mv release-images/images.tar.zst "/srv/ci-images/$GITHUB_RUN_ID/images.tar.zst"',
    );
    expect(checksum).toBeGreaterThan(0);
    expect(move).toBeGreaterThan(checksum);
    const storeMounted =
      "mountpoint -q /srv/ci-images || { echo '::error::The shared image store /srv/ci-images is not mounted (docs/self-hosted-runner.md)'; exit 1; }";
    // A missing mount must fail the build, not fill the runner's own disk unseen.
    expect(save.slice(move - 3, move)).toEqual([
      'if [[ $RUNNER_ENVIRONMENT == self-hosted ]]; then',
      storeMounted,
      'install -d "/srv/ci-images/$GITHUB_RUN_ID"',
    ]);
    const exported = lines(build.find((step) => step.name === exportStepName));
    const sum = exported.indexOf(
      'sha256sum candidate/images.tar.gz > candidate/images.tar.gz.sha256',
    );
    const moveCandidate = exported.indexOf(
      'mv candidate/images.tar.gz "/srv/ci-images/$GITHUB_RUN_ID/images.tar.gz"',
    );
    expect(sum).toBeGreaterThan(0);
    expect(moveCandidate).toBeGreaterThan(sum);
    expect(exported.slice(moveCandidate - 3, moveCandidate)).toEqual([
      'if [[ $RUNNER_ENVIRONMENT == self-hosted ]]; then',
      storeMounted,
      'install -d "/srv/ci-images/$GITHUB_RUN_ID"',
    ]);
    // The checksum file stays in the uploaded directories.
    expect(save.join('\n')).not.toMatch(/mv release-images\/images\.tar\.zst\.sha256/);
    expect(exported.join('\n')).not.toMatch(/mv candidate\/images\.tar\.gz\.sha256/);
    // The deploy links the stored archive only when the artifact lacks it, then checks it
    // against the artifact's checksum before loading anything.
    const download = lines(
      (workflow('cd').jobs.deploy.steps ?? []).find(
        (step) => step.name === 'Download and verify the tested candidate',
      ),
    );
    const link = download.indexOf(
      'ln -s "/srv/ci-images/$RUN_ID/images.tar.gz" candidate/images.tar.gz',
    );
    expect(download[link - 1]).toBe(
      'if [[ ! -e candidate/images.tar.gz && $RUNNER_ENVIRONMENT == self-hosted ]]; then',
    );
    expect(download.indexOf('sha256sum -c candidate/images.tar.gz.sha256')).toBeGreaterThan(link);
    expect(download.at(-1)).toBe('sha256sum -c candidate/images.tar.gz.sha256');
  });

  it('ENG-008-B pull requests never trigger with base-repository privileges', () => {
    for (const name of ['ci', 'cd']) {
      expect(Object.keys(workflow(name).on)).not.toContain('pull_request_target');
    }
  });
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
      "(github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.head_sha == github.sha && github.ref == 'refs/heads/main') || (github.event_name == 'workflow_dispatch' && (github.ref == 'refs/heads/main' || (inputs.mode == 'inventory' && github.ref == 'refs/heads/release/manual-mvp' && github.sha == vars.MVP_PREFLIGHT_COMMIT)))",
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
