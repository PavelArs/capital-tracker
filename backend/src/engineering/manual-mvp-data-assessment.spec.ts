import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = resolve(__dirname, '../../../scripts/manual-mvp-data-assessment.sh');
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'capital-assessment-'));
  mkdirSync(join(directory, 'bin'));
  writeFileSync(join(directory, 'bin', 'id'), '#!/usr/bin/env node\nconsole.log("0")\n', {
    mode: 0o700,
  });
  writeFileSync(
    join(directory, 'bin', 'docker'),
    `#!/usr/bin/env node
const a=process.argv.slice(2),mode=process.env.FIXTURE_INVENTORY;
if(mode==='failure')process.exit(1);
if(a[0]==='ps')process.stdout.write(['container','bind'].includes(mode)?'synthetic-container':'');
if(a[0]==='volume'&&a[1]==='ls')process.stdout.write(mode==='volume'?'synthetic-volume':'');
if(a[0]==='network'&&a[1]==='ls')process.stdout.write(mode==='network'?'synthetic-network':'');
if(a[0]==='inspect')console.log(JSON.stringify([{Name:mode==='container'?'/capital_tracker_db':'/unrelated',Mounts:mode==='bind'?[{Type:'bind',Source:process.env.FIXTURE_ROOT+'/data'}]:[],Config:{Labels:{}}}]));
if(['volume','network'].includes(a[0])&&a[1]==='inspect')console.log(JSON.stringify([{Name:'unrelated',Labels:{'com.docker.compose.project':'capital-tracker'}}]));
`,
    { mode: 0o700 },
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function assess(environment: string, inventory = 'empty') {
  const script = join(directory, 'assessment.sh');
  // Test-owned path substitution only; the shipped operator helper keeps its fixed /opt path.
  writeFileSync(
    script,
    readFileSync(source, 'utf8').replace('root=/opt/capital-tracker', `root=${directory}`),
  );
  writeFileSync(join(directory, '.env'), environment);
  const root = join(directory, 'project');
  mkdirSync(root);
  writeFileSync(join(root, '.env'), environment);
  writeFileSync(script, readFileSync(script, 'utf8').replace(`root=${directory}`, `root=${root}`));
  const result = spawnSync('bash', [script], {
    env: {
      ...process.env,
      PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
      FIXTURE_INVENTORY: inventory,
      FIXTURE_ROOT: root,
    },
    encoding: 'utf8',
    timeout: 5000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(readFileSync(join(root, '.env'), 'utf8')).toBe(environment);
  expect(result.stdout + result.stderr).not.toContain('PRIVATE_CANARY');
  return result;
}
describe('read-only owner configuration assessment', () => {
  it.each([
    'DB_HOST=postgres',
    'export DB_HOST="db" # comment',
    "DB_HOST='capital_tracker_db'",
    '# ignored\nDB_HOST=postgres # note',
  ])('recognizes dedicated Docker targets without printing values: %s', (value) => {
    const result = assess(`${value}\nDB_PASSWORD=PRIVATE_CANARY\n`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('database_target_classes=local_dedicated');
    expect(result.stdout).toContain('database_connection_key_names=DB_HOST,DB_PASSWORD');
  });
  it.each([
    'DB_HOST=private.example.invalid',
    'DB_HOST=localhost',
    'DB_HOST=127.0.0.1',
    'DATABASE_URL=postgres://user:PRIVATE_CANARY@private.example.invalid/database',
    'export DB_URL="postgres://user:PRIVATE_CANARY@localhost/database"',
    'PGSERVICE=private-service',
    'UNKNOWN_DB_TARGET=PRIVATE_CANARY',
    'DB_HOST=private.example.invalid\nDB_HOST=postgres',
    'DB_HOST postgres',
    'DB_HOST="postgres',
    'DB_HOST=$(PRIVATE_CANARY)',
    'DB_HOST=',
    'DB_PASSWORD=PRIVATE_CANARY',
  ])('blocks external, native, unknown or malformed configuration: %s', (value) => {
    const result = assess(value);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('fresh_setup_gate=blocked');
    expect(result.stdout + result.stderr).not.toContain('private.example.invalid');
  });
  it.each(['container', 'volume', 'network', 'bind', 'failure'])(
    'blocks existing resources or unavailable inventory: %s',
    (inventory) => {
      const result = assess('DB_HOST=postgres\nDB_PASSWORD=PRIVATE_CANARY', inventory);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain('fresh_setup_gate=blocked');
    },
  );
});
