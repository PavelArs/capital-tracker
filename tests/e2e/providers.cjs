// Test-only provider fixture. CONNECT terminates here; no upstream socket is opened.
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { readFileSync } = require('node:fs');
const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

const solanaHost = 'api.mainnet-beta.solana.com';
const allowedHosts = new Set(['blockstream.info', 'api.etherscan.io', solanaHost, 'api.coingecko.com', 'api.exchangerate-api.com', 'open.er-api.com', 'api.kraken.com', 'www.cbr.ru', 'api.bybit.com', 'api.trongrid.io', 'apilist.tronscanapi.com',
  'horizon.stellar.org', 'zec1.trezor.io', 'zec5.trezor.io']);
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
// Synthetic Bitcoin chain (scan-bitcoin-xpub): transactions posted in a compact form, built into
// Esplora's shape here. Once posted, an address without a synthetic history above has the
// posted transactions naming it as its history (newest first) and their number as its count,
// so an account's derived addresses answer as the chain would. `fault` answers the n-th
// history page request after the post with [] (a lagging backend) or an HTTP status.
let bitcoinChain = null;
// Never one of the addresses whose history the acceptance tests import.
const historyCounterparty = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
// Synthetic market prices (collect-hourly-prices). null keeps the legacy CoinGecko fixture.
// kraken: { hourly: { XBTUSD: '84945.1' }, daily: { XBTUSD: 90000 }, fail: { XBTUSD: 500 }, dailyFail: {...} }
// coingecko: { status, prices: { bitcoin: 84950.5 }, updatedAt }
let marketPrices = null;
// CoinGecko token prices by contract (TOKEN-ANY-PRICE): { status, ethereum: { <lower-case contract>: usd }, solana: { <mint>: usd } }.
let tokenPrices = { status: 200, ethereum: {}, solana: {} };
const krakenKeys = { XBTUSD: 'XXBTZUSD', ETHUSD: 'XETHZUSD', ZECUSD: 'XZECZUSD', XLMUSD: 'XXLMZUSD', USDTUSD: 'USDTZUSD' };
const DAY = 86400;
const backfillStart = Date.parse('2025-01-01T00:00:00Z') / 1000;
// Synthetic Bank of Russia rates (account-in-three-currencies): { base: { R01235: 80 }, fail: { R01239: 500 } }.
// Every Tuesday..Saturday in the asked range up to tomorrow (Moscow) has a record worth
// base + 0.01 per day since 2025-01-01 (less before it); Sundays and Mondays have none.
// Oracles restate this.
let cbr = null;
// Synthetic Etherscan V2 (track-ethereum-wallets): the newest block and raw list items exactly as
// the probe posts them; each list answers the items of an address in a block range, oldest first.
// Pools (track-ethereum-stake) answer eth_call: balanceOfUnderlying(holder) as of a block is the
// posted amount of the newest posted reading at or before it (0 before the first), symbol() is
// the posted symbol; a contract never posted reverts, like one without these functions.
const etherscanKey = 'acceptance-etherscan-key';
const initialEthereum = () => ({ tip: 20000100, normal: [], internal: [], tokens: [], pools: {}, fault: null, requests: 0 });
let ethereum = initialEthereum();
// Synthetic Solana mainnet JSON-RPC (track-solana-wallets): the finalized slot and raw
// getTransaction results exactly as the probe posts them. Signatures and token accounts are
// derived from those transactions as the chain would: an address's signatures are the
// transactions naming it, a wallet's token accounts are those its token balances name. Stake
// accounts (track-solana-stake) answer getMultipleAccounts with the "jsonParsed" value posted
// for them; an account never posted, or posted as null, does not exist.
const initialSolana = () => ({ slot: 300000100, epoch: 800, stakes: new Map(), transactions: new Map(), fault: null, requests: 0 });
let solana = initialSolana();
// Synthetic Bybit V5 (sync-bybit-account): keys with what /v5/user/query-api says of them, and
// records posted as { at: <ms>, row: <Bybit's row> }; every private request must carry a valid
// HMAC-SHA256 signature of the exact query string, checked here independently of the backend.
// `pageSize` splits lists into smaller pages (cursor "<offset>%3A<n>", sent back raw); `fault`
// answers the n-th signed request after the post with a retCode or an HTTP status. Earn
// (BYBIT-EARN) answers only a key whose permissions include Earn: the positions posted per
// product and the yield records of the last three months, as `yield` the way Bybit sends it.
// Convert history and coin exchange records (BYBIT-CONVERT) answer only a key whose Exchange
// permissions include ExchangeHistory, newest first, by page number and by cursor.
// Bybit's public spot market (BYBIT-ANY-COIN) needs no key: `markets` gives each listed coin's
// price against USDT, every candle closing at it; any other symbol is not listed.
const initialBybit = () => ({ keys: [], executions: [], deposits: [], internalDeposits: [], withdrawals: [],
  balances: { FUND: [], UNIFIED: [] }, earn: { FlexibleSaving: [], OnChain: [], fixed: [] },
  flexibleYield: [], onchainYield: [], converts: [], coinExchanges: [], markets: {}, pageSize: null, fault: null,
  requests: 0, badSignatures: 0 });
let bybit = initialBybit();
// Synthetic TronGrid (track-tron-wallets): the newest solidified block and raw items exactly as
// the probe posts them, merged by id. An account's transactions are those whose contract names
// it as owner_address or to_address, and the internal transfers naming it; its TRC-20 transfers
// those naming it as from or to. Lists answer oldest first between min_ and max_timestamp, only
// up to the solid block, the asked limit (6 transactions or 20 token transfers, the app's small
// pages) capped by `pageSize`, with a fingerprint for the next. The node's
// record of a transaction, an account (getaccount) and its unclaimed reward answer as posted;
// anything not yet solid or never posted answers {} like the node. A posted `key` makes every
// request without that TRON-PRO-API-KEY a 401; `fault` answers the n-th request after the post
// with an HTTP status (403 with a frequency-limit message when `limited`).
const initialTron = () => ({ tip: { number: 70000100, timestamp: 1760000300000 }, transactions: new Map(),
  internal: new Map(), tokens: new Map(), infos: new Map(), accounts: new Map(), rewards: new Map(),
  tronscan: new Map(), tronscanFault: false, pageSize: 200, key: null, fault: null, requests: 0 });
let tron = initialTron();
// Synthetic Horizon (track-stellar-wallets): transaction, payment and effect records exactly as
// the probe posts them, merged by paging token. An account's transactions are those it sourced,
// paid the fee of, or that hold a payment naming it; its payments those naming it as from, to,
// funder, account or into. Lists answer oldest first after the cursor, the app's small pages (5
// transactions, 10 payments) capped by `pageSize`; an account answers its posted balances, else
// 404 like Horizon. `fault` answers the n-th request after the post with an HTTP status.
const initialStellar = () => ({ transactions: new Map(), payments: new Map(), effects: new Map(),
  accounts: new Map(), pageSize: 200, fault: null, requests: 0 });
let stellar = initialStellar();
// Synthetic Zcash Blockbook (track-zcash-wallets) on both of Trezor's instance names: the indexed
// tip and the transactions exactly as the probe posts them. An address's history is every
// transaction whose inputs or outputs name it within the asked block range, newest first, in
// pages of the asked size; a page past the end answers the last one like Blockbook. `fault`
// answers the n-th request to one host with an HTTP status.
const initialZcash = () => ({ tip: 3000100, inSync: true, transactions: new Map(), fault: null, requests: 0 });
let zcash = initialZcash();
// Synthetic Yandex SMTP (reset-password-by-email): implicit TLS as smtp.yandex.ru, AUTH PLAIN
// with the synthetic credentials of the acceptance environment, every accepted message kept
// raw for the probe to read. Nothing is relayed anywhere.
const smtpHost = 'smtp.yandex.ru';
const smtpUser = 'acceptance-mailer@example.invalid';
const smtpPassword = 'acceptance-smtp-password';
let mail = [];

