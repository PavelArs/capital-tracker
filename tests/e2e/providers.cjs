// Test-only HTTP forward-proxy fixture. It never connects to an upstream.
const http = require('node:http');

const initialBitcoin = () => ({ funded: 150000000, spent: 25000000 });
let bitcoin = initialBitcoin();
let requests = [];

function respond(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
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

const server = http.createServer(async (request, response) => {
  try {
    if (request.url.startsWith('/__control/')) {
      if (request.method === 'GET' && request.url === '/__control/health') {
        return respond(response, 200, { ok: true });
      }
      if (request.method === 'GET' && request.url === '/__control/requests') {
        return respond(response, 200, requests);
      }
      if (request.method === 'POST' && request.url === '/__control/reset') {
        bitcoin = initialBitcoin();
        requests = [];
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
      return respond(response, 404, { error: 'Unknown fixture control' });
    }

    if (requests.length >= 10000) {
      return respond(response, 503, { error: 'Fixture request budget exhausted' });
    }
    requests.push({ method: request.method, url: request.url });
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.protocol !== 'https:') {
      return respond(response, 501, { error: 'Unexpected outbound request' });
    }
    if (url.hostname === 'api.coingecko.com' && url.pathname === '/api/v3/simple/price') {
      return respond(response, 200, { bitcoin: { usd: 60000 }, ethereum: { usd: 3000 } });
    }
    if (url.hostname === 'api.coingecko.com'
      && url.pathname === '/api/v3/simple/token_price/ethereum') {
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
  } catch {
    return respond(response, 400, { error: 'Invalid fixture request' });
  }
});

// CONNECT is deliberately unsupported; this is not a general-purpose proxy.
server.on('connect', (_request, socket) => socket.end('HTTP/1.1 501 Not Implemented\r\n\r\n'));
server.listen(8080, '0.0.0.0');
