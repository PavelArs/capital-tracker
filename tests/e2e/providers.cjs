// Test-only provider fixture. CONNECT terminates here; no upstream socket is opened.
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');

const allowedHosts = new Set(['blockstream.info', 'api.coingecko.com', 'api.exchangerate-api.com', 'open.er-api.com']);
const credentials = {
  key: readFileSync('/tests/tls/privkey.pem'),
  cert: readFileSync('/tests/tls/fullchain.pem'),
};
const secureContext = tls.createSecureContext(credentials);
const initialBitcoin = () => ({ funded: 150000000, spent: 25000000 });
let bitcoin = initialBitcoin();
let requests = [];
const initialFx = () => {
  const at = Math.floor(Date.now() / 1000) - 60;
  return { status: 200, body: JSON.stringify({ result: 'success', base_code: 'USD',
    time_last_update_unix: at, time_next_update_unix: at + 86400, time_eol_unix: 0,
    rates: { USD: 1, EUR: 0.9, RUB: 90.12 } }) };
};
let fx = initialFx();
// Synthetic Esplora address histories: address -> { count, fault, requests }.
let bitcoinHistories = new Map();
const historyCounterparty = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// Deterministic transaction i (0 is oldest). Acceptance oracles restate these formulas.
function historyTx(address, i) {
  const height = 800000 + i;
  const out = (owner, value) => ({ scriptpubkey: '0014' + sha256(owner).slice(0, 40),
    scriptpubkey_asm: 'OP_0 OP_PUSHBYTES_20', scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: owner, value });
  const spend = (owner, value, n) => ({ txid: sha256(`ct-e2e-prev:${address}:${i}:${n}`), vout: n,
    prevout: out(owner, value), scriptsig: '', scriptsig_asm: '', witness: ['30440220', '02ab'],
    is_coinbase: false, sequence: 4294967293 });
  const shapes = [
    () => ({ vin: [spend(historyCounterparty, 1000000, 0)],
      vout: [out(address, 100000 + i * 1000), out(historyCounterparty, 1000000 - (100000 + i * 1000) - 500)], fee: 500 }),
    () => ({ vin: [spend(address, 50000 + i, 0), spend(address, 7000, 1), spend(historyCounterparty, 9000, 2)],
      vout: [out(historyCounterparty, 60000), out(address, 5700 + i)], fee: 300 }),
    () => ({ vin: [spend(address, 20000 + i, 0)], vout: [out(address, 19800 + i)], fee: 200 }),
    () => ({ vin: [{ txid: '0'.repeat(64), vout: 4294967295, prevout: null, scriptsig: '03', scriptsig_asm: '',
      is_coinbase: true, sequence: 4294967295 }], vout: [out(address, 312500000 + i)], fee: 0 }),
  ];
  return { txid: sha256(`ct-e2e-tx:${address}:${i}`), version: 2, locktime: 0, ...shapes[i % 4](),
    size: 222, weight: 561, status: { confirmed: true, block_height: height,
      block_hash: sha256(`ct-e2e-block:${height}`), block_time: 1700000000 + i * 600 } };
}

function bitcoinHistory(response, address, afterTxid) {
  const history = bitcoinHistories.get(address);
  if (!history) return respond(response, 200, []);
  history.requests++;
  if (history.fault && history.fault.onRequest === history.requests) {
    const fault = history.fault;
    history.fault = null;
    if (fault.invalid) return respond(response, 200, [{ ...historyTx(address, history.count - 1), fee: 1.5 }]);
    return respond(response, fault.status, { error: 'Synthetic provider fault' });
  }
  const newestFirst = Array.from({ length: history.count }, (_value, index) => history.count - 1 - index);
  let start = 0;
  if (afterTxid !== null) {
    start = newestFirst.findIndex((i) => historyTx(address, i).txid === afterTxid) + 1;
    if (start === 0) return respond(response, 422, { error: 'Unknown txid' });
  }
  return respond(response, 200, newestFirst.slice(start, start + 25).map((i) => historyTx(address, i)));
}

function respond(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 16384) throw new Error('Fixture body is too large');
  }
  return JSON.parse(body || '{}');
}

