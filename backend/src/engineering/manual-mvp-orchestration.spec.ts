import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script =
  process.env.MVP_RELEASE_SCRIPT_UNDER_TEST ??
  resolve(__dirname, '../../../scripts/manual-mvp-release.sh');
const commit = 'a'.repeat(40);
const backend = `ghcr.io/pavelars/capital-tracker-backend@sha256:${'d'.repeat(64)}`;
const frontend = `ghcr.io/pavelars/capital-tracker-frontend@sha256:${'e'.repeat(64)}`;
const previousBackend = `sha256:${'b'.repeat(64)}`;
const previousFrontend = `sha256:${'c'.repeat(64)}`;
let directory: string;
type Command = { tool: string; args: string[]; backend?: string; frontend?: string };

// Synthetic process contracts only: this never starts Docker, contacts a host or proves PostgreSQL restoration.
const stub = `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const tool=path.basename(process.argv[1]),a=process.argv.slice(2),root=process.env.RELEASE_ROOT,mode=process.env.FIXTURE_FAILURE;
fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify({tool,args:a,backend:process.env.BACKEND_IMAGE,frontend:process.env.FRONTEND_IMAGE})+'\\n');
const candidate=path.join(root,'candidate-up'),changed=path.join(root,'schema-changed'),rollback=path.join(root,'rollback-up');
const original=['MigrateCurrencyToForeignKey1764000000000','DropStubModuleTables1764100000000','DropRemovedModuleTables1764200000000','CleanupCryptoTypeEnum1764300000000'].join('\\n');
if(tool==='flock'){process.exit(mode==='lock'?1:0);}
if(tool==='stat'){process.stdout.write(a[1]==='%a'?'600':String(fs.statSync(a[2]).size));}
if(tool==='jq'){
 const q=a[a.length-1];let v='true';
 if(q.includes('Mounts')||q.includes('volumes.postgres_data.name'))v='capital_tracker_postgres_data';
 else if(q.includes('FRONTEND_URL'))v='https://mvp.example.invalid';
 else if(q.includes('volumes[]'))v=path.join(root,'mfa-key');
 else if(q.includes('BACKGROUND_JOBS_ENABLED'))v='false';
 process.stdout.write(v);
}
if(tool==='docker'){
 if(a[0]==='inspect'){
  if(mode==='missing-db'&&a[1]==='capital_tracker_db')process.exit(1);
  if(a.includes('--format')){
   const q=a[a.length-1];let v='db';
   if(q.includes('Config.Labels'))v='capital_tracker';
   else if(q.includes('.Image'))v='sha256:'+('b'.repeat(64));
   if(q.includes('.Image')&&a[1]==='capital_tracker_frontend')v='sha256:'+('c'.repeat(64));
   process.stdout.write(v);
  }else process.stdout.write('[]');
 }
 if(a[0]==='compose'){
  if(a.includes('config'))process.stdout.write('{}');
  if(a.includes('run')&&a.includes('backend/dist/migrate.js')){
   if(mode==='migration')process.exit(1);
   if(mode==='health-changed')fs.writeFileSync(changed,'yes');
  }
  if(a.includes('up')){
   if((process.env.BACKEND_IMAGE||'').startsWith('ghcr.io/'))fs.writeFileSync(candidate,'yes');
   else {fs.writeFileSync(rollback,'yes');if(mode==='rollback-start')process.exit(1);}
  }
 }
 if(a[0]==='exec'){
  const s=a.join(' ');
  if(s.includes('SELECT name FROM migrations'))process.stdout.write(original+(fs.existsSync(changed)?'\\nNewAdditiveMigration':'')+'\\n');
  else if(s.includes('pg_restore')){fs.readFileSync(0);if(mode==='restore')process.exit(1);}
  else if(s.includes('pg_dump -Fc')){if(mode==='dump')process.exit(1);process.stdout.write('SYNTHETIC_DUMP');}
  else if(s.includes('pg_dump'))process.stdout.write('SYNTHETIC_LOGICAL_ROWS_AND_SCHEMA\\n');
 }
}
if(tool==='openssl'){
 if(a.includes('-d'))process.stdout.write(fs.readFileSync(a[a.indexOf('-in')+1]));
 else {const data=fs.readFileSync(0);if(mode==='encrypt')process.exit(1);fs.writeFileSync(a[a.indexOf('-out')+1],data);}
}
if(tool==='sha256sum'){
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 if(a[0]==='-c'){
  const [expected,...file]=fs.readFileSync(a[1],'utf8').trim().split(/\\s+/);process.exit(hash(fs.readFileSync(file.join(' ')))===expected?0:1);
 }
 const file=a[0];process.stdout.write(hash(file?fs.readFileSync(file):fs.readFileSync(0))+'  '+(file||'-')+'\\n');
}
if(tool==='curl'){
 const url=a[a.length-1];
 if(url.endsWith('/health')){
  const unhealthy=fs.existsSync(candidate)&&['health-same','health-changed','rollback-start'].includes(mode)&&!fs.existsSync(rollback);
  process.stdout.write(unhealthy?'{}':'{"status":"ok"}');
 }else process.stdout.write(url.endsWith('/api/health/detailed')?'404':'401');
}
`;

