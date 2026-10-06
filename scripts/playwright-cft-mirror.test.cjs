const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const { redirectTarget } = require('./playwright-cft-mirror.cjs');

const mirrorPath = resolve(__dirname, 'playwright-cft-mirror.cjs');
const bucket = 'https://storage.googleapis.com/chrome-for-testing-public/';

test('maps the Chrome for Testing downloads Playwright asks for to Google', () => {
  assert.equal(
    redirectTarget('/builds/cft/153.0.8010.12/linux64/chrome-linux64.zip'),
    `${bucket}153.0.8010.12/linux64/chrome-linux64.zip`,
  );
  assert.equal(
    redirectTarget('/builds/cft/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip'),
    `${bucket}153.0.8010.12/linux64/chrome-headless-shell-linux64.zip`,
  );
});

test('refuses anything outside the Chrome for Testing builds', () => {
  for (const path of [
    '/',
    '/builds/ffmpeg/1011/ffmpeg-linux.zip',
    '/builds/cft/',
    '/builds/cft/../ffmpeg/1011/ffmpeg-linux.zip',
    '/builds/cft/%2e%2e/secret',
    '/builds/cft/153.0.8010.12//chrome-linux64.zip',
    '/builds/cft/153.0.8010.12/linux64/chrome-linux64.zip?x=1#y',
  ]) {
    const target = redirectTarget(path);
    if (path.endsWith('?x=1#y')) {
      // The query and fragment never reach the redirect target.
      assert.equal(target, `${bucket}153.0.8010.12/linux64/chrome-linux64.zip`);
    } else {
      assert.equal(target, null, path);
    }
  }
});

test('runs the command with the mirror as the Chromium download host and returns its exit code', () => {
  const probe = `
    const host = process.env.PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST;
    if (!/^http:\\/\\/127\\.0\\.0\\.1:\\d+$/.test(host)) process.exit(3);
    const get = (path) => new Promise((done) => require('node:http').get(host + path, (res) => {
      res.resume();
      done(res.statusCode + ' ' + (res.headers.location ?? '-'));
    }));
    (async () => {
      console.log(await get('/builds/cft/1.2.3/linux64/chrome-linux64.zip'));
      console.log(await get('/builds/ffmpeg/1011/ffmpeg-linux.zip'));
      process.exit(7);
    })();
  `;
  const result = spawnSync(process.execPath, [mirrorPath, process.execPath, '-e', probe], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), [
    `302 ${bucket}1.2.3/linux64/chrome-linux64.zip`,
    '404 -',
  ]);
});

test('fails without a command', () => {
  const result = spawnSync(process.execPath, [mirrorPath], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage/);
});
