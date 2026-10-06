import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { assertSyntheticNetworks } from './acceptance-networks.cjs';
import shards from './acceptance-shards.cjs';
import criticalProfile from './critical-release-profile.cjs';
import { withPreservedFile } from './preserve-file.cjs';
import { renderAcceptanceProxy } from './render-acceptance-proxy.cjs';
import releaseValidation from './validate-manual-mvp-release.cjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const releaseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
if (process.env.CAPITAL_RELEASE_COMMIT && process.env.CAPITAL_RELEASE_COMMIT !== releaseCommit) {
  throw new Error('Acceptance image revision must match the checkout commit');
}
process.env.CAPITAL_RELEASE_COMMIT = releaseCommit;
const project = 'capital-tracker-e2e';
const composeArgs = ['compose', '-p', project, '-f', join(root, 'tests/e2e/compose.yml')];
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });
const compose = (...args) => run('docker', [...composeArgs, ...args]);
const imageId = (reference) =>
  execFileSync('docker', ['image', 'inspect', reference, '--format', '{{.Id}}'], {
    encoding: 'utf8',
  }).trim();
const inspectImage = (tag) =>
  JSON.parse(execFileSync('docker', ['image', 'inspect', tag], { encoding: 'utf8' }))[0];
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const usage =
  'Use acceptance.mjs [run|critical|down] | critical --shard <name> --images <manifest> | images --manifest <path>';
const [command = 'run', ...options] = process.argv.slice(2);
let shard;
let imagesPath;
if (command === 'critical' && options.length === 4) {
  if (options[0] !== '--shard' || options[2] !== '--images') throw new Error(usage);
  shard = shards.parseShard(options[1]).name;
  imagesPath = resolve(root, options[3]);
} else if (command === 'images' && options.length === 2 && options[0] === '--manifest') {
  imagesPath = resolve(root, options[1]);
} else if (!['run', 'critical', 'down'].includes(command) || options.length > 0) {
  throw new Error(usage);
}
// Prebuilt images are bound to one CI run; the serial modes remain available locally.
const runId = process.env.GITHUB_RUN_ID ?? 'local';
if ((shard || command === 'images') && !/^[1-9][0-9]*$/.test(runId)) {
  throw new Error('Prebuilt-image acceptance requires the CI run id; use `critical` locally');
}
const pins =
  command === 'down'
    ? undefined
    : releaseValidation.validateInfrastructurePins(
        readJson(join(root, 'deploy/manual-mvp-infrastructure-pins.json')),
      );

function verifyPostgresPin() {
  const pinnedId = imageId(pins.postgres.registryDigest);
  if (imageId(pins.postgres.tag) !== pinnedId) {
    throw new Error('Acceptance PostgreSQL differs from the reviewed original digest');
  }
  return pinnedId;
}

