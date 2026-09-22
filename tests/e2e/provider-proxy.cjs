'use strict';

// External acceptance only. Run in the backend release image with this file mounted
// and NODE_PATH=/app/backend/node_modules. No application or authentication mocks;
// only external provider fixtures.
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const axios = require('axios');

const proxy = new URL('http://providers:8080');
const address = 'synthetic-proxy-bitcoin-address';
const bitcoinUrl = `https://blockstream.info/api/address/${address}`;
const timeout = 5000;

function responseBody(response) {
  return new Promise((resolve, reject) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      body += chunk;
      if (body.length > 65536) response.destroy(new Error('Oversized fixture response'));
    });
    response.on('error', reject);
    response.on('end', () => resolve({ status: response.statusCode, body }));
  });
}

function control(path, data) {
  return new Promise((resolve, reject) => {
    assert.ok(path.startsWith('/__control/'));
    const body = data === undefined ? undefined : JSON.stringify(data);
    const request = http.request(new URL(path, proxy), {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      },
      timeout,
    }, (response) => {
      responseBody(response).then((result) => {
        assert.equal(result.status, 200, `Plaintext fixture control ${path}`);
        return JSON.parse(result.body);
      }).then(resolve, reject);
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Fixture control timed out')));
    request.end(body);
  });
}

function connect(authority) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: proxy.hostname, port: proxy.port, method: 'CONNECT', path: authority,
      headers: { Host: authority }, timeout,
    });
    request.on('connect', (response, socket, head) => {
      socket.on('error', () => {}); // Expected reset probes must not crash the client.
      socket.setTimeout(timeout, () => socket.destroy());
      resolve({ status: response.statusCode, socket, head });
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('CONNECT timed out')));
    request.end();
  });
}

async function encryptedRequest({
  authority = 'blockstream.info:443',
  servername = 'blockstream.info',
  host = 'blockstream.info',
  path = `/api/address/${address}`,
  method = 'GET',
  data,
} = {}) {
  const tunnel = await connect(authority);
  assert.equal(tunnel.status, 200, 'Allowlisted CONNECT must establish a local TLS tunnel');
  assert.equal(tunnel.head.length, 0, 'No unexpected application bytes before TLS');
  const agent = new https.Agent({ keepAlive: false });
  agent.createConnection = () => tls.connect({
    socket: tunnel.socket, servername, rejectUnauthorized: true,
  });
  try {
    return await new Promise((resolve, reject) => {
      const body = data === undefined ? undefined : JSON.stringify(data);
      const request = https.request({
        hostname: servername, port: 443, method, path, agent, timeout,
        headers: {
          Host: host, Connection: 'close',
          ...(body === undefined ? {} : {
            'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
          }),
        },
      }, (response) => responseBody(response).then(resolve, reject));
      request.on('error', reject);
      request.on('timeout', () => request.destroy(new Error('TLS fixture request timed out')));
      request.end(body);
    });
  } finally {
    agent.destroy();
    tunnel.socket.destroy();
  }
}

async function deniedMismatch(options) {
  const before = await control('/__control/requests');
  let response;
  try {
    response = await encryptedRequest(options);
  } catch (error) {
    // A connection/handshake rejection is an intentional fail-closed result.
    // Assertion/setup failures and timeouts are not evidence of correct rejection.
    assert.ok([
      'ECONNRESET', 'EPIPE', 'EPROTO', 'ERR_TLS_CERT_ALTNAME_INVALID',
      'ERR_SSL_TLSV1_UNRECOGNIZED_NAME', 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE',
      'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR',
    ].includes(error.code), `Mismatch must reject promptly, not fail setup: ${error.code}`);
  }
  if (response) assert.ok(response.status >= 400, 'Mismatched identity cannot return provider data');
  assert.deepEqual(await control('/__control/requests'), before,
    'Rejected CONNECT/SNI/Host mismatch must not dispatch a provider data request');
  assert.deepEqual(await control('/__control/health'), { ok: true });
}

