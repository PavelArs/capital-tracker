// Test-only provider fixture. CONNECT terminates here; no upstream socket is opened.
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { readFileSync } = require('node:fs');

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