function provider(request, response, url) {
  if (requests.length >= 10000) return respond(response, 503, { error: 'Fixture request budget exhausted' });
  requests.push({ method: request.method, url: url.href });
  if (request.method !== 'GET' || url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
    return respond(response, 501, { error: 'Unexpected outbound request' });
  }
  if (url.hostname === 'open.er-api.com' && url.pathname === '/v6/latest/USD' && !url.search) {
    const reply = { ...fx };
    const send = () => {
      if (response.destroyed) return;
      response.writeHead(reply.status, { 'content-type': 'application/json', connection: 'close',
        ...(reply.retryAfter ? { 'retry-after': reply.retryAfter } : {}),
        ...(reply.status >= 300 && reply.status < 400 ? { location: 'http://169.254.169.254/metadata' } : {}) });
      response.end(reply.body);
    };
    if (reply.delayMs) setTimeout(send, reply.delayMs);
    else send();
    return;
  }
  if (url.hostname === 'api.coingecko.com' && url.pathname === '/api/v3/simple/price') {
    return respond(response, 200, { bitcoin: { usd: 60000 }, ethereum: { usd: 3000 } });
  }
  if (url.hostname === 'api.coingecko.com' && url.pathname === '/api/v3/simple/token_price/ethereum') {
    const contracts = (url.searchParams.get('contract_addresses') || '').split(',').filter(Boolean);
    return respond(response, 200, Object.fromEntries(contracts.map((contract) => [contract.toLowerCase(), { usd: 1 }])));
  }
  if (url.hostname === 'api.exchangerate-api.com' && url.pathname === '/v4/latest/USD') {
    return respond(response, 200, { base: 'USD', date: '2026-09-21', rates: { USD: 1, EUR: 0.9, RUB: 90 } });
  }
  const chain = /^\/api\/address\/([^/]+)\/txs\/chain(?:\/([0-9a-f]{64}))?$/.exec(url.pathname);
  if (url.hostname === 'blockstream.info' && chain && !url.search) {
    return bitcoinHistory(response, decodeURIComponent(chain[1]), chain[2] ?? null);
  }
  if (url.hostname === 'blockstream.info' && /^\/api\/address\/[^/]+$/.test(url.pathname)) {
    return respond(response, 200, {
      address: decodeURIComponent(url.pathname.split('/').at(-1)),
      chain_stats: { funded_txo_sum: bitcoin.funded, spent_txo_sum: bitcoin.spent, tx_count: 2 },
      mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
    });
  }
  return respond(response, 501, { error: 'No fixture for outbound destination' });
}

