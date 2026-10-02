import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
if(tool==='mv'){
 if(mode==='metadata-publication'&&a[0]===path.join(root,'docker-compose.yml.next'))process.exit(1);
 fs.renameSync(a[0],a[1]);
}
if(tool==='flock'){process.exit(mode==='lock'?1:0);}
if(tool==='stat'){process.stdout.write(a[1]==='%a'?'600':String(fs.statSync(a[2]).size));}
if(tool==='jq'){
 // Every fixture jq call uses stdin (a pipe or here-string); consume it before returning output.
 fs.readFileSync(0);
 const q=a[a.length-1];let v='true';
 if(q==='.services.postgres.image')v=process.env.RELEASE_INSTALLATION!=='existing'&&mode!=='fresh-mutable-postgres'?'ghcr.io/pavelars/capital-tracker-postgres@sha256:'+('d'.repeat(64)):'postgres:16.10-alpine';
 else if(q==='.services.redis.image')v=process.env.RELEASE_INSTALLATION!=='existing'&&mode!=='fresh-mutable-redis'?'redis@sha256:'+('e'.repeat(64)):'redis:7.4.2-alpine';
 else if(q.includes('services.postgres.environment.CAPITAL_EXPECTED_MAJOR'))v=mode==='existing-major'||(process.env.RELEASE_INSTALLATION!=='existing'&&mode!=='fresh-old-major')?'18':'16';
 else if(q.includes('services.postgres.volumes'))v=mode==='existing-layout'||(process.env.RELEASE_INSTALLATION!=='existing'&&mode!=='fresh-old-major'&&mode!=='fresh-old-layout')?'/var/lib/postgresql':'/var/lib/postgresql/data';
 else if(q.includes('Mounts')||q.includes('volumes.postgres_data.name'))v='capital_tracker_postgres_data';
 else if(q.includes('FRONTEND_URL'))v='https://mvp.example.invalid';
 else if(q.includes('volumes[]'))v=path.join(root,'mfa-key');
 else if(q.includes('BACKGROUND_JOBS_ENABLED'))v='false';
 else if(q.includes('.proxyPeer'))v='172.18.0.3';
 process.stdout.write(v);
}
if(tool==='docker'){
 if(a[0]==='ps'){
  if(mode==='fresh-container-inventory')process.exit(1);
  if(mode==='fresh-container')process.stdout.write('capital_tracker_db');
 }
 if(a[0]==='volume'&&a[1]==='ls'){
  const labeled=a.includes('--filter');
  if(mode===(labeled?'fresh-label-inventory':'fresh-volume-inventory'))process.exit(1);
  if(mode===(labeled?'fresh-labeled-volume':'fresh-named-volume'))process.stdout.write(labeled?'unexplained_owner_data':'capital_tracker_postgres_data');
 }
 if(a[0]==='image'&&a[1]==='inspect'){
  const drift=(mode==='existing-postgres-drift'&&a[2].startsWith('postgres'))||(mode==='existing-redis-drift'&&a[2].startsWith('redis'));
  process.stdout.write('sha256:'+(drift?'f':'b').repeat(64));
 }
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
  if(a.includes('run')&&a.some(item=>item.includes('candidateId')))process.stdout.write('11111111-1111-1111-1111-111111111111');
  if(a.includes('stop')&&mode==='partial-stop'&&!fs.existsSync(path.join(root,'stop-refused'))){fs.writeFileSync(path.join(root,'stop-refused'),'yes');process.exit(1);}
  if(a.includes('up')){
   if((process.env.BACKEND_IMAGE||'').startsWith('ghcr.io/'))fs.writeFileSync(candidate,'yes');
   else {fs.writeFileSync(rollback,'yes');if(mode==='rollback-start')process.exit(1);}
  }
 }
 if(a[0]==='exec'){
  const s=a.join(' ');
  if(s.includes('pg_isready')){
   if(s.includes('127.0.0.1')){
    if(mode==='restore-never-tcp')process.exit(1);
    if(mode==='restore-temp-window'){
     const countFile=path.join(root,'tcp-ready-attempts');
     const count=Number(fs.existsSync(countFile)?fs.readFileSync(countFile,'utf8'):0)+1;
     fs.writeFileSync(countFile,String(count));
     if(count<3)process.exit(1);
     fs.writeFileSync(path.join(root,'final-restore-ready'),'yes');
    }
   }
   process.exit(0);
  }
  if(s.includes('PG_VERSION'))process.stdout.write(process.env.RELEASE_INSTALLATION==='resume-fresh'?'18':'16');
  else if(s.includes('owner_auth WHERE id=1'))process.stdout.write('11111111-1111-1111-1111-111111111111');
  else if(s.includes('SELECT name FROM migrations'))process.stdout.write((mode==='unsafe-schema'?original.split('\\n').slice(1).join('\\n'):original)+(fs.existsSync(changed)?'\\nNewAdditiveMigration':'')+'\\n');
  else if(s.includes('pg_restore')){fs.readFileSync(0);if(mode==='restore'||(mode==='restore-temp-window'&&!fs.existsSync(path.join(root,'final-restore-ready'))))process.exit(1);}
  else if(s.includes('pg_dump -Fc')){if(mode==='dump')process.exit(1);process.stdout.write('SYNTHETIC_DUMP');}
  else if(s.includes('pg_dump'))process.stdout.write(mode==='fingerprint'&&a[1]!=='db'?'DIFFERENT_RESTORED_ROWS\\n':'SYNTHETIC_LOGICAL_ROWS_AND_SCHEMA\\n');
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
 if(url.startsWith('http://127.0.0.1:3102/'))process.stdout.write('172.18.0.3');
 else if(url.endsWith('/health')){
  const unhealthy=fs.existsSync(candidate)&&['health-same','health-changed','rollback-start'].includes(mode)&&!fs.existsSync(rollback);
  process.stdout.write(unhealthy?'{}':'{"status":"ok"}');
 }else process.stdout.write(url.endsWith('/api/health/detailed')?'404':'401');
}
if(tool==='sleep')process.exit(0);
`;

beforeAll(() => {
  expect(existsSync(script)).toBe(true);
});
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'capital-mvp-process-'));
  mkdirSync(join(directory, 'bin'));
  for (const tool of ['docker', 'jq', 'flock', 'curl', 'openssl', 'sha256sum', 'stat', 'mv', 'sleep'])
    writeFileSync(join(directory, 'bin', tool), stub, { mode: 0o700 });
  writeFileSync(join(directory, 'docker-compose.yml'), '# Synthetic previous configuration\n');
  for (const file of ['.env', '.env.release', 'candidate.yml'])
    writeFileSync(join(directory, file), '# Synthetic release fixture\n');
  writeFileSync(join(directory, 'mfa-key'), Buffer.alloc(32, 1), { mode: 0o600 });
  writeFileSync(join(directory, '.backup-key'), Buffer.alloc(32, 2), { mode: 0o600 });
  writeFileSync(join(directory, 'resume-helper.py'), 'raise SystemExit(2)\n');
  writeFileSync(join(directory, '.owner-password.json'), '{"password":"synthetic","confirmation":"synthetic"}');
  mkdirSync(join(directory, 'operator'));
});
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});
function release(failure: string, installation = 'existing', action = 'deploy') {
  const log = join(directory, 'commands.jsonl');
  const result = spawnSync('bash', [script, action, commit, backend, frontend], {
    env: {
      ...process.env,
      PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
      RELEASE_ROOT: directory,
      RELEASE_INSTALLATION: installation,
      RELEASE_POSTGRES_IMAGE: `ghcr.io/pavelars/capital-tracker-postgres@sha256:${'d'.repeat(64)}`,
      RELEASE_REDIS_IMAGE: `redis@sha256:${'e'.repeat(64)}`,
      RELEASE_COMPOSE_FILE: join(directory, 'candidate.yml'),
      RELEASE_RUNTIME_FILE: join(directory, '.env.release'),
      RELEASE_BACKUP_KEY_FILE: join(directory, '.backup-key'),
      RELEASE_RESUME_HELPER: join(directory, 'resume-helper.py'),
      RELEASE_PINS_FILE: join(directory, 'pins.json'),
      RELEASE_USED_RECEIPTS_DIR: join(directory, 'used'),
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
  it('continues only apps after positive resume proof and backup restore, retaining infrastructure', () => {
    writeFileSync(join(directory, 'resume-helper.py'), `import json, os, sys
