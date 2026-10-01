'use strict';

// Real Node HTTP adapter characterization; this is not image/browser acceptance.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const path = require('node:path');
const axios = require(path.resolve('backend/node_modules/axios'));
const frontendAxios = require(path.resolve('frontend/node_modules/axios/dist/node/axios.cjs'));

async function main() {
  const expectedVersion = process.argv[2];
  assert.ok(expectedVersion, 'Supply the expected frozen Axios version');
  assert.equal(axios.VERSION, expectedVersion);
  assert.equal(frontendAxios.VERSION, expectedVersion);
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/timeout') return;
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/destination' });
      return response.end();
    }
    if (request.url === '/rate-limit') {
      response.writeHead(429, { 'Retry-After': '120', 'Content-Type': 'application/json' });
      return response.end('{"error":"synthetic quota"}');
    }
    if (request.url === '/oversized') return response.end('x'.repeat(65537));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"rates":{"USD":1,"EUR":0.9}}');
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const options = {
      adapter: 'http', proxy: false, responseType: 'text',
      transformResponse: [(value) => value], timeout: 1000,
      maxContentLength: 65536, maxBodyLength: 0, maxRedirects: 0,
      headers: { Accept: 'application/json' }, validateStatus: () => true,
    };
    const success = await axios.get(`${base}/success`, options);
    assert.equal(success.status, 200);
    assert.equal(typeof success.data, 'string');
    assert.deepEqual(JSON.parse(success.data), { rates: { USD: 1, EUR: 0.9 } });
    console.log('PASS AXS-001-B actual HTTP success retains text and fixture values');

    const redirect = await axios.get(`${base}/redirect`, options);
    assert.equal(redirect.status, 302);
    assert.equal(requests.filter((url) => url === '/destination').length, 0);
    console.log('PASS AXS-001-B maxRedirects:0 makes zero destination requests');

    const quota = await axios.get(`${base}/rate-limit`, options);
    assert.equal(quota.status, 429);
    assert.equal(quota.headers['retry-after'], '120');
    assert.equal(quota.data, '{"error":"synthetic quota"}');
    console.log('PASS AXS-001-B 429 preserves Retry-After and text metadata');

    await assert.rejects(axios.get(`${base}/oversized`, options), (error) => {
      assert.equal(error.code, 'ERR_BAD_RESPONSE');
      assert.match(error.message, /maxContentLength/);
      return true;
    });
    console.log('PASS AXS-001-B oversized body rejects at 65536 bytes');

    await assert.rejects(axios.get(`${base}/timeout`, { ...options, timeout: 100 }), (error) => {
      assert.equal(error.code, 'ECONNABORTED');
      assert.match(error.message, /timeout of 100ms exceeded/);
      return true;
    });
    assert.equal(requests.filter((url) => url === '/timeout').length, 1);
    console.log('PASS AXS-001-B stalled response rejects using the configured timeout');
    console.log(`PASS 5/5 backend HTTP adapter checks on Axios ${expectedVersion}; frontend package VERSION also asserted (browser adapter untested)`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
