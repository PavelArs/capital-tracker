import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  'continue-on-error'?: boolean;
  'working-directory'?: string;
};
type WorkflowJob = {
  needs?: string | string[];
  if?: string;
  steps?: WorkflowStep[];
  'continue-on-error'?: boolean;
  defaults?: { run?: { 'working-directory'?: string } };
};
type Workflow = {
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

describe('ENG-002-A: controlled legacy deployment entry', () => {
  let cd: Workflow;

  beforeAll(() => {
    cd = workflow('cd');
  });

  it('permits manual dispatch only, without automatic push deployment', () => {
    // The original push trigger is a behavioral RED independent of the new CLI.
    expect(Object.keys(cd.on)).toEqual(['workflow_dispatch']);
  });

  it('requires main and explicit owner opt-in before the initial version job runs', () => {
    const clauses = expression(cd.jobs.version.if).split(/\s*&&\s*/);
    const required = [
      "github.ref == 'refs/heads/main'",
      "vars.PRODUCTION_ROLLOUT_ENABLED == 'true'",
    ];
    expect(clauses).toEqual(expect.arrayContaining(required));
    // Restrict to conjunctions: an OR/always() escape must not pass string-presence checks.
    const allowed = [...required, "github.event_name == 'workflow_dispatch'"];
    for (const clause of clauses) expect(allowed).toContain(clause);
    expect(dependencies(cd.jobs.version)).toEqual([]);
  });

  it('keeps every existing publishing, deployment and follow-up job behind version', () => {
    const originalJobs = [
      'version',
      'build-backend',
      'build-frontend',
      'deploy',
      'rollback',
      'notify',
    ];
    expect(Object.keys(cd.jobs).sort()).toEqual(originalJobs.sort());
    const reachesVersion = (name: string, visited = new Set<string>()): boolean => {
      if (name === 'version') return true;
      if (visited.has(name)) return false;
      visited.add(name);
      expect(cd.jobs[name]).toBeDefined();
      return dependencies(cd.jobs[name]).some((dependency) => reachesVersion(dependency, visited));
    };
    for (const name of originalJobs.filter((job) => job !== 'version')) {
      expect({ job: name, guarded: reachesVersion(name) }).toEqual({ job: name, guarded: true });
    }
  });

  it('ENG-002-B permits rollback only after guarded deployment failure with a prior image', () => {
    const clauses = expression(cd.jobs.rollback.if).split(/\s*&&\s*/);
    const required = [
      "needs.version.result == 'success'",
      "needs.deploy.result == 'failure'",
      "needs.deploy.outputs.previous_backend != ''",
      "needs.deploy.outputs.previous_backend != 'none'",
    ];
    expect(clauses).toEqual(expect.arrayContaining(required));
    // Exact conjunctions forbid OR/always() escapes. These clauses exclude version
    // failure, skipped deployment after a build failure, and missing image output.
    for (const clause of clauses) expect([...required, 'failure()']).toContain(clause);
  });
});