with open(os.environ['FIXTURE_LOG'], 'a') as out:
    out.write(json.dumps({'tool':'resume-proof','args':sys.argv[1:]})+'\\n')
if sys.argv[1] == 'preflight':
    print(json.dumps({'proxyPeer':'172.18.0.3','network':['old-network'],'containers':{}}))
`);
    writeFileSync(join(directory, '.env.release'), 'OWNER_EMAIL=owner@capital.pavelars.ru\n');
    const { result, calls } = release('resume-success', 'resume-fresh');
    expect(result.status).toBe(0);
    expect(calls.some((call) => call.tool === 'resume-proof' && call.args[0] === 'preflight')).toBe(true);
    expect(calls.some((call) => call.tool === 'resume-proof' && call.args[0] === 'compare-active')).toBe(true);
    expect(calls.some((call) => call.tool === 'docker' && call.args.includes('pull') &&
      (call.args.includes('postgres') || call.args.includes('redis')))).toBe(false);
    expect(calls.some((call) => appUp(call) &&
      (call.args.includes('postgres') || call.args.includes('redis')))).toBe(false);
    const restore = calls.findIndex((call) => call.tool === 'docker' && call.args.includes('pg_restore'));
    const migrate = calls.findIndex(migration);
    expect(restore).toBeGreaterThan(0);
    expect(migrate).toBeGreaterThan(restore);
    expect(existsSync(join(directory, '.env.images'))).toBe(true);
  }, 20000);
  it('refuses a resumed installation when historical and host proof fails before pull or writes', () => {
    const { result, calls } = release('resume-helper-refusal', 'resume-fresh');
    expect(result.status).not.toBe(0);
    expect(calls.some((call) => call.tool === 'docker' && call.args.includes('pull'))).toBe(false);
    expect(calls.some(migration)).toBe(false);
    expect(calls.some(appUp)).toBe(false);
    expect(existsSync(join(directory, '.env.images'))).toBe(false);
  });
  it.each(['lock', 'missing-db', 'dump', 'encrypt', 'restore', 'fingerprint', 'unsafe-schema'])(
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
        'unsafe-schema': (call) =>
          call.tool === 'docker' && call.args.join(' ').includes('SELECT name FROM migrations'),
        fingerprint: (call) =>
          call.tool === 'docker' && call.args.join(' ').includes('pg_dump --no-owner'),
      };
      expect(calls.some(witness[failure])).toBe(true);
      expect(calls.filter(migration)).toEqual([]);
      expect(calls.filter(appUp).filter((call) => call.backend === backend)).toEqual([]);
      for (const call of calls.filter(appUp)) {
        expect(call.backend).toBe(previousBackend);
        expect(call.frontend).toBe(previousFrontend);
        const configuration = call.args[call.args.indexOf('-f') + 1];
        expect(readFileSync(configuration, 'utf8')).toBe('# Synthetic previous configuration\n');
      }
      expect(existsSync(join(directory, '.env.images'))).toBe(false);
    },
    20000,
  );
  it.each(['migration', 'health-same', 'partial-stop'])(
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
        readFileSync(
          calls[rollbackIndex].args[calls[rollbackIndex].args.indexOf('-f') + 1],
          'utf8',
        ),
      ).toBe('# Synthetic previous configuration\n');
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
  it('failed prior-pair restart stops applications without claiming verified recovery', () => {
    const { result, calls } = release('rollback-start');
    expect(result.status).not.toBe(0);
    const attempted = calls.findIndex((call) => appUp(call) && call.backend === previousBackend);
    expect(attempted).toBeGreaterThan(0);
    expect(calls[attempted].frontend).toBe(previousFrontend);
    expect(
      calls
        .slice(attempted + 1)
        .some((call) => call.tool === 'docker' && call.args.includes('stop')),
    ).toBe(true);
    expect(result.stdout).not.toContain('previous application pair readiness and privacy verified');
    expect(existsSync(join(directory, '.env.images'))).toBe(false);
  }, 20000);
  it('metadata publication failure restores original selection/configuration before verified paired rollback', () => {
    const oldSelection = `BACKEND_IMAGE=${previousBackend}\nFRONTEND_IMAGE=${previousFrontend}\n`;
    writeFileSync(join(directory, '.env.images'), oldSelection);
    writeFileSync(join(directory, '.release-managed-env'), 'previous-managed-marker\n');
    const { result, calls } = release('metadata-publication');
    expect(result.status).not.toBe(0);
    const refused = calls.findIndex(
      (call) => call.tool === 'mv' && call.args[0] === join(directory, 'docker-compose.yml.next'),
    );
    expect(refused).toBeGreaterThan(0);
    const rollback = calls.findIndex(
      (call, index) => index > refused && appUp(call) && call.backend === previousBackend,
    );
    expect(rollback).toBeGreaterThan(refused);
    expect(calls[rollback].frontend).toBe(previousFrontend);
    expect(readFileSync(join(directory, '.env.images'), 'utf8')).toBe(oldSelection);
    expect(readFileSync(join(directory, 'docker-compose.yml'), 'utf8')).toBe(
      '# Synthetic previous configuration\n',
    );
    expect(readFileSync(join(directory, '.release-managed-env'), 'utf8')).toBe(
      'previous-managed-marker\n',
    );
    const releaseRoot = join(directory, 'releases', commit);
    const attempts = readdirSync(releaseRoot, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    );
    expect(attempts).toHaveLength(1);
    for (const attempt of attempts) {
      expect(existsSync(join(releaseRoot, attempt.name, 'receipt'))).toBe(false);
    }
    expect(result.stdout).not.toContain('Release verified;');
    expect(result.stdout).toContain('previous application pair readiness and privacy verified');
  }, 20000);
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

describe('MRR-001: isolated restore waits for final PostgreSQL', () => {
  it('MRR-001-A ignores socket-only temporary readiness and restores over final TCP', () => {
    const { result, calls } = release('restore-temp-window');
    expect(result.status).toBe(0);
    const tcpProbes = calls.filter(
      (call) => call.tool === 'docker' && call.args.includes('pg_isready') && call.args.includes('127.0.0.1'),
    );
    expect(tcpProbes).toHaveLength(3);
    const restoreIndex = calls.findIndex((call) => call.tool === 'docker' && call.args.includes('pg_restore'));
    expect(restoreIndex).toBeGreaterThan(calls.lastIndexOf(tcpProbes[2]));
    expect(calls[restoreIndex].args).toContain('127.0.0.1');
    expect(calls.some((call) => call.tool === 'docker' && call.args.join(' ').includes('pg_dump -h 127.0.0.1'))).toBe(true);
    expect(calls.findIndex(migration)).toBeGreaterThan(restoreIndex);
  }, 20000);

  it('MRR-001-B refuses exhausted TCP readiness before decrypt, restore, or migration', () => {
    const { result, calls } = release('restore-never-tcp');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/isolated.*PostgreSQL.*readiness.*failed/i);
    expect(calls.filter((call) => call.tool === 'docker' && call.args.includes('pg_isready') && call.args.includes('127.0.0.1'))).toHaveLength(60);
    expect(calls.some((call) => call.tool === 'openssl' && call.args.includes('-d'))).toBe(false);
    expect(calls.some((call) => call.tool === 'docker' && call.args.includes('pg_restore'))).toBe(false);
    expect(calls.filter(migration)).toEqual([]);
    expect(calls.filter(appUp).filter((call) => call.backend === backend)).toEqual([]);
    expect(existsSync(join(directory, '.env.images'))).toBe(false);
  }, 20000);
});

describe('MVP-008: generated runtime does not depend on the legacy template', () => {
  it('fresh preflight succeeds without a legacy .env', () => {
    rmSync(join(directory, '.env'));
    const { result, calls } = release('success', 'fresh', 'preflight');
    expect(result.status).toBe(0);
    expect(calls.filter(appUp)).toEqual([]);
    expect(calls.filter(migration)).toEqual([]);
  });
  it('unmanaged existing preflight still requires its legacy .env', () => {
    rmSync(join(directory, '.env'));
    const { result, calls } = release('success', 'existing', 'preflight');
    expect(result.status).not.toBe(0);
    expect(calls.some((call) => call.tool === 'docker')).toBe(false);
  });
  it('managed existing preflight uses generated runtime without legacy .env', () => {
    rmSync(join(directory, '.env'));
    writeFileSync(join(directory, '.release-managed-env'), 'generated-runtime-only\n');
    const { result } = release('success', 'existing', 'preflight');
    expect(result.status).toBe(0);
  });
});

describe('MVP-003: explicit fresh-install absence preflight', () => {
  it.each([
    'fresh-container',
    'fresh-named-volume',
    'fresh-labeled-volume',
    'fresh-container-inventory',
    'fresh-volume-inventory',
    'fresh-label-inventory',
  ])('refuses %s without creating or changing application data', (failure) => {
    const { result, calls } = release(failure, 'fresh', 'preflight');
    expect(result.status).not.toBe(0);
    const inventory = failure.includes('container')
      ? (call: Command) => call.tool === 'docker' && call.args[0] === 'ps'
      : (call: Command) =>
          call.tool === 'docker' &&
          call.args[0] === 'volume' &&
          call.args[1] === 'ls' &&
          call.args.includes('--filter') === failure.includes('label');
    expect(calls.some(inventory)).toBe(true);
    expect(calls.filter(appUp)).toEqual([]);
    expect(calls.filter(migration)).toEqual([]);
    expect(
      calls.filter(
        (call) => call.tool === 'docker' && ['run', 'exec', 'create'].includes(call.args[0]),
      ),
    ).toEqual([]);
    expect(existsSync(join(directory, '.env.images'))).toBe(false);
  });
  it('explicit empty-inventory preflight checks configuration and TLS without provisioning', () => {
    const { result, calls } = release('success', 'fresh', 'preflight');
    expect(result.status).toBe(0);
    for (const query of [
      '.services.postgres.image',
      '.services.redis.image',
      '.services.postgres.environment.CAPITAL_EXPECTED_MAJOR',
    ]) {
      expect(calls.some((call) => call.tool === 'jq' && call.args.at(-1) === query)).toBe(true);
    }
    expect(calls.some((call) => call.tool === 'docker' && call.args[0] === 'ps')).toBe(true);
    expect(
      calls.filter(
        (call) => call.tool === 'docker' && call.args[0] === 'volume' && call.args[1] === 'ls',
      ),
    ).toHaveLength(2);
    expect(
      calls.some(
        (call) => call.tool === 'curl' && call.args.at(-1) === 'https://mvp.example.invalid/',
      ),
    ).toBe(true);
    expect(calls.filter(appUp)).toEqual([]);
    expect(calls.filter(migration)).toEqual([]);
    expect(
      calls.filter(
        (call) => call.tool === 'docker' && ['run', 'exec', 'create'].includes(call.args[0]),
      ),
    ).toEqual([]);
  });
});

describe('MVP-006: refuse implicit PostgreSQL major/layout changes', () => {
  it.each([
    ['existing-major', 'existing'],
    ['existing-layout', 'existing'],
    ['fresh-old-major', 'fresh'],
    ['fresh-old-layout', 'fresh'],
    ['fresh-mutable-postgres', 'fresh'],
    ['fresh-mutable-redis', 'fresh'],
    ['existing-postgres-drift', 'existing'],
    ['existing-redis-drift', 'existing'],
  ])(
    'refuses %s before downtime, database creation, backup or migration',
    (failure, installation) => {
      const { result, calls } = release(failure, installation, 'preflight');
      expect(calls.some((call) => call.tool === 'docker' && call.args.includes('config'))).toBe(
        true,
      );
      expect(result.status).not.toBe(0);
      const inspected = failure === 'existing-postgres-drift' ? 'postgres' : 'redis';
      if (failure.startsWith('existing-') && failure.endsWith('-drift')) {
        expect(
          calls.some(
            (call) =>
              call.tool === 'docker' &&
              call.args[0] === 'image' &&
              call.args[1] === 'inspect' &&
              call.args[2]?.startsWith(inspected),
          ),
        ).toBe(true);
      }
      if (failure.startsWith('fresh-mutable-')) {
        const service = failure === 'fresh-mutable-postgres' ? 'postgres' : 'redis';
        expect(
          calls.some(
            (call) => call.tool === 'jq' && call.args.at(-1) === `.services.${service}.image`,
          ),
        ).toBe(true);
      }
      expect(
        calls.filter(
          (call) =>
            call.tool === 'docker' &&
            (call.args.includes('pull') ||
              call.args.includes('stop') ||
              call.args.includes('up') ||
              call.args[0] === 'run' ||
              call.args.join(' ').includes('pg_dump')),
        ),
      ).toEqual([]);
      expect(calls.filter(migration)).toEqual([]);
      expect(readFileSync(join(directory, 'docker-compose.yml'), 'utf8')).toBe(
        '# Synthetic previous configuration\n',
      );
      expect(existsSync(join(directory, '.env.images'))).toBe(false);
    },
  );
});