// This file/project exclusively owns disposable synthetic databases; never use production Compose.
if (command === 'down') {
  compose('down', '--remove-orphans');
} else if (command === 'images') {
  // Builds the backend/frontend images once for every shard; it never runs acceptance.
  await withPreservedFile(join(root, 'frontend/nginx.conf'), async () => {
    if (existsSync(imagesPath)) unlinkSync(imagesPath);
    verifyPostgresPin();
    compose('build', 'backend', 'frontend');
    const built = shards.imageManifest(releaseCommit, runId, pins, imageId);
    shards.verifyImages(built, releaseCommit, runId, pins, inspectImage);
    mkdirSync(dirname(imagesPath), { recursive: true });
    writeFileSync(imagesPath, `${JSON.stringify(built, null, 2)}\n`);
  });
  console.log('PASS ISO-005-C checkout Nginx file preserved through the image build');
  console.log(`PASS built release images once: ${imagesPath}`);
} else {
  const receiptPath = join(root, 'test-results/critical-release-acceptance.json');
  const shardReceiptPath = shard && join(root, 'test-results', shards.receiptFile(shard));
  const outputPath = shardReceiptPath ?? receiptPath;
  if (existsSync(outputPath)) unlinkSync(outputPath);
  const steps = shards.plan(command, shard);
  const built = imagesPath && readJson(imagesPath);
  const browserShard = shard && shards.parseShard(shard).kind === 'browser';
  let selection;
  if (command === 'critical' && (!shard || browserShard)) {
    const manifest = readJson(join(root, 'tests/e2e/manual-mvp-manifest.json'));
    const cases = browserShard ? shards.browserCases(manifest, shard) : manifest;
    const inventory = JSON.parse(
      execFileSync('pnpm', ['exec', 'playwright', 'test', '--list', '--reporter=json'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, CI: 'true' },
      }),
    );
    selection = criticalProfile.select(cases, inventory);
    const routed = JSON.parse(
      execFileSync(
        'pnpm',
        [
          'exec',
          'playwright',
          'test',
          ...selection.files,
          '--grep',
          selection.grep,
          '--list',
          '--reporter=json',
        ],
        { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } },
      ),
    );
    criticalProfile.assertRouted(selection, routed);
  }
  const runAcceptance = () =>
    withPreservedFile(join(root, 'frontend/nginx.conf'), async () => {
      let completedReceipt;
      let pinnedPostgresId;
      let testedImages;
      let browserResult;
      const completed = [];
      assertSyntheticNetworks();
      const tls = join(root, 'tests/e2e/.runtime/tls');
      mkdirSync(tls, { recursive: true });
      // Exercise the actual deployment edge, changing only synthetic authorities/TLS.
      writeFileSync(join(root, 'tests/e2e/.runtime/deploy-nginx.conf'), renderAcceptanceProxy());
      const key = join(root, 'tests/e2e/.runtime/mfa-key');
      try {
        writeFileSync(key, randomBytes(32), { mode: 0o600, flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const keyStat = lstatSync(key);
      if (
        !keyStat.isFile() ||
        keyStat.size !== 32 ||
        ![0o400, 0o600].includes(keyStat.mode & 0o7777)
      ) {
        throw new Error('Synthetic MFA fixture key must be a private regular 32-byte file');
      }
      run('openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-sha256',
        '-days',
        '2',
        '-nodes',
        '-keyout',
        join(tls, 'privkey.pem'),
        '-out',
        join(tls, 'fullchain.pem'),
        '-subj',
        '/CN=capital-tracker-e2e.invalid',
        '-addext',
        'subjectAltName=IP:127.0.0.1,DNS:localhost',
      ]);
      const providerTls = join(root, 'tests/e2e/.runtime/provider-tls');
      mkdirSync(providerTls, { recursive: true });
      if (!lstatSync(providerTls).isDirectory()) {
        throw new Error('Provider TLS fixture directory must not be a symlink');
      }
      // These two fixed fixture files are synthetic, regenerated each run. A previous
      // Linux run may have assigned the private key to the non-root fixture container.
      for (const name of ['privkey.pem', 'fullchain.pem']) {
        const path = join(providerTls, name);
        try {
          if (!lstatSync(path).isFile())
            throw new Error('Provider TLS fixture must be a regular file');
          unlinkSync(path);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      run('openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-sha256',
        '-days',
        '2',
        '-nodes',
        '-keyout',
        join(providerTls, 'privkey.pem'),
        '-out',
        join(providerTls, 'fullchain.pem'),
        '-subj',
        '/CN=capital-tracker-provider-fixture.invalid',
        '-addext',
        'subjectAltName=DNS:blockstream.info,DNS:api.etherscan.io,DNS:api.mainnet-beta.solana.com,DNS:api.coingecko.com,DNS:api.exchangerate-api.com,DNS:open.er-api.com,DNS:api.kraken.com,DNS:www.cbr.ru',
      ]);
      const chown = (source, target) =>
        run('docker', [
          'run',
          '--rm',
          '--network',
          'none',
          '--user',
          '0',
          '--mount',
          `type=bind,src=${source},dst=${target}`,
          '--entrypoint',
          'node',
          'capital-tracker-backend:acceptance',
          '-e',
          `const fs=require('node:fs');fs.chownSync('${target}',1000,1000);fs.chmodSync('${target}',0o400)`,
        ]);
      // A shard tests only the images of the build manifest, in its running containers too.
      const verifyTestedImages = () => {
        const expected = shards.verifyImages(built, releaseCommit, runId, pins, inspectImage);
        const services = { postgres: 'postgres', redis: 'redis' };
        if (browserShard) {
          for (const service of ['backend', 'backend-replica', 'client-a', 'client-b']) {
            services[service] = 'backend';
          }
          services.frontend = 'frontend';
        }
        for (const [service, image] of Object.entries(services)) {
          const containers = execFileSync('docker', [...composeArgs, 'ps', '-q', service], {
            encoding: 'utf8',
          })
            .trim()
            .split('\n')
            .filter(Boolean);
          const used = containers.map((id) =>
            execFileSync('docker', ['inspect', id, '--format', '{{.Image}}'], {
              encoding: 'utf8',
            }).trim(),
          );
          if (used.length !== 1 || used[0] !== expected[image]) {
            throw new Error(`Acceptance service ${service} did not run the built ${image} image`);
          }
        }
        return expected;
      };
      const execute = async (step) => {
        const [kind, argument] = step.split(':');
        if (kind === 'verify-postgres-pin') pinnedPostgresId = verifyPostgresPin();
        else if (kind === 'build') compose('build', ...argument.split(','));
        else if (kind === 'verify-prebuilt-images') {
          // Refuses missing or different images before Compose could build or pull them.
          shards.verifyImages(built, releaseCommit, runId, pins, inspectImage);
        } else if (kind === 'check' && argument === 'restore-readiness') {
          run('node', ['tests/e2e/restore-readiness.cjs', pins.postgres.tag]);
        } else if (kind === 'check') compose(...shards.checkInvocation(argument, root));
        else if (kind === 'fixture-ownership') {
          if (process.platform === 'linux') chown(key, '/synthetic-key');
          if (process.platform === 'linux') {
            chown(join(providerTls, 'privkey.pem'), '/synthetic-provider-key');
          }
        } else if (kind === 'infrastructure-up') {
          compose(
            'up',
            '-d',
            '--no-build',
            '--wait',
            '--wait-timeout',
            '120',
            'postgres',
            'redis',
            'providers',
          );
        } else if (kind === 'migrate' || kind === 'seed') compose('run', '--rm', '--no-deps', kind);
        else if (kind === 'application-up') {
          compose(
            'up',
            '-d',
            '--no-build',
            '--wait',
            '--wait-timeout',
            '120',
            'backend',
            'backend-replica',
            'frontend',
            'proxy',
            'client-a',
            'client-b',
          );
        } else if (kind === 'verify-postgres-identity') {
          if (imageId(pins.postgres.tag) !== pinnedPostgresId) {
            throw new Error('Acceptance changed the reviewed PostgreSQL image identity');
          }
        } else if (kind === 'ingress') {
          // Container health is insufficient: verify the browser's actual host ingress too.
          let ready = false;
          const deadline = Date.now() + 30_000;
          while (Date.now() < deadline && !ready) {
            ready = await new Promise((resolveReady) => {
              const request = https.get(
                'https://127.0.0.1:8443/health',
                { rejectUnauthorized: false, timeout: 2_000 },
                (response) => {
                  response.resume();
                  resolveReady(response.statusCode === 200);
                },
              );
              request.on('error', () => resolveReady(false));
              request.on('timeout', () => request.destroy());
            });
            if (!ready) await delay(200);
          }
          if (!ready)
            throw new Error('Synthetic HTTPS proxy is not reachable from the browser host');
        } else if (kind === 'artifacts') run('node', ['tests/e2e/artifacts.cjs']);
        else if (kind === 'browser' && argument === 'full')
          run('pnpm', ['exec', 'playwright', 'test']);
        else if (kind === 'browser') {
          const reportPath = join(root, 'tests/e2e/.runtime/critical-playwright.json');
          if (existsSync(reportPath)) unlinkSync(reportPath);
          execFileSync(
            'pnpm',
            [
              'exec',
              'playwright',
              'test',
              ...selection.files,
              '--grep',
              selection.grep,
              '--workers=1',
              '--retries=0',
              '--reporter=json',
            ],
            {
              cwd: root,
              stdio: 'inherit',
              env: { ...process.env, CI: 'true', PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath },
            },
          );
          browserResult = readJson(reportPath);
          // Fails here on any partial, extra, skipped or failed case of this selection.
          criticalProfile.receipt(selection, browserResult, releaseCommit, runId);
        } else if (kind === 'verify-tested-images') testedImages = verifyTestedImages();
        else throw new Error(`Unknown acceptance step: ${step}`);
        if (kind === 'check') completed.push(argument);
      };
      compose('down', '--remove-orphans');
      try {
        for (const step of steps) await execute(step);
        if (shard) {
          completedReceipt = shards.shardReceipt({
            shard,
            commit: releaseCommit,
            runId,
            images: testedImages,
            ...(browserShard
              ? { cases: selection.cases, playwright: browserResult }
              : { probes: completed }),
          });
        } else if (command === 'critical') {
          completedReceipt = criticalProfile.receipt(
            selection,
            browserResult,
            releaseCommit,
            runId,
          );
        }
      } finally {
        compose('down', '--remove-orphans');
      }
      return completedReceipt;
    });
  if (command === 'critical') {
    // The returned value is available only after Compose cleanup and Nginx preservation.
    const receipt = await criticalProfile.publishAfterGates(runAcceptance, outputPath);
    console.log('PASS ISO-005-C checkout Nginx file preserved through acceptance and cleanup');
    if (!shard)
      console.log(`PASS critical release profile: ${receipt.cases.length} exact browser cases`);
    else if (browserShard)
      console.log(`PASS critical shard ${shard}: ${receipt.cases.length} exact browser cases`);
    else console.log(`PASS critical shard ${shard}: ${receipt.probes.length} exact real checks`);
  } else {
    await runAcceptance();
    console.log('PASS ISO-005-C checkout Nginx file preserved through acceptance and cleanup');
  }
}
