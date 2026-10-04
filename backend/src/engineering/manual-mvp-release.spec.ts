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
});