async function withoutCa() {
  assert.equal(process.env.NODE_EXTRA_CA_CERTS, undefined);
  await assert.rejects(axios.get(bitcoinUrl, { timeout }), (error) => {
    assert.equal(error.response, undefined, 'Untrusted TLS must fail before HTTP response');
    return [
      'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    ].includes(error.code);
  }, 'Node must reject the synthetic provider certificate without its custom CA');
  console.log('PASS provider TLS rejects an untrusted synthetic CA');
}

async function main() {
  assert.equal(axios.VERSION, '1.18.0', 'Exercise the actual release Axios version');
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY']) {
    assert.equal(process.env[name], proxy.origin, `Use the real configured ${name}`);
  }
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', 'TLS verification cannot be disabled');
  assert.ok(process.env.NODE_EXTRA_CA_CERTS && existsSync(process.env.NODE_EXTRA_CA_CERTS),
    'A public synthetic CA must be supplied at process startup');
  assert.deepEqual(await control('/__control/health'), { ok: true });
  await control('/__control/reset', {});
  try {
    const result = await axios.get(bitcoinUrl, { timeout });
    assert.equal(result.status, 200);
    assert.equal(result.data.address, address);
    assert.equal((result.data.chain_stats.funded_txo_sum - result.data.chain_stats.spent_txo_sum) / 1e8, 1.25);
    assert.deepEqual(await control('/__control/requests'), [{ method: 'GET', url: bitcoinUrl }],
      'Record the real decrypted HTTPS GET, not the CONNECT authority');
    console.log('PASS real release Axios HTTPS CONNECT returns BTC1.25 and records its actual URL');

    const beforeUntrusted = await control('/__control/requests');
    const env = { ...process.env };
    delete env.NODE_EXTRA_CA_CERTS;
    const child = spawnSync(process.execPath, [__filename, '--without-ca'], {
      env, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(child.error, undefined, 'Untrusted TLS child must terminate');
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, `Untrusted TLS assertion failed: ${child.stderr}`);
    assert.deepEqual(await control('/__control/requests'), beforeUntrusted);
    process.stdout.write(child.stdout);

    for (const authority of ['unlisted.example.invalid:443', '127.0.0.1:443',
      'blockstream.info:80', 'blockstream.info:444', 'blockstream.info.evil.invalid:443']) {
      const before = await control('/__control/requests');
      const tunnel = await connect(authority);
      try { assert.equal(tunnel.status, 501, `Reject unlisted authority ${authority}`); }
      finally { tunnel.socket.destroy(); }
      assert.deepEqual(await control('/__control/requests'), before,
        'Rejected authorities must not dispatch or record provider data');
    }
    console.log('PASS CONNECT rejects unlisted hosts/ports without provider dispatch');

    const unknown = await encryptedRequest({ path: '/not-a-fixture' });
    assert.equal(unknown.status, 501);
    assert.deepEqual((await control('/__control/requests')).at(-1), {
      method: 'GET', url: 'https://blockstream.info/not-a-fixture',
    });

    // Deliberately distinguish internal plaintext control from encrypted provider paths.
    await control('/__control/bitcoin', { funded: 225000000, spent: 25000000 });
    for (const example of [
      { path: '/__control/health' }, { path: '/__control/requests' },
      { path: '/__control/reset', method: 'POST', data: {} },
      { path: '/__control/bitcoin', method: 'POST', data: { funded: 0, spent: 0 } },
    ]) {
      const before = await control('/__control/requests');
      const response = await encryptedRequest(example);
      assert.equal(response.status, 501, 'TLS provider traffic cannot access fixture controls');
      assert.notDeepEqual(JSON.parse(response.body), { ok: true });
      assert.ok(!response.body.includes(address), 'TLS cannot disclose the request-control history');
      const after = await control('/__control/requests');
      assert.deepEqual(after.slice(0, before.length), before, 'TLS cannot reset control history');
      const balance = await axios.get(bitcoinUrl, { timeout });
      assert.equal((balance.data.chain_stats.funded_txo_sum - balance.data.chain_stats.spent_txo_sum) / 1e8, 2);
    }
    console.log('PASS plaintext controls work; TLS unknown/control paths return501 without control effects');

    await deniedMismatch({ servername: 'api.coingecko.com' });
    await deniedMismatch({ host: 'api.coingecko.com' });
    await deniedMismatch({ host: 'blockstream.info:444' });
    await deniedMismatch({ path: 'https://api.coingecko.com/api/v3/simple/price' });
    console.log('PASS CONNECT authority, TLS SNI and encrypted HTTP authority remain bound');

    // Resets at raw CONNECT, partial handshake, and established TLS must remain local.
    for (const stage of ['connect', 'partial-tls', 'secure']) {
      const tunnel = await connect('blockstream.info:443');
      assert.equal(tunnel.status, 200);
      if (stage === 'partial-tls') tunnel.socket.write(Buffer.from([0x16, 0x03, 0x01, 0x00]));
      if (stage === 'secure') {
        await new Promise((resolve, reject) => {
          const socket = tls.connect({ socket: tunnel.socket, servername: 'blockstream.info', rejectUnauthorized: true });
          socket.once('error', reject);
          socket.once('secureConnect', () => { socket.destroy(); resolve(); });
        });
      } else tunnel.socket.destroy();
      assert.deepEqual(await control('/__control/health'), { ok: true });
      assert.equal((await axios.get(bitcoinUrl, { timeout })).status, 200);
    }
    console.log('PASS reset clients do not crash the isolated provider server');

    const prices = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', { timeout });
    assert.equal(prices.data.bitcoin.usd, 60000);
    const rates = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', { timeout });
    assert.equal(rates.data.rates.EUR, 0.9);
    console.log('PASS all three allowed HTTPS provider hosts use the local TLS fixture');
  } finally {
    await control('/__control/reset', {});
  }
}

(process.argv[2] === '--without-ca' ? withoutCa() : main()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