function cbrDynamic(response, url) {
  const code = url.searchParams.get('VAL_NM_RQ') ?? '';
  // Only a series code shape is ever echoed back, like the real service.
  if (!/^R\d{5}$/.test(code)) {
    response.writeHead(200, { 'content-type': 'text/html', connection: 'close' });
    return response.end('Error in parameters');
  }
  const parse = (value) => {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value ?? '');
    return match ? Date.parse(`${match[3]}-${match[2]}-${match[1]}T00:00:00Z`) / 1000 : NaN;
  };
  const from = parse(url.searchParams.get('date_req1'));
  const to = parse(url.searchParams.get('date_req2'));
  const failure = cbr?.fail?.[code];
  if (failure) {
    response.writeHead(failure, { 'content-type': 'text/html', connection: 'close' });
    return response.end('<html><body>Service unavailable</body></html>');
  }
  const base = cbr?.base?.[code];
  if (base === undefined || !Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    response.writeHead(200, { 'content-type': 'text/html', connection: 'close' });
    return response.end('Error in parameters');
  }
  const tomorrow = Math.floor((Date.now() / 1000 + 3 * 3600) / DAY) * DAY + DAY;
  const date = (time) => new Date(time * 1000).toISOString().slice(0, 10).split('-').reverse().join('.');
  let records = '';
  for (let time = from; time <= Math.min(to, tomorrow); time += DAY) {
    if ([0, 1].includes(new Date(time * 1000).getUTCDay())) continue;
    const cents = base * 100 + (time - backfillStart) / DAY;
    const value = `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}00`;
    // A broken date's record has another shape, so every answer containing it is unreadable.
    records += cbr.broken?.[code] === new Date(time * 1000).toISOString().slice(0, 10)
      ? `<Record Date="${date(time)}" Id="${code}"><Value>${value}</Value></Record>`
      : `<Record Date="${date(time)}" Id="${code}"><Nominal>1</Nominal><Value>${value}</Value><VunitRate>${value}</VunitRate></Record>`;
  }
  response.writeHead(200, { 'content-type': 'application/xml; charset=windows-1251', connection: 'close' });
  response.end(`<?xml version="1.0" encoding="windows-1251"?><ValCurs ID="${code}" DateRange1="${date(from)}" DateRange2="${date(to)}" name="Foreign Currency Market Dynamic">${records}</ValCurs>`);
}

function etherscan(response, url) {
  const query = url.searchParams;
  const refuse = (result) => respond(response, 200, { status: '0', message: 'NOTOK', result });
  if (url.pathname !== '/v2/api' || query.get('chainid') !== '1') return refuse('Missing or unsupported chainid parameter');
  if (query.get('apikey') !== etherscanKey) return refuse('Invalid API Key (#err2)|synthetic');
  ethereum.requests++;
  const fault = ethereum.fault;
  if (fault && fault.onRequest === ethereum.requests) {
    ethereum.fault = null;
    if (fault.rateLimited) return refuse('Max calls per sec rate limit reached (5/sec)');
    return respond(response, fault.status, { error: 'Synthetic provider fault' });
  }
  const action = query.get('action');
  if (query.get('module') === 'proxy' && action === 'eth_blockNumber') {
    return respond(response, 200, { jsonrpc: '2.0', id: 83, result: `0x${ethereum.tip.toString(16)}` });
  }
  if (query.get('module') === 'proxy' && action === 'eth_call') {
    const to = query.get('to') ?? '';
    const data = query.get('data') ?? '';
    const tag = query.get('tag') ?? '';
    if (!/^0x[0-9a-f]{40}$/.test(to) || !/^0x[0-9a-f]{8}([0-9a-f]{64})*$/.test(data) || !/^0x[0-9a-f]{1,8}$/.test(tag)) {
      return respond(response, 200, { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'invalid argument' } });
    }
    const block = Number.parseInt(tag, 16);
    const pool = ethereum.pools[to];
    const revert = () => respond(response, 200, { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'execution reverted' } });
    if (!pool) return revert();
    const word = (value) => BigInt(value).toString(16).padStart(64, '0');
    if (data === '0x95d89b41') {
      const symbol = Buffer.from(pool.symbol).toString('hex').padEnd(64, '0');
      return respond(response, 200, { jsonrpc: '2.0', id: 1, result: `0x${word(32)}${word(pool.symbol.length)}${symbol}` });
    }
    if (data.length !== 74 || !data.startsWith('0x3af9e669')) return revert();
    const holder = `0x${data.slice(-40)}`;
    const reading = (pool.readings ?? []).filter((item) => item.holder === holder && item.block <= block)
      .sort((left, right) => right.block - left.block)[0];
    return respond(response, 200, { jsonrpc: '2.0', id: 1, result: `0x${word(reading?.units ?? '0')}` });
  }
  const list = { txlist: 'normal', txlistinternal: 'internal', tokentx: 'tokens' }[action];
  const address = query.get('address') ?? '';
  const from = Number(query.get('startblock'));
  const to = Number(query.get('endblock'));
  const offset = Number(query.get('offset'));
  if (query.get('module') !== 'account' || !list || !/^0x[0-9a-f]{40}$/.test(address) || query.get('page') !== '1'
    || query.get('sort') !== 'asc' || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to
    || !Number.isSafeInteger(offset) || offset < 1 || offset > 10000) {
    return refuse('Error! Invalid parameters');
  }
  const items = ethereum[list]
    .filter((item) => [item.from, item.to].includes(address) && Number(item.blockNumber) >= from && Number(item.blockNumber) <= to)
    .sort((left, right) => Number(left.blockNumber) - Number(right.blockNumber))
    .slice(0, offset);
  if (items.length === 0) return respond(response, 200, { status: '0', message: 'No transactions found', result: [] });
  return respond(response, 200, { status: '1', message: 'OK', result: items });
}

const DAY_MS = 86400000;
function bybitRequest(request, response, url) {
  const reply = (retCode, retMsg, result = {}) => respond(response, 200, { retCode, retMsg, result, retExtInfo: {}, time: Date.now() });
  if (url.pathname === '/v5/market/kline') {
    const params = url.searchParams;
    const step = { 60: 60 * 60_000, D: DAY_MS }[params.get('interval')];
    const limit = Number(params.get('limit'));
    if (params.get('category') !== 'spot' || !step || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      return reply(10001, 'params error');
    const symbol = params.get('symbol') ?? '';
    const price = symbol.endsWith('USDT') ? bybit.markets[symbol.slice(0, -4)] : undefined;
    if (price === undefined) return reply(10001, 'Not supported symbols');
    // Newest first, the current candle still open; daily history stops 40 days back.
    const open = Math.floor(Date.now() / step) * step;
    const list = Array.from({ length: Math.min(limit, step === DAY_MS ? 40 : limit) }, (_, index) =>
      [String(open - index * step), price, price, price, price, '1', price]);
    return reply(0, 'OK', { category: 'spot', symbol, list });
  }
  const header = (name) => (typeof request.headers[name] === 'string' ? request.headers[name] : '');
  const apiKey = header('x-bapi-api-key');
  const timestamp = header('x-bapi-timestamp');
  const window = header('x-bapi-recv-window');
  const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?') + 1) : '';
  const key = bybit.keys.find((item) => item.apiKey === apiKey);
  if (!key) return reply(10003, 'API key is invalid.');
  const expected = createHmac('sha256', key.apiSecret).update(timestamp + apiKey + window + query).digest();
  const given = Buffer.from(/^[0-9a-f]{64}$/.test(header('x-bapi-sign')) ? header('x-bapi-sign') : '', 'hex');
  if (given.length !== 32 || !timingSafeEqual(given, expected)) {
    bybit.badSignatures++;
    return reply(10004, 'error sign! origin_string[synthetic]');
  }
  if (!/^\d{13}$/.test(timestamp) || Math.abs(Number(timestamp) - Date.now()) > Number(window || 5000)) {
    return reply(10002, 'invalid request, please check your server timestamp or recv_window param');
  }
  bybit.requests++;
  const fault = bybit.fault;
  if (fault && fault.onRequest === bybit.requests) {
    bybit.fault = null;
    if (fault.status) return respond(response, fault.status, { error: 'Synthetic provider fault' });
    return reply(fault.retCode, 'Synthetic refusal');
  }
  const params = url.searchParams;
  if (url.pathname === '/v5/user/query-api') return reply(0, '', { ...key.info, apiKey });
  if (url.pathname === '/v5/asset/transfer/query-account-coins-balance') {
    const type = params.get('accountType');
    if (!['FUND', 'UNIFIED'].includes(type)) return reply(10001, 'accountType invalid');
    // As Bybit answers: the unified account is listed here only for one to ten named coins.
    if (type === 'UNIFIED' && !params.get('coin'))
      return reply(131203, 'request parameter err: Limit the query to 1 to 10 coins for account UNIFIED');
    return reply(0, 'success', { accountType: type, memberId: key.info.userID, balance: bybit.balances[type] });
  }
  if (url.pathname === '/v5/account/wallet-balance') {
    if (params.get('accountType') !== 'UNIFIED') return reply(10001, 'accountType only support UNIFIED');
    const coin = bybit.balances.UNIFIED.map((row) => ({ coin: row.coin, walletBalance: row.walletBalance,
      equity: row.walletBalance, locked: '0', borrowAmount: '0', usdValue: '', availableToWithdraw: '' }));
    return reply(0, 'OK', { list: [{ accountType: 'UNIFIED', totalEquity: '', coin }] });
  }
  if (url.pathname.startsWith('/v5/earn/')) {
    if (!(key.info.permissions?.Earn ?? []).includes('Earn'))
      return reply(10005, 'Permission denied, please check your API key permissions.');
    const category = params.get('category');
    if (url.pathname === '/v5/earn/position') {
      if (!['FlexibleSaving', 'OnChain'].includes(category)) return reply(10001, 'category invalid');
      return reply(0, '', { list: bybit.earn[category] });
    }
    if (url.pathname === '/v5/earn/fixed-term/position') return reply(0, '', { list: bybit.earn.fixed });
    if (url.pathname !== '/v5/earn/yield' || !['FlexibleSaving', 'OnChain'].includes(category))
      return reply(10001, 'Unknown synthetic endpoint');
    // Bybit keeps three months of yield.
    if (Number(params.get('startTime')) < Date.now() - 90 * DAY_MS) return reply(10001, 'Only the past 3 months data');
  }
  if (url.pathname.startsWith('/v5/asset/exchange/')) {
    if (!(key.info.permissions?.Exchange ?? []).includes('ExchangeHistory'))
      return reply(10005, 'Permission denied, please check your API key permissions.');
    const limit = Number(params.get('limit'));
    const newest = (name) => [...bybit[name]].sort((left, right) => right.at - left.at).map((item) => item.row);
    if (url.pathname === '/v5/asset/exchange/query-convert-history') {
      const index = Number(params.get('index'));
      if (!Number.isSafeInteger(index) || index < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        return reply(700000, 'parameter error');
      return reply(0, 'ok', { list: newest('converts').slice((index - 1) * limit, index * limit) });
    }
    if (url.pathname !== '/v5/asset/exchange/order-record') return reply(10001, 'Unknown synthetic endpoint');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) return reply(10001, 'limit invalid');
    const offset = params.has('cursor') ? Number(params.get('cursor')) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) return reply(10001, 'cursor invalid');
    const rows = newest('coinExchanges');
    return reply(0, 'success', { orderBody: rows.slice(offset, offset + limit),
      nextPageCursor: offset + limit < rows.length ? String(offset + limit) : '' });
  }
  const lists = {
    '/v5/earn/yield': [params.get('category') === 'OnChain' ? 'onchainYield' : 'flexibleYield', 'yield', 7 * DAY_MS, 100],
    '/v5/execution/list': ['executions', 'list', 7 * DAY_MS, 100],
    '/v5/asset/deposit/query-record': ['deposits', 'rows', 30 * DAY_MS, 50],
    '/v5/asset/deposit/query-internal-record': ['internalDeposits', 'rows', 30 * DAY_MS, 50],
    '/v5/asset/withdraw/query-record': ['withdrawals', 'rows', 30 * DAY_MS, 50],
  };
  const list = lists[url.pathname];
  if (!list) return reply(10001, 'Unknown synthetic endpoint');
  const [name, field, longest, largest] = list;
  if (name === 'executions' && params.get('category') !== 'spot') return reply(10001, 'category invalid');
  if (name === 'withdrawals' && params.get('withdrawType') !== '2') return reply(10001, 'withdrawType must ask for every withdrawal');
  const start = Number(params.get('startTime'));
  const end = Number(params.get('endTime'));
  const limit = Number(params.get('limit'));
  // Bybit's own limits: the backend must split history into windows it accepts.
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end - start > longest
    || (longest !== 7 * DAY_MS && end - start >= longest)) return reply(10001, 'The time range is too long or invalid');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > largest) return reply(10001, 'limit invalid');
  const size = Math.min(limit, bybit.pageSize ?? limit);
  const cursor = params.get('cursor');
  const offset = cursor === null ? 0 : Number(/^(\d+):\d+$/.exec(cursor)?.[1] ?? NaN);
  if (!Number.isSafeInteger(offset)) return reply(10001, 'cursor invalid');
  // Newest first, as Bybit lists them.
  const matching = bybit[name].filter(({ at }) => at >= start && at <= end).sort((left, right) => right.at - left.at);
  const page = matching.slice(offset, offset + size).map(({ row }) => row);
  const more = offset + size < matching.length;
  return reply(0, 'OK', { [field]: page, nextPageCursor: more ? `${offset + size}%3A${size}` : '', ...(name === 'executions' ? { category: 'spot' } : {}) });
}