beforeAll(() => {
  expect(existsSync(script)).toBe(true);
});
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'capital-mvp-process-'));
  mkdirSync(join(directory, 'bin'));
  for (const tool of ['docker', 'jq', 'flock', 'curl', 'openssl', 'sha256sum', 'stat'])
    writeFileSync(join(directory, 'bin', tool), stub, { mode: 0o700 });
  for (const file of ['.env', '.env.release', 'candidate.yml'])
    writeFileSync(join(directory, file), '# Synthetic release fixture\n');
  writeFileSync(join(directory, 'mfa-key'), Buffer.alloc(32, 1), { mode: 0o600 });
  writeFileSync(join(directory, '.backup-key'), Buffer.alloc(32, 2), { mode: 0o600 });
});
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});
function release(failure: string) {
  const log = join(directory, 'commands.jsonl');
  const result = spawnSync('bash', [script, 'deploy', commit, backend, frontend], {
    env: {
      ...process.env,
      PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
      RELEASE_ROOT: directory,
      RELEASE_COMPOSE_FILE: join(directory, 'candidate.yml'),
      RELEASE_RUNTIME_FILE: join(directory, '.env.release'),
      RELEASE_BACKUP_KEY_FILE: join(directory, '.backup-key'),
      FIXTURE_FAILURE: failure,
      FIXTURE_LOG: log,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Command)
    : [];
  return { result, calls };
}
const migration = (call: Command) =>
  call.tool === 'docker' && call.args.includes('backend/dist/migrate.js');
const appUp = (call: Command) =>
  call.tool === 'docker' && call.args[0] === 'compose' && call.args.includes('up');

describe('MVP-003/004: failure-safe server process orchestration', () => {
  it.each(['lock', 'missing-db', 'dump', 'encrypt', 'restore'])(
    'refuses %s before migration or candidate application update',
    (failure) => {
      const { result, calls } = release(failure);
      expect(result.status).not.toBe(0);
      const witness: Record<string, (call: Command) => boolean> = {
        lock: (call) => call.tool === 'flock',
        'missing-db': (call) =>
          call.tool === 'docker' &&
          call.args[0] === 'inspect' &&
          call.args[1] === 'capital_tracker_db',
        dump: (call) => call.tool === 'docker' && call.args.join(' ').includes('pg_dump -Fc'),
        encrypt: (call) => call.tool === 'openssl' && !call.args.includes('-d'),
        restore: (call) => call.tool === 'docker' && call.args.includes('pg_restore'),
      };
      expect(calls.some(witness[failure])).toBe(true);
      expect(calls.filter(migration)).toEqual([]);
      expect(calls.filter(appUp).filter((call) => call.backend === backend)).toEqual([]);
      for (const call of calls.filter(appUp)) {
        expect(call.backend).toBe(previousBackend);
        expect(call.frontend).toBe(previousFrontend);
      }
      expect(existsSync(join(directory, '.env.images'))).toBe(false);
    },
    20000,
  );
  it.each(['migration', 'health-same'])(
    'restores both prior application images after %s only against unchanged schema and checks readiness',
    (failure) => {
      const { result, calls } = release(failure);
      expect(result.status).not.toBe(0);
      const rollbackIndex = calls.findIndex(
        (call) => appUp(call) && call.backend === previousBackend,
      );
      expect(rollbackIndex).toBeGreaterThan(0);
      expect(calls[rollbackIndex].frontend).toBe(previousFrontend);
      expect(
        calls
          .slice(rollbackIndex + 1)
          .some(
            (call) => call.tool === 'curl' && call.args[call.args.length - 1]?.endsWith('/health'),
          ),
      ).toBe(true);
      expect(existsSync(join(directory, '.env.images'))).toBe(false);
    },
    20000,
  );
  it('stops safely after changed schema without rolling old images forward or restoring owner database', () => {
    const { result, calls } = release('health-changed');
    expect(result.status).not.toBe(0);
    expect(calls.filter(appUp).filter((call) => call.backend === previousBackend)).toEqual([]);
    const restoreCommands = calls.filter(
      (call) => call.tool === 'docker' && call.args.includes('pg_restore'),
    );
    expect(restoreCommands).toHaveLength(1);
    expect(restoreCommands[0].args).not.toContain('db');
    expect(
      calls.some(
        (call) =>
          call.tool === 'docker' && call.args[0] === 'compose' && call.args.includes('stop'),
      ),
    ).toBe(true);
    expect(existsSync(join(directory, '.env.images'))).toBe(false);
  }, 20000);
  it('successful preparation orders verified isolated restore before migration and persists the exact candidate pair', () => {
    const { result, calls } = release('success');
    expect(result.status).toBe(0);
    const restoreIndex = calls.findIndex(
      (call) => call.tool === 'docker' && call.args.includes('pg_restore'),
    );
    expect(restoreIndex).toBeGreaterThan(0);
    expect(calls.findIndex(migration)).toBeGreaterThan(restoreIndex);
    expect(readFileSync(join(directory, '.env.images'), 'utf8')).toBe(
      `BACKEND_IMAGE=${backend}\nFRONTEND_IMAGE=${frontend}\n`,
    );
    expect(
      calls.some((call) => appUp(call) && call.backend === backend && call.frontend === frontend),
    ).toBe(true);
    expect(calls.some((call) => call.tool === 'docker' && call.args.includes('down'))).toBe(false);
  }, 20000);
});
