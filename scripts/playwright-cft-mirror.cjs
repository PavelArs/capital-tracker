'use strict';
// Runs a command with Playwright's Chrome for Testing downloads redirected to Google's public
// bucket. The Playwright CDN stalls from the self-hosted runners' network, while Google serves
// the same builds under the same version and file names.
const { spawn } = require('node:child_process');
const http = require('node:http');

const CFT_PREFIX = '/builds/cft/';
const GOOGLE_BUCKET = 'https://storage.googleapis.com/chrome-for-testing-public/';
const SAFE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function redirectTarget(requestUrl) {
  const { pathname } = new URL(requestUrl, 'http://mirror.invalid');
  if (!pathname.startsWith(CFT_PREFIX)) return null;
  const rest = pathname.slice(CFT_PREFIX.length);
  if (!SAFE_PATH.test(rest) || rest.split('/').some((part) => part === '..' || part === '.')) {
    return null;
  }
  return GOOGLE_BUCKET + rest;
}

function startMirror() {
  const server = http.createServer((request, response) => {
    const target = request.method === 'GET' ? redirectTarget(request.url ?? '') : null;
    response.writeHead(target ? 302 : 404, target ? { location: target } : {});
    response.end();
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise(server));
  });
}

async function main(command) {
  if (command.length === 0) throw new Error('Usage: playwright-cft-mirror.cjs <command> [args...]');
  const server = await startMirror();
  const { port } = server.address();
  const child = spawn(command[0], command.slice(1), {
    env: { ...process.env, PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: `http://127.0.0.1:${port}` },
    stdio: 'inherit',
  });
  const [code, signal] = await new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, exitSignal) => resolvePromise([exitCode, exitSignal]));
  });
  server.close();
  return signal ? 1 : (code ?? 1);
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}

module.exports = { redirectTarget, startMirror };
