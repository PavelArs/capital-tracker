'use strict';
// Synthetic protocol client: all positive credentials come from actual Set-Cookie.
const http = require('node:http');
const https = require('node:https');
const { readFileSync } = require('node:fs');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 65536) throw new Error('Bounded client input exceeded');
  }
  const { requests, jar: initialJar = {}, directAddress } = JSON.parse(input);
  if (!Array.isArray(requests) || requests.length > 40) throw new Error('Invalid request batch');
  const jar = { ...initialJar };
  const responses = [];
  for (const command of requests) {
    if (typeof command.path !== 'string' || !command.path.startsWith('/') || command.path.startsWith('//')) {
      throw new Error('Expected an origin-relative path');
    }
    const body = command.body === undefined ? undefined : JSON.stringify(command.body);
    const headers = {
      Host: '127.0.0.1:8443', Origin: 'https://127.0.0.1:8443',
      ...(Object.keys(jar).length ? { Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }),
      ...command.headers,
    };
    const result = await new Promise((resolve, reject) => {
      const transport = directAddress ? http : https;
      const request = transport.request({
        hostname: directAddress ?? 'proxy', port: directAddress ? 3000 : 443,
        ...(directAddress ? {} : { servername: 'localhost', ca: readFileSync('/tests/public-ca.pem'), rejectUnauthorized: true }),
        method: command.method, path: command.path, headers, timeout: 8000,
      }, (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
          if (Buffer.byteLength(text) > 262144) response.destroy(new Error('Bounded response exceeded'));
        });
        response.on('error', reject);
        response.on('end', () => {
          for (const cookie of response.headers['set-cookie'] ?? []) {
            const first = cookie.split(';')[0];
            const separator = first.indexOf('=');
            if (separator < 1) continue;
            const name = first.slice(0, separator), value = first.slice(separator + 1);
            if (!value || /(?:^|;)\s*max-age=0(?:;|$)/i.test(cookie)) delete jar[name];
            else jar[name] = value;
          }
          let payload = text;
          try { payload = JSON.parse(text); } catch { /* Preserve empty/non-JSON responses. */ }
          resolve({ status: response.statusCode, headers: response.headers, body: payload,
            localAddress: request.socket.localAddress, remoteAddress: request.socket.remoteAddress });
        });
      });
      request.on('error', reject);
      request.on('timeout', () => request.destroy(new Error('Source client request timed out')));
      request.end(body);
    });
    responses.push(result);
  }
  process.stdout.write(JSON.stringify({ responses, jar }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
