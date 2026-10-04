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
  'docker-build',
  'spec-check',
  'dependency-audit',
];

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

function invokeWorkflowGate(step: WorkflowStep, needs: Needs) {
  const needsExpression = /\$\{\{\s*toJSON\(needs\)\s*\}\}/g;
  const render = (value: string) => value.replace(needsExpression, JSON.stringify(needs));
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
  it('ENG-001-A accepts exact success for all nine required jobs', () => {
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

describe('ENG-001-D: repository CI workflow wiring', () => {
  let ci: Workflow;

  beforeAll(() => {
    ci = workflow('ci');
  });

  it('runs for pull requests and pushes to main', () => {
    expect(ci.on.pull_request?.branches).toContain('main');
    expect(ci.on.push?.branches).toContain('main');
  });

  it('aggregates all nine real jobs, including Docker, specifications and dependency audit', () => {
    expect(dependencies(ci.jobs['ci-status']).sort()).toEqual([...requiredJobs].sort());
    for (const job of requiredJobs) {
      expect(ci.jobs[job]).toBeDefined();
      expect(ci.jobs[job]['continue-on-error']).not.toBe(true);
    }
    expect(ci.jobs['docker-build'].if).toBeUndefined();
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
    expect(manifest.packageManager).toBe('pnpm@10.33.0');
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
    expect(dependencies(ci.jobs['docker-build']).sort()).toEqual([...releasePrerequisites].sort());
  });

  it('ENG-004-A/ENG-004-B has no job-level failure or scheduling bypass', () => {
    const ci = workflow('ci');
    for (const name of ['docker-build', ...releasePrerequisites]) {
      const job = ci.jobs[name];
      expect(job).toBeDefined();
      // Default success scheduling is required: always() or OR expressions could bypass failures.
      expect(job.if).toBeUndefined();
      expect(job['continue-on-error'] ?? false).toBe(false);
    }
  });

  it('ENG-004-A/ENG-004-B rejects failed early gates and skipped release in the real aggregate', () => {
    const ci = workflow('ci');
    for (const job of ['dependency-audit', 'spec-check']) {
      for (const status of ['failure', 'cancelled', 'skipped']) {
        const needs = successfulNeeds();
        needs[job] = { result: status };
        needs['docker-build'] = { result: 'skipped' };
        const result = invokeWorkflowGate(gateStep(ci), needs);
        expect(result.status).not.toBe(0);
        expect(result.output).toContain(job);
        expect(result.output).toContain('docker-build');
      }
    }
  });
});

describe('ENG-005: critical real release acceptance preserves security and blocks incomplete promotion', () => {
  const accepted =
    "success() && steps.critical-release-acceptance.conclusion == 'success' && steps.verify-critical-receipt.conclusion == 'success'";

  it('ENG-005-A runs the reviewed critical profile and keeps full manual E2E available', () => {
    const ci = workflow('ci');
    expect(ci.env?.CI_E2E_ENABLED).toBeUndefined();
    expect(ci.jobs['docker-build'].name).toBe('Release Images and Security');
    const steps = ci.jobs['docker-build'].steps ?? [];
    const browser = steps.filter((step) => step.run?.includes('playwright install'));
    expect(browser).toHaveLength(1);
    expect(browser[0].if).toBeUndefined();
    const acceptance = steps.filter((step) => step.run?.trim() === 'pnpm test:e2e:critical');
    expect(acceptance).toHaveLength(1);
    expect(acceptance[0].id).toBe('critical-release-acceptance');
    expect(acceptance[0].name).toBe('Run critical real release acceptance');
    expect(acceptance[0].if).toBeUndefined();
    expect(acceptance[0]['continue-on-error'] ?? false).toBe(false);
    expect(steps.find((step) => step.name === 'Verify critical acceptance receipt')?.run).toContain(
      'critical-release-profile.cjs verify',
    );
    const scripts = JSON.parse(
      readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
    ).scripts;
    expect(scripts['test:e2e']).toBe('node scripts/acceptance.mjs');
    expect(scripts['test:e2e:critical']).toBe('node scripts/acceptance.mjs critical');
    const report = steps.find((step) => step.with?.name === 'synthetic-acceptance-report');
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
    for (const name of [
      'Pull exact reviewed PostgreSQL and Redis images',
      'Enforce exact-image high and critical security gate',
    ]) {
      const step = steps.find((item) => item.name === name);
      expect(step).toBeDefined();
      expect(step?.if).toBeUndefined();
      expect(step?.['continue-on-error'] ?? false).toBe(false);
    }
  });

  it('ENG-005-C exports a candidate only after successful critical acceptance and receipt validation', () => {
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
    const receipt = steps.find((step) => step.with?.name === 'critical-release-acceptance');
    expect(receipt?.with?.['if-no-files-found']).toBe('error');
  });

  it.each([undefined, 'skipped', 'failure', 'cancelled', 'unknown', 'success'])(
    'ENG-005-B actual CD provenance accepts only successful critical acceptance, result %p',
    (conclusion) => {
      const validation = workflow('cd').jobs.deploy.steps?.find(
        (step) => step.name === 'Validate trusted successful candidate provenance',
      );
      expect(validation?.if).toBe("env.RELEASE_MODE != 'inventory'");
      const script = validation?.run?.match(/node - <<'NODE'\n([\s\S]*?)\nNODE/);
      expect(script).not.toBeNull();
      const names = [
        'Backend Lint & Format',
        'Backend Tests',
        'Backend Build',
        'Frontend Lint & Format',
        'Frontend Tests',
        'Frontend Build',
        'Release Images and Security',
        'Specification and Engineering Gates',
        // Even an obsolete successful job name must not substitute for actual step evidence.
        'Release Images and Real Acceptance',
        'Production Dependency Audit',
        'CI Status',
      ];
      const jobs = names.map((name) => ({
        name,
        conclusion: 'success',
        steps:
          name === 'Release Images and Security' && conclusion !== undefined
            ? [
                { name: 'Run critical real release acceptance', conclusion },
                { name: 'Verify critical acceptance receipt', conclusion: 'success' },
              ]
            : [],
      }));
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
        expect(result.status).toBe(conclusion === 'success' ? 0 : 1);
        if (conclusion !== 'success') {
          expect(result.stderr).toContain('Critical real acceptance missing or unsuccessful');
        }
        expect(validation?.run).toContain('gh run download "$RUN_ID"');
        expect(validation?.run).toContain(
          'critical-release-profile.cjs verify acceptance/critical-release-acceptance.json',
        );
      } finally {
        rmSync(directory, { recursive: true });
      }
    },
  );

  it('ENG-005-B refuses a successful browser step without successful receipt verification', () => {
    const validation = workflow('cd').jobs.deploy.steps?.find(
      (step) => step.name === 'Validate trusted successful candidate provenance',
    );
    const script = validation?.run?.match(/node - <<'NODE'\n([\s\S]*?)\nNODE/);
    expect(script).not.toBeNull();
    const jobs = [
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
    ].map((name) => ({
      name,
      conclusion: 'success',
      steps:
        name === 'Release Images and Security'
          ? [{ name: 'Run critical real release acceptance', conclusion: 'success' }]
          : [],
    }));
    const directory = mkdtempSync(resolve(tmpdir(), 'capital-ci-provenance-'));
    try {
      writeFileSync(resolve(directory, 'jobs.json'), JSON.stringify({ jobs }));
      const result = spawnSync(process.execPath, ['-e', script?.[1] ?? ''], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 5_000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Critical real acceptance missing or unsuccessful');
    } finally {
      rmSync(directory, { recursive: true });
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
    expect(Object.keys(cd.jobs)).toEqual(['deploy']);
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