// Controls are available only on this internal plaintext service, never inside TLS.
const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/__control/health') return respond(response, 200, { ok: true });
    if (request.method === 'GET' && request.url === '/__control/requests') return respond(response, 200, requests);
    if (request.method === 'POST' && request.url === '/__control/reset') {
      bitcoin = initialBitcoin();
      requests = [];
      fx = initialFx();
      bitcoinHistories = new Map();
      return respond(response, 200, { ok: true });
    }
    if (request.method === 'POST' && request.url === '/__control/fx') {
      const data = await readJson(request);
      if (!Number.isInteger(data.status) || data.status < 200 || data.status > 599
        || typeof data.body !== 'string' || data.body.length > 15000
        || (data.delayMs !== undefined && (!Number.isInteger(data.delayMs) || data.delayMs < 0 || data.delayMs > 6000))
        || (data.retryAfter !== undefined && (typeof data.retryAfter !== 'string' || /[\r\n]/.test(data.retryAfter)))) {
        return respond(response, 400, { error: 'Invalid synthetic FX fixture' });
      }
      fx = data;
      return respond(response, 200, { ok: true });
    }
    if (request.method === 'POST' && request.url === '/__control/bitcoin-history') {
      const data = await readJson(request);
      const fault = data.fault;
      if (typeof data.address !== 'string' || !/^[a-zA-Z0-9]{14,90}$/.test(data.address)
        || (data.count !== undefined && (!Number.isSafeInteger(data.count) || data.count < 0 || data.count > 500))
        || (data.append !== undefined && (!Number.isSafeInteger(data.append) || data.append < 1 || data.append > 100))
        || (fault !== undefined && (!fault || !Number.isSafeInteger(fault.onRequest) || fault.onRequest < 1
          || (fault.invalid !== true && (!Number.isInteger(fault.status) || fault.status < 300 || fault.status > 599))))) {
        return respond(response, 400, { error: 'Invalid synthetic Bitcoin history fixture' });
      }
      const current = bitcoinHistories.get(data.address) ?? { count: 0, fault: null, requests: 0 };
      const count = data.count ?? current.count + (data.append ?? 0);
      if (count > 500) return respond(response, 400, { error: 'Synthetic history is bounded' });
      const next = { count, fault: fault ? { onRequest: fault.onRequest, status: fault.status, invalid: fault.invalid === true } : null, requests: 0 };
      bitcoinHistories.set(data.address, next);
      return respond(response, 200, { address: data.address, count, newestTxid: count ? historyTx(data.address, count - 1).txid : null });
    }
    if (request.method === 'POST' && request.url === '/__control/bitcoin') {
      const data = await readJson(request);
      if (!Number.isSafeInteger(data.funded) || !Number.isSafeInteger(data.spent)
        || data.funded < 0 || data.spent < 0 || data.spent > data.funded) {
        return respond(response, 400, { error: 'Expected non-negative funded/spent integers' });
      }
      bitcoin = { funded: data.funded, spent: data.spent };
      return respond(response, 200, bitcoin);
    }
    return respond(response, 501, { error: 'Use an allowlisted HTTPS tunnel' });
  } catch {
    return respond(response, 400, { error: 'Invalid fixture request' });
  }
});
server.requestTimeout = 5000;
server.headersTimeout = 5000;
server.setTimeout(10000, (socket) => socket.destroy());
server.on('clientError', (_error, socket) => socket.destroy());

server.on('connect', (request, socket, head) => {
  socket.on('error', () => socket.destroy());
  const match = /^([^:]+):443$/.exec(request.url);
  const host = match?.[1];
  if (!allowedHosts.has(host)) {
    socket.end('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  // Each incoming socket gets a local TLS server whose closure binds its authority.
  // It never listens on another port and never connects or resolves any destination.
  const origin = https.createServer({
    ...credentials,
    handshakeTimeout: 5000,
    SNICallback(servername, callback) {
      if (servername !== host) return callback(new Error('Fixture TLS authority mismatch'));
      callback(null, secureContext);
    },
  }, (incoming, response) => {
    try {
      const hostFields = incoming.rawHeaders.filter((_value, index) => index % 2 === 0
        && incoming.rawHeaders[index].toLowerCase() === 'host').length;
      if (incoming.socket.servername !== host || hostFields !== 1
        || ![host, `${host}:443`].includes(incoming.headers.host)
        || !incoming.url.startsWith('/') || incoming.url.startsWith('//') || incoming.url.includes('\\')) {
        return respond(response, 421, { error: 'Fixture authority mismatch' });
      }
      const url = new URL(incoming.url, `https://${host}`);
      if (url.origin !== `https://${host}`) return respond(response, 421, { error: 'Fixture authority mismatch' });
      if (url.pathname.startsWith('/__control/')) return respond(response, 501, { error: 'No provider fixture' });
      if (incoming.headers['transfer-encoding'] || ![undefined, '0'].includes(incoming.headers['content-length'])) {
        return respond(response, 501, { error: 'Provider bodies are unsupported' });
      }
      return provider(incoming, response, url);
    } catch {
      return respond(response, 400, { error: 'Invalid provider request' });
    }
  });
  origin.requestTimeout = 5000;
  origin.headersTimeout = 5000;
  origin.setTimeout(10000, (connection) => connection.destroy());
  origin.on('tlsClientError', (_error, connection) => connection.destroy());
  origin.on('clientError', (_error, connection) => connection.destroy());
  socket.pause();
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  if (head.length) socket.unshift(head);
  origin.emit('connection', socket);
  socket.resume();
});
server.listen(8080, '0.0.0.0');