function solanaKeys(result) {
  const loaded = result.meta.loadedAddresses ?? { writable: [], readonly: [] };
  return [...result.transaction.message.accountKeys, ...loaded.writable, ...loaded.readonly];
}

function solanaRpc(response, body) {
  const rpc = (result) => respond(response, 200, { jsonrpc: '2.0', id: body.id, result });
  const error = (code, message) => respond(response, 200, { jsonrpc: '2.0', id: body.id, error: { code, message } });
  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string' || !Array.isArray(body.params)) return error(-32600, 'Invalid request');
  solana.requests++;
  const fault = solana.fault;
  if (fault && fault.onRequest === solana.requests) {
    solana.fault = null;
    if (fault.rateLimited) return respond(response, 429, { jsonrpc: '2.0', id: body.id, error: { code: 429, message: 'Too many requests for a specific RPC call' } });
    return respond(response, fault.status, { error: 'Synthetic provider fault' });
  }
  const [first, second, third] = body.params;
  const options = (value) => value && typeof value === 'object' && value.commitment === 'finalized';
  // Only what is final at the posted slot exists, newest first as getSignaturesForAddress lists it.
  const final = [...solana.transactions.entries()].filter(([, result]) => result.slot <= solana.slot)
    .sort(([leftSig, left], [rightSig, right]) => right.slot - left.slot || (leftSig < rightSig ? 1 : -1));
  if (body.method === 'getSlot' && options(first)) return rpc(solana.slot);
  if (body.method === 'getEpochInfo' && options(first)) {
    return rpc({ absoluteSlot: solana.slot, blockHeight: solana.slot - 20000000, epoch: solana.epoch, slotIndex: 1000,
      slotsInEpoch: 432000, transactionCount: 1 });
  }
  if (body.method === 'getMultipleAccounts' && Array.isArray(first) && first.length >= 1 && first.length <= 100
    && first.every((key) => typeof key === 'string') && options(second) && second.encoding === 'jsonParsed') {
    return rpc({ context: { slot: solana.slot }, value: first.map((key) => solana.stakes.get(key) ?? null) });
  }
  // By mint, or (TOKEN-ANY) every account of one token program, as the balances name it.
  if (body.method === 'getTokenAccountsByOwner' && typeof first === 'string'
    && (typeof second?.mint === 'string' || typeof second?.programId === 'string')
    && options(third) && third.encoding === 'base64') {
    const accounts = new Set();
    for (const [, result] of final) {
      const keys = solanaKeys(result);
      for (const balance of [...(result.meta.preTokenBalances ?? []), ...(result.meta.postTokenBalances ?? [])]) {
        const matches = second.mint !== undefined ? balance.mint === second.mint
          : (balance.programId ?? 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') === second.programId;
        if (balance.owner === first && matches) accounts.add(keys[balance.accountIndex]);
      }
    }
    return rpc({ context: { slot: solana.slot }, value: [...accounts].sort().map((pubkey) => ({ pubkey,
      account: { data: ['', 'base64'], executable: false, lamports: 2039280, owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', rentEpoch: 0, space: 165 } })) });
  }
  if (body.method === 'getSignaturesForAddress' && typeof first === 'string' && options(second)
    && Number.isSafeInteger(second.limit) && second.limit >= 1 && second.limit <= 1000) {
    const touching = final.filter(([, result]) => solanaKeys(result).includes(first));
    const start = second.before ? touching.findIndex(([signature]) => signature === second.before) + 1 : 0;
    if (second.before && start === 0) return error(-32602, 'Invalid param: before');
    return rpc(touching.slice(start, start + second.limit).map(([signature, result]) => ({ signature, slot: result.slot,
      err: result.meta.err, memo: null, blockTime: result.blockTime, confirmationStatus: 'finalized' })));
  }
  if (body.method === 'getTransaction' && typeof first === 'string' && options(second) && second.encoding === 'json'
    && second.maxSupportedTransactionVersion === 0) {
    const result = solana.transactions.get(first);
    return rpc(result && result.slot <= solana.slot ? result : null);
  }
  return error(-32601, 'Method not found');
}

// Kraken OHLC: hourly candles end with the open candle three hours after `since`; daily
// candles run from the day containing `since` to today. Oracles restate these formulas.
function krakenOhlc(response, url) {
  const pair = url.searchParams.get('pair');
  const interval = Number(url.searchParams.get('interval'));
  const since = Number(url.searchParams.get('since'));
  const kraken = marketPrices?.kraken ?? {};
  const failure = (interval === 1440 ? kraken.dailyFail : kraken.fail)?.[pair];
  if (failure) return respond(response, failure, { error: ['EService:Unavailable'] });
  const configured = interval === 1440 ? kraken.daily?.[pair] : kraken.hourly?.[pair];
  if (configured === undefined || !Number.isSafeInteger(since)) {
    return respond(response, 200, { error: ['EQuery:Unknown asset pair'] });
  }
  const candle = (time, close) => [time, close, close, close, close, close, '1.00000000', 1];
  let candles;
  if (interval === 60) {
    const open = since + 3 * 3600;
    candles = [open - 3 * 3600, open - 2 * 3600, open - 3600].map((time) => candle(time, configured));
    candles.push(candle(open, '1.0'));
  } else if (interval === 1440) {
    const today = Math.floor(Date.now() / 1000 / DAY) * DAY;
    candles = [];
    for (let time = Math.floor(since / DAY) * DAY; time <= today; time += DAY) {
      candles.push(candle(time, `${configured + (time - backfillStart) / DAY}.5`));
    }
  } else {
    return respond(response, 200, { error: ['EGeneral:Invalid arguments'] });
  }
  return respond(response, 200, { error: [], result: { [krakenKeys[pair] ?? pair]: candles, last: candles.at(-2)?.[0] ?? 0 } });
}

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

function chainTx({ txid, height, inputs, outputs, fee }) {
  const out = (owner, value) => ({ scriptpubkey: '0014' + sha256(owner).slice(0, 40),
    scriptpubkey_asm: 'OP_0 OP_PUSHBYTES_20', scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: owner, value });
  return { txid, version: 2, locktime: 0,
    vin: inputs.map(([owner, value], n) => ({ txid: sha256(`ct-e2e-chain-prev:${txid}:${n}`), vout: n,
      prevout: out(owner, value), scriptsig: '', scriptsig_asm: '', witness: ['30440220', '02ab'],
      is_coinbase: false, sequence: 4294967293 })),
    vout: outputs.map(([owner, value]) => out(owner, value)), fee, size: 222, weight: 561,
    status: { confirmed: true, block_height: height, block_hash: sha256(`ct-e2e-block:${height}`),
      block_time: 1700000000 + (height - 800000) * 600 } };
}

// Newest first, as Esplora lists an address's confirmed history.
function chainHistory(address) {
  const names = (tx) => tx.vout.some((output) => output.scriptpubkey_address === address)
    || tx.vin.some((input) => input.prevout.scriptpubkey_address === address);
  return bitcoinChain.transactions.filter(names).reverse();
}

function bitcoinHistory(response, address, afterTxid) {
  const history = bitcoinHistories.get(address);
  if (!history && bitcoinChain) {
    bitcoinChain.requests++;
    const fault = bitcoinChain.fault;
    if (fault && fault.onRequest === bitcoinChain.requests) {
      bitcoinChain.fault = null;
      if (fault.empty) return respond(response, 200, []);
      return respond(response, fault.status, { error: 'Synthetic provider fault' });
    }
    const list = chainHistory(address);
    const start = afterTxid === null ? 0 : list.findIndex((tx) => tx.txid === afterTxid) + 1;
    if (afterTxid !== null && start === 0) return respond(response, 200, []);
    return respond(response, 200, list.slice(start, start + 25));
  }
  if (!history) return respond(response, 200, []);
  history.requests++;
  if (history.fault && history.fault.onRequest === history.requests) {
    const fault = history.fault;
    history.fault = null;
    if (fault.invalid) return respond(response, 200, [{ ...historyTx(address, history.count - 1), fee: 1.5 }]);
    // A lagging Esplora backend answers 200 [] for a cursor it does not know yet.
    if (fault.empty) return respond(response, 200, []);
    return respond(response, fault.status, { error: 'Synthetic provider fault' });
  }
  const newestFirst = Array.from({ length: history.count }, (_value, index) => history.count - 1 - index);
  let start = 0;
  if (afterTxid !== null) {
    start = newestFirst.findIndex((i) => historyTx(address, i).txid === afterTxid) + 1;
    // Real electrs skips to the cursor and returns 200 [] when it is unknown.
    if (start === 0) return respond(response, 200, []);
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
  if (url.hostname === 'api.kraken.com' && url.pathname === '/0/public/OHLC') return krakenOhlc(response, url);
  if (url.hostname === 'www.cbr.ru' && url.pathname === '/scripts/XML_dynamic.asp') return cbrDynamic(response, url);
  if (url.hostname === 'api.etherscan.io') return etherscan(response, url);
  if (url.hostname === 'api.bybit.com') return bybitRequest(request, response, url);
  if (url.hostname === 'api.trongrid.io') return tronRequest(request, response, url);
  if (url.hostname === 'apilist.tronscanapi.com') return tronscanRequest(request, response, url);
  if (url.hostname === 'horizon.stellar.org') return stellarRequest(response, url);
  if (url.hostname === 'zec1.trezor.io' || url.hostname === 'zec5.trezor.io') return zcashRequest(response, url);
  if (url.hostname === 'api.coingecko.com' && url.pathname === '/api/v3/simple/price'
    && marketPrices?.coingecko && url.searchParams.get('include_last_updated_at') === 'true') {
    const { status = 200, prices = {}, updatedAt } = marketPrices.coingecko;
    if (status !== 200) return respond(response, status, { status: { error_code: status } });
    const ids = (url.searchParams.get('ids') || '').split(',');
    const at = updatedAt ?? Math.floor(Date.now() / 1000) - 30;
    return respond(response, 200, Object.fromEntries(ids.filter((id) => prices[id] !== undefined)
      .map((id) => [id, { usd: prices[id], last_updated_at: at }])));
  }
  if (url.hostname === 'api.coingecko.com' && url.pathname === '/api/v3/simple/price') {
    return respond(response, 200, { bitcoin: { usd: 60000 }, ethereum: { usd: 3000 } });
  }
  const tokenRoute = /^\/api\/v3\/simple\/token_price\/(ethereum|solana)$/.exec(url.hostname === 'api.coingecko.com' ? url.pathname : '');
  if (tokenRoute) {
    if (tokenPrices.status !== 200) return respond(response, tokenPrices.status, { status: { error_code: tokenPrices.status } });
    const table = tokenPrices[tokenRoute[1]];
    const at = Math.floor(Date.now() / 1000) - 30;
    const contracts = (url.searchParams.get('contract_addresses') || '').split(',').filter(Boolean);
    // Ethereum answers by lower-case contract, Solana by mint.
    return respond(response, 200, Object.fromEntries(contracts.flatMap((contract) => {
      const key = tokenRoute[1] === 'ethereum' ? contract.toLowerCase() : contract;
      return table[key] === undefined ? [] : [[key, { usd: table[key], last_updated_at: at }]];
    })));
  }
  if (url.hostname === 'api.exchangerate-api.com' && url.pathname === '/v4/latest/USD') {
    return respond(response, 200, { base: 'USD', date: '2026-09-21', rates: { USD: 1, EUR: 0.9, RUB: 90 } });
  }
  const chain = /^\/api\/address\/([^/]+)\/txs\/chain(?:\/([0-9a-f]{64}))?$/.exec(url.pathname);
  if (url.hostname === 'blockstream.info' && chain && !url.search) {
    return bitcoinHistory(response, decodeURIComponent(chain[1]), chain[2] ?? null);
  }
  if (url.hostname === 'blockstream.info' && /^\/api\/address\/[^/]+$/.test(url.pathname)) {
    const address = decodeURIComponent(url.pathname.split('/').at(-1));
    return respond(response, 200, {
      address,
      chain_stats: { funded_txo_sum: bitcoin.funded, spent_txo_sum: bitcoin.spent,
        tx_count: bitcoinHistories.get(address)?.count
          ?? (bitcoinChain ? chainHistory(address).length : 2) },
      mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
    });
  }
  return respond(response, 501, { error: 'No fixture for outbound destination' });
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const stellarNames = (payment) => [payment.from, payment.to, payment.funder, payment.account, payment.into]
  .concat((payment.asset_balance_changes ?? []).flatMap((change) => [change.from, change.to]));
function stellarRequest(response, url) {
  stellar.requests++;
  const fault = stellar.fault;
  if (fault && fault.onRequest === stellar.requests) {
    stellar.fault = null;
    return respond(response, fault.status, { status: fault.status, title: 'Synthetic fault' });
  }
  const query = url.searchParams;
  const records = (items) => respond(response, 200, { _links: {}, _embedded: { records: items } });
  const effects = /^\/operations\/([0-9]{1,19})\/effects$/.exec(url.pathname);
  if (effects) return records(stellar.effects.get(effects[1]) ?? []);
  const path = /^\/accounts\/(G[A-Z2-7]{55})(\/transactions|\/payments)?$/.exec(url.pathname);
  if (!path) return respond(response, 404, { status: 404, title: 'Resource Missing' });
  const [, id, list] = path;
  if (!list) {
    const account = stellar.accounts.get(id);
    return account ? respond(response, 200, { id, account_id: id, ...account })
      : respond(response, 404, { status: 404, title: 'Resource Missing' });
  }
  const transactions = list === '/transactions';
  const cursor = query.get('cursor');
  if (query.get('order') !== 'asc' || query.get('limit') !== (transactions ? '5' : '10')
    || (transactions ? query.get('include_failed') !== 'true' : query.has('include_failed'))
    || (cursor !== null && !/^[0-9]{1,19}$/.test(cursor))) {
    return respond(response, 400, { status: 400, title: 'Invalid synthetic Horizon request' });
  }
  const payments = [...stellar.payments.values()];
  const named = (payment) => stellarNames(payment).includes(id);
  const items = (transactions
    ? [...stellar.transactions.values()].filter((item) => item.source_account === id || item.fee_account === id
      || payments.some((payment) => payment.transaction_hash === item.hash && named(payment)))
    : payments.filter((payment) => payment.transaction_successful && named(payment)))
    .filter((item) => cursor === null || BigInt(item.paging_token) > BigInt(cursor))
    .sort((left, right) => (BigInt(left.paging_token) < BigInt(right.paging_token) ? -1 : 1));
  return records(items.slice(0, Math.min(Number(query.get('limit')), stellar.pageSize)));
}

function zcashRequest(response, url) {
  zcash.requests++;
  const fault = zcash.fault;
  if (fault && fault.host === url.hostname && fault.onRequest === zcash.requests) {
    zcash.fault = null;
    return respond(response, fault.status, { error: 'Synthetic fault' });
  }
  if (url.pathname === '/api') {
    return respond(response, 200, { blockbook: { coin: 'Zcash', bestHeight: zcash.tip, inSync: zcash.inSync },
      backend: { chain: 'main', blocks: zcash.tip } });
  }
  const path = /^\/api\/v2\/address\/(t[13][1-9A-HJ-NP-Za-km-z]{33})$/.exec(url.pathname);
  if (!path) return respond(response, 400, { error: 'Invalid synthetic Blockbook request' });
  const query = url.searchParams;
  const number = (name) => (/^(0|[1-9][0-9]{0,9})$/.test(query.get(name) ?? '') ? Number(query.get(name)) : null);
  const [from, to, page, pageSize] = ['from', 'to', 'page', 'pageSize'].map(number);
  if (query.get('details') !== 'txs' || pageSize !== 10 || from === null || to === null || !page) {
    return respond(response, 400, { error: 'Invalid synthetic Blockbook request' });
  }
  const id = path[1];
  const names = (item) => [...item.vin, ...item.vout].flatMap((part) => part.addresses ?? []);
  const items = [...zcash.transactions.values()]
    .filter((item) => item.blockHeight >= from && item.blockHeight <= to && names(item).includes(id))
    .sort((left, right) => right.blockHeight - left.blockHeight);
  const totalPages = Math.ceil(items.length / pageSize);
  const shown = Math.min(page, Math.max(totalPages, 1));
  const body = { page: shown, totalPages, itemsOnPage: pageSize, address: id, balance: '0',
    totalReceived: '0', totalSent: '0', unconfirmedBalance: '0', unconfirmedTxs: 0, txs: items.length };
  const slice = items.slice((shown - 1) * pageSize, shown * pageSize);
  return respond(response, 200, slice.length ? { ...body, transactions: slice } : body);
}

// The hex form ("41…") of a base58check Tron address, restated from the format.
function tronHex(value) {
  if (typeof value !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return null;
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(BASE58.indexOf(character));
  const bytes = Buffer.from(number.toString(16).padStart(50, '0'), 'hex');
  const check = createHash('sha256').update(createHash('sha256').update(bytes.subarray(0, 21)).digest()).digest();
  return bytes[0] === 0x41 && check.subarray(0, 4).equals(bytes.subarray(21)) ? bytes.subarray(0, 21).toString('hex') : null;
}

// Synthetic Tronscan (TRON-INTERNAL): only the list of TRX transfers contracts made to an account,
// newest first, as the probe posts them in `tronscan` (items keyed by account); `limit` items from
// `start`. Nothing else of Tronscan is answered.
function tronscanRequest(request, response, url) {
  const query = url.searchParams;
  if (url.pathname !== '/api/internal-transaction' || [...query.keys()].sort().join() !== 'address,limit,start'
    || tronHex(query.get('address')) === null || !/^[0-9]{1,6}$/.test(query.get('start')) || query.get('limit') !== '10') {
    return respond(response, 400, { error: 'Invalid synthetic Tronscan request' });
  }
  if (tron.tronscanFault) {
    tron.tronscanFault = false;
    return respond(response, 503, { error: 'Synthetic Tronscan fault' });
  }
  const start = Number(query.get('start'));
  const items = tron.tronscan.get(query.get('address')) ?? [];
  return respond(response, 200, { total: -1, data: items.slice(start, start + 10) });
}

function tronRequest(request, response, url) {
  const query = url.searchParams;
  tron.requests++;
  if (tron.key && request.headers['tron-pro-api-key'] !== tron.key) return respond(response, 401, { Error: 'ApiKey not exists' });
  const fault = tron.fault;
  if (fault && fault.onRequest === tron.requests) {
    tron.fault = null;
    if (fault.limited) return respond(response, 403, { Error: 'The key exceeds the frequency limit(15), and the query server is suspended for 1s' });
    return respond(response, fault.status, { Error: 'Synthetic provider fault' });
  }
  const solid = (time) => time <= tron.tip.timestamp;
  // Header only: the app never asks for a whole block (its answers must stay small).
  if (url.pathname === '/walletsolidity/getblock' && url.search === '?detail=false') {
    return respond(response, 200, { blockID: tron.tip.number.toString(16).padStart(64, '0'),
      block_header: { raw_data: { number: tron.tip.number, timestamp: tron.tip.timestamp } } });
  }
  if (url.pathname === '/walletsolidity/gettransactioninfobyid' && [...query.keys()].join() === 'value') {
    const info = tron.infos.get(query.get('value'));
    return respond(response, 200, info && solid(info.blockTimeStamp) ? info : {});
  }
  const visible = query.get('visible') === 'true' && [...query.keys()].sort().join() === 'address,visible';
  if (url.pathname === '/walletsolidity/getaccount' && visible) {
    return respond(response, 200, tron.accounts.get(query.get('address')) ?? {});
  }
  if (url.pathname === '/wallet/getReward' && visible) {
    const reward = tron.rewards.get(query.get('address'));
    return respond(response, 200, reward ? { reward } : {});
  }
  const list = /^\/v1\/accounts\/(T[1-9A-HJ-NP-Za-km-z]{33})\/transactions(\/trc20)?$/.exec(url.pathname);
  const from = Number(query.get('min_timestamp'));
  const to = Number(query.get('max_timestamp'));
  const expected = ['fingerprint', 'limit', 'max_timestamp', 'min_timestamp', 'only_confirmed', 'order_by', ...(list?.[2] ? ['contract_address'] : [])];
  if (!list || tronHex(list[1]) === null || query.get('only_confirmed') !== 'true' || query.get('limit') !== (list?.[2] ? '20' : '6')
    || query.get('order_by') !== 'block_timestamp,asc' || !Number.isSafeInteger(from) || !Number.isSafeInteger(to)
    || ![...query.keys()].every((name) => expected.includes(name))) {
    return respond(response, 400, { success: false, error: 'Invalid synthetic TronGrid request', statusCode: 400 });
  }
  const account = list[1];
  const hex = tronHex(account);
  const time = (item) => item.block_timestamp;
  let items;
  if (list[2]) {
    const contract = query.get('contract_address');
    items = [...tron.tokens.values()].filter((item) => item.token_info.address === contract
      && (item.from === account || item.to === account));
  } else {
    const value = (item) => item.raw_data.contract[0].parameter.value;
    items = [...tron.transactions.values()].filter((item) => value(item).owner_address === hex || value(item).to_address === hex)
      .concat([...tron.internal.values()].filter((item) => item.from_address === hex || item.to_address === hex));
  }
  items = items.filter((item) => solid(time(item)) && time(item) >= from && time(item) <= to)
    .sort((left, right) => time(left) - time(right) || (left.txID ?? left.tx_id ?? left.transaction_id).localeCompare(right.txID ?? right.tx_id ?? right.transaction_id));
  const offset = query.has('fingerprint') ? Number(query.get('fingerprint').replace(/^offset-/, '')) : 0;
  const page = items.slice(offset, offset + Math.min(Number(query.get('limit')), tron.pageSize));
  const more = offset + page.length < items.length;
  return respond(response, 200, { data: page, success: true,
    meta: { at: tron.tip.timestamp, page_size: page.length, ...(more ? { fingerprint: `offset-${offset + page.length}` } : {}) } });
}

async function solanaRequest(request, response, url) {
  if (requests.length >= 10000) return respond(response, 503, { error: 'Fixture request budget exhausted' });
  let body;
  try {
    body = await readJson(request);
  } catch {
    return respond(response, 400, { error: 'Invalid JSON-RPC body' });
  }
  if (!(/^application\/json\b/.test(request.headers['content-type'] ?? ''))) return respond(response, 415, { error: 'JSON only' });
  requests.push({ method: request.method, url: url.href, rpc: { method: body?.method, params: body?.params } });
  return solanaRpc(response, body);
}

// Controls are available only on this internal plaintext service, never inside TLS.
const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/__control/health') return respond(response, 200, { ok: true });
    if (request.method === 'GET' && request.url === '/__control/requests') return respond(response, 200, requests);
    if (request.method === 'GET' && request.url === '/__control/mail') return respond(response, 200, mail);
    if (request.method === 'POST' && request.url === '/__control/reset') {
      bitcoin = initialBitcoin();
      requests = [];
      fx = initialFx();
      bitcoinHistories = new Map();
      bitcoinChain = null;
      marketPrices = null;
      tokenPrices = { status: 200, ethereum: {}, solana: {} };
      cbr = null;
      ethereum = initialEthereum();
      solana = initialSolana();
      bybit = initialBybit();
      tron = initialTron();
      stellar = initialStellar();
      zcash = initialZcash();
      mail = [];
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
    if (request.method === 'POST' && request.url === '/__control/prices') {
      const data = await readJson(request);
      const status = (value) => value === undefined || (Number.isInteger(value) && value >= 200 && value <= 599);
      const table = (value, check) => value === undefined || (value && typeof value === 'object' && !Array.isArray(value)
        && Object.entries(value).every(([key, item]) => /^[A-Za-z0-9-]{2,24}$/.test(key) && check(item)));
      const kraken = data.kraken ?? {};
      const coingecko = data.coingecko ?? {};
      if (!table(kraken.hourly, (item) => typeof item === 'string' && /^\d+(\.\d+)?$/.test(item))
        || !table(kraken.daily, (item) => Number.isSafeInteger(item) && item > 0)
        || !table(kraken.fail, (item) => Number.isInteger(item) && item >= 400 && item <= 599)
        || !table(kraken.dailyFail, (item) => Number.isInteger(item) && item >= 400 && item <= 599)
        || !status(coingecko.status) || !table(coingecko.prices, (item) => typeof item === 'number' && item > 0)
        || (coingecko.updatedAt !== undefined && !Number.isSafeInteger(coingecko.updatedAt))) {
        return respond(response, 400, { error: 'Invalid synthetic price fixture' });
      }
      marketPrices = { kraken, coingecko: data.coingecko ? coingecko : null };
      return respond(response, 200, { ok: true });
    }
    if (request.method === 'POST' && request.url === '/__control/token-prices') {
      const data = await readJson(request);
      const table = (value) => value === undefined || (value && typeof value === 'object' && !Array.isArray(value)
        && Object.entries(value).every(([key, item]) => /^[A-Za-z0-9]{20,64}$/.test(key) && typeof item === 'number' && item > 0));
      if (!table(data.ethereum) || !table(data.solana)
        || (data.status !== undefined && !(Number.isInteger(data.status) && data.status >= 200 && data.status <= 599))) {
        return respond(response, 400, { error: 'Invalid synthetic token price fixture' });
      }
      tokenPrices = { status: data.status ?? 200, ethereum: data.ethereum ?? {}, solana: data.solana ?? {} };
      return respond(response, 200, { ok: true });
    }
    if (request.method === 'POST' && request.url === '/__control/cbr') {
      const data = await readJson(request);
      const table = (value, check) => value === undefined || (value && typeof value === 'object' && !Array.isArray(value)
        && Object.entries(value).every(([key, item]) => /^R\d{5}$/.test(key) && check(item)));
      if (!table(data.base, (item) => Number.isSafeInteger(item) && item > 0 && item < 10000)
        || !table(data.fail, (item) => Number.isInteger(item) && item >= 400 && item <= 599)
        || !table(data.broken, (item) => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item))) {
        return respond(response, 400, { error: 'Invalid synthetic Bank of Russia fixture' });
      }
      cbr = { base: data.base ?? {}, fail: data.fail ?? {}, broken: data.broken ?? {} };
      return respond(response, 200, { ok: true });
    }
    if (request.method === 'GET' && request.url === '/__control/bybit') {
      return respond(response, 200, { requests: bybit.requests, badSignatures: bybit.badSignatures });
    }
    // Lists replace what was posted before; `append` adds to them instead.
    if (request.method === 'POST' && request.url === '/__control/bybit') {
      const data = await readJson(request);
      const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
      const records = (value) => value === undefined || (Array.isArray(value) && value.length <= 60
        && value.every((item) => plain(item) && Number.isSafeInteger(item.at) && plain(item.row)));
      const keys = data.keys === undefined || (Array.isArray(data.keys) && data.keys.length <= 10
        && data.keys.every((item) => plain(item) && /^[0-9A-Za-z]{10,64}$/.test(item.apiKey ?? '')
          && /^[0-9A-Za-z]{10,128}$/.test(item.apiSecret ?? '') && plain(item.info)));
      const coins = (value) => value === undefined || (Array.isArray(value) && value.length <= 20 && value.every(plain));
      const fault = data.fault;
      if (!keys || !records(data.executions) || !records(data.deposits) || !records(data.internalDeposits)
        || !records(data.withdrawals) || !records(data.flexibleYield) || !records(data.onchainYield)
        || !records(data.converts) || !records(data.coinExchanges)
        || (data.markets !== undefined && (!plain(data.markets) || !Object.entries(data.markets)
          .every(([coin, price]) => /^[A-Z0-9]{1,16}$/.test(coin) && /^\d+(\.\d+)?$/.test(price))))
        || (data.balances !== undefined && (!plain(data.balances)
          || !coins(data.balances.FUND) || !coins(data.balances.UNIFIED)))
        || (data.earn !== undefined && (!plain(data.earn) || !coins(data.earn.FlexibleSaving)
          || !coins(data.earn.OnChain) || !coins(data.earn.fixed)))
        || (data.pageSize !== undefined && data.pageSize !== null && (!Number.isInteger(data.pageSize) || data.pageSize < 1))
        || (fault !== undefined && (!plain(fault) || !Number.isSafeInteger(fault.onRequest) || fault.onRequest < 1
          || (!Number.isInteger(fault.retCode) && (!Number.isInteger(fault.status) || fault.status < 300 || fault.status > 599))))) {
        return respond(response, 400, { error: 'Invalid synthetic Bybit fixture' });
      }
      const merge = (name) => (data[name] === undefined ? bybit[name] : data.append ? [...bybit[name], ...data[name]] : data[name]);
      bybit = { keys: data.keys ?? bybit.keys, executions: merge('executions'), deposits: merge('deposits'),
        internalDeposits: merge('internalDeposits'), withdrawals: merge('withdrawals'),
        flexibleYield: merge('flexibleYield'), onchainYield: merge('onchainYield'),
        converts: merge('converts'), coinExchanges: merge('coinExchanges'), markets: data.markets ?? bybit.markets,
        balances: data.balances ? { FUND: data.balances.FUND ?? [], UNIFIED: data.balances.UNIFIED ?? [] } : bybit.balances,
        earn: data.earn ? { FlexibleSaving: data.earn.FlexibleSaving ?? [], OnChain: data.earn.OnChain ?? [],
          fixed: data.earn.fixed ?? [] } : bybit.earn,
        pageSize: data.pageSize === undefined ? bybit.pageSize : data.pageSize,
        fault: fault ? { onRequest: fault.onRequest, retCode: fault.retCode, status: fault.status } : null,
        requests: 0, badSignatures: bybit.badSignatures };
      return respond(response, 200, { ok: true });
    }
    if (request.method === 'POST' && request.url === '/__control/ethereum') {
      const data = await readJson(request);
      const items = (value) => value === undefined || (Array.isArray(value) && value.length <= 100
        && value.every((item) => item && typeof item === 'object' && !Array.isArray(item)
          && Object.entries(item).every(([key, field]) => /^[A-Za-z_]{1,24}$/.test(key)
            && typeof field === 'string' && field.length <= 100)));
      const fault = data.fault;
      const pools = (value) => value === undefined || (value && typeof value === 'object' && !Array.isArray(value)
        && Object.entries(value).length <= 10 && Object.entries(value).every(([contract, pool]) => /^0x[0-9a-f]{40}$/.test(contract)
          && pool && typeof pool.symbol === 'string' && /^[A-Za-z0-9.]{1,16}$/.test(pool.symbol)
          && Array.isArray(pool.readings) && pool.readings.length <= 100 && pool.readings.every((item) => item
            && /^0x[0-9a-f]{40}$/.test(item.holder) && Number.isSafeInteger(item.block) && item.block >= 0
            && typeof item.units === 'string' && /^(0|[1-9][0-9]{0,40})$/.test(item.units))));
      if ((data.tip !== undefined && (!Number.isSafeInteger(data.tip) || data.tip < 0 || data.tip >= 2 ** 31))
        || !items(data.normal) || !items(data.internal) || !items(data.tokens) || !pools(data.pools)
        || (fault !== undefined && (!fault || !Number.isSafeInteger(fault.onRequest) || fault.onRequest < 1
          || (fault.rateLimited !== true && (!Number.isInteger(fault.status) || fault.status < 300 || fault.status > 599))))) {
        return respond(response, 400, { error: 'Invalid synthetic Ethereum fixture' });
      }
      ethereum = { tip: data.tip ?? ethereum.tip, normal: data.normal ?? ethereum.normal,
        internal: data.internal ?? ethereum.internal, tokens: data.tokens ?? ethereum.tokens,
        pools: data.pools ?? ethereum.pools,
        fault: fault ? { onRequest: fault.onRequest, status: fault.status, rateLimited: fault.rateLimited === true } : null,
        requests: 0 };
      return respond(response, 200, { ok: true, tip: ethereum.tip });
    }
    // Transactions merge by signature, so a long history is posted in several calls.
    if (request.method === 'POST' && request.url === '/__control/solana') {
      const data = await readJson(request);
      const base58 = (value, min, max) => typeof value === 'string' && new RegExp(`^[1-9A-HJ-NP-Za-km-z]{${min},${max}}$`).test(value);
      const transaction = (item) => item && typeof item === 'object' && base58(item.signature, 64, 88)
        && item.result && typeof item.result === 'object' && Number.isSafeInteger(item.result.slot)
        && item.result.meta && typeof item.result.meta === 'object'
        && Array.isArray(item.result.transaction?.signatures) && item.result.transaction.signatures[0] === item.signature
        && Array.isArray(item.result.transaction?.message?.accountKeys)
        && item.result.transaction.message.accountKeys.every((key) => base58(key, 32, 44));
      const fault = data.fault;
      const stakes = data.stakes;
      if ((data.slot !== undefined && (!Number.isSafeInteger(data.slot) || data.slot < 0 || data.slot >= 2 ** 31))
        || (data.epoch !== undefined && (!Number.isSafeInteger(data.epoch) || data.epoch < 0))
        || (stakes !== undefined && (!stakes || typeof stakes !== 'object' || Array.isArray(stakes)
          || Object.keys(stakes).length > 20 || !Object.keys(stakes).every((key) => base58(key, 32, 44))
          || !Object.values(stakes).every((value) => value === null || (typeof value === 'object' && !Array.isArray(value)))))
        || (data.transactions !== undefined && (!Array.isArray(data.transactions) || data.transactions.length > 20
          || !data.transactions.every(transaction)))
        || (fault !== undefined && (!fault || !Number.isSafeInteger(fault.onRequest) || fault.onRequest < 1
          || (fault.rateLimited !== true && (!Number.isInteger(fault.status) || fault.status < 300 || fault.status > 599))))) {
        return respond(response, 400, { error: 'Invalid synthetic Solana fixture' });
      }
      for (const item of data.transactions ?? []) solana.transactions.set(item.signature, item.result);
      if (solana.transactions.size > 200) return respond(response, 400, { error: 'Synthetic history is bounded' });
      for (const [key, value] of Object.entries(stakes ?? {})) solana.stakes.set(key, value);
      solana = { ...solana, slot: data.slot ?? solana.slot, epoch: data.epoch ?? solana.epoch,
        fault: fault ? { onRequest: fault.onRequest, status: fault.status, rateLimited: fault.rateLimited === true } : null,
        requests: 0 };
      return respond(response, 200, { ok: true, slot: solana.slot, transactions: solana.transactions.size });
    }
    // Items merge by id, so a long history is posted in several calls.
    if (request.method === 'POST' && request.url === '/__control/tron') {
      const data = await readJson(request);
      const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
      const hash = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
      const time = (value) => Number.isSafeInteger(value) && value >= 0;
      const items = (value, valid) => value === undefined || (Array.isArray(value) && value.length <= 20 && value.every(valid));
      const transaction = (item) => object(item) && hash(item.txID) && time(item.block_timestamp)
        && Number.isSafeInteger(item.blockNumber) && Array.isArray(item.raw_data?.contract) && item.raw_data.contract.length === 1
        && object(item.raw_data.contract[0].parameter?.value);
      const internal = (item) => object(item) && hash(item.tx_id) && typeof item.internal_tx_id === 'string' && time(item.block_timestamp);
      const token = (item) => object(item) && hash(item.transaction_id) && time(item.block_timestamp) && object(item.token_info)
        && tronHex(item.from) !== null && tronHex(item.to) !== null && typeof item.value === 'string';
      const keyed = (value, key, valid) => value === undefined || (object(value) && Object.keys(value).length <= 20
        && Object.entries(value).every(([name, field]) => key(name) && valid(field)));
      const fault = data.fault;
      if ((data.tip !== undefined && !(object(data.tip) && Number.isSafeInteger(data.tip.number) && time(data.tip.timestamp)))
        || !items(data.transactions, transaction) || !items(data.internal, internal) || !items(data.tokens, token)
        || !keyed(data.infos, hash, (info) => object(info) && info.id !== undefined && time(info.blockTimeStamp))
        || !keyed(data.accounts, (name) => tronHex(name) !== null, object)
        || !keyed(data.rewards, (name) => tronHex(name) !== null, (value) => Number.isSafeInteger(value) && value > 0)
        || (data.pageSize !== undefined && (!Number.isSafeInteger(data.pageSize) || data.pageSize < 1 || data.pageSize > 200))
        || (data.key !== undefined && data.key !== null && (typeof data.key !== 'string' || !/^[a-z-]{1,40}$/.test(data.key)))
        || !keyed(data.tronscan, (name) => tronHex(name) !== null, (value) => Array.isArray(value) && value.length <= 60 && value.every(object))
        || (data.tronscanFault !== undefined && typeof data.tronscanFault !== 'boolean')
        || (fault !== undefined && fault !== null && (!object(fault) || !Number.isSafeInteger(fault.onRequest) || fault.onRequest < 1
          || (fault.limited !== true && (!Number.isInteger(fault.status) || fault.status < 300 || fault.status > 599))))) {
        return respond(response, 400, { error: 'Invalid synthetic Tron fixture' });
      }
      for (const item of data.transactions ?? []) tron.transactions.set(item.txID, item);
      for (const item of data.internal ?? []) tron.internal.set(item.internal_tx_id, item);
      for (const item of data.tokens ?? []) tron.tokens.set(`${item.transaction_id}:${item.from}:${item.to}:${item.value}`, item);
      for (const [name, info] of Object.entries(data.infos ?? {})) tron.infos.set(name, info);
      for (const [name, value] of Object.entries(data.accounts ?? {})) tron.accounts.set(name, value);
      for (const [name, value] of Object.entries(data.rewards ?? {})) tron.rewards.set(name, value);
      for (const [name, value] of Object.entries(data.tronscan ?? {})) tron.tronscan.set(name, value);
      if (tron.transactions.size + tron.internal.size + tron.tokens.size > 300) return respond(response, 400, { error: 'Synthetic history is bounded' });
      tron = { ...tron, tip: data.tip ?? tron.tip, pageSize: data.pageSize ?? tron.pageSize,
        key: data.key === undefined ? tron.key : data.key, tronscanFault: data.tronscanFault ?? tron.tronscanFault,
        fault: fault ? { onRequest: fault.onRequest, status: fault.status, limited: fault.limited === true } : null,
        requests: 0 };
      return respond(response, 200, { ok: true, tip: tron.tip });
    }
    if (request.method === 'POST' && request.url === '/__control/stellar') {
      const data = await readJson(request);
      const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
      const token = (value) => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value);
      const hash = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
      const items = (value, valid) => value === undefined || (Array.isArray(value) && value.length <= 20 && value.every(valid));
      const keyed = (value, key, valid) => value === undefined || (object(value) && Object.keys(value).length <= 20
        && Object.entries(value).every(([name, field]) => key(name) && valid(field)));
      const fault = data.fault;
      if (!items(data.transactions, (item) => object(item) && token(item.paging_token) && hash(item.hash))
        || !items(data.payments, (item) => object(item) && token(item.paging_token) && hash(item.transaction_hash)
          && typeof item.type === 'string')
        || !keyed(data.effects, (name) => /^[0-9]{1,19}$/.test(name), (value) => Array.isArray(value) && value.length <= 10)
        || !keyed(data.accounts, (name) => /^G[A-Z2-7]{55}$/.test(name), (value) => object(value) && Array.isArray(value.balances))
        || (data.pageSize !== undefined && (!Number.isSafeInteger(data.pageSize) || data.pageSize < 1 || data.pageSize > 200))
        || (fault !== undefined && fault !== null && (!object(fault) || !Number.isSafeInteger(fault.onRequest) || fault.onRequest < 1
          || !Number.isInteger(fault.status) || fault.status < 300 || fault.status > 599))) {
        return respond(response, 400, { error: 'Invalid synthetic Stellar fixture' });
      }
      for (const item of data.transactions ?? []) stellar.transactions.set(item.paging_token, item);
      for (const item of data.payments ?? []) stellar.payments.set(item.paging_token, item);
      for (const [name, value] of Object.entries(data.effects ?? {})) stellar.effects.set(name, value);
      for (const [name, value] of Object.entries(data.accounts ?? {})) stellar.accounts.set(name, value);
      if (stellar.transactions.size + stellar.payments.size > 300) return respond(response, 400, { error: 'Synthetic history is bounded' });
      stellar = { ...stellar, pageSize: data.pageSize ?? stellar.pageSize,
        fault: fault ? { onRequest: fault.onRequest, status: fault.status } : null, requests: 0 };
      return respond(response, 200, { ok: true, transactions: stellar.transactions.size });
    }
    if (request.method === 'POST' && request.url === '/__control/zcash') {
      const data = await readJson(request);
      const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
      const height = (value) => Number.isSafeInteger(value) && value >= 0 && value < 2 ** 31;
      const fault = data.fault;
      if ((data.transactions !== undefined && !(Array.isArray(data.transactions) && data.transactions.length <= 20
          && data.transactions.every((item) => object(item) && typeof item.txid === 'string' && /^[0-9a-f]{64}$/.test(item.txid)
            && height(item.blockHeight) && Array.isArray(item.vin) && Array.isArray(item.vout))))
        || (data.tip !== undefined && !height(data.tip))
        || (data.inSync !== undefined && typeof data.inSync !== 'boolean')
        || (fault !== undefined && fault !== null && (!object(fault) || !['zec1.trezor.io', 'zec5.trezor.io'].includes(fault.host)
          || !Number.isSafeInteger(fault.onRequest) || fault.onRequest < 1
          || !Number.isInteger(fault.status) || fault.status < 300 || fault.status > 599))) {
        return respond(response, 400, { error: 'Invalid synthetic Zcash fixture' });
      }
      for (const item of data.transactions ?? []) zcash.transactions.set(item.txid, item);
      if (zcash.transactions.size > 200) return respond(response, 400, { error: 'Synthetic history is bounded' });
      zcash = { ...zcash, tip: data.tip ?? zcash.tip, inSync: data.inSync ?? zcash.inSync,
        fault: fault ? { host: fault.host, onRequest: fault.onRequest, status: fault.status } : null, requests: 0 };
      return respond(response, 200, { ok: true, transactions: zcash.transactions.size });
    }
    if (request.method === 'POST' && request.url === '/__control/bitcoin-history') {
      const data = await readJson(request);
      const fault = data.fault;
      if (typeof data.address !== 'string' || !/^[a-zA-Z0-9]{14,90}$/.test(data.address)
        || (data.count !== undefined && (!Number.isSafeInteger(data.count) || data.count < 0 || data.count > 500))
        || (data.append !== undefined && (!Number.isSafeInteger(data.append) || data.append < 1 || data.append > 100))
        || (fault !== undefined && (!fault || !Number.isSafeInteger(fault.onRequest) || fault.onRequest < 1
          || (fault.invalid !== true && fault.empty !== true
            && (!Number.isInteger(fault.status) || fault.status < 300 || fault.status > 599))))) {
        return respond(response, 400, { error: 'Invalid synthetic Bitcoin history fixture' });
      }
      const current = bitcoinHistories.get(data.address) ?? { count: 0, fault: null, requests: 0 };
      const count = data.count ?? current.count + (data.append ?? 0);
      if (count > 500) return respond(response, 400, { error: 'Synthetic history is bounded' });
      const next = { count, fault: fault ? { onRequest: fault.onRequest, status: fault.status, invalid: fault.invalid === true, empty: fault.empty === true } : null, requests: 0 };
      bitcoinHistories.set(data.address, next);
      return respond(response, 200, { address: data.address, count, newestTxid: count ? historyTx(data.address, count - 1).txid : null });
    }
    if (request.method === 'POST' && request.url === '/__control/bitcoin-chain') {
      const data = await readJson(request);
      const address = (value) => typeof value === 'string' && /^[a-zA-Z0-9]{14,90}$/.test(value);
      const amount = (value) => Number.isSafeInteger(value) && value >= 0;
      const parts = (list) => Array.isArray(list) && list.length >= 1 && list.length <= 8
        && list.every((part) => Array.isArray(part) && part.length === 2 && address(part[0]) && amount(part[1]));
      const fault = data.fault;
      if (!Array.isArray(data.transactions) || !data.transactions.every((tx) => tx && /^[0-9a-f]{64}$/.test(tx.txid)
          && Number.isSafeInteger(tx.height) && tx.height >= 800000 && tx.height < 900000
          && parts(tx.inputs) && parts(tx.outputs) && amount(tx.fee))
        || (fault !== undefined && (!fault || !Number.isSafeInteger(fault.onRequest) || fault.onRequest < 1
          || (fault.empty !== true && (!Number.isInteger(fault.status) || fault.status < 300 || fault.status > 599))))) {
        return respond(response, 400, { error: 'Invalid synthetic Bitcoin chain fixture' });
      }
      const transactions = [...(data.append ? bitcoinChain?.transactions ?? [] : []), ...data.transactions.map(chainTx)];
      if (transactions.length > 200 || new Set(transactions.map(({ txid }) => txid)).size !== transactions.length) {
        return respond(response, 400, { error: 'Synthetic chain is bounded and names each transaction once' });
      }
      transactions.sort((left, right) => left.status.block_height - right.status.block_height);
      bitcoinChain = { transactions, requests: 0,
        fault: fault ? { onRequest: fault.onRequest, status: fault.status, empty: fault.empty === true } : null };
      return respond(response, 200, { ok: true, transactions: transactions.length });
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
      // Solana JSON-RPC is the one provider called with a body: one bounded JSON POST to "/".
      if (host === solanaHost && incoming.method === 'POST' && url.pathname === '/' && !url.search
        && !incoming.headers['transfer-encoding'] && /^[1-9][0-9]{0,3}$/.test(incoming.headers['content-length'] ?? '')) {
        return solanaRequest(incoming, response, url);
      }
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

// One SMTP session at a time per socket: greeting, EHLO, AUTH PLAIN, one envelope, DATA, QUIT.
const smtp = tls.createServer({
  ...credentials,
  handshakeTimeout: 5000,
  SNICallback(servername, callback) {
    if (servername !== smtpHost) return callback(new Error('Fixture TLS authority mismatch'));
    callback(null, secureContext);
  },
}, (socket) => {
  socket.setTimeout(10000, () => socket.destroy());
  socket.on('error', () => socket.destroy());
  const reply = (line) => socket.write(`${line}\r\n`);
  const state = { authenticated: false, from: null, to: [], data: null };
  let buffer = '';
  reply(`220 ${smtpHost} ESMTP synthetic fixture`);
  socket.on('data', (chunk) => {
    buffer += chunk.toString('latin1');
    if (buffer.length > 262144) return socket.destroy();
    for (;;) {
      if (state.data !== null) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end < 0) return;
        const message = (state.data + buffer.slice(0, end)).replace(/^\.\./gm, '.');
        buffer = buffer.slice(end + 5);
        state.data = null;
        if (mail.length >= 100) {
          reply('452 4.3.1 Fixture mailbox full');
        } else {
          mail.push({ from: state.from, to: state.to, message });
          reply('250 2.0.0 Ok: queued');
        }
        state.from = null;
        state.to = [];
        continue;
      }
      const end = buffer.indexOf('\r\n');
      if (end < 0) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const [verb] = line.split(' ', 1);
      switch (verb.toUpperCase()) {
        case 'EHLO':
          reply(`250-${smtpHost}`);
          reply('250-AUTH PLAIN');
          reply('250 8BITMIME');
          break;
        case 'AUTH': {
          const [, method, encoded] = line.split(' ');
          const parts = Buffer.from(encoded ?? '', 'base64').toString('utf8').split('\0');
          state.authenticated = method === 'PLAIN' && parts.length === 3
            && parts[1] === smtpUser && parts[2] === smtpPassword;
          reply(state.authenticated ? '235 2.7.0 Authentication successful' : '535 5.7.8 Invalid credentials');
          break;
        }
        case 'MAIL': {
          const from = /^MAIL FROM:<([^>]*)>/i.exec(line)?.[1];
          if (!state.authenticated) reply('530 5.7.0 Authentication required');
          else if (from !== smtpUser) reply('553 5.7.1 Sender must be the authenticated mailbox');
          else { state.from = from; reply('250 2.1.0 Ok'); }
          break;
        }
        case 'RCPT': {
          const to = /^RCPT TO:<([^>]+)>/i.exec(line)?.[1];
          if (!state.from || !to) reply('503 5.5.1 Bad sequence');
          else { state.to.push(to); reply('250 2.1.5 Ok'); }
          break;
        }
        case 'DATA':
          if (!state.from || !state.to.length) { reply('503 5.5.1 Bad sequence'); break; }
          state.data = '';
          reply('354 End data with <CR><LF>.<CR><LF>');
          break;
        case 'RSET':
          state.from = null;
          state.to = [];
          reply('250 2.0.0 Ok');
          break;
        case 'NOOP':
          reply('250 2.0.0 Ok');
          break;
        case 'QUIT':
          reply('221 2.0.0 Bye');
          socket.end();
          return;
        default:
          reply('502 5.5.2 Command not implemented');
      }
    }
  });
});
smtp.on('tlsClientError', (_error, socket) => socket.destroy());
smtp.listen(2465, '0.0.0.0');
