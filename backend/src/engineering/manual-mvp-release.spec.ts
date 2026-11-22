import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { parse } = require('yaml') as { parse: (source: string) => unknown };
const root = resolve(__dirname, '../../..');
type Workflow = {
  on: { workflow_dispatch?: { inputs?: Record<string, unknown> } };
  jobs: Record<string, { steps?: { run?: string }[] }>;
};
const cd = parse(readFileSync(resolve(root, '.github/workflows/cd.yml'), 'utf8')) as Workflow;
const workflowCommands = Object.values(cd.jobs)
  .flatMap((job) => job.steps ?? [])
  .map((step) => step.run ?? '')
  .join('\n');
const serverScript = resolve(root, 'scripts/manual-mvp-release.sh');
const commands =
  workflowCommands + (existsSync(serverScript) ? readFileSync(serverScript, 'utf8') : '');
describe('MVP-002: actual deployment policy', () => {
  // These predecessor failures inspect existing runnable deployment commands, not absent scaffolding.
  it('MVP-002-A offers no override that skips the pre-mutation database backup', () => {
    expect(cd.on.workflow_dispatch?.inputs ?? {}).not.toHaveProperty('skip_backup');
    expect(commands).not.toMatch(/Postgres container not found, skipping backup/);
  });
  it('MVP-002-B cannot learn the trusted SSH host key from the connection being authenticated', () => {
    expect(commands).not.toMatch(/\bssh-keyscan\b/);
  });
  it('MVP-002-C updates applications without taking the entire stack down or pruning recovery images', () => {
    expect(commands).not.toMatch(/docker\s+compose\s+down\b/);
    expect(commands).not.toMatch(/docker\s+image\s+prune\b/);
  });
  it('MVP-002-D invokes the existing explicit migration CLI during release', () => {
    expect(commands).toMatch(/backend\/dist\/migrate\.js/);
  });
  it('MVP-002-F gives the backend the runtime role and only the migration CLI the migration role', () => {
    type Service = { profiles?: string[]; environment?: Record<string, unknown> };
    const production = parse(readFileSync(resolve(root, 'docker-compose.yml'), 'utf8')) as {
      services: Record<string, Service>;
    };
    const { backend, migrate, postgres } = production.services;
    // Falls back to the migration role until the owner creates the runtime role (DBROLE-001).
    expect(backend.environment?.DB_USERNAME).toBe(
      ['$', '{DB_APP_USERNAME:-$', '{DB_USERNAME:-postgres}}'].join(''),
    );
    expect(backend.environment?.DB_PASSWORD).toBe(
      ['$', '{DB_APP_PASSWORD:-$', '{DB_PASSWORD:?Set the existing database password}}'].join(''),
    );
    expect(migrate.profiles).toEqual(['release']);
    expect(migrate.environment?.DB_USERNAME).toBe(postgres.environment?.POSTGRES_USER);
    expect(migrate.environment?.DB_PASSWORD).toBe(postgres.environment?.POSTGRES_PASSWORD);
    expect(migrate.environment?.DB_APP_USERNAME).toBe(['$', '{DB_APP_USERNAME:-}'].join(''));
    // Only what migrate.js reads: no MFA key, provider keys or proxy settings.
    expect(Object.keys(migrate.environment ?? {}).sort()).toEqual([
      'DB_APP_USERNAME',
      'DB_HOST',
      'DB_NAME',
      'DB_PASSWORD',
      'DB_PORT',
      'DB_USERNAME',
      'NODE_ENV',
    ]);
    expect(readFileSync(serverScript, 'utf8')).toContain(
      'dc run --rm --no-deps migrate node backend/dist/migrate.js',
    );
    expect(readFileSync(serverScript, 'utf8')).not.toMatch(
      /run --rm --no-deps backend node backend\/dist\/migrate/,
    );
  });
  it('MVP-002-E checks only private routes the browser acceptance proves answer 401', () => {
    // A route the application removed answers 404 and fails the release after migration.
    const smoke = /for route in ([^;]+); do/.exec(readFileSync(serverScript, 'utf8'));
    const routes = smoke?.[1].trim().split(/\s+/) ?? [];
    const sessions = readFileSync(resolve(root, 'tests/e2e/sessions.spec.ts'), 'utf8');
    const privateRoutes = /SES-004-A: backend root is private by default[\s\S]*?\]\) \{/.exec(
      sessions,
    )?.[0];
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) expect(privateRoutes).toContain(`'/api/${route}'`);
  });
});
